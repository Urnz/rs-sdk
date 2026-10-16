import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AgentCharacterLifecycle, AgentPopulationMember } from '../agent-state/types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export interface PopulationAgeModifiers {
    regenerationBasisPoints: number;
    workloadCapacityBasisPoints: number;
    riskBasisPoints: number;
}

export interface PopulationAgeStage {
    stageId: string;
    fromAgeYears: number;
    modifiers: PopulationAgeModifiers;
}

export interface PopulationAgePolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    lifecyclePolicy: { policyId: string; version: string; digest: string };
    simulationMillisecondsPerYear: number;
    stages: PopulationAgeStage[];
}

export interface PopulationAgePolicy extends PopulationAgePolicyDefinition { digest: string }

interface PopulationAgeObservationBase {
    agentId: string;
    observedAtSimulationTime: string;
    agePolicy: { policyId: string; version: string; digest: string };
}

export type PopulationAgeObservation = PopulationAgeObservationBase & (
    { status: 'unknown'; reason: 'birth-time-unrecorded'; ageSimulationMilliseconds: null;
        ageYears: null; stageId: null; modifiers: null }
    | { status: 'known'; ageSimulationMilliseconds: number; ageYears: number; stageId: string;
        // Historical/reset/deceased observations cannot authorize physical activity.
        modifiers: PopulationAgeModifiers | null }
);

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
        throw new Error(`${label} fields are invalid`);
    }
    return value as Record<string, unknown>;
}

function identity(value: Record<string, unknown>, label: string): void {
    if (typeof value.policyId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(value.policyId)
        || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value.version)) {
        throw new Error(`${label} identity is invalid`);
    }
}

export function validatePopulationAgePolicy(raw: unknown): PopulationAgePolicy {
    const value = object(raw, ['schemaVersion', 'policyId', 'version', 'lifecyclePolicy',
        'simulationMillisecondsPerYear', 'stages'], 'Population age policy');
    identity(value, 'Population age policy');
    const binding = object(value.lifecyclePolicy, ['policyId', 'version', 'digest'], 'Lifecycle binding');
    identity(binding, 'Lifecycle binding');
    if (typeof binding.digest !== 'string' || !/^[a-f0-9]{64}$/.test(binding.digest)) {
        throw new Error('Lifecycle binding digest is invalid');
    }
    const year = value.simulationMillisecondsPerYear;
    if (value.schemaVersion !== 1 || typeof year !== 'number' || !Number.isSafeInteger(year) || year <= 0
        || !Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > 32) {
        throw new Error('Population age policy scale or stages are invalid');
    }
    let previous = -1;
    const stages = value.stages.map(rawStage => {
        const stage = object(rawStage, ['stageId', 'fromAgeYears', 'modifiers'], 'Age stage');
        const from = stage.fromAgeYears;
        if (typeof stage.stageId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(stage.stageId)
            || typeof from !== 'number' || !Number.isSafeInteger(from) || from <= previous
            || !Number.isSafeInteger(from * year)) throw new Error('Age stage boundary is invalid');
        previous = from;
        const modifiers = object(stage.modifiers, ['regenerationBasisPoints', 'workloadCapacityBasisPoints',
            'riskBasisPoints'], 'Age modifiers');
        for (const multiplier of Object.values(modifiers)) {
            if (typeof multiplier !== 'number' || !Number.isSafeInteger(multiplier)
                || multiplier < 0 || multiplier > 40_000) throw new Error('Age modifier is outside bounds');
        }
        return { stageId: stage.stageId, fromAgeYears: from,
            modifiers: { regenerationBasisPoints: modifiers.regenerationBasisPoints as number,
                workloadCapacityBasisPoints: modifiers.workloadCapacityBasisPoints as number,
                riskBasisPoints: modifiers.riskBasisPoints as number } };
    });
    if (stages[0]!.fromAgeYears !== 0 || new Set(stages.map(stage => stage.stageId)).size !== stages.length) {
        throw new Error('Age stages must start at zero and have unique ids');
    }
    const definition: PopulationAgePolicyDefinition = { schemaVersion: 1, policyId: value.policyId as string,
        version: value.version as string, lifecyclePolicy: { policyId: binding.policyId as string,
            version: binding.version as string, digest: binding.digest }, simulationMillisecondsPerYear: year, stages };
    // Validation reconstructs fields in a fixed order, including nested objects.
    return { ...definition, digest: createHash('sha256').update(JSON.stringify(definition)).digest('hex') };
}

