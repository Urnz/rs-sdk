import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../config.js';
import { NeedsStore, type NeedsBinding } from '../store.js';
import { advanceNeedsFromClock } from '../dynamics.js';
import { validateNeedsPolicy } from '../profile.js';
import { FoodConsumptionStore, closeFoodLoop, loadFoodLoopCatalog } from '../../food-loop/index.js';
import { FoodNeedsPersistence } from '../../food-loop/needs-persistence.js';
import type { FoodInventoryReceipt } from '../../food-loop/types.js';

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = join(import.meta.dir, '../../config');
const policy = loadNeedsPolicyCatalog(join(config, 'needs-policies.json')).policies[0]!;
const dynamics = loadNeedsDynamicsPolicyCatalog(join(config, 'needs-dynamics-policies.json'), policy).policies[0]!;
const catalog = loadFoodLoopCatalog(join(config, 'food-loops.json'));
const start = '2030-01-01T00:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
function harness() {
    const root = mkdtempSync(join(tmpdir(), 'si-needs-')); roots.push(root);
    const clockPath = join(root, 'clock.sqlite'), path = join(root, 'needs.sqlite');
    let clock = new SimulationClockStore(clockPath);
    const created = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal',
        version: '1.0.0', seed: 'needs-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } },
        simulationTime: start, wallTime: start });
    let store = new NeedsStore(path, policy, dynamics);
    const binding: NeedsBinding = { worldId: 'world-one', actorId: 'alice', playerId: 'alice', lifecycleId: 'life-1', clockId: 'world',
        clockProfileDigest: created.profileDigest, worldProfileDigest: 'a'.repeat(64), lifecyclePolicyDigest: 'b'.repeat(64) };
    const source = (ms = 0) => ({ binding, clock: clock.observe('world', at(ms)),
        history: clock.getPlayerTimeHistory('world', 'alice'), playerTime: clock.getPlayerTimeState('world', 'alice') });
    let admissionInput: Parameters<NeedsStore['initialize']>[0] | undefined;
    const initialize = () => store.initialize(admissionInput ??= { ...source(), admission: {
        kind: 'genesis', evidenceId: 'genesis-1', evidenceDigest: 'c'.repeat(64) } });
    const advance = (ms: number, terminal?: Parameters<NeedsStore['advance']>[0]['terminal']) => store.advance({ ...source(ms),
        expectedRevision: store.get(binding)?.revision ?? 1, terminal });
    closers.push(() => { store.close(); clock.close(); });
    return { root, path, clockPath, binding, source, initialize, advance, get store() { return store; }, get clock() { return clock; },
        reopen() { store.close(); clock.close(); clock = new SimulationClockStore(clockPath); store = new NeedsStore(path, policy, dynamics); } };
}
const values = (state: ReturnType<NeedsStore['initialize']>) => state.state.values;

