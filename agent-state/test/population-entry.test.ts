import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../store.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../types.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { validatePopulationEntryPolicy, validatePopulationEntryRequest, generatePopulationEntry,
    type PopulationEntryEnvironment } from '../../population-lifecycle/entry.js';
import { createPopulationDeathEvidence, loadPopulationMortalityPolicy } from '../../population-lifecycle/index.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { runAdminPopulationEntry, loadPopulationEntryEnvironment } from '../../server/gateway/admin/population-entry.js';

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const configDirectory = join(import.meta.dir, '../../config');
const wall = '2026-10-14T10:00:00.000Z', initial = '2001-01-01T00:00:00.000Z';
const request = { batchId: 'arrival-wave-1', seed: 'reproducible-arrivals', count: 2, anchorAgentId: 'founder' };
function policy(environment: PopulationEntryEnvironment, patch: Record<string, unknown>) {
    const { digest, ...definition } = environment.policy;
    return { ...environment, policy: validatePopulationEntryPolicy({ ...definition, ...patch }) };
}
function raw(path: string, action: (db: Database) => void) {
    const db = new Database(path); try { action(db); } finally { db.close(true); }
}
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'population-entry-')); roots.push(root);
    const agentPath = join(root, 'agents.sqlite'), enginePath = join(root, 'engine.sqlite'), accountPath = join(root, 'accounts.sqlite');
    raw(accountPath, db => db.run('CREATE TABLE account (id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE)'));
    const clock = new SimulationClockStore(join(root, 'clock.sqlite')); closers.push(() => clock.close());
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'entry-test', version: '1.0.0',
        seed: 'entry-world', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, status: 'paused', wallTime: wall, simulationTime: initial });
    const simulationClock = { store: clock, clockId: 'world' }, environment = loadPopulationEntryEnvironment(configDirectory);
    let store = new AgentStateStore(agentPath, simulationClock); closers.push(() => store.close());
    store.createIdentity({ agentId: 'founder', playerUsername: 'founder', displayName: 'Founder', background: 'Original genesis member.',
        personalityTraits: ['steady'] }, wall);
    const profile = environment.profiles.profiles.find(item => item.profileId === 'mature-society')!;
    store.bindPopulationMember({ agentId: 'founder', playerUsername: 'founder',
        worldProfile: { profileId: profile.profileId, version: profile.version, digest: profile.digest },
        lifecyclePolicy: { ...environment.policy.lifecyclePolicy, kind: 'finite' },
        simulationClock: { clockId: 'world', profileDigest: state.profileDigest }, joinedAtSimulationTime: initial,
        sourceResultId: 'genesis-' + 'a'.repeat(24), sourceResultDigest: 'b'.repeat(64) }, wall);
    const engine = new PlayerHealthEvidenceStore(enginePath); closers.push(() => engine.close());
    const playerSavesPath = join(root, 'players'), botsPath = join(root, 'bots'); mkdirSync(playerSavesPath); mkdirSync(botsPath);
    const options = { agentPath, enginePath, accountPath, playerSavesPath, botsPath, configDirectory, simulationClock, onlineUsernames: [] as string[] };
    const plan = (input = request, env = environment) => store.previewPopulationEntry(input, env);
    const apply = (input = request, env = environment, assertUnused = (_: string) => {}) => {
        const preview = plan(input, env);
        return store.applyPopulationEntry(input, env, preview.digest, 'Reviewed bounded arrival batch.', assertUnused, wall);
    };
    const die = (id: string) => {
        const member = store.getPopulationMember(id)!, mortality = loadPopulationMortalityPolicy(join(configDirectory, 'population-mortality-policy.json'));
        engine.bindFiniteAvatar(member);
        const proof = createPopulationDeathEvidence(member, clock.observe('world', wall, 42), environment.age, mortality,
            { damageEventId: '10000000-0000-4000-8000-000000000001', sessionId: 'entry-session', engineTick: 42 });
        engine.record({ username: member.playerUsername, sessionId: 'entry-session', engineTick: 42, occurredAt: wall,
            hpBefore: 10, hpAfter: 0, maxHp: 10, damageType: 1 }, '10000000-0000-4000-8000-000000000001', proof);
        const reader = new PlayerHealthEvidenceStore(enginePath, true);
        try { store.consumePopulationDeath(reader, proof.eventId, environment.age, mortality); } finally { reader.close(); }
    };
    return { root, agentPath, clock, state, simulationClock, environment, engine, options, plan, apply, die,
        get store() { return store; }, restart() { store.close(); store = new AgentStateStore(agentPath, simulationClock); } };
}