export function loadPopulationAgePolicy(path: string): PopulationAgePolicy {
    return validatePopulationAgePolicy(JSON.parse(readFileSync(path, 'utf8')));
}

function timestamp(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
        throw new Error('Character age time must be canonical UTC ISO');
    }
    return parsed;
}

/** Birth is authoritative; the observation anchor is only a legacy fallback. */
export function characterAgeAt(lifecycle: Pick<AgentCharacterLifecycle, 'birthAtSimulationTime'
    | 'ageAtObservationMilliseconds' | 'ageObservedAtSimulationTime' | 'status' | 'statusChangedAtSimulationTime'>,
atSimulationTime: string): number {
    const observed = timestamp(atSimulationTime);
    const effective = lifecycle.status === 'deceased'
        ? Math.min(observed, timestamp(lifecycle.statusChangedAtSimulationTime)) : observed;
    const age = lifecycle.birthAtSimulationTime === null
        ? lifecycle.ageAtObservationMilliseconds + (lifecycle.status === 'active'
            ? effective - timestamp(lifecycle.ageObservedAtSimulationTime) : 0)
        : effective - timestamp(lifecycle.birthAtSimulationTime);
    if (!Number.isSafeInteger(age) || age < 0) throw new Error('Character age exceeds the safe range or precedes birth');
    return age;
}

export function evaluatePopulationAge(member: AgentPopulationMember, clock: SimulationClockObservation,
    policy: PopulationAgePolicy): PopulationAgeObservation {
    const { digest, ...definition } = policy;
    const verified = validatePopulationAgePolicy(definition);
    if (verified.digest !== digest) throw new Error('Population age policy digest is stale');
    const binding = verified.lifecyclePolicy;
    if (member.lifecyclePolicy.kind !== 'finite' || member.lifecyclePolicy.policyId !== binding.policyId
        || member.lifecyclePolicy.version !== binding.version || member.lifecyclePolicy.digest !== binding.digest) {
        throw new Error('Population age lifecycle policy binding is stale');
    }
    if (member.simulationClock.clockId !== clock.clockId || member.simulationClock.profileDigest !== clock.profileDigest) {
        throw new Error('Population age requires the exact shared simulation clock');
    }
    if (member.agentId !== member.characterLifecycle.agentId) throw new Error('Population age lifecycle identity mismatch');
    const at = member.status === 'reset' ? member.resetAtSimulationTime : clock.simulationTime;
    if (!at || timestamp(at) > timestamp(clock.simulationTime)) throw new Error('Population age observation time is invalid');
    const base = { agentId: member.agentId, observedAtSimulationTime: at,
        agePolicy: { policyId: verified.policyId, version: verified.version, digest } };
    if (member.characterLifecycle.birthAtSimulationTime === null) {
        return { ...base, status: 'unknown', reason: 'birth-time-unrecorded', ageSimulationMilliseconds: null,
            ageYears: null, stageId: null, modifiers: null };
    }
    const age = characterAgeAt(member.characterLifecycle, at);
    const stage = [...verified.stages].reverse().find(entry => age >= entry.fromAgeYears * verified.simulationMillisecondsPerYear)!;
    return { ...base, status: 'known', ageSimulationMilliseconds: age,
        ageYears: age / verified.simulationMillisecondsPerYear, stageId: stage.stageId,
        modifiers: member.status === 'active' && member.characterLifecycle.status === 'active' ? { ...stage.modifiers } : null };
}
