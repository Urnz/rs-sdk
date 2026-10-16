import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AgentPopulationMember } from '../../agent-state/types.js';
import type { SimulationClockObservation } from '../../simulation-clock/types.js';
import { characterAgeAt, evaluatePopulationAge, loadPopulationAgePolicy,
    loadPopulationLifecyclePolicyCatalog, validatePopulationAgePolicy } from '../index.js';

const policy = loadPopulationAgePolicy(join(import.meta.dir, '../../config/population-age-policy.json'));
const { digest, ...definition } = policy;
const birth = '1900-01-01T00:00:00.000Z';
const atAge = (age: number) => new Date(Date.parse(birth) + age).toISOString();
const year = policy.simulationMillisecondsPerYear;

function fixture(age: number) {
    const at = atAge(age);
    const member: AgentPopulationMember = { agentId: 'alice', playerUsername: 'alice',
        worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...policy.lifecyclePolicy, kind: 'finite' },
        simulationClock: { clockId: 'world', profileDigest: 'b'.repeat(64) },
        joinedAtSimulationTime: birth, sourceResultId: 'genesis-test', sourceResultDigest: 'c'.repeat(64),
        status: 'active', resetAtSimulationTime: null, createdAt: birth, updatedAt: birth, revision: 1,
        characterLifecycle: { agentId: 'alice', origin: 'born', createdAtSimulationTime: birth,
            birthAtSimulationTime: birth, ageAtObservationMilliseconds: 0, ageObservedAtSimulationTime: birth,
            currentAgeSimulationMilliseconds: 0, status: 'active', statusChangedAtSimulationTime: birth,
            createdAt: birth, updatedAt: birth, revision: 1 } };
    const clock: SimulationClockObservation = { clockId: 'world', profileDigest: 'b'.repeat(64),
        wallTime: '2026-10-13T12:00:00.000Z', simulationTime: at, engineTick: null, status: 'running', revision: 1 };
    return { member, clock };
}

