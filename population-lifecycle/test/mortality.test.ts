import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AgentPopulationMember } from '../../agent-state/types.js';
import type { SimulationClockObservation } from '../../simulation-clock/types.js';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog } from '../../world-genesis/index.js';
import { evaluatePopulationMortality, loadPopulationAgePolicy, loadPopulationMortalityPolicy,
    validatePopulationAgePolicy, validatePopulationMortalityPolicy } from '../index.js';

const directory = join(import.meta.dir, '../../config');
const agePolicy = loadPopulationAgePolicy(join(directory, 'population-age-policy.json'));
const policy = loadPopulationMortalityPolicy(join(directory, 'population-mortality-policy.json'));
const { digest, ...definition } = policy;
const year = agePolicy.simulationMillisecondsPerYear;
const birth = '2000-01-01T00:00:00.000Z';
const atAge = (age: number) => new Date(Date.parse(birth) + age).toISOString();

function fixture(agentId = 'alice', sourceDigest = 'c'.repeat(64), age = 0) {
    const member: AgentPopulationMember = { agentId, playerUsername: 'alice',
        worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...agePolicy.lifecyclePolicy, kind: 'finite' },
        simulationClock: { clockId: 'world', profileDigest: 'b'.repeat(64) },
        joinedAtSimulationTime: birth, sourceResultId: 'genesis-test', sourceResultDigest: sourceDigest,
        status: 'active', resetAtSimulationTime: null, createdAt: birth, updatedAt: birth, revision: 1,
        characterLifecycle: { agentId, origin: 'born', createdAtSimulationTime: birth,
            birthAtSimulationTime: birth, ageAtObservationMilliseconds: 0, ageObservedAtSimulationTime: birth,
            currentAgeSimulationMilliseconds: 0, status: 'active', statusChangedAtSimulationTime: birth,
            createdAt: birth, updatedAt: birth, revision: 1 } };
    const clock: SimulationClockObservation = { clockId: 'world', profileDigest: 'b'.repeat(64),
        wallTime: '2026-10-13T12:00:00.000Z', simulationTime: atAge(age), engineTick: null, status: 'running', revision: 1 };
    return { member, clock };
}

function evaluate(local: ReturnType<typeof fixture>, age = agePolicy, mortality = policy) {
    return evaluatePopulationMortality(local.member, local.clock, age, mortality);
}

