import { createHash } from 'node:crypto';
import { CORE_NEED_IDS, NEEDS_SCHEMA_VERSION, type NeedDefinition, type NeedsPolicy,
    type NeedsPolicyDefinition, type NeedsState, type NeedsStateDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;

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

function timestamp(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error(`${field} must be canonical UTC ISO`);
    }
    return value;
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

export function needsPolicyDigest(value: NeedsPolicyDefinition): string {
    return digest(value);
}

export function needsStateDigest(value: NeedsStateDefinition): string {
    return digest(value);
}

function needDefinition(value: unknown, index: number): NeedDefinition {
    const field = `needs[${index}]`, input = record(value, field);
    exact(input, ['needId', 'label', 'minimumValue', 'maximumValue', 'initialValue', 'criticalThreshold'], field);
    if (input.minimumValue !== 0) throw new Error(`${field}.minimumValue must be zero`);
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100) {
        throw new Error(`${field}.label is invalid`);
    }
    const maximumValue = integer(input.maximumValue, `${field}.maximumValue`, 1, 1_000_000);
    const initialValue = integer(input.initialValue, `${field}.initialValue`, 0, maximumValue);
    const criticalThreshold = integer(input.criticalThreshold, `${field}.criticalThreshold`, 1, maximumValue);
    if (criticalThreshold <= initialValue) throw new Error(`${field}.criticalThreshold must exceed initialValue`);
    return { needId: identifier(input.needId, `${field}.needId`), label: input.label.trim(),
        minimumValue: 0, maximumValue, initialValue, criticalThreshold };
}

export function validateNeedsPolicy(value: unknown): NeedsPolicy {
    const input = record(value, 'Needs policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'needs'], 'Needs policy');
    if (input.schemaVersion !== NEEDS_SCHEMA_VERSION || typeof input.version !== 'string'
        || !VERSION.test(input.version) || !Array.isArray(input.needs)
        || input.needs.length < CORE_NEED_IDS.length || input.needs.length > 32) {
        throw new Error('Needs policy identity or collection is invalid');
    }
    const needs = input.needs.map(needDefinition);
    const ids = needs.map(need => need.needId);
    if (new Set(ids).size !== ids.length) throw new Error('Need identities must be unique');
    for (const required of CORE_NEED_IDS) if (!ids.includes(required)) throw new Error(`Core need is missing: ${required}`);
    const definition: NeedsPolicyDefinition = { schemaVersion: NEEDS_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'), version: input.version, needs };
    return { ...definition, digest: needsPolicyDigest(definition) };
}

function resolvePolicy(value: NeedsPolicyDefinition | NeedsPolicy): NeedsPolicy {
    const input = record(value, 'Needs policy');
    if (!Object.hasOwn(input, 'digest')) return validateNeedsPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'needs', 'digest'], 'Validated needs policy');
    const { digest: supplied, ...definition } = input;
    const policy = validateNeedsPolicy(definition);
    if (supplied !== policy.digest) throw new Error('Validated needs policy digest does not match');
    return policy;
}

export function createInitialNeedsState(policyValue: NeedsPolicyDefinition | NeedsPolicy, input: {
    characterAgentId: string; clockId: string; observedAtSimulationTime: string;
}): NeedsState {
    const policy = resolvePolicy(policyValue);
    const characterAgentId = identifier(input.characterAgentId, 'characterAgentId');
    const definition: NeedsStateDefinition = {
        schemaVersion: NEEDS_SCHEMA_VERSION,
        stateId: `needs:${characterAgentId}`,
        version: policy.version, characterAgentId, clockId: identifier(input.clockId, 'clockId'),
        observedAtSimulationTime: timestamp(input.observedAtSimulationTime, 'observedAtSimulationTime'),
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        values: policy.needs.map(need => ({ needId: need.needId, value: need.initialValue }))
    };
    return { ...definition, digest: needsStateDigest(definition) };
}

export function validateNeedsState(value: unknown, policyValue: NeedsPolicyDefinition | NeedsPolicy): NeedsState {
    const policy = resolvePolicy(policyValue), input = record(value, 'Needs state');
    exact(input, ['schemaVersion', 'stateId', 'version', 'characterAgentId', 'clockId',
        'observedAtSimulationTime', 'policy', 'values'], 'Needs state');
    if (input.schemaVersion !== NEEDS_SCHEMA_VERSION || input.version !== policy.version || !Array.isArray(input.values)) {
        throw new Error('Needs state identity is invalid');
    }
    const reference = record(input.policy, 'policy');
    exact(reference, ['policyId', 'version', 'digest'], 'policy');
    if (reference.policyId !== policy.policyId || reference.version !== policy.version || reference.digest !== policy.digest) {
        throw new Error('Needs state policy evidence does not match');
    }
    const values = input.values.map((value, index) => {
        const item = record(value, `values[${index}]`);
        exact(item, ['needId', 'value'], `values[${index}]`);
        const needId = identifier(item.needId, `values[${index}].needId`);
        const definition = policy.needs.find(need => need.needId === needId);
        if (!definition) throw new Error(`Unknown need value: ${needId}`);
        return { needId, value: integer(item.value, `values[${index}].value`, 0, definition.maximumValue) };
    });
    if (values.length !== policy.needs.length || new Set(values.map(item => item.needId)).size !== values.length
        || policy.needs.some(need => !values.some(item => item.needId === need.needId))) {
        throw new Error('Needs state must contain every configured need exactly once');
    }
    const definition: NeedsStateDefinition = { schemaVersion: NEEDS_SCHEMA_VERSION,
        stateId: identifier(input.stateId, 'stateId'), version: input.version,
        characterAgentId: identifier(input.characterAgentId, 'characterAgentId'),
        clockId: identifier(input.clockId, 'clockId'),
        observedAtSimulationTime: timestamp(input.observedAtSimulationTime, 'observedAtSimulationTime'),
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest }, values };
    return { ...definition, digest: needsStateDigest(definition) };
}