describe('birth-derived population age and stage policy', () => {
    test('binds to the actual finite lifecycle policy and canonicalizes key order', () => {
        const catalog = loadPopulationLifecyclePolicyCatalog(join(import.meta.dir, '../../config/population-lifecycle-policies.json'));
        expect(catalog.policies.find(entry => entry.kind === 'finite')!.digest).toBe(policy.lifecyclePolicy.digest);
        const reordered = JSON.parse(JSON.stringify(definition), (_key, value) => value && typeof value === 'object'
            && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
        expect(validatePopulationAgePolicy(reordered).digest).toBe(digest);
        expect(validatePopulationAgePolicy({ ...definition, version: '1.0.1' }).digest).not.toBe(digest);
    });

    test('covers every half-open boundary and the unbounded final stage', () => {
        for (let index = 0; index < policy.stages.length; index++) {
            const stage = policy.stages[index]!;
            const age = stage.fromAgeYears * year;
            const exact = fixture(age);
            expect(evaluatePopulationAge(exact.member, exact.clock, policy)).toMatchObject({
                status: 'known', ageSimulationMilliseconds: age, ageYears: stage.fromAgeYears,
                stageId: stage.stageId, modifiers: stage.modifiers });
            if (index > 0) {
                const before = fixture(age - 1);
                expect(evaluatePopulationAge(before.member, before.clock, policy).stageId).toBe(policy.stages[index - 1]!.stageId);
            }
        }
        const ancient = fixture(200 * year);
        expect(evaluatePopulationAge(ancient.member, ancient.clock, policy).stageId).toBe('elder');
    });

    test('ignores cached ages when birth is recorded, reports missing birth explicitly', () => {
        const local = fixture(18 * year);
        local.member.characterLifecycle.ageAtObservationMilliseconds = 999;
        local.member.characterLifecycle.currentAgeSimulationMilliseconds = 999;
        expect(evaluatePopulationAge(local.member, local.clock, policy).ageSimulationMilliseconds).toBe(18 * year);
        local.member.characterLifecycle.birthAtSimulationTime = null;
        expect(evaluatePopulationAge(local.member, local.clock, policy)).toMatchObject({ status: 'unknown',
            reason: 'birth-time-unrecorded', ageSimulationMilliseconds: null, stageId: null, modifiers: null });
    });

    test('configurable scale, boundaries and modifiers change the domain result', () => {
        const custom = validatePopulationAgePolicy({ ...definition, simulationMillisecondsPerYear: 1000,
            stages: [{ stageId: 'young', fromAgeYears: 0, modifiers: policy.stages[0]!.modifiers },
                { stageId: 'mature', fromAgeYears: 2, modifiers: { regenerationBasisPoints: 7000,
                    workloadCapacityBasisPoints: 5000, riskBasisPoints: 20000 } }] });
        const local = fixture(2000);
        expect(evaluatePopulationAge(local.member, local.clock, custom)).toMatchObject({ ageYears: 2,
            stageId: 'mature', modifiers: { workloadCapacityBasisPoints: 5000, riskBasisPoints: 20000 } });
    });

    test('freezes reset history and deceased age and withholds active modifiers', () => {
        const local = fixture(80 * year);
        local.member.status = 'reset'; local.member.resetAtSimulationTime = atAge(18 * year);
        expect(evaluatePopulationAge(local.member, local.clock, policy)).toMatchObject({ ageYears: 18,
            stageId: 'adult', modifiers: null, observedAtSimulationTime: atAge(18 * year) });
        local.member.status = 'active';
        local.member.characterLifecycle.status = 'deceased';
        local.member.characterLifecycle.statusChangedAtSimulationTime = atAge(50 * year);
        expect(evaluatePopulationAge(local.member, local.clock, policy)).toMatchObject({ ageYears: 50,
            stageId: 'older-adult', modifiers: null });
    });

    test('rejects stale policy, lifecycle or clock bindings and mismatched identities', () => {
        const local = fixture(year);
        expect(() => evaluatePopulationAge(local.member, local.clock, { ...policy, digest: '0'.repeat(64) })).toThrow('stale');
        expect(() => evaluatePopulationAge(local.member, { ...local.clock, clockId: 'another' }, policy)).toThrow('exact shared');
        expect(() => evaluatePopulationAge(local.member, { ...local.clock, profileDigest: '0'.repeat(64) }, policy)).toThrow('exact shared');
        for (const key of ['policyId', 'version', 'digest'] as const) {
            expect(() => evaluatePopulationAge({ ...local.member, lifecyclePolicy: {
                ...local.member.lifecyclePolicy, [key]: 'wrong' } }, local.clock, policy)).toThrow('binding is stale');
        }
        local.member.characterLifecycle.agentId = 'other';
        expect(() => evaluatePopulationAge(local.member, local.clock, policy)).toThrow('identity mismatch');
    });

    test('rejects gaps at zero, unordered/duplicate stages, unsafe boundaries and unbounded modifiers', () => {
        const invalid = [
            { ...definition, extra: true }, { ...definition, schemaVersion: 2 },
            { ...definition, simulationMillisecondsPerYear: 0 }, { ...definition, stages: [] },
            { ...definition, stages: policy.stages.slice(1) },
            { ...definition, stages: [...policy.stages].reverse() },
            { ...definition, stages: [policy.stages[0], policy.stages[0]] },
            { ...definition, stages: [policy.stages[0], { ...policy.stages[1], fromAgeYears: Number.MAX_SAFE_INTEGER }] },
            { ...definition, stages: [{ ...policy.stages[0], modifiers: { ...policy.stages[0]!.modifiers, riskBasisPoints: 40001 } }] },
            { ...definition, stages: [{ ...policy.stages[0], modifiers: { ...policy.stages[0]!.modifiers, riskBasisPoints: 1.5 } }] }
        ];
        for (const value of invalid) expect(() => validatePopulationAgePolicy(value)).toThrow();
    });

    test('rejects future birth, invalid timestamps and overflowing age; retains legacy anchor arithmetic', () => {
        const local = fixture(year), lifecycle = local.member.characterLifecycle;
        expect(() => characterAgeAt(lifecycle, 'not-a-date')).toThrow('canonical');
        expect(() => characterAgeAt(lifecycle, '1899-01-01T00:00:00.000Z')).toThrow('precedes birth');
        expect(characterAgeAt({ ...lifecycle, birthAtSimulationTime: null, ageAtObservationMilliseconds: 10 }, atAge(20))).toBe(30);
        expect(() => characterAgeAt({ ...lifecycle, birthAtSimulationTime: null,
            ageAtObservationMilliseconds: Number.MAX_SAFE_INTEGER }, atAge(20))).toThrow('safe range');
    });
});
