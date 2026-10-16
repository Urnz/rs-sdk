import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AgentPopulationMember } from '../agent-state/types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { evaluatePopulationAge, type PopulationAgePolicy } from './age.js';

export interface PopulationMortalityPolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    algorithm: 'sha256-annual-hazard-v1';
    agePolicy: { policyId: string; version: string; digest: string };
    naturalAgeBoundsYears: { minimum: number; maximum: number };
    referenceLifespanYears: { minimum: number; maximum: number };
    susceptibilityBasisPoints: { minimum: number; maximum: number };
    hazardBands: Array<{ fromReferenceAgeBasisPoints: number; annualRiskBasisPoints: number }>;
}

export interface PopulationMortalityPolicy extends PopulationMortalityPolicyDefinition { digest: string }

export interface PopulationMortalityTraits {
    entropyDigest: string;
    referenceLifespanSimulationMilliseconds: number;
    susceptibilityBasisPoints: number;
    naturalLifespanSimulationMilliseconds: number;
}

export interface PopulationMortalityObservation {
    agentId: string;
    observedAtSimulationTime: string;
    mortalityPolicy: { policyId: string; version: string; digest: string };
    agePolicy: { policyId: string; version: string; digest: string };
    traits: PopulationMortalityTraits;
    status: 'unknown' | 'active' | 'inactive';
    reason: 'birth-time-unrecorded' | 'membership-reset' | 'character-deceased' | null;
    ageSimulationMilliseconds: number | null;
    annualRiskBasisPoints: number | null;
    // A deterministic proposal for the future death authority, never a death event.
    candidate: { candidateId: string; atSimulationTime: string; due: boolean } | null;
}

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function object(value: unknown, keys: string[], field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
        throw new Error(`${field} fields are invalid`);
    }
    return value as Record<string, unknown>;
}