describe('bounded seeded population admission', () => {
    test('preview is deterministic and read-only; independent worlds with the same binding reproduce it', () => {
        const local = fixture(), other = fixture();
        expect(local.plan()).toEqual(other.plan());
        expect(local.store.listIdentities()).toHaveLength(1); expect(local.store.listPopulationMembers()).toHaveLength(1);
        expect(local.plan({ ...request, seed: 'different' }).entrants).not.toEqual(local.plan().entrants);
        expect(local.plan({ ...request, batchId: 'wave-2' }).entryId).not.toBe(local.plan().entryId);
    });
    test('commits new identity, finite membership, generated birth and immutable audit, and survives restart', () => {
        const local = fixture(), receipt = local.apply();
        expect(local.store.listPopulationMembers()).toHaveLength(3);
        for (const entrant of receipt.plan.entrants) {
            const member = local.store.getPopulationMember(entrant.identity.agentId)!;
            expect(member).toMatchObject({ sourceResultId: receipt.plan.entryId, sourceResultDigest: receipt.plan.digest,
                joinedAtSimulationTime: initial, characterLifecycle: { birthAtSimulationTime: entrant.birthAtSimulationTime, origin: 'imported', status: 'active' } });
            const age = local.store.getPopulationAge(member.agentId, local.environment.age)!;
            expect(age.status).toBe('known');
            if (age.status === 'known') { expect(age.ageYears).toBeGreaterThanOrEqual(18); expect(age.ageYears).toBeLessThanOrEqual(35); }
            const snapshot = local.store.getSnapshot(member.agentId)!;
            expect(local.store.getControlProfile(member.agentId)).toMatchObject({ role: 'player', subjectId: member.playerUsername, avatarPlayerUsername: member.playerUsername,
                dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 0 });
            expect(local.store.listEpisodes(member.agentId)).toHaveLength(0); expect(local.store.listKnowledge(member.agentId)).toHaveLength(0);
            expect(local.store.listRelationships(member.agentId)).toHaveLength(0); expect(snapshot.knownSkills).toHaveLength(0); expect(snapshot.goals).toHaveLength(0);
        }
        local.restart(); expect(local.store.getPopulationEntry(receipt.plan.entryId)).toEqual(receipt);
        raw(local.agentPath, db => { expect(() => db.run('DELETE FROM agent_population_entry')).toThrow('immutable');
            expect(() => db.run("UPDATE agent_population_entry SET entrant_count=9")).toThrow('immutable'); });
    });
    test('exact replay after reset/running clock returns the original receipt without reactivation; changed request conflicts', () => {
        const local = fixture(), receipt = local.apply(), id = receipt.plan.entrants[0]!.identity.agentId;
        local.store.resetPopulationMember(id, receipt.plan.digest, 1, wall);
        const clock = local.clock.get('world')!; local.clock.resume('world', clock.revision, wall);
        expect(local.apply()).toEqual(receipt); expect(local.store.getPopulationMember(id)!.status).toBe('reset');
        expect(() => local.plan({ ...request, count: 1 })).toThrow('conflicts');
        expect(() => local.plan({ ...request, seed: 'rebound' })).toThrow('conflicts');
        expect(local.store.listIdentities()).toHaveLength(3);
    });
    test('requires preview digest and rolls back the whole batch when a later member fails to persist', () => {
        const local = fixture(), plan = local.plan(), second = plan.entrants[1]!.identity.agentId;
        expect(() => local.store.applyPopulationEntry(request, local.environment, 'c'.repeat(64), 'Approved', () => {}, wall)).toThrow('preview changed');
        raw(local.agentPath, db => db.run(`CREATE TRIGGER reject_second_entry BEFORE INSERT ON agent_population_member
            WHEN NEW.agent_id='${second}' BEGIN SELECT RAISE(ABORT,'Injected second member failure'); END`));
        expect(() => local.apply()).toThrow('Injected second member failure');
        expect(local.store.listIdentities()).toHaveLength(1); expect(local.store.getPopulationEntry(plan.entryId)).toBeNull();
        local.restart(); expect(local.store.listPopulationMembers()).toHaveLength(1);
    });
    test('refuses existing identities/avatars, even outside finite membership, without adopting them', () => {
        const local = fixture(), identity = local.plan().entrants[0]!.identity;
        local.store.createIdentity({ ...identity, agentId: 'unrelated-existing-agent' }, wall);
        expect(() => local.plan()).toThrow('already reserved');
        expect(local.store.getPopulationMember('unrelated-existing-agent')).toBeNull();
    });
    test('external avatar refusal and concurrent clock resume leave no new identities or receipts', () => {
        const local = fixture(), plan = local.plan();
        expect(() => local.apply(request, local.environment, () => { throw new Error('avatar occupied'); })).toThrow('avatar occupied');
        let calls = 0;
        expect(() => local.apply(request, local.environment, () => {
            if (++calls === 1) local.clock.resume('world', local.clock.get('world')!.revision, wall);
        })).toThrow('clock changed');
        expect(local.store.listIdentities()).toHaveLength(1); expect(local.store.getPopulationEntry(plan.entryId)).toBeNull();
    });
    test('batch, active population and lifetime clock quotas are independent and policy revisions do not replenish quota', () => {
        const local = fixture();
        expect(() => local.plan({ ...request, count: 9 })).toThrow('batch limit');
        expect(() => local.plan(request, policy(local.environment, { maximumActiveMembers: 2 }))).toThrow('active member limit');
        const limited = policy(local.environment, { maximumAdmissionsPerClock: 2 }); local.apply(request, limited);
        for (const member of local.store.listPopulationMembers().filter(item => item.agentId !== 'founder'))
            local.store.resetPopulationMember(member.agentId, member.sourceResultDigest, member.revision, wall);
        const revised = policy(limited, { version: '1.0.1' });
        expect(() => local.plan({ ...request, batchId: 'wave-2', count: 1 }, revised)).toThrow('lifetime clock quota');
    });
    test('rejects stale world/lifecycle/age policy binding and a reset or non-genesis anchor', () => {
        const local = fixture(), anchor = local.store.getPopulationMember('founder')!;
        const generate = (member = anchor, env = local.environment) => generatePopulationEntry(request, member, initial, env);
        expect(() => generate({ ...anchor, worldProfile: { ...anchor.worldProfile, digest: 'c'.repeat(64) } })).toThrow('world profile');
        expect(() => generate(anchor, policy(local.environment, { lifecyclePolicy: { ...local.environment.policy.lifecyclePolicy, digest: 'd'.repeat(64) } }))).toThrow('lifecycle policy');
        expect(() => generate(anchor, { ...local.environment, age: { ...local.environment.age, digest: 'e'.repeat(64) } })).toThrow('age policy');
        expect(() => generate({ ...anchor, status: 'reset' })).toThrow('unreset genesis');
        expect(() => generate({ ...anchor, sourceResultId: 'entry-' + 'f'.repeat(24) })).toThrow('unreset genesis');
    });
    test('rejects unknown fields, missing seeds, invalid counts, unsupported generators and manipulated policy digest', () => {
        const local = fixture();
        for (const patch of [{ count: 0 }, { count: 1.5 }, { seed: '' }, { family: 'invented' }])
            expect(() => validatePopulationEntryRequest({ ...request, ...patch })).toThrow();
        expect(() => policy(local.environment, { generator: 'family' })).toThrow();
        expect(() => local.plan(request, { ...local.environment, policy: { ...local.environment.policy, maximumBatchSize: 100 } })).toThrow('digest is stale');
        local.clock.resume('world', local.state.revision, wall);
        expect(() => local.plan()).toThrow('paused');
    });
    test('the engine accepts entrant membership and terminal death remains terminal on admission replay', () => {
        const local = fixture(), receipt = local.apply(), id = receipt.plan.entrants[0]!.identity.agentId;
        local.die(id);
        expect(local.apply()).toEqual(receipt); expect(local.store.getCharacterLifecycle(id)!.status).toBe('deceased');
        local.restart(); expect(local.store.getCharacterLifecycle(id)!.status).toBe('deceased');
    });
    test('a deceased founding cohort can receive fresh arrivals without resurrecting the founder', () => {
        const local = fixture();
        local.store.setCharacterBirth('founder', 1, '1976-01-01T00:00:00.000Z', 'imported', wall);
        local.die('founder');
        const receipt = local.apply();
        expect(local.store.getCharacterLifecycle('founder')!.status).toBe('deceased');
        expect(receipt.plan.entrants).toHaveLength(2);
        expect(local.store.listPopulationMembers().filter(item => item.characterLifecycle.status === 'active')).toHaveLength(2);
    });
    test('another genesis on the same clock cannot be silently merged into the entry world', () => {
        const local = fixture(), anchor = local.store.getPopulationMember('founder')!;
        local.store.createIdentity({ agentId: 'foreign', playerUsername: 'foreign', displayName: 'Foreign', background: 'Other world.', personalityTraits: ['steady'] }, wall);
        local.store.bindPopulationMember({ ...anchor, agentId: 'foreign', playerUsername: 'foreign',
            sourceResultId: 'genesis-' + 'f'.repeat(24), sourceResultDigest: 'e'.repeat(64) }, wall);
        expect(() => local.plan()).toThrow('conflicting genesis');
        expect(local.store.listIdentities()).toHaveLength(2);
    });
    test('v24 migration is additive and generates no entrants for pre-existing characters', () => {
        const local = fixture(); raw(local.agentPath, db => {
            // Rebuild the actual v24 boundary, not a current DB with only its version lowered.
            for (const table of ['agent_economic_action','agent_institution_strategy','agent_player_strategy',
                'agent_plan_adoption','agent_state_evaluation','agent_state_objective','agent_population_entry']) db.run(`DROP TABLE ${table}`);
            db.run('PRAGMA user_version=24');
        });
        local.restart(); expect(local.store.listIdentities()).toHaveLength(1); expect(local.store.listPopulationMembers()).toHaveLength(1);
        raw(local.agentPath, db => expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: AGENT_STATE_SCHEMA_VERSION }));
    });
    test('restart refuses corrupt receipts, missing membership and missing receipt sources', () => {
        for (const mode of ['receipt', 'membership', 'missing-receipt']) {
            const local = fixture(), receipt = local.apply();
            raw(local.agentPath, db => {
                if (mode === 'membership') db.run('DELETE FROM agent_population_member WHERE agent_id=?1', [receipt.plan.entrants[0]!.identity.agentId]);
                else {
                    db.run(`DROP TRIGGER population_entry_no_${mode === 'receipt' ? 'update' : 'delete'}`);
                    db.run(mode === 'receipt' ? 'UPDATE agent_population_entry SET entrant_count=99' : 'DELETE FROM agent_population_entry');
                }
            });
            expect(() => new AgentStateStore(local.agentPath, local.simulationClock)).toThrow('Population entry');
        }
    });
    test('an entry source cannot be forged through the general membership binder', () => {
        const local = fixture(), anchor = local.store.getPopulationMember('founder')!;
        local.store.createIdentity({ agentId: 'forged', playerUsername: 'forged', displayName: 'Forged', background: 'Test.', personalityTraits: ['steady'] }, wall);
        expect(() => local.store.bindPopulationMember({ ...anchor, agentId: 'forged', playerUsername: 'forged',
            sourceResultId: 'entry-' + 'c'.repeat(24) }, wall)).toThrow('exact persisted admission receipt');
    });
});