describe('durable needs authority', () => {
    test('the readonly starvation consumer waits for a brief real writer lock and preserves the admitted state', async () => {
        const h = harness(), initial = h.initialize(), script = join(h.root, 'hold-needs.ts');
        writeFileSync(script, "import {Database} from 'bun:sqlite'; const db=new Database(process.argv[2]); db.run('BEGIN EXCLUSIVE'); console.log('locked'); await Bun.sleep(200); db.run('COMMIT'); db.close(true);\n");
        const child = Bun.spawn([process.execPath, script, h.path], { stdout: 'pipe', stderr: 'pipe' });
        let reader: NeedsStore | undefined;
        try {
            const output = child.stdout.getReader(), first = await output.read();
            expect(new TextDecoder().decode(first.value)).toContain('locked'); output.releaseLock();
            reader = new NeedsStore(h.path, policy, dynamics, { readonly: true });
            expect(reader.get(h.binding)).toEqual(initial);
            expect(await child.exited).toBe(0);
        } finally { reader?.close(); child.kill(); await child.exited; }
    });
    test('missing state is unknown; admission is explicit, idempotent and cannot reset later work', () => {
        const h = harness(); expect(h.store.read(h.binding)).toEqual({ status: 'unknown', state: null });
        expect(() => h.advance(0)).toThrow('explicit initialization');
        const initial = h.initialize(); expect(h.initialize()).toEqual(initial);
        h.advance(3600000);
        expect(h.initialize().revision).toBe(2);
        expect(() => h.store.initialize({ ...h.source(3600000), admission: {
            kind: 'legacy-explicit', evidenceId: 'reset', evidenceDigest: 'd'.repeat(64) } })).toThrow('conflicts');
    });
    test('many fractional steps equal one large step, including saturation', () => {
        const small = harness(), big = harness(); small.initialize(); big.initialize();
        for (let ms = 59783; ms < 3601234; ms += 59783) small.advance(ms);
        expect(values(small.advance(3601234))).toEqual(values(big.advance(3601234)));
        for (let ms = 3601234 + 3600000; ms < 72 * 3600000; ms += 3600000) small.advance(ms);
        expect(values(small.advance(72 * 3600000))).toEqual(values(big.advance(72 * 3600000)));
    });
    test('reopen preserves remainders and accounts the offline gap once', () => {
        const h = harness(); h.initialize(); h.advance(1234); const before = h.store.get(h.binding)!;
        h.reopen(); expect(h.store.get(h.binding)).toEqual(before);
        const later = h.advance(3601234);
        expect(values(later)[0]).toEqual({ needId: 'hunger', value: 200, remainderNumerator: 246800 });
        expect(h.advance(3601234)).toEqual(later);
    });
    test('clamped sleep recovery has no leftover debt that depends on polling frequency', () => {
        const small = harness(), big = harness();
        for (const h of [small, big]) {
            h.clock.startPlayerSleep('world', 'alice', { sleeperKind: 'npc-agent', sleepPlaceId: 'bed',
                access: { kind: 'bed-entitlement', evidenceId: 'lease', sourceDigest: 'e'.repeat(64),
                    validUntilSimulationTime: null } }, at(0));
            h.initialize();
        }
        for (let ms = 1000; ms <= 5000; ms += 1000) small.advance(ms);
        expect(values(small.store.get(small.binding)!)).toEqual(values(big.advance(5000)));
        expect(values(small.store.get(small.binding)!)[1]!.remainderNumerator).toBe(0);
    });
    test('replays multiple committed online/offline changes after a gateway outage', () => {
        const h = harness(); h.initialize();
        h.clock.recordPlayerPresence('world', 'alice', 'online', at(3600000));
        h.clock.recordPlayerPresence('world', 'alice', 'offline', at(7200000));
        h.reopen(); const next = h.advance(10800000);
        expect(values(next).map(value => value.value)).toEqual([700, 900]);
        expect(next.playerTimeRevision).toBe(2);
    });
    test('sleep and wake split rates exactly, with an expiring human bed entitlement', () => {
        const h = harness(); h.initialize();
        h.clock.recordPlayerPresence('world', 'alice', 'online', at(0));
        h.clock.startPlayerSleep('world', 'alice', { sleeperKind: 'human-player', sleepPlaceId: 'bed-1',
            access: { kind: 'bed-entitlement', evidenceId: 'lease-1', sourceDigest: 'e'.repeat(64),
                validUntilSimulationTime: at(3 * 3600000) } }, at(2 * 3600000));
        h.clock.recordPlayerRest('world', 'alice', 'awake', at(4 * 3600000));
        const next = h.advance(5 * 3600000);
        expect(values(next).map(value => value.value)).toEqual([1300, 800]);
    });
    test('optimistic revision rejects a competing connection without charging time twice', () => {
        const h = harness(), initial = h.initialize(); const other = new NeedsStore(h.path, policy, dynamics);
        try {
            const source = h.source(3600000);
            h.store.advance({ ...source, expectedRevision: initial.revision });
            expect(() => other.advance({ ...source, expectedRevision: initial.revision })).toThrow('revision conflict');
            expect(other.get(h.binding)).toEqual(h.store.get(h.binding));
        } finally { other.close(); }
    });
    test('other world, clock profile, lifecycle and needs policy cannot reuse the row', () => {
        const h = harness(); h.initialize();
        expect(() => h.store.get({ ...h.binding, worldId: 'other' })).toThrow('another world');
        expect(() => h.store.get({ ...h.binding, clockProfileDigest: 'f'.repeat(64) })).toThrow('mismatch');
        expect(h.store.get({ ...h.binding, lifecycleId: 'other-life' })).toBeNull();
        expect(() => h.store.advance({ ...h.source(), binding: { ...h.binding, clockId: 'other-clock' }, expectedRevision: 1 })).toThrow('clock/profile');
        const { digest: _digest, ...changed } = policy;
        const driftedPolicy = validateNeedsPolicy({ ...changed, needs: changed.needs.map((need, index) => index === 0
            ? { ...need, label: 'Changed hunger definition' } : need) });
        const drifted = new NeedsStore(h.path, driftedPolicy, dynamics);
        try { expect(() => drifted.get(h.binding)).toThrow('policy/digest mismatch'); }
        finally { drifted.close(); }
        h.clock.recordPlayerPresence('world', 'bob', 'online', at(0));
        const source = h.source();
        expect(() => h.store.advance({ ...source, history: h.clock.getPlayerTimeHistory('world', 'bob'),
            playerTime: h.clock.getPlayerTimeState('world', 'bob'), expectedRevision: 1 })).toThrow('history mismatch');
        const db = new Database(h.path); db.run("UPDATE needs_state SET snapshot_digest='bad'"); db.close(true);
        expect(() => h.store.get(h.binding)).toThrow('mismatch');
    });
    test('history tampering, deletion and a replaced cursor fail closed', () => {
        const h = harness(); h.initialize(); h.clock.recordPlayerPresence('world', 'alice', 'online', at(0)); h.advance(0);
        h.clock.recordPlayerPresence('world', 'alice', 'offline', at(1000));
        const source = h.source(2000);
        expect(() => h.store.advance({ ...source, history: [], expectedRevision: 2 })).toThrow('history');
        const changed = structuredClone(source); changed.history[0]!.state.presence = 'offline';
        expect(() => h.store.advance({ ...changed, expectedRevision: 2 })).toThrow('history');
        const db = new Database(h.clockPath); db.run('DELETE FROM simulation_player_time_history WHERE revision=1'); db.close(true);
        expect(() => h.clock.getPlayerTimeHistory('world', 'alice')).toThrow('corrupt');
        expect(h.store.get(h.binding)!.revision).toBe(2);
    });
    test('death advances only to the exact terminal time and never resumes physiology', () => {
        const h = harness(); h.initialize();
        const terminal = { kind: 'deceased' as const, at: at(3600000), sourceId: 'death-1', sourceDigest: 'd'.repeat(64) };
        const dead = h.advance(7200000, terminal);
        expect(dead.state.observedAtSimulationTime).toBe(at(3600000));
        expect(values(dead).map(value => value.value)).toEqual([200, 250]);
        h.reopen(); expect(h.advance(10800000, terminal)).toEqual(dead);
        expect(() => h.advance(10800000, { ...terminal, sourceId: 'different' })).toThrow('terminal evidence');
    });
    test('retroactive death, backward time and future terminal times are blocked', () => {
        const h = harness(); h.initialize(); h.advance(3600000);
        const terminal = { kind: 'deceased' as const, at: at(0), sourceId: 'death', sourceDigest: 'd'.repeat(64) };
        expect(() => h.advance(7200000, terminal)).toThrow('terminal time');
        const source = h.source(7200000);
        expect(() => h.store.advance({ ...source, clock: { ...source.clock, simulationTime: at(0) }, expectedRevision: 2 })).toThrow('monotonic');
        expect(() => h.advance(7200000, { ...terminal, at: at(10800000) })).toThrow('terminal time');
    });
    test('audit insertion failure rolls back the current row; removed audit history is detected', () => {
        const h = harness(), initial = h.initialize();
        const db = new Database(h.path);
        db.run("CREATE TRIGGER fail_needs BEFORE INSERT ON needs_event BEGIN SELECT RAISE(ABORT,'injected needs failure'); END");
        expect(() => h.advance(3600000)).toThrow('injected needs failure'); expect(h.store.get(h.binding)).toEqual(initial);
        db.run('DROP TRIGGER fail_needs'); h.advance(3600000);
        db.run('DELETE FROM needs_event WHERE revision=1'); db.close(true);
        expect(() => h.store.get(h.binding)).toThrow('audit');
    });
    test('clock v4 migration seeds only the known player revision and preserves existing state', () => {
        const h = harness(); h.clock.recordPlayerPresence('world', 'alice', 'online', at(0));
        h.clock.recordPlayerPresence('world', 'alice', 'offline', at(1000));
        const state = h.clock.getPlayerTimeState('world', 'alice');
        const db = new Database(h.clockPath); db.run('DROP TABLE simulation_player_time_history'); db.run('PRAGMA user_version=4'); db.close(true);
        h.reopen(); expect(h.clock.getPlayerTimeState('world', 'alice')).toEqual(state);
        const entries = h.clock.getPlayerTimeHistory('world', 'alice');
        expect(entries).toHaveLength(1); expect(entries[0]!.state.revision).toBe(2); expect(entries[0]!.previousDigest).toBeNull();
        const initial = h.store.initialize({ ...h.source(1000), admission: { kind: 'legacy-explicit', evidenceId: 'legacy', evidenceDigest: 'd'.repeat(64) } });
        expect(initial.state.observedAtSimulationTime).toBe(at(1000)); expect(values(initial)[0]!.value).toBe(0);
        expect(values(h.advance(3601000))[0]!.value).toBe(200);
    });
    test('player-time mode and history commit atomically; a failed journal insert restores both clock and mode', () => {
        const h = harness(); h.clock.recordPlayerPresence('world', 'alice', 'online', at(0));
        const before = h.clock.getPlayerTimeState('world', 'alice'), clockBefore = h.clock.get('world');
        const db = new Database(h.clockPath);
        db.run("CREATE TRIGGER fail_mode BEFORE INSERT ON simulation_player_time_history BEGIN SELECT RAISE(ABORT,'mode failure'); END");
        expect(() => h.clock.recordPlayerPresence('world', 'alice', 'offline', at(1000))).toThrow('mode failure');
        expect(h.clock.getPlayerTimeState('world', 'alice')).toEqual(before); expect(h.clock.get('world')).toEqual(clockBefore);
        expect(h.clock.getPlayerTimeHistory('world', 'alice')).toHaveLength(1); db.close(true);
    });
    test('unsupported and incomplete needs schemas are rejected', () => {
        const h = harness(); const db = new Database(h.path); db.run('UPDATE needs_schema SET version=2'); db.close(true);
        expect(() => new NeedsStore(h.path, policy, dynamics)).toThrow('Unsupported');
        const partial = harness(), corrupt = new Database(partial.path);
        corrupt.run('DROP TABLE needs_world'); corrupt.close(true);
        expect(() => new NeedsStore(partial.path, policy, dynamics)).toThrow('needs_world');
    });
    test('readonly legacy lookup creates no needs tables and rejects writes', () => {
        const h = harness(), path = join(h.root, 'legacy.sqlite');
        const food = new FoodConsumptionStore(path, catalog); food.close();
        const before = new Database(path, { readonly: true });
        const tables = before.query("SELECT name FROM sqlite_master ORDER BY name").all(); before.close(true);
        const reader = new NeedsStore(path, policy, dynamics, { readonly: true });
        expect(reader.read(h.binding)).toEqual({ status: 'unknown', state: null });
        expect(() => reader.initialize({ ...h.source(), admission: {
            kind: 'legacy-explicit', evidenceId: 'legacy', evidenceDigest: 'e'.repeat(64) } })).toThrow('read-only');
        reader.close();
        const after = new Database(path, { readonly: true });
        expect(after.query('SELECT name FROM sqlite_master ORDER BY name').all()).toEqual(tables); after.close(true);
    });
    test('food v1 migrates additively and a typed shared transaction rolls back both domains', () => {
        const h = harness(), legacyPath = join(h.root, 'legacy-food.sqlite');
        const food = new FoodConsumptionStore(legacyPath, catalog); food.close();
        const persistence = new FoodNeedsPersistence(legacyPath, policy, dynamics, catalog);
        try {
            const state = persistence.commit({ kind: 'initialize', input: { ...h.source(), admission: {
                kind: 'genesis', evidenceId: 'genesis', evidenceDigest: 'c'.repeat(64) } } }).state;
            const advanced = h.source(1000);
            const beforeFood = advanceNeedsFromClock(state.state, advanced.clock, 'offline', 'awake', policy, dynamics).state;
            const receipt = (kind: 'gathered' | 'processed' | 'consumed'): FoodInventoryReceipt => ({ receiptId: kind, actorAgentId: 'alice', kind,
                occurredAtSimulationTime: at(1000), skill: kind === 'gathered' ? 'Fishing' : kind === 'processed' ? 'Cooking' : null,
                inputs: kind === 'gathered' ? [] : [{ itemId: kind === 'processed' ? 377 : 379, quantity: 1 }],
                outputs: kind === 'consumed' ? [] : [{ itemId: kind === 'gathered' ? 377 : 379, quantity: 1 }], sourceDigest: 'e'.repeat(64) });
            const closure = closeFoodLoop({ closureId: 'closure', foodChainId: 'lobster', state: beforeFood,
                gathered: receipt('gathered'), processed: receipt('processed'), consumed: receipt('consumed') }, catalog, policy);
            expect(() => persistence.commit({ kind: 'advance', input: { ...advanced, expectedRevision: 1 } },
                { ...closure, hungerRelief: 1 })).toThrow('SI-A04');
            const db = new Database(legacyPath);
            db.run("CREATE TRIGGER fail_food BEFORE INSERT ON food_consumption_event BEGIN SELECT RAISE(ABORT,'injected food failure'); END");
            expect(() => persistence.commit({ kind: 'advance', input: { ...advanced, expectedRevision: 1 } }, closure)).toThrow('injected food');
            expect(persistence.food.list()).toEqual([]); expect(persistence.needs.get(h.binding)).toEqual(state);
            db.run('DROP TRIGGER fail_food'); db.close(true);
            const result = persistence.commit({ kind: 'advance', input: { ...advanced, expectedRevision: 1 } }, closure);
            expect(result.event?.closureId).toBe('closure'); expect(persistence.food.verifyAuditChain()).toBeTrue();
        } finally { persistence.close(); }
        const db = new Database(legacyPath);
        expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
        expect(db.query('SELECT * FROM food_receipt_use').all()).toHaveLength(3); db.close(true);
    });
});
