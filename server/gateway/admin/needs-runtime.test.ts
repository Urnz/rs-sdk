import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import { SimulationClockStore } from '../../../simulation-clock/store.js';
import { loadPopulationAgePolicy } from '../../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy } from '../../../population-lifecycle/mortality.js';
import { createPopulationDeathEvidence } from '../../../population-lifecycle/death.js';
import { PlayerHealthEvidenceStore } from '../../engine/src/mods/PlayerHealthEvidenceStore.js';
import { assertNeedsPath, initializePopulationNeeds, populationNeedsBinding, populationNeedsOptions,
    readPopulationNeeds, runPopulationNeedsCycle } from './needs-runtime.js';
import { reconcilePopulationDeaths } from './population-death-runtime.js';
import { loadWorldGenesisProfileCatalog } from '../../../world-genesis/config.js';
import { loadPopulationEntryEnvironment, runAdminPopulationEntry } from './population-entry.js';
import { NativeFoodConsumptionStore, FOOD_POLICY, foodDigest, type FoodAction } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick } from '../../engine/src/mods/NativeFoodDeliveryStore.js';
import { readPopulationFoodApplications } from './needs-runtime.js';
import { randomUUID } from 'node:crypto';
import { readEconomicObservation } from './economic-observer-source.js';

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = join(import.meta.dir, '../../../config');
const age = loadPopulationAgePolicy(join(config, 'population-age-policy.json'));
const mortality = loadPopulationMortalityPolicy(join(config, 'population-mortality-policy.json'));
const start = '2030-01-01T00:00:00.000Z';
const at = (hours: number) => new Date(Date.parse(start) + hours * 3600000).toISOString();
function harness() {
    const root = mkdtempSync(join(tmpdir(), 'si-needs-runtime-')); roots.push(root);
    mkdirSync(join(root, 'config'));
    for (const file of ['needs-policies.json', 'needs-dynamics-policies.json', 'food-loops.json'])
        cpSync(join(config, file), join(root, 'config', file));
    const options = { ...populationNeedsOptions(root), nativeFoodCheckpointPath: join(root, 'food-checkpoints.sqlite') };
    mkdirSync(join(root, '.local/simulation'), { recursive: true });
    const clock = new SimulationClockStore(join(root, '.local/simulation/clock.sqlite'));
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
        seed: 'runtime-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: start, simulationTime: start });
    const shared = { store: clock, clockId: 'world' };
    const agents = new AgentStateStore(join(root, 'agents.sqlite'), shared);
    agents.createIdentity({ agentId: 'alice', playerUsername: 'alice', displayName: 'Alice',
        background: 'Needs runtime fixture.', personalityTraits: ['steady'] }, start);
    agents.bindPopulationMember({ agentId: 'alice', playerUsername: 'alice', worldProfile: {
        profileId: 'mature-society', version: '1.0.0',
        digest: loadWorldGenesisProfileCatalog(join(config, 'world-genesis-profiles.json')).profiles.find(profile => profile.profileId === 'mature-society')!.digest },
        lifecyclePolicy: { ...age.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: 'world', profileDigest: state.profileDigest },
        joinedAtSimulationTime: start, sourceResultId: 'genesis-' + 'b'.repeat(24), sourceResultDigest: 'c'.repeat(64) }, start);
    const enginePath = join(root, 'health.sqlite'), engine = new PlayerHealthEvidenceStore(enginePath);
    engine.bindFiniteAvatar(agents.getPopulationMember('alice')!); engine.heartbeat(start);
    const foodDatabase = new Database(options.nativeFoodCheckpointPath, { create: true, strict: true });
    const foodWriter = new NativeFoodConsumptionStore({ db: foodDatabase });
    const closeFood = (hours: number) => closeFoodDeliveryTick(foodDatabase,
        { ...clock.observeThrough('world', at(hours)), engineTick: 42 });
    closeFood(0);
    closers.push(() => clock.close(), () => agents.close(), () => engine.close(), () => foodDatabase.close(true));
    const member = () => agents.getPopulationMember('alice')!;
    const initialize = () => initializePopulationNeeds(options, member(), shared, 'genesis');
    const cycle = (hours: number) => { engine.heartbeat(at(hours)); closeFood(hours);
        return runPopulationNeedsCycle(agents, shared, options, enginePath, at(hours)); };
    // Typed authority fixture for gateway scheduling/failure tests. Real inventory proof is in NativeFoodNutrition.test.ts.
    const consumeFixture = (hours: number) => {
        const b = populationNeedsBinding(options.worldId, member()), observed = clock.observe('world', at(hours), 42);
        const action: FoodAction = { actionId: randomUUID(), worldId: b.worldId, actorId: b.actorId, username: b.playerId,
            lifecycleId: b.lifecycleId, itemId: 379, quantity: 1, slot: 0, policyDigest: foodDigest(FOOD_POLICY),
            clockId: b.clockId, clockProfileDigest: b.clockProfileDigest };
        foodWriter.admit(action);
        foodDatabase.transaction(() => foodWriter.finish({ action, outcome: 'consumed', receipt: { ...action,
            schemaVersion: 1, cause: 'content:consume_effect_stat', before: 1, after: 0, hpBefore: 20, hpAfter: 20,
            clock: observed, checkpointId: `food:${action.actionId}`, checkpointDigest: 'a'.repeat(64), requestDigest: foodDigest(action) } }, observed)).immediate();
        return action;
    };
    return { root, options, clock, shared, agents, engine, enginePath, member, initialize, cycle, closeFood, consumeFixture };
}
describe('population needs runtime integration', () => {
    test('economic observer reads exact native needs head and makes a source gap unknown', () => {
        const h = harness(); h.initialize();
        const options = { agentPath: join(h.root, 'agents.sqlite'), workspace: h.root, simulationClock: h.shared, now: start };
        const initial = readEconomicObservation('alice', options);
        expect(initial.facts.find(f => f.key === 'hunger')).toMatchObject({ freshness: 'fresh', trust: 'native',
            value: readPopulationNeeds(h.options, h.member()).state!.state.values.find(v => v.needId === 'hunger')!.value });
        h.clock.observe('world', at(1));
        expect(readEconomicObservation('alice', { ...options, now: at(1) }).facts.find(f => f.key === 'hunger'))
            .toMatchObject({ freshness: 'unknown', value: null });
        expect(h.cycle(1).advanced).toBe(1);
        expect(readEconomicObservation('alice', { ...options, now: at(1) }).facts.find(f => f.key === 'hunger')?.freshness).toBe('fresh');
    });
    test('resume waits for both native authorities in the new clock segment without inventing physiology or discarding pending source history', () => {
        const h = harness(), initial = h.initialize();
        const wall = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();
        h.clock.pause('world', h.clock.get('world')!.revision, wall(10));
        h.clock.resume('world', h.clock.get('world')!.revision, wall(11));
        expect(runPopulationNeedsCycle(h.agents, h.shared, h.options, h.enginePath, wall(12))).toEqual({
            advanced: 0, unknown: [], waitingFor: 'native-authorities-in-current-clock-segment' });
        expect(readPopulationNeeds(h.options, h.member()).state).toEqual(initial);
        h.engine.heartbeat(wall(13));
        // The food writer independently closes a real source boundary after resume.
        h.closeFood(13 / 3600);
        expect(runPopulationNeedsCycle(h.agents, h.shared, h.options, h.enginePath, wall(13)).advanced).toBe(1);
    });
    test('a read of absent state creates no file; ordinary cycles report unknown without inventing history', () => {
        const h = harness(); expect(readPopulationNeeds(h.options, h.member())).toEqual({ status: 'unknown', state: null });
        expect(existsSync(h.options.databasePath)).toBeFalse();
        expect(h.cycle(1)).toEqual({ advanced: 0, unknown: ['alice'] });
        expect(readPopulationNeeds(h.options, h.member()).status).toBe('unknown');
        const initial = initializePopulationNeeds(h.options, h.member(), h.shared, 'legacy-explicit');
        expect(initial.state.observedAtSimulationTime).toBe(at(1)); expect(initial.state.values[0]!.value).toBe(0);
    });
    test('genesis initializes once and delayed mode replay accounts online and offline time exactly', () => {
        const h = harness(), initial = h.initialize();
        h.clock.recordPlayerPresence('world', 'alice', 'online', at(1));
        h.clock.recordPlayerPresence('world', 'alice', 'offline', at(2));
        expect(h.cycle(3)).toEqual({ advanced: 1, unknown: [] });
        const next = readPopulationNeeds(h.options, h.member()).state!;
        expect(next.state.values.map(value => value.value)).toEqual([700, 900]);
        expect(h.initialize()).toEqual(next);
        expect(next.admissionDigest).toBe(initial.admissionDigest);
        expect(h.cycle(3).advanced).toBe(0);
    });
    test('admission retries complete pending needs initialization without repeating the population entry', () => {
        const h = harness(); h.initialize();
        h.clock.pause('world', h.clock.get('world')!.revision, start);
        const accountPath = join(h.root, 'accounts.sqlite'), accounts = new Database(accountPath);
        accounts.run('CREATE TABLE account(username TEXT PRIMARY KEY)'); accounts.close(true);
        const playerSavesPath = join(h.root, 'players'), botsPath = join(h.root, 'bots');
        mkdirSync(playerSavesPath); mkdirSync(botsPath);
        const options = { agentPath: join(h.root, 'agents.sqlite'), enginePath: h.enginePath, accountPath,
            playerSavesPath, botsPath, configDirectory: config, onlineUsernames: [], simulationClock: h.shared, needs: h.options };
        const request = { batchId: 'needs-arrival', seed: 'needs-arrival', count: 1, anchorAgentId: 'alice' };
        const plan = h.agents.previewPopulationEntry(request, loadPopulationEntryEnvironment(config));
        const db = new Database(h.options.databasePath);
        db.run("CREATE TRIGGER fail_admission BEFORE INSERT ON needs_event BEGIN SELECT RAISE(ABORT,'admission needs failure'); END");
        expect(() => runAdminPopulationEntry(options, request, { expectedPlanDigest: plan.digest, reason: 'Needs admission trial.' }, start))
            .toThrow('admission needs failure');
        const admitted = h.agents.getPopulationMember(plan.entrants[0]!.identity.agentId)!;
        expect(readPopulationNeeds(h.options, admitted).status).toBe('unknown');
        expect(h.agents.listPopulationMembers()).toHaveLength(2);
        db.run('DROP TRIGGER fail_admission'); db.close(true);
        runAdminPopulationEntry(options, request, { expectedPlanDigest: plan.digest, reason: 'Retry same admission.' }, start);
        expect(h.agents.listPopulationMembers()).toHaveLength(2);
        expect(readPopulationNeeds(h.options, admitted)).toMatchObject({ status: 'initialized', state: {
            revision: 1, admission: { kind: 'admission', evidenceId: plan.entryId } } });
    });
    test('native lifecycle identity matches SI-A01 and cannot be rebound after genesis source drift', () => {
        const h = harness(); h.initialize(); const member = h.member();
        const binding = populationNeedsBinding(h.options.worldId, member);
        expect(binding.lifecycleId).toMatch(/^[a-f0-9]{64}$/);
        expect(readPopulationNeeds(h.options, { ...member, sourceResultDigest: 'd'.repeat(64) }).status).toBe('unknown');
        expect(() => initializePopulationNeeds(h.options, { ...member, status: 'reset' }, h.shared, 'genesis')).toThrow('Terminal');
    });
    test('engine death freezes exact simulation time; reopen and later cycles add no physiology', () => {
        const h = harness(); h.initialize();
        const observation = h.clock.observe('world', at(1), 42);
        const damageId = '10000000-0000-4000-8000-000000000001';
        const death = createPopulationDeathEvidence(h.member(), observation, age, mortality,
            { damageEventId: damageId, sessionId: 'needs-test', engineTick: 42 });
        h.engine.record({ username: 'alice', sessionId: 'needs-test', engineTick: 42, occurredAt: at(1),
            hpBefore: 10, hpAfter: 0, maxHp: 10, damageType: 1 }, damageId, death);
        reconcilePopulationDeaths(h.agents, h.enginePath, age, mortality);
        expect(h.cycle(2).advanced).toBe(1);
        const dead = readPopulationNeeds(h.options, h.member()).state!;
        expect(dead.terminal?.kind).toBe('deceased'); expect(dead.state.observedAtSimulationTime).toBe(at(1));
        expect(h.cycle(3).advanced).toBe(0); expect(readPopulationNeeds(h.options, h.member()).state).toEqual(dead);
    });
    test('missing or stale death authority blocks advancement', () => {
        const h = harness(), initial = h.initialize();
        expect(() => runPopulationNeedsCycle(h.agents, h.shared, h.options, join(h.root, 'missing'), at(1))).toThrow('unavailable');
        expect(() => runPopulationNeedsCycle(h.agents, h.shared, h.options, h.enginePath, at(1))).toThrow('unavailable');
        expect(readPopulationNeeds(h.options, h.member()).state).toEqual(initial);
    });
    test('needs stops at the engine watermark even when the shared clock and player modes are ahead', () => {
        const h = harness(); h.initialize();
        h.engine.heartbeat(at(1));
        h.closeFood(1);
        h.clock.recordPlayerPresence('world', 'alice', 'online', at(1.001));
        h.clock.observe('world', at(1.002));
        runPopulationNeedsCycle(h.agents, h.shared, h.options, h.enginePath, at(1.002));
        const state = readPopulationNeeds(h.options, h.member()).state!;
        expect(state.state.observedAtSimulationTime).toBe(at(1));
        expect(state.state.values[0]!.value).toBe(200); expect(state.playerTimeRevision).toBe(0);
        h.cycle(2);
        expect(readPopulationNeeds(h.options, h.member()).state!.state.values[0]!.value).toBe(499);
    });
    test('a missing finite avatar binding cannot authorize physiology updates', () => {
        const h = harness(); h.initialize();
        const db = new Database(h.enginePath);
        db.run('DELETE FROM engine_population_binding'); db.close(true);
        expect(() => h.cycle(1)).toThrow('bindings were altered');
        expect(readPopulationNeeds(h.options, h.member()).state!.revision).toBe(1);
    });
    test('clock profile reconfiguration fails closed instead of silently reinterpreting needs', () => {
        const h = harness(); h.initialize();
        const current = h.clock.get('world')!;
        h.clock.reconfigure('world', current.revision, { ...current.profile, seed: 'other' }, at(0));
        expect(() => h.cycle(1)).toThrow('watermark drift');
        expect(readPopulationNeeds(h.options, h.member()).state!.revision).toBe(1);
    });
    test('two world files remain isolated and path traversal or copied foreign-world state is rejected', () => {
        const a = harness(), b = harness(); a.initialize(); b.initialize(); a.cycle(1);
        expect(readPopulationNeeds(b.options, b.member()).state!.state.values[0]!.value).toBe(0);
        expect(() => assertNeedsPath({ ...a.options, databasePath: b.options.databasePath })).toThrow('escapes');
        expect(() => readPopulationNeeds({ ...a.options, worldId: 'foreign-world' }, a.member())).toThrow('another world');
    });
    test('a junction cannot route the needs writer into another workspace', () => {
        const a = harness(), b = harness();
        const link = join(a.root, '.local/simulation/foreign');
        symlinkSync(join(b.root, '.local/simulation'), link, 'junction');
        expect(() => assertNeedsPath({ ...a.options, databasePath: join(link, 'needs.sqlite') })).toThrow('escapes');
    });
    test('managed server context rejects another server ID or workspace', () => {
        const a = harness(), b = harness();
        const updates = { CONTROL_PLANE_SERVER_ID: 'srv-11111111-1111-4111-8111-111111111111',
            MANAGED_WORKSPACE: a.root, ENGINE_ADMIN_URL: 'http://127.0.0.1:22000', GATEWAY_URL: 'ws://127.0.0.1:22001' };
        const before = Object.fromEntries(Object.keys(updates).map(key => [key, process.env[key]]));
        try {
            Object.assign(process.env, updates);
            const selected = populationNeedsOptions(a.root); expect(() => assertNeedsPath(selected)).not.toThrow();
            expect(() => assertNeedsPath({ ...selected, worldId: b.options.worldId })).toThrow('managed world');
            expect(() => assertNeedsPath({ ...selected, workspace: b.root })).toThrow('managed world');
        } finally { for (const [key, value] of Object.entries(before)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        } }
    });
    test('reset is terminal and does not erase the old physiology record', () => {
        const h = harness(); h.initialize();
        const db = new Database(join(h.root, 'agents.sqlite'));
        db.run("UPDATE agent_population_member SET status='reset',reset_at_simulation_time=?1 WHERE agent_id='alice'", [at(1)]);
        db.close(true);
        expect(h.cycle(2).advanced).toBe(1);
        const state = readPopulationNeeds(h.options, h.member()).state!;
        expect(state.terminal?.kind).toBe('reset'); expect(state.state.observedAtSimulationTime).toBe(at(1));
        expect(h.cycle(3).advanced).toBe(0);
    });
    test('gateway reconciles native-committed/domain-pending before advancing physiology, including a failed receipt-lock write', () => {
        const h = harness(); h.initialize(); const action = h.consumeFixture(10);
        const db = new Database(h.options.databasePath);
        db.run("CREATE TRIGGER fail_relief_lock BEFORE INSERT ON native_food_receipt_use BEGIN SELECT RAISE(ABORT,'receipt lock failure'); END");
        expect(() => h.cycle(12)).toThrow('receipt lock failure');
        expect(readPopulationNeeds(h.options, h.member()).state!.state.observedAtSimulationTime).toBe(start);
        expect(readPopulationFoodApplications(h.options)).toMatchObject({ status: 'available', pending: 1, applications: [] });
        db.run('DROP TRIGGER fail_relief_lock'); db.close(true);
        h.cycle(12);
        const view = readPopulationFoodApplications(h.options);
        expect(view).toMatchObject({ status: 'available', pending: 0 });
        expect(view.applications![0]).toMatchObject({ actionId: action.actionId, hungerBefore: 2000, hungerRelief: 1800, hungerAfter: 200 });
        expect(readPopulationNeeds(h.options, h.member()).state!.state.values[0]!.value).toBe(600);
        h.cycle(13);
        expect(readPopulationFoodApplications(h.options).applications).toHaveLength(1);
        expect(readPopulationNeeds(h.options, h.member()).state!.state.values[0]!.value).toBe(800);
    });
    test('missing delivery source or absent tick closure blocks physiology instead of treating it as no meals', () => {
        const h = harness(), initial = h.initialize();
        expect(() => runPopulationNeedsCycle(h.agents, h.shared, { ...h.options,
            nativeFoodCheckpointPath: join(h.root, 'absent.sqlite') }, h.enginePath, start)).toThrow('unavailable');
        expect(readPopulationNeeds(h.options, h.member()).state).toEqual(initial);
    });
});
