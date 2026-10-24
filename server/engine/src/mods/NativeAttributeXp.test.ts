import World from '../engine/World.js';
import { beforeAll, afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Player, { getExpByLevel, getLevelByExp } from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import Packet from '../io/Packet.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { MarketStore, playerSaveStore } from '../engine/market/MarketStore.js';
import Environment from '../util/Environment.js';
import { loadPackedContent, kitchen, options, request, closeNativeFoodFixtures } from './native-food-skill-fixture.js';
import { executeFoodSkillRequest } from '../../../gateway/admin/native-food-skills.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import JavaRandom from '../util/JavaRandom.js';
import { validateSkillCapPolicy } from '../../../../character-attributes/skill-cap-policy.js';
import { CharacterAttributeStore } from '../../../../character-attributes/binding-store.js';
import { attributeMember, attributeCreation } from '../../../../character-attributes/test/binding-fixture.js';
import { checkpointNativeAttributeXp, prepareNativeAttributeXp } from './NativeAttributeXp.js';
import { runWorldModXpAwardHook, type ActiveWorldModSnapshot } from './WorldMods.js';

const dirs: string[] = [], stores: MarketStore[] = [];
let fixtureSequence = 0;
const rate = Environment.node.xpRate;
beforeAll(loadPackedContent);
afterEach(() => {
    Environment.node.xpRate = rate;
    closeNativeFoodFixtures();
    for (const store of stores.splice(0)) store.db.close(true);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(username = `xp${++fixtureSequence}`, value = 0, kind = 'attribute-hard-cap', maximumLevel?: number) {
    const dir = mkdtempSync(join(tmpdir(), 'native-attribute-')); dirs.push(dir);
    const path = join(dir, 'checkpoints.sqlite'), market = new MarketStore(path); stores.push(market);
    const member = attributeMember(username), profiles = new CharacterAttributeStore(market.db);
    const creation = attributeCreation(member, value, kind);
    if (maximumLevel !== undefined) {
        const { digest: _digest, ...definition } = creation.capPolicy;
        creation.capPolicy = validateSkillCapPolicy({ ...definition, maximumLevel });
    }
    const binding = profiles.bind(member, creation);
    const player = new Player(username, 2n, 2n);
    player.levels.fill(1); player.baseLevels.fill(1);
    player.nativeAttributeXpContext = () => {
        const current = profiles.get(member);
        if (!current) throw new Error('Explicit attribute migration required');
        return { binding: current, worldId: 'si-c01-disposable-world', clock: {
            clockId: member.simulationClock.clockId, profileDigest: member.simulationClock.profileDigest,
            wallTime: '2026-10-24T12:00:01.000Z', simulationTime: '2001-01-01T00:00:01.000Z',
            status: 'running', revision: 1, engineTick: World.currentTick } };
    };
    const save = () => {
        market.db.transaction(() => {
            const bytes = player.save(false); market.checkpoint(username, bytes, true);
            checkpointNativeAttributeXp(market.db, player, bytes);
        }).immediate();
    };
    const receipts = () => market.db.query<{ payload: string }, []>('SELECT payload FROM native_attribute_xp_receipt ORDER BY rowid')
        .all().map(row => JSON.parse(row.payload));
    const reload = () => PlayerLoading.load(username, new Packet(market.saved(username)!), null);
    return { path, market, player, member, profiles, binding, save, receipts, reload };
}

test('SI-C01 paired actual Player workloads persist different XP in all four native skills', () => {
    const lower = fixture('alice', 0), higher = fixture('bob', 10);
    for (const stat of [PlayerStat.FISHING, PlayerStat.COOKING, PlayerStat.MINING, PlayerStat.SMITHING]) {
        lower.player.addXp(stat, 80, false); higher.player.addXp(stat, 80, false);
        expect(lower.player.stats[stat]).toBe(60); expect(higher.player.stats[stat]).toBe(100);
    }
    // Exercise the production World checkpoint boundary, not just the receipt helper.
    World.checkpointPlayers(lower.player); World.checkpointPlayers(higher.player);
    expect(lower.player.nativeAttributeXpReceipts).toHaveLength(0);
    const canonical = playerSaveStore()!;
    const restored = PlayerLoading.load('alice', new Packet(canonical.saved('alice')!), null);
    expect(restored.stats[PlayerStat.FISHING]).toBe(60);
    const row = canonical.db.query<{ count: number }, []>('SELECT count(*) count FROM native_attribute_xp_receipt').get()!;
    expect(row.count).toBe(8);
    expect(lower.profiles.get(lower.member)).toEqual(lower.binding);
    const evidence = (f: ReturnType<typeof fixture>) => ({ username: f.player.username,
        bindingDigest: f.binding.digest, attributesDigest: f.binding.attributes.digest,
        potentialPolicy: f.binding.potentialPolicy.digest, capPolicy: f.binding.capPolicy.digest,
        awards: canonical.db.query<{ payload: string; checkpoint_digest: string }, [string]>(
            'SELECT payload,checkpoint_digest FROM native_attribute_xp_receipt WHERE username=? ORDER BY rowid')
            .all(f.player.username).map(row => { const award = JSON.parse(row.payload);
                return { skill: award.skill, requestedXp: award.requestedXp, grantedXp: award.grantedXp,
                    afterXp: award.afterXp, checkpointDigest: row.checkpoint_digest }; }) });
    console.info('[SI-C01 paired]', JSON.stringify({ source: 'actual-Player.addXp/World.checkpointPlayers',
        clockId: lower.binding.clockId, low: 60, high: 100, skills: 4, receipts: 8,
        actors: [evidence(lower), evidence(higher)] }));
});

test('SI-C01 hard cap clips crossing awards after global rate and cannot be bypassed by allowMulti=false', () => {
    const f = fixture(); Environment.node.xpRate = 2;
    const capXp = getExpByLevel(40);
    f.player.stats[PlayerStat.MINING] = capXp - 5;
    f.player.baseLevels[PlayerStat.MINING] = f.player.levels[PlayerStat.MINING] = 39;
    f.player.addXp(PlayerStat.MINING, 80);
    expect(f.player.stats[PlayerStat.MINING]).toBe(capXp);
    expect(f.player.nativeAttributeXpReceipts[0]).toMatchObject({ globalMultiplier: 2, grantedXp: 5 });
    f.player.addXp(PlayerStat.MINING, 80, false);
    expect(f.player.stats[PlayerStat.MINING]).toBe(capXp);
    expect(f.player.nativeAttributeXpReceipts[1]!.grantedXp).toBe(0);
    f.save(); expect(f.reload().baseLevels[PlayerStat.MINING]).toBe(40);
});

test('SI-C01 soft cap uses the pre-award personal level and applies its configured slowdown', () => {
    const f = fixture('softcap', 0, 'attribute-soft-cap');
    f.player.setLevel(PlayerStat.COOKING, 40); const before = f.player.stats[PlayerStat.COOKING];
    f.player.addXp(PlayerStat.COOKING, 80, false);
    expect(f.player.stats[PlayerStat.COOKING] - before).toBe(15);
    expect(f.player.nativeAttributeXpReceipts[0]!.progression.capDecision).toMatchObject({
        personalSoftCapLevel: 40, personalHardCapLevel: 99, learningMultiplierBps: 1875 });
    f.save(); expect(f.reload().stats[PlayerStat.COOKING]).toBe(before + 15);
});

test('SI-C01 facility cap retains personal skills and clips actual XP at the facility policy ceiling', () => {
    const f = fixture('facility', 10, 'facility-centered-cap');
    f.player.setLevel(PlayerStat.SMITHING, 59); const before = f.player.stats[PlayerStat.SMITHING];
    expect(f.binding.potential.skills.find(skill => skill.skillId === 'smithing')!.personalPotentialLevel).toBe(99);
    f.player.addXp(PlayerStat.SMITHING, 2_000_000, false);
    expect(f.player.stats[PlayerStat.SMITHING]).toBe(getExpByLevel(60));
    expect(f.player.stats[PlayerStat.SMITHING]).toBeGreaterThan(before);
    expect(f.player.nativeAttributeXpReceipts[0]!.progression.capDecision).toMatchObject({
        personalHardCapLevel: 60, providedCapabilityRequired: 'advanced-production-facility' });
    expect(f.profiles.get(f.member)).toEqual(f.binding);
    f.player.setLevel(PlayerStat.SMITHING, 75); const existing = f.player.stats[PlayerStat.SMITHING];
    f.player.addXp(PlayerStat.SMITHING, 80, false);
    expect(f.player.stats[PlayerStat.SMITHING]).toBe(existing);
    expect(f.player.baseLevels[PlayerStat.SMITHING]).toBe(75);
});

test('SI-C01 every other skill stays vanilla; unregistered legacy avatars retain their XP path', () => {
    const f = fixture(); f.player.nativeAttributeXpContext = () => { throw new Error('Unexpected profile lookup'); };
    for (const stat of [0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 15, 16, 17, 18, 19, 20]) {
        f.player.addXp(stat, 83, false); expect(f.player.stats[stat]).toBe(83);
    }
    expect(f.player.nativeAttributeXpReceipts).toHaveLength(0);
    f.player.nativeAttributeXpContext = () => null;
    f.player.addXp(PlayerStat.FISHING, 83, false); expect(f.player.stats[PlayerStat.FISHING]).toBe(83);
});

test('SI-C01 missing lifecycle profile rejects before XP and never substitutes an average', () => {
    const f = fixture(); f.member.sourceResultDigest = 'f'.repeat(64);
    expect(() => f.player.addXp(PlayerStat.FISHING, 80)).toThrow('migration required');
    expect(f.player.stats[PlayerStat.FISHING]).toBe(0);
    expect(f.player.nativeAttributeXpReceipts).toHaveLength(0);
});

test('SI-C01 mismatched or paused clock rejects without awarding XP', () => {
    const f = fixture(), resolve = f.player.nativeAttributeXpContext!;
    for (const patch of [{ clockId: 'other' }, { profileDigest: 'f'.repeat(64) }, { status: 'paused' as const }]) {
        f.player.nativeAttributeXpContext = (name, tick) => { const context = resolve(name, tick)!;
            return { ...context, clock: { ...context.clock, ...patch } }; };
        expect(() => f.player.addXp(PlayerStat.FISHING, 80, false)).toThrow('identity/clock mismatch');
    }
    expect(f.player.stats[PlayerStat.FISHING]).toBe(0);
});

test('SI-C01 checkpoint receipt failure rolls back Player bytes; retry/reopen preserve a single XP award', () => {
    const f = fixture(); f.save();
    const original = f.market.saved(f.player.username)!;
    f.player.addXp(PlayerStat.FISHING, 80, false);
    // Establish the additive receipt schema, then reject its first durable insert.
    f.market.db.transaction(() => { checkpointNativeAttributeXp(f.market.db, f.player, f.player.save(false)); }).immediate();
    f.market.db.run('DROP TRIGGER native_attribute_xp_no_delete'); f.market.db.run('DELETE FROM native_attribute_xp_receipt');
    f.market.db.run("CREATE TRIGGER reject_xp BEFORE INSERT ON native_attribute_xp_receipt BEGIN SELECT RAISE(ABORT,'injected XP write failure'); END");
    expect(f.save).toThrow('injected XP write failure');
    expect(f.market.saved(f.player.username)).toEqual(original); expect(f.receipts()).toEqual([]);
    expect(f.player.nativeAttributeXpReceipts).toHaveLength(1);
    f.market.db.run('DROP TRIGGER reject_xp'); f.save(); f.save();
    const reopened = new MarketStore(f.path); stores.push(reopened);
    expect(PlayerLoading.load(f.player.username, new Packet(reopened.saved(f.player.username)!), null).stats[PlayerStat.FISHING]).toBe(60);
    expect(f.receipts()).toHaveLength(1);
    expect(f.receipts()[0]).toMatchObject({ requestedXp: 80, grantedXp: 60, beforeXp: 0, afterXp: 60 });
});

test('SI-C01 stale Player bytes cannot attest a new XP receipt and nested rollback retains pending evidence', () => {
    const f = fixture(), stale = f.player.save(false);
    f.player.addXp(PlayerStat.FISHING, 80, false);
    expect(() => f.market.db.transaction(() => {
        f.market.checkpoint(f.player.username, stale, true); checkpointNativeAttributeXp(f.market.db, f.player, stale);
    }).immediate()).toThrow('differs from Player checkpoint');
    expect(f.market.saved(f.player.username)).toBeUndefined();
    expect(() => playerSaveStore()!.db.transaction(() => { World.checkpointPlayers(f.player); throw new Error('outer failed'); }).immediate()).toThrow('outer failed');
    expect(f.player.nativeAttributeXpReceipts).toHaveLength(1);
    World.checkpointPlayers(f.player); expect(f.player.nativeAttributeXpReceipts).toHaveLength(0);
});

test('SI-C01 native hook composition rounds experiment then diminishing then potential then global rate', () => {
    const f = fixture();
    const metric = () => ({ status: 'active' as const, hookInvocations: 0, hookErrors: 0,
        lastHookAt: null, lastError: null, counters: {}, details: [] });
    const active: ActiveWorldModSnapshot = { schemaVersion: 1, revision: 1, loadedAt: '', lastReloadAt: null, loadError: null,
        mods: {
            'experiment.xp-calibration': { enabled: true, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1,
                config: { profileId: 'fixture', profileVersion: '1.0.0', profileDigest: 'a'.repeat(64),
                    rewardsJson: '[{"activityKey":"skill:fishing","multiplier":1.5}]' } },
            'economy.diminishing-xp': { enabled: true, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1,
                config: { affectedSkills: 'FISHING', regionSize: 64, recoveryMinutes: 60, tier2At: 5, tier3At: 15, tier4At: 30, tier5At: 60,
                    multiplier2: 0.9, multiplier3: 0.7, multiplier4: 0.4, multiplier5: 0.15 } } },
        metrics: { 'experiment.xp-calibration': metric(), 'economy.diminishing-xp': metric() } };
    const activity = { script: 'fixture', targetKind: 'none' as const, targetId: null, x: 0, z: 0, level: 0 };
    const award = prepareNativeAttributeXp(f.player, 'FISHING', 83, 0, 1, 100, true, 2, activity,
        () => runWorldModXpAwardHook(active, f.player, 'FISHING', 83, activity, {
            award: (_name, _skill, _context, xp) => { expect(xp).toBe(125);
                return { activityKey: 'fixture', baseXp: xp, grantedXp: 88, multiplier: 0.7, repetitionScore: 15, nextRecoveryAt: '' }; },
            summary: () => ({ playersTracked: 1, activitiesTracked: 1 }) }), () => 'a'.repeat(64), getExpByLevel, () => {})!;
    expect(award).toMatchObject({ requestedXp: 83, worldModXp: 88, potentialXp: 66, globalMultiplier: 2, grantedXp: 132 });
    expect(getLevelByExp(award.afterXp)).toBe(1);
});

test('SI-C01 level-one and level-99 hard ceilings cannot produce NaN or XP overshoot', () => {
    const lower = fixture('capone', 0, 'attribute-hard-cap', 1);
    lower.player.addXp(PlayerStat.MINING, 80, false);
    expect(lower.player.stats[PlayerStat.MINING]).toBe(0);
    const higher = fixture('capninetynin', 10);
    higher.player.stats[PlayerStat.MINING] = getExpByLevel(99) - 5;
    higher.player.baseLevels[PlayerStat.MINING] = higher.player.levels[PlayerStat.MINING] = 98;
    higher.player.addXp(PlayerStat.MINING, 80, false);
    expect(higher.player.stats[PlayerStat.MINING]).toBe(getExpByLevel(99));
    expect(higher.player.nativeAttributeXpReceipts[0]!.grantedXp).toBe(5);
});

test('SI-C01 failed native gathering restores pending XP evidence together with actual Player stats', async () => {
    const f = kitchen(), attributes = fixture('prodtest', 10), opts = options(f);
    f.player.nativeAttributeXpContext = attributes.player.nativeAttributeXpContext;
    f.player.setLevel(PlayerStat.FISHING, 40);
    f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick); JavaRandom.setSeed(4096);
    const before = [...f.player.stats]; let checkpoints = 0, observedXp = false;
    f.ports.checkpoint = save => {
        if (++checkpoints === 2) {
            observedXp = f.player.nativeAttributeXpReceipts.length > 0;
            throw new Error('checkpoint failure after native attribute XP');
        }
        f.market.checkpoint('prodtest', save, true);
    };
    expect(await executeFoodSkillRequest(opts, 'prodtest', request('food-gather')))
        .toMatchObject({ success: false, reason: 'food-uncertain' });
    expect(observedXp).toBeTrue(); expect([...f.player.stats]).toEqual(before);
    expect(f.player.nativeAttributeXpReceipts).toHaveLength(0);
});

test('SI-C01 failed logout flush retains pending receipts after the Player leaves the online list', () => {
    const f = fixture('logoutxp'), canonical = playerSaveStore()!;
    canonical.checkpoint(f.player.username, f.player.save(false), true);
    f.player.addXp(PlayerStat.FISHING, 80, false);
    canonical.db.run("CREATE TRIGGER reject_logout_xp BEFORE INSERT ON native_attribute_xp_receipt WHEN NEW.username='logoutxp' BEGIN SELECT RAISE(ABORT,'logout receipt failure'); END");
    try {
        expect(() => World.flushPlayer(f.player)).toThrow('logout receipt failure');
        expect(World.logoutRequests.get('logoutxp')!.nativeXp!.nativeAttributeXpReceipts).toHaveLength(1);
        expect(PlayerLoading.load('logoutxp', new Packet(canonical.saved('logoutxp')!), null).stats[PlayerStat.FISHING]).toBe(0);
        canonical.db.run('DROP TRIGGER reject_logout_xp');
        World.checkpointPlayers(); // No online Player and no extra argument: recover from the pending logout.
        expect(f.player.nativeAttributeXpReceipts).toHaveLength(0);
        expect(PlayerLoading.load('logoutxp', new Packet(canonical.saved('logoutxp')!), null).stats[PlayerStat.FISHING]).toBe(60);
    } finally {
        canonical.db.run('DROP TRIGGER IF EXISTS reject_logout_xp');
        World.logoutRequests.delete('logoutxp');
    }
});