function identity(value: Record<string, unknown>): void {
    if (typeof value.policyId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(value.policyId)
        || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value.version)) {
        throw new Error('Mortality policy identity is invalid');
    }
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} is outside bounds`);
    }
    return value;
}

function bounds(value: unknown, minimum: number, maximum: number, field: string) {
    const raw = object(value, ['minimum', 'maximum'], field);
    const lower = integer(raw.minimum, minimum, maximum, field);
    const upper = integer(raw.maximum, lower + 1, maximum, field);
    return { minimum: lower, maximum: upper };
}

export function validatePopulationMortalityPolicy(raw: unknown): PopulationMortalityPolicy {
    const value = object(raw, ['schemaVersion', 'policyId', 'version', 'algorithm', 'agePolicy',
        'naturalAgeBoundsYears', 'referenceLifespanYears', 'susceptibilityBasisPoints', 'hazardBands'], 'Mortality policy');
    identity(value);
    if (value.schemaVersion !== 1 || value.algorithm !== 'sha256-annual-hazard-v1') {
        throw new Error('Mortality policy schema or algorithm is invalid');
    }
    const age = object(value.agePolicy, ['policyId', 'version', 'digest'], 'Mortality age binding');
    identity(age);
    if (typeof age.digest !== 'string' || !/^[a-f0-9]{64}$/.test(age.digest)) throw new Error('Mortality age digest is invalid');
    const natural = bounds(value.naturalAgeBoundsYears, 0, 256, 'Natural age');
    const reference = bounds(value.referenceLifespanYears, Math.max(1, natural.minimum), natural.maximum, 'Reference lifespan');
    const susceptibility = bounds(value.susceptibilityBasisPoints, 1, 40_000, 'Mortality susceptibility');
    if (!Array.isArray(value.hazardBands) || value.hazardBands.length === 0 || value.hazardBands.length > 32) {
        throw new Error('Mortality hazard bands are invalid');
    }
    let previousAge = -1, previousRisk = -1;
    const bands = value.hazardBands.map(rawBand => {
        const band = object(rawBand, ['fromReferenceAgeBasisPoints', 'annualRiskBasisPoints'], 'Mortality hazard band');
        const from = integer(band.fromReferenceAgeBasisPoints, previousAge + 1, 40_000, 'Hazard age');
        const risk = integer(band.annualRiskBasisPoints, Math.max(0, previousRisk), 10_000, 'Annual mortality risk');
        previousAge = from; previousRisk = risk;
        return { fromReferenceAgeBasisPoints: from, annualRiskBasisPoints: risk };
    });
    if (bands[0]!.fromReferenceAgeBasisPoints !== 0) throw new Error('Mortality hazard bands must start at zero');
    const definition: PopulationMortalityPolicyDefinition = { schemaVersion: 1,
        policyId: value.policyId as string, version: value.version as string, algorithm: value.algorithm,
        agePolicy: { policyId: age.policyId as string, version: age.version as string, digest: age.digest },
        naturalAgeBoundsYears: natural, referenceLifespanYears: reference,
        susceptibilityBasisPoints: susceptibility, hazardBands: bands };
    return { ...definition, digest: hash(definition) };
}

export function loadPopulationMortalityPolicy(path: string): PopulationMortalityPolicy {
    return validatePopulationMortalityPolicy(JSON.parse(readFileSync(path, 'utf8')));
}

function verifiedPolicy(policy: PopulationMortalityPolicy, agePolicy: PopulationAgePolicy): PopulationMortalityPolicy {
    const { digest, ...definition } = policy;
    const verified = validatePopulationMortalityPolicy(definition);
    if (verified.digest !== digest) throw new Error('Mortality policy digest is stale');
    if (verified.agePolicy.policyId !== agePolicy.policyId || verified.agePolicy.version !== agePolicy.version
        || verified.agePolicy.digest !== agePolicy.digest) throw new Error('Mortality age policy binding is stale');
    if (!Number.isSafeInteger(verified.naturalAgeBoundsYears.maximum * agePolicy.simulationMillisecondsPerYear)) {
        throw new Error('Mortality age range exceeds safe milliseconds');
    }
    return verified;
}

/** Inclusive bounded draw, independent of call order, wall time and global RNG. */
function draw(entropy: string, namespace: string, minimum: number, maximum: number): number {
    const span = BigInt(maximum) - BigInt(minimum) + 1n;
    const range = 1n << 256n, limit = range - range % span;
    // Rejection sampling avoids modulo bias. This bound makes bad entropy fail closed.
    for (let retry = 0; retry < 256; retry++) {
        const sample = BigInt(`0x${hash({ entropy, namespace, retry })}`);
        if (sample < limit) return minimum + Number(sample % span);
    }
    throw new Error('Mortality entropy exhausted the bounded draw');
}

function annualRisk(age: number, reference: number, susceptibility: number,
    policy: PopulationMortalityPolicy, year: number): number {
    if (age < policy.naturalAgeBoundsYears.minimum * year) return 0;
    // Last annual interval guarantees the configured upper bound, with individual sub-year timing.
    if (age >= (policy.naturalAgeBoundsYears.maximum - 1) * year) return 10_000;
    const fraction = BigInt(age) * 10_000n / BigInt(reference);
    const band = [...policy.hazardBands].reverse().find(entry => fraction >= BigInt(entry.fromReferenceAgeBasisPoints))!;
    return Math.min(10_000, Number(BigInt(band.annualRiskBasisPoints) * BigInt(susceptibility) / 10_000n));
}

export function evaluatePopulationMortality(member: AgentPopulationMember, clock: SimulationClockObservation,
    agePolicy: PopulationAgePolicy, mortalityPolicy: PopulationMortalityPolicy): PopulationMortalityObservation {
    // This also verifies the age-policy digest, finite lifecycle and exact shared clock.
    const age = evaluatePopulationAge(member, clock, agePolicy);
    const policy = verifiedPolicy(mortalityPolicy, agePolicy);
    if (!/^[a-f0-9]{64}$/.test(member.sourceResultDigest)
        || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(member.agentId)) throw new Error('Mortality entropy source is invalid');
    const lifecycleCreated = member.characterLifecycle.createdAtSimulationTime;
    if (!Number.isFinite(Date.parse(lifecycleCreated)) || new Date(lifecycleCreated).toISOString() !== lifecycleCreated) {
        throw new Error('Mortality lifecycle source time is invalid');
    }
    const entropy = hash({ algorithm: policy.algorithm, policyDigest: policy.digest,
        sourceResultDigest: member.sourceResultDigest, agentId: member.agentId, lifecycleCreatedAtSimulationTime: lifecycleCreated });
    const year = agePolicy.simulationMillisecondsPerYear;
    const reference = draw(entropy, 'reference-lifespan', policy.referenceLifespanYears.minimum * year,
        policy.referenceLifespanYears.maximum * year);
    const susceptibility = draw(entropy, 'susceptibility', policy.susceptibilityBasisPoints.minimum,
        policy.susceptibilityBasisPoints.maximum);
    let lifespan: number | null = null;
    for (let ageYear = policy.naturalAgeBoundsYears.minimum; ageYear < policy.naturalAgeBoundsYears.maximum; ageYear++) {
        const risk = annualRisk(ageYear * year, reference, susceptibility, policy, year);
        if (draw(entropy, `annual-mortality:${ageYear}`, 0, 9999) < risk) {
            lifespan = ageYear * year + draw(entropy, `within-year:${ageYear}`, 0, year - 1);
            break;
        }
    }
    if (lifespan === null) throw new Error('Mortality policy failed to produce a bounded lifespan');
    const base = { agentId: member.agentId, observedAtSimulationTime: age.observedAtSimulationTime,
        mortalityPolicy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        agePolicy: policy.agePolicy, traits: { entropyDigest: entropy, referenceLifespanSimulationMilliseconds: reference,
            susceptibilityBasisPoints: susceptibility, naturalLifespanSimulationMilliseconds: lifespan } };
    if (age.status === 'unknown') return { ...base, status: 'unknown', reason: 'birth-time-unrecorded',
        ageSimulationMilliseconds: null, annualRiskBasisPoints: null, candidate: null };
    if (member.status === 'reset' || member.characterLifecycle.status === 'deceased') {
        return { ...base, status: 'inactive', reason: member.status === 'reset' ? 'membership-reset' : 'character-deceased',
            ageSimulationMilliseconds: age.ageSimulationMilliseconds, annualRiskBasisPoints: null, candidate: null };
    }
    const deathTime = Date.parse(member.characterLifecycle.birthAtSimulationTime!) + lifespan;
    if (!Number.isSafeInteger(deathTime) || !Number.isFinite(new Date(deathTime).getTime())) {
        throw new Error('Natural mortality candidate exceeds the timestamp range');
    }
    const joined = Date.parse(member.joinedAtSimulationTime);
    if (!Number.isFinite(joined) || new Date(joined).toISOString() !== member.joinedAtSimulationTime
        || joined > Date.parse(clock.simulationTime)) throw new Error('Mortality population join time is invalid');
    // Imported elderly members can be due on entry, never backdate a proposal before membership.
    const atSimulationTime = new Date(Math.max(deathTime, joined)).toISOString();
    // Public annual risk uses the same whole-age-year interval as the schedule.
    const intervalAge = Math.floor(age.ageSimulationMilliseconds / year) * year;
    return { ...base, status: 'active', reason: null, ageSimulationMilliseconds: age.ageSimulationMilliseconds,
        annualRiskBasisPoints: annualRisk(intervalAge, reference, susceptibility, policy, year),
        candidate: { candidateId: `natural-mortality-${hash({ entropy, birth: member.characterLifecycle.birthAtSimulationTime,
            lifespan, joinedAtSimulationTime: member.joinedAtSimulationTime }).slice(0, 32)}`,
            atSimulationTime, due: age.ageSimulationMilliseconds >= lifespan } };
}
