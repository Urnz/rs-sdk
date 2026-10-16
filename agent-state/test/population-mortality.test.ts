import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPopulationAgePolicy, loadPopulationMortalityPolicy,
    validatePopulationAgePolicy, validatePopulationMortalityPolicy } from '../../population-lifecycle/index.js';
import { SimulationClockStore } from '../../simulation-clock/index.js';
import { listAdminAgents } from '../../server/gateway/admin/agent-state.js';
import { AgentStateStore } from '../index.js';

const closers: Array<() => void> = [], directories: string[] = [];
afterEach(() => {
    for (const close of closers.splice(0).reverse()) close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const configDirectory = join(import.meta.dir, '../../config');
const loadedAge = loadPopulationAgePolicy(join(configDirectory, 'population-age-policy.json'));
const { digest: _ageDigest, ...ageDefinition } = loadedAge;
const agePolicy = validatePopulationAgePolicy({ ...ageDefinition, simulationMillisecondsPerYear: 1000 });
const loadedMortality = loadPopulationMortalityPolicy(join(configDirectory, 'population-mortality-policy.json'));
const { digest: _mortalityDigest, ...mortalityDefinition } = loadedMortality;
const mortalityPolicy = validatePopulationMortalityPolicy({ ...mortalityDefinition,
    agePolicy: { policyId: agePolicy.policyId, version: agePolicy.version, digest: agePolicy.digest } });
const wall = '2026-10-13T10:00:00.000Z', initial = '2001-01-01T00:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(wall) + ms).toISOString();

function harness() {
    const directory = mkdtempSync(join(tmpdir(), 'population-mortality-')); directories.push(directory);
    const path = join(directory, 'agents.sqlite'), clockPath = join(directory, 'clock.sqlite');
    let clock = new SimulationClockStore(clockPath);
    const state = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'mortality-test',
        version: '1.0.0', seed: 'mortality-test', rate: { simulationMilliseconds: 2, wallMilliseconds: 1 } },
        wallTime: wall, simulationTime: initial });
    let store = new AgentStateStore(path, { store: clock, clockId: 'world' });
    closers.push(() => clock.close(), () => store.close());
    store.createIdentity({ agentId: 'alice', playerUsername: 'Alice', displayName: 'Alice', background: 'Mortality test.',
        personalityTraits: ['steady'] }, wall);
    const membership = { agentId: 'alice', playerUsername: 'alice',
        worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...agePolicy.lifecyclePolicy, kind: 'finite' as const },
        simulationClock: { clockId: 'world', profileDigest: state.profileDigest }, joinedAtSimulationTime: initial,
        sourceResultId: 'genesis-0123456789abcdef01234567', sourceResultDigest: 'c'.repeat(64) };
    store.bindPopulationMember(membership, wall);
    return { path, membership, get clock() { return clock; }, get store() { return store; },
        read(now?: string) { return store.getPopulationMortality('alice', agePolicy, mortalityPolicy, now)!; },
        restart() {
            store.close(); clock.close(); clock = new SimulationClockStore(clockPath);
            store = new AgentStateStore(path, { store: clock, clockId: 'world' });
        } };
}

describe('mortality projections from persistent population and shared clock', () => {
    test('no birth is invented; traits survive restart and later explicit birth registration', () => {
        const local = harness(), first = local.read();
        expect(first).toMatchObject({ status: 'unknown', candidate: null, ageSimulationMilliseconds: null });
        local.restart(); expect(local.read()).toEqual(first);
        local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        expect(local.read().traits).toEqual(first.traits);
        expect(local.read().candidate!.due).toBeFalse();
    });

    test('replay, paused clock and reopening both databases preserve the exact future candidate', () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const first = local.read();
        local.read(later(10000));
        local.clock.pause('world', local.clock.get('world')!.revision, later(10000));
        const paused = local.read(later(200000));
        expect(paused.candidate).toEqual(first.candidate);
        local.restart(); expect(local.read()).toEqual(paused);
        const beforeReplay = local.store.getPopulationMember('alice')!;
        expect(local.store.bindPopulationMember(local.membership, later(200000))).toEqual(beforeReplay);
        expect(local.read().traits).toEqual(first.traits);
        expect(local.store.getCharacterLifecycle('alice')!.revision).toBe(2);
    });

    test('catch-up reaches the same due candidate as incremental observation and never marks a death', () => {
        const direct = harness(), incremental = harness();
        for (const local of [direct, incremental]) local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const lifespan = direct.read().traits.naturalLifespanSimulationMilliseconds;
        const elapsed = Math.ceil(lifespan / 2);
        for (let milliseconds = 1000; milliseconds < elapsed; milliseconds += 1000) incremental.read(later(milliseconds));
        const reached = direct.read(later(elapsed));
        expect(reached).toEqual(incremental.read(later(elapsed)));
        expect(reached.candidate!.due).toBeTrue();
        expect(direct.store.getCharacterLifecycle('alice')!.status).toBe('active');
        expect(direct.store.getPopulationMember('alice')!.revision).toBe(1);
    });

    test('reset history retains traits but removes the candidate, including after restart', () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const first = local.read(later(10000));
        local.store.resetPopulationMember('alice', local.membership.sourceResultDigest, 1, later(10000));
        const reset = local.read(later(200000));
        expect(reset).toMatchObject({ status: 'inactive', reason: 'membership-reset', candidate: null, traits: first.traits });
        local.restart(); expect(local.read()).toEqual(reset);
    });

    test('missing/reconfigured clock and incompatible policy fail closed', () => {
        const local = harness(), absentClock = new AgentStateStore(local.path); closers.push(() => absentClock.close());
        expect(() => absentClock.getPopulationMortality('alice', agePolicy, mortalityPolicy)).toThrow('shared simulation clock');
        expect(() => local.store.getPopulationMortality('alice', agePolicy, loadedMortality)).toThrow('binding is stale');
        const clock = local.clock.get('world')!;
        local.clock.reconfigure('world', clock.revision, { ...clock.profile, version: '1.0.1' }, wall);
        expect(() => local.read()).toThrow('exact shared');
    });

    test('admin backend uses the same projection; missing clock exposes unavailable data', async () => {
        const local = harness(); local.store.setCharacterBirth('alice', 1, initial, 'born', wall);
        const result = await listAdminAgents(local.path, { simulationClock: { store: local.clock, clockId: 'world' },
            populationAgePolicy: agePolicy, populationMortalityPolicy: mortalityPolicy, observedAt: later(200000), skillRuns: [] });
        expect(result.agents[0]!.populationMortality).toEqual(local.read());
        expect(result.agents[0]!.populationMortality!.candidate!.due).toBeTrue();
        const missing = await listAdminAgents(local.path, { skillRuns: [] });
        expect(missing.agents[0]!.populationMortality).toBeNull();
        expect(missing.agents[0]!.decisionContextBlockers).toContain('population-mortality');
    });
});
