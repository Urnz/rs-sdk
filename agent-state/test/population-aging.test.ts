import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPopulationAgePolicy, validatePopulationAgePolicy,
    loadPopulationMortalityPolicy, validatePopulationMortalityPolicy } from '../../population-lifecycle/index.js';
import { SimulationClockStore } from '../../simulation-clock/index.js';
import { AgentStateStore } from '../index.js';
import { listAdminAgents } from '../../server/gateway/admin/agent-state.js';

const directories: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
    for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const loaded = loadPopulationAgePolicy(join(import.meta.dir, '../../config/population-age-policy.json'));
const { digest, ...definition } = loaded;
const policy = validatePopulationAgePolicy({ ...definition, simulationMillisecondsPerYear: 1000 });
const { digest: mortalityDigest, ...mortalityDefinition } = loadPopulationMortalityPolicy(
    join(import.meta.dir, '../../config/population-mortality-policy.json'));
const mortalityPolicy = validatePopulationMortalityPolicy({ ...mortalityDefinition,
    agePolicy: { policyId: policy.policyId, version: policy.version, digest: policy.digest } });
const wall = '2026-10-13T10:00:00.000Z';
const initial = '2001-01-01T00:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(wall) + ms).toISOString();

function harness() {
    const directory = mkdtempSync(join(tmpdir(), 'population-aging-')); directories.push(directory);
    const path = join(directory, 'agents.sqlite');
    const clock = new SimulationClockStore(join(directory, 'clock.sqlite')); closers.push(() => clock.close());
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'aging-test',
        version: '1.0.0', seed: 'aging-test', rate: { simulationMilliseconds: 2, wallMilliseconds: 1 } },
        wallTime: wall, simulationTime: initial });
    let store = new AgentStateStore(path, { store: clock, clockId: 'world' }); closers.push(() => store.close());
    store.createIdentity({ agentId: 'alice', playerUsername: 'Alice', displayName: 'Alice', background: 'Aging test.',
        personalityTraits: ['steady'] }, wall);
    store.bindPopulationMember({ agentId: 'alice', playerUsername: 'alice',
        worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...policy.lifecyclePolicy, kind: 'finite' },
        simulationClock: { clockId: 'world', profileDigest: state.profileDigest }, joinedAtSimulationTime: initial,
        sourceResultId: 'genesis-0123456789abcdef01234567', sourceResultDigest: 'c'.repeat(64) }, wall);
    return { path, clock, get store() { return store; }, restart() {
        store.close(); store = new AgentStateStore(path, { store: clock, clockId: 'world' });
    } };
}

describe('population age from authoritative AgentState and shared clock', () => {
    test('missing birth remains unknown across restart, without rewriting persistent data', () => {
        const local = harness();
        expect(local.store.getPopulationAge('alice', policy, later(1000))).toMatchObject({ status: 'unknown', modifiers: null });
        local.restart();
        expect(local.store.getPopulationAge('alice', policy)).toMatchObject({ status: 'unknown', stageId: null });
        expect(local.store.getCharacterLifecycle('alice')!.birthAtSimulationTime).toBeNull();
        expect(local.store.getPopulationMember('alice')!.revision).toBe(1);
        expect(local.store.getPopulationAge('absent', policy)).toBeNull();
    });

    test('accelerated aging, exact stage crossing, pause/resume and restart use only simulation time', () => {
        const local = harness();
        local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        expect(local.store.getPopulationAge('alice', policy, later(8999))).toMatchObject({ ageYears: 17.998, stageId: 'adolescent' });
        expect(local.store.getPopulationAge('alice', policy, later(9000))).toMatchObject({ ageYears: 18, stageId: 'adult' });
        local.clock.pause('world', local.clock.get('world')!.revision, later(9000));
        expect(local.store.getPopulationAge('alice', policy, later(50000))!.ageYears).toBe(18);
        local.restart();
        expect(local.store.getPopulationAge('alice', policy)!.ageYears).toBe(18);
        local.clock.resume('world', local.clock.get('world')!.revision, later(50000));
        expect(local.store.getPopulationAge('alice', policy, later(66000))).toMatchObject({ ageYears: 50, stageId: 'older-adult' });
        const observed = local.store.observeCharacterAge('alice', 2, later(66000));
        expect(observed.currentAgeSimulationMilliseconds).toBe(50000);
        expect(local.store.getSnapshot('alice')!.populationMember!.characterLifecycle.currentAgeSimulationMilliseconds).toBe(50000);
    });

    test('birth registration rejects future timestamps and stale revisions; birth stays immutable', () => {
        const local = harness();
        expect(() => local.store.setCharacterBirth('alice', 1, '2002-01-01T00:00:00.000Z', 'born', wall)).toThrow('cannot follow');
        expect(() => local.store.setCharacterBirth('alice', 9, initial, 'born', wall)).toThrow('changed before');
        local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        expect(() => local.store.setCharacterBirth('alice', 2, initial, 'born', wall)).toThrow('immutable');
        expect(() => local.store.observeCharacterAge('alice', 1, wall)).toThrow('changed before');
    });

    test('reset keeps a historical stage without modifiers or further population aging', () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        local.store.getPopulationAge('alice', policy, later(9000));
        local.store.resetPopulationMember('alice', 'c'.repeat(64), 1, later(9000));
        expect(local.store.getPopulationAge('alice', policy, later(50000))).toMatchObject({ ageYears: 18,
            stageId: 'adult', modifiers: null });
        local.restart();
        expect(local.store.getPopulationAge('alice', policy)!.ageYears).toBe(18);
    });

    test('rejects missing or reconfigured shared clock instead of using wall time', () => {
        const local = harness();
        const withoutClock = new AgentStateStore(local.path); closers.push(() => withoutClock.close());
        expect(() => withoutClock.getPopulationAge('alice', policy)).toThrow('shared simulation clock');
        const state = local.clock.get('world')!;
        local.clock.reconfigure('world', state.revision, { ...state.profile, version: '1.0.1' }, wall);
        expect(() => local.store.getPopulationAge('alice', policy)).toThrow('exact shared');
    });

    test('derives recorded birth directly even if the observation cache differs', () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const database = new Database(local.path, { strict: true });
        try { database.run('UPDATE agent_character_lifecycle SET age_at_observation_ms=999 WHERE agent_id=?1', ['alice']); }
        finally { database.close(); }
        expect(local.store.getPopulationAge('alice', policy, later(9000))!.ageYears).toBe(18);
        expect(local.store.getCharacterLifecycle('alice')!.currentAgeSimulationMilliseconds).toBe(18000);
    });

    test('admin backend exposes the same age and domain modifiers using the real bound clock', async () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const result = await listAdminAgents(local.path, { simulationClock: { store: local.clock, clockId: 'world' },
            populationAgePolicy: policy, populationMortalityPolicy: mortalityPolicy,
            observedAt: later(35000), skillRuns: [] });
        expect(result.agents[0]!.populationAge).toMatchObject({ status: 'known', ageYears: 70, stageId: 'elder',
            modifiers: { regenerationBasisPoints: 6500, workloadCapacityBasisPoints: 6000, riskBasisPoints: 14000 } });
        expect(result.agents[0]!.characterLifecycle!.currentAgeSimulationMilliseconds).toBe(70000);
    });
});
