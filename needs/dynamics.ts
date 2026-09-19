import { createHash } from 'node:crypto';
import type { PlayerPresence, PlayerRestState, SimulationClockObservation } from '../simulation-clock/types.js';
import { needsStateDigest, validateNeedsPolicy, validateNeedsState } from './profile.js';
import { NEEDS_DYNAMICS_SCHEMA_VERSION, NEEDS_SCHEMA_VERSION, type NeedRateRule,
    type NeedsDynamicsPolicy, type NeedsDynamicsPolicyDefinition, type NeedsPolicy,
    type NeedsPolicyDefinition, type NeedsState, type NeedsStateDefinition,
    type NeedsTransition, type NeedsTransitionDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const RATE_DENOMINATOR = 3_600_000;
const MAX_ELAPSED_MILLISECONDS = 366 * 24 * 60 * 60 * 1_000;

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function needsDynamicsPolicyDigest(value: NeedsDynamicsPolicyDefinition): string {
    return digest(value);
}

function rule(value: unknown, index: number): NeedRateRule {
    const field = `rules[${index}]`, input = record(value, field);
    exact(input, ['needId', 'onlineAwakePerHour', 'offlineAwakePerHour',
        'onlineSleepingPerHour', 'offlineSleepingPerHour'], field);
    return { needId: identifier(input.needId, `${field}.needId`),
        onlineAwakePerHour: integer(input.onlineAwakePerHour, `${field}.onlineAwakePerHour`, -100_000, 100_000),
        offlineAwakePerHour: integer(input.offlineAwakePerHour, `${field}.offlineAwakePerHour`, -100_000, 100_000),
        onlineSleepingPerHour: integer(input.onlineSleepingPerHour,
            `${field}.onlineSleepingPerHour`, -100_000, 100_000),
        offlineSleepingPerHour: integer(input.offlineSleepingPerHour,
            `${field}.offlineSleepingPerHour`, -100_000, 100_000) };
}

export function validateNeedsDynamicsPolicy(value: unknown,
    needsPolicyValue: NeedsPolicyDefinition | NeedsPolicy): NeedsDynamicsPolicy {
    const needsPolicy = resolveNeedsPolicy(needsPolicyValue);
    const input = record(value, 'Needs dynamics policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'needsPolicy', 'rules'], 'Needs dynamics policy');
    if (input.schemaVersion !== NEEDS_DYNAMICS_SCHEMA_VERSION || typeof input.version !== 'string'
        || !VERSION.test(input.version) || !Array.isArray(input.rules)) throw new Error('Needs dynamics policy is invalid');
    const reference = record(input.needsPolicy, 'needsPolicy');
    exact(reference, ['policyId', 'version'], 'needsPolicy');
    if (reference.policyId !== needsPolicy.policyId || reference.version !== needsPolicy.version) {
        throw new Error('Needs dynamics policy references a different needs policy');
    }
    const rules = input.rules.map(rule);
    const ids = rules.map(item => item.needId);
    if (rules.length !== needsPolicy.needs.length || new Set(ids).size !== ids.length
        || needsPolicy.needs.some(need => !ids.includes(need.needId))) {
        throw new Error('Needs dynamics must contain one rule for every configured need');
    }
    const definition: NeedsDynamicsPolicyDefinition = { schemaVersion: NEEDS_DYNAMICS_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'), version: input.version,
        needsPolicy: { policyId: needsPolicy.policyId, version: needsPolicy.version }, rules };
    return { ...definition, digest: needsDynamicsPolicyDigest(definition) };
}

function resolveNeedsPolicy(value: NeedsPolicyDefinition | NeedsPolicy): NeedsPolicy {
    const input = record(value, 'Needs policy');
    if (!Object.hasOwn(input, 'digest')) return validateNeedsPolicy(input);
    const { digest: supplied, ...definition } = input;
    const policy = validateNeedsPolicy(definition);
    if (supplied !== policy.digest) throw new Error('Validated needs policy digest does not match');
    return policy;
}

function resolveDynamics(value: NeedsDynamicsPolicyDefinition | NeedsDynamicsPolicy,
    needsPolicy: NeedsPolicyDefinition | NeedsPolicy): NeedsDynamicsPolicy {
    const input = record(value, 'Needs dynamics policy');
    if (!Object.hasOwn(input, 'digest')) return validateNeedsDynamicsPolicy(input, needsPolicy);
    exact(input, ['schemaVersion', 'policyId', 'version', 'needsPolicy', 'rules', 'digest'],
        'Validated needs dynamics policy');
    const { digest: supplied, ...definition } = input;
    const policy = validateNeedsDynamicsPolicy(definition, needsPolicy);
    if (supplied !== policy.digest) throw new Error('Validated needs dynamics policy digest does not match');
    return policy;
}

function resolveState(value: NeedsState, needsPolicy: NeedsPolicyDefinition | NeedsPolicy): NeedsState {
    const { digest: supplied, ...definition } = value;
    const state = validateNeedsState(definition, needsPolicy);
    if (supplied !== state.digest) throw new Error('Validated needs state digest does not match');
    return state;
}

function selectedRate(ruleValue: NeedRateRule, presence: PlayerPresence, rest: PlayerRestState): number {
    if (presence === 'online') return rest === 'awake'
        ? ruleValue.onlineAwakePerHour : ruleValue.onlineSleepingPerHour;
    return rest === 'awake' ? ruleValue.offlineAwakePerHour : ruleValue.offlineSleepingPerHour;
}

export function advanceNeedsFromClock(stateValue: NeedsState, observation: SimulationClockObservation,
    presence: PlayerPresence, rest: PlayerRestState, needsPolicyValue: NeedsPolicyDefinition | NeedsPolicy,
    dynamicsValue: NeedsDynamicsPolicyDefinition | NeedsDynamicsPolicy): NeedsTransition {
    const needsPolicy = resolveNeedsPolicy(needsPolicyValue);
    const state = resolveState(stateValue, needsPolicy), dynamics = resolveDynamics(dynamicsValue, needsPolicy);
    if (observation.clockId !== state.clockId) throw new Error('Simulation clock does not match needs state');
    if (presence !== 'online' && presence !== 'offline') throw new Error('Player presence is invalid');
    if (rest !== 'awake' && rest !== 'sleeping') throw new Error('Player rest state is invalid');
    const from = Date.parse(state.observedAtSimulationTime), to = Date.parse(observation.simulationTime);
    if (Number.isNaN(to) || new Date(to).toISOString() !== observation.simulationTime) {
        throw new Error('Simulation clock observation time must be canonical UTC ISO');
    }
    const elapsedSimulationMilliseconds = to - from;
    if (elapsedSimulationMilliseconds < 0 || elapsedSimulationMilliseconds > MAX_ELAPSED_MILLISECONDS) {
        throw new Error('Simulation time transition must be monotonic and at most 366 days');
    }
    const deltas = state.values.map(current => {
        const definition = needsPolicy.needs.find(need => need.needId === current.needId)!;
        const ratePerSimulationHour = selectedRate(dynamics.rules.find(item => item.needId === current.needId)!,
            presence, rest);
        const numerator = current.remainderNumerator + elapsedSimulationMilliseconds * ratePerSimulationHour;
        const requestedDelta = Math.trunc(numerator / RATE_DENOMINATOR);
        const unclamped = current.value + requestedDelta;
        const after = Math.max(definition.minimumValue, Math.min(definition.maximumValue, unclamped));
        const remainderNumerator = after === unclamped ? numerator - requestedDelta * RATE_DENOMINATOR : 0;
        return { value: { needId: current.needId, value: after, remainderNumerator },
            delta: { needId: current.needId, before: current.value, ratePerSimulationHour,
                appliedDelta: after - current.value, after } };
    });
    const stateDefinition: NeedsStateDefinition = { schemaVersion: NEEDS_SCHEMA_VERSION,
        stateId: state.stateId, version: state.version,
        characterAgentId: state.characterAgentId, clockId: state.clockId,
        observedAtSimulationTime: observation.simulationTime, policy: state.policy,
        values: deltas.map(item => item.value) };
    const nextState: NeedsState = { ...stateDefinition, digest: needsStateDigest(stateDefinition) };
    const transition: NeedsTransitionDefinition = {
        schemaVersion: NEEDS_DYNAMICS_SCHEMA_VERSION, previousStateDigest: state.digest, clockId: state.clockId,
        fromSimulationTime: state.observedAtSimulationTime, toSimulationTime: observation.simulationTime,
        elapsedSimulationMilliseconds, presence, rest,
        dynamicsPolicy: { policyId: dynamics.policyId, version: dynamics.version, digest: dynamics.digest },
        deltas: deltas.map(item => item.delta), state: nextState
    };
    return { ...transition, digest: digest(transition) };
}