describe('local population entry adapter', () => {
    test('previews and applies against actual AgentState, clock and read-only engine authority', () => {
        const local = fixture(), preview = runAdminPopulationEntry(local.options, request);
        expect(preview).toEqual(local.plan());
        const receipt = runAdminPopulationEntry(local.options, request, { expectedPlanDigest: local.plan().digest, reason: 'Local integration admission.' }, wall);
        expect(receipt).toHaveProperty('appliedAt', wall); expect(local.store.listPopulationMembers()).toHaveLength(3);
        expect(runAdminPopulationEntry(local.options, request, { expectedPlanDigest: local.plan().digest, reason: 'Replay.' }, wall)).toEqual(receipt);
    });
    test('save, bot, online and permanently bound avatar collisions fail closed', () => {
        for (const mode of ['save', 'bot', 'online', 'engine', 'account']) {
            const local = fixture(), username = local.plan().entrants[0]!.identity.playerUsername!;
            if (mode === 'save') writeFileSync(join(local.options.playerSavesPath, `${username.toUpperCase()}.sav`), 'existing save');
            if (mode === 'bot') mkdirSync(join(local.options.botsPath, username));
            if (mode === 'online') local.options.onlineUsernames.push(username);
            if (mode === 'engine') local.engine.bindFiniteAvatar({ ...local.store.getPopulationMember('founder')!, playerUsername: username });
            if (mode === 'account') raw(local.options.accountPath, db => db.run('INSERT INTO account(username) VALUES(?1)', [username]));
            expect(() => runAdminPopulationEntry(local.options, request)).toThrow('already exists');
            expect(local.store.listIdentities()).toHaveLength(1);
        }
    });
    test('missing engine authority or namespace is blocked instead of constructing an empty replacement', () => {
        const local = fixture();
        expect(() => runAdminPopulationEntry({ ...local.options, enginePath: join(local.root, 'missing.sqlite') }, request)).toThrow('unavailable');
        expect(() => runAdminPopulationEntry({ ...local.options, accountPath: join(local.root, 'missing-accounts.sqlite') }, request)).toThrow('unavailable');
        expect(() => runAdminPopulationEntry({ ...local.options, playerSavesPath: join(local.root, 'missing-players') }, request)).toThrow('unavailable');
        expect(local.store.listPopulationMembers()).toHaveLength(1);
    });
});