describe('seeded bounded population natural mortality', () => {
    test('pins the actual age policy and canonicalizes JSON keys', () => {
        expect(policy.agePolicy).toEqual({ policyId: agePolicy.policyId, version: agePolicy.version, digest: agePolicy.digest });
        const reordered = JSON.parse(JSON.stringify(definition), (_key, value) => value && typeof value === 'object'
            && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
        expect(validatePopulationMortalityPolicy(reordered).digest).toBe(digest);
    });

    test('is deterministic, independent of call order and wall/audit time, with bounded diverse individuals', () => {
        const lifespans = new Set<number>(), references = new Set<number>(), predispositions = new Set<number>();
        for (let index = 0; index < 500; index++) {
            const local = fixture(`agent-${index}`), first = evaluate(local);
            const repeated = evaluate({ member: { ...local.member, revision: 99, updatedAt: '2026-10-13T18:00:00.000Z' },
                clock: { ...local.clock, wallTime: '2026-10-14T12:00:00.000Z', revision: 99 } });
            expect(repeated).toEqual(first);
            expect(first.traits.naturalLifespanSimulationMilliseconds).toBeGreaterThanOrEqual(40 * year);
            expect(first.traits.naturalLifespanSimulationMilliseconds).toBeLessThan(120 * year);
            expect(first.traits.referenceLifespanSimulationMilliseconds).toBeGreaterThanOrEqual(60 * year);
            expect(first.traits.referenceLifespanSimulationMilliseconds).toBeLessThanOrEqual(100 * year);
            expect(first.traits.susceptibilityBasisPoints).toBeGreaterThanOrEqual(7500);
            expect(first.traits.susceptibilityBasisPoints).toBeLessThanOrEqual(12500);
            lifespans.add(first.traits.naturalLifespanSimulationMilliseconds);
            references.add(first.traits.referenceLifespanSimulationMilliseconds);
            predispositions.add(first.traits.susceptibilityBasisPoints);
        }
        expect(lifespans.size).toBeGreaterThan(490);
        expect(references.size).toBeGreaterThan(490);
        expect(predispositions.size).toBeGreaterThan(400);
        const alice = fixture();
        expect(evaluate(alice)).toEqual(evaluate(fixture()));
        expect(evaluate(alice).traits).not.toEqual(evaluate(fixture('bob')).traits);
    });

    test('real genesis seed affects entropy; audit time does not', () => {
        const profiles = loadWorldGenesisProfileCatalog(join(directory, 'world-genesis-profiles.json'));
        const profile = profiles.profiles.find(entry => entry.profileId === 'mature-society')!;
        const result = (seed: string, audit: string) => buildWorldGenesisResult(buildWorldGenesisConfiguration({ seed,
            profile, worldBuild: 'lostcity-local-v1', simulationClock: { clockId: 'world', profileDigest: 'b'.repeat(64),
                initialSimulationTime: birth } }), { populationMembers: [] }, audit);
        const first = result('society-a', '2026-10-13T12:00:00.000Z');
        const later = result('society-a', '2026-10-14T12:00:00.000Z');
        const other = result('society-b', '2026-10-13T12:00:00.000Z');
        expect(evaluate(fixture('alice', first.resultDigest)).traits).toEqual(evaluate(fixture('alice', later.resultDigest)).traits);
        expect(evaluate(fixture('alice', first.resultDigest)).traits).not.toEqual(evaluate(fixture('alice', other.resultDigest)).traits);
    });

    test('candidate is false before its exact time, due at/after it, unchanged by intermediate reads', () => {
        const local = fixture(), first = evaluate(local), lifespan = first.traits.naturalLifespanSimulationMilliseconds;
        local.clock.simulationTime = atAge(lifespan - 1);
        expect(evaluate(local).candidate!.due).toBeFalse();
        local.clock.simulationTime = atAge(lifespan);
        const exact = evaluate(local);
        expect(exact.candidate).toEqual({ ...first.candidate!, due: true });
        local.clock.simulationTime = atAge(150 * year);
        expect(evaluate(local).candidate).toEqual(exact.candidate);
        expect(local.member.characterLifecycle.status).toBe('active');
        expect(local.member.revision).toBe(1);
    });

    test('natural age floor, monotone hazard, and final interval use the configured probability bounds', () => {
        const local = fixture(); let last = -1;
        for (let years = 0; years <= 120; years++) {
            local.clock.simulationTime = atAge(years * year);
            const risk = evaluate(local).annualRiskBasisPoints!;
            expect(risk).toBeGreaterThanOrEqual(last);
            expect(risk).toBeLessThanOrEqual(10000);
            if (years < 40) expect(risk).toBe(0);
            if (years >= 119) expect(risk).toBe(10000);
            last = risk;
        }
    });

    test('an old imported member is due on entry without proposing a pre-membership death', () => {
        const local = fixture('alice', 'c'.repeat(64), 150 * year);
        local.member.joinedAtSimulationTime = local.clock.simulationTime;
        local.member.characterLifecycle.createdAtSimulationTime = local.clock.simulationTime;
        expect(evaluate(local).candidate).toMatchObject({ due: true, atSimulationTime: local.member.joinedAtSimulationTime });
    });

    test('even a zero-hazard configuration terminates within the final year with per-member timing', () => {
        const zero = validatePopulationMortalityPolicy({ ...definition,
            hazardBands: [{ fromReferenceAgeBasisPoints: 0, annualRiskBasisPoints: 0 }] });
        const times = new Set<number>();
        for (let index = 0; index < 50; index++) {
            const lifespan = evaluate(fixture(`agent-${index}`), agePolicy, zero).traits.naturalLifespanSimulationMilliseconds;
            expect(lifespan).toBeGreaterThanOrEqual(119 * year);
            expect(lifespan).toBeLessThan(120 * year);
            times.add(lifespan);
        }
        expect(times.size).toBe(50);
    });

    test('unknown birth and inactive histories cannot produce actionable candidates', () => {
        const local = fixture('alice', 'c'.repeat(64), 150 * year);
        const traits = evaluate(local).traits;
        local.member.characterLifecycle.birthAtSimulationTime = null;
        expect(evaluate(local)).toMatchObject({ status: 'unknown', reason: 'birth-time-unrecorded',
            ageSimulationMilliseconds: null, annualRiskBasisPoints: null, candidate: null, traits });
        local.member.characterLifecycle.birthAtSimulationTime = birth;
        local.member.status = 'reset'; local.member.resetAtSimulationTime = atAge(70 * year);
        expect(evaluate(local)).toMatchObject({ status: 'inactive', reason: 'membership-reset', candidate: null, traits });
        local.member.status = 'active'; local.member.characterLifecycle.status = 'deceased';
        local.member.characterLifecycle.statusChangedAtSimulationTime = atAge(70 * year);
        expect(evaluate(local)).toMatchObject({ status: 'inactive', reason: 'character-deceased', candidate: null, traits });
    });

    test('rejects stale policies, malformed entropy source, wrong clock and incompatible age scale', () => {
        const local = fixture();
        expect(() => evaluate(local, agePolicy, { ...policy, digest: '0'.repeat(64) })).toThrow('digest is stale');
        const stale = validatePopulationMortalityPolicy({ ...definition, agePolicy: { ...definition.agePolicy, digest: '0'.repeat(64) } });
        expect(() => evaluate(local, agePolicy, stale)).toThrow('binding is stale');
        expect(() => evaluate({ ...local, clock: { ...local.clock, clockId: 'other' } })).toThrow('exact shared');
        expect(() => evaluate({ ...local, member: { ...local.member, sourceResultDigest: 'invalid' } })).toThrow('entropy source');
        expect(() => evaluate(local, { ...agePolicy, simulationMillisecondsPerYear: 1 })).toThrow('age policy digest is stale');
        const { digest: _ageDigest, ...ageDefinition } = agePolicy;
        const huge = validatePopulationAgePolicy({ ...ageDefinition, simulationMillisecondsPerYear: Math.floor(Number.MAX_SAFE_INTEGER / 100) });
        const hugeMortality = validatePopulationMortalityPolicy({ ...definition,
            agePolicy: { policyId: huge.policyId, version: huge.version, digest: huge.digest } });
        expect(() => evaluate(local, huge, hugeMortality)).toThrow('safe milliseconds');
    });

    test('rejects unbounded/reversed ranges, unsupported algorithm, missing bands and descending risk', () => {
        const invalid = [
            { ...definition, extra: true }, { ...definition, algorithm: 'random' },
            { ...definition, naturalAgeBoundsYears: { minimum: 40, maximum: 257 } },
            { ...definition, naturalAgeBoundsYears: { minimum: 120, maximum: 40 } },
            { ...definition, referenceLifespanYears: { minimum: 0, maximum: 100 } },
            { ...definition, referenceLifespanYears: { minimum: 80, maximum: 80 } },
            { ...definition, susceptibilityBasisPoints: { minimum: 1, maximum: 40001 } },
            { ...definition, hazardBands: [] }, { ...definition, hazardBands: definition.hazardBands.slice(1) },
            { ...definition, hazardBands: [{ fromReferenceAgeBasisPoints: 0, annualRiskBasisPoints: 10001 }] },
            { ...definition, hazardBands: [{ fromReferenceAgeBasisPoints: 0, annualRiskBasisPoints: 10 },
                { fromReferenceAgeBasisPoints: 10000, annualRiskBasisPoints: 1 }] }
        ];
        for (const value of invalid) expect(() => validatePopulationMortalityPolicy(value)).toThrow();
    });
});
