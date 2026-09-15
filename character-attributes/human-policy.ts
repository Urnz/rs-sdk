import { createHash } from 'node:crypto';
import { generateNpcAttributeProfile } from './allocation-policy.js';
import { validateAttributeProfile } from './profile.js';
import { ATTRIBUTE_KEYS, HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION, type AttributeAllocationPolicy,
    type AttributeAllocationPolicyDefinition, type AttributeBudgetPolicy, type AttributeBudgetPolicyDefinition,
    type AttributeValues, type CreateHumanAttributeProfileInput, type HumanAttributeCreationPolicy,
    type HumanAttributeCreationPolicyDefinition, type HumanAttributeCreationResult,
    type HumanAttributeCreationResultDefinition } from './types.js';

const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

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
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function version(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} must use semantic versioning`);
    return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function simulationTime(value: unknown): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error('lifecycleCreatedAtSimulationTime must be canonical UTC ISO');
    }
    return value;
}

function policyReference(value: unknown, field: string): { policyId: string; version: string } {
    const input = record(value, field);
    exact(input, ['policyId', 'version'], field);
    return { policyId: identifier(input.policyId, `${field}.policyId`), version: version(input.version, `${field}.version`) };
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

export function humanAttributeCreationPolicyDigest(value: HumanAttributeCreationPolicyDefinition): string {
    return digest(value);
}

export function validateHumanAttributeCreationPolicy(value: unknown): HumanAttributeCreationPolicy {
    const input = record(value, 'Human attribute creation policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'mode', 'scale',
        'manualAllocation', 'lottery'], 'Human attribute creation policy');
    if (input.schemaVersion !== HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION || input.characterKind !== 'human-player'
        || (input.mode !== 'player-choice' && input.mode !== 'genetic-lottery')) {
        throw new Error('Human attribute creation policy identity is invalid');
    }
    const scaleInput = record(input.scale, 'scale');
    exact(scaleInput, ['minimum', 'maximum'], 'scale');
    const minimum = integer(scaleInput.minimum, 'scale.minimum', 0, 1_000);
    const maximum = integer(scaleInput.maximum, 'scale.maximum', minimum + 1, 1_000);
    const feasibleMinimum = minimum * ATTRIBUTE_KEYS.length, feasibleMaximum = maximum * ATTRIBUTE_KEYS.length;

    const manualAllocation = input.manualAllocation === null ? null : (() => {
        const manual = record(input.manualAllocation, 'manualAllocation');
        exact(manual, ['totalPoints'], 'manualAllocation');
        return { totalPoints: integer(manual.totalPoints, 'manualAllocation.totalPoints',
            feasibleMinimum, feasibleMaximum) };
    })();
    const lottery = input.lottery === null ? null : (() => {
        const lotteryInput = record(input.lottery, 'lottery');
        exact(lotteryInput, ['budgetPolicy', 'allocationPolicy'], 'lottery');
        return { budgetPolicy: policyReference(lotteryInput.budgetPolicy, 'lottery.budgetPolicy'),
            allocationPolicy: policyReference(lotteryInput.allocationPolicy, 'lottery.allocationPolicy') };
    })();
    if ((input.mode === 'player-choice' && (manualAllocation === null || lottery !== null))
        || (input.mode === 'genetic-lottery' && (lottery === null || manualAllocation !== null))) {
        throw new Error('Human attribute creation mode configuration is inconsistent');
    }
    const definition: HumanAttributeCreationPolicyDefinition = {
        schemaVersion: HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'), version: version(input.version, 'version'),
        characterKind: 'human-player', mode: input.mode, scale: { minimum, maximum }, manualAllocation, lottery
    };
    return { ...definition, digest: humanAttributeCreationPolicyDigest(definition) };
}

function resolvePolicy(value: HumanAttributeCreationPolicyDefinition | HumanAttributeCreationPolicy): HumanAttributeCreationPolicy {
    const input = record(value, 'Human attribute creation policy');
    if (!Object.hasOwn(input, 'digest')) return validateHumanAttributeCreationPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'mode', 'scale',
        'manualAllocation', 'lottery', 'digest'], 'Validated human attribute creation policy');
    const { digest: suppliedDigest, ...definition } = input;
    const policy = validateHumanAttributeCreationPolicy(definition);
    if (suppliedDigest !== policy.digest) throw new Error('Validated human attribute policy digest does not match');
    return policy;
}

function result(definition: HumanAttributeCreationResultDefinition): HumanAttributeCreationResult {
    return { ...definition, digest: digest(definition) };
}

export function createHumanAttributeProfile(policyValue: HumanAttributeCreationPolicyDefinition | HumanAttributeCreationPolicy,
    input: CreateHumanAttributeProfileInput, lotteryPolicies?: {
        budget: AttributeBudgetPolicyDefinition | AttributeBudgetPolicy;
        allocation: AttributeAllocationPolicyDefinition | AttributeAllocationPolicy;
    }): HumanAttributeCreationResult {
    const policy = resolvePolicy(policyValue);
    if (input.mode !== policy.mode) throw new Error('Input mode does not match the human attribute creation policy');
    const characterAgentId = identifier(input.characterAgentId, 'characterAgentId');
    const createdAt = simulationTime(input.lifecycleCreatedAtSimulationTime);

    if (input.mode === 'player-choice') {
        const rawValues = record(input.values, 'values');
        exact(rawValues, ATTRIBUTE_KEYS, 'values');
        const values = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key,
            integer(rawValues[key], `values.${key}`, policy.scale.minimum, policy.scale.maximum)])) as AttributeValues;
        const total = ATTRIBUTE_KEYS.reduce((sum, key) => sum + values[key], 0);
        if (total !== policy.manualAllocation!.totalPoints) {
            throw new Error(`Player allocation must spend exactly ${policy.manualAllocation!.totalPoints} points`);
        }
        const identityDigest = digest({ policy: policy.digest, characterAgentId, createdAt, values });
        const profile = validateAttributeProfile({ schemaVersion: 1,
            profileId: `attribute:${characterAgentId}:${identityDigest.slice(0, 16)}`, version: policy.version,
            characterAgentId, lifecycleCreatedAtSimulationTime: createdAt,
            source: { origin: 'human-allocation', policyId: policy.policyId,
                policyVersion: policy.version, seedDigest: null }, scale: policy.scale, values });
        return result({ schemaVersion: HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION,
            policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
            mode: policy.mode, profile, lotteryEvidence: null });
    }

    if (!lotteryPolicies) throw new Error('Genetic lottery policies are required');
    const expected = policy.lottery!;
    if (lotteryPolicies.budget.policyId !== expected.budgetPolicy.policyId
        || lotteryPolicies.budget.version !== expected.budgetPolicy.version
        || lotteryPolicies.allocation.policyId !== expected.allocationPolicy.policyId
        || lotteryPolicies.allocation.version !== expected.allocationPolicy.version) {
        throw new Error('Genetic lottery policy references do not match');
    }
    const generated = generateNpcAttributeProfile(lotteryPolicies.budget, lotteryPolicies.allocation, {
        seed: input.seed, characterAgentId, lifecycleCreatedAtSimulationTime: createdAt
    });
    if (generated.profile.scale.minimum !== policy.scale.minimum
        || generated.profile.scale.maximum !== policy.scale.maximum) {
        throw new Error('Genetic lottery scale does not match the human policy');
    }
    const profile = validateAttributeProfile({ schemaVersion: 1,
        profileId: `attribute:${characterAgentId}:${generated.allocation.digest.slice(0, 16)}`,
        version: policy.version, characterAgentId, lifecycleCreatedAtSimulationTime: createdAt,
        source: { origin: 'genesis-lottery', policyId: policy.policyId,
            policyVersion: policy.version, seedDigest: generated.budget.source.seedDigest },
        scale: policy.scale, values: generated.profile.values });
    return result({ schemaVersion: HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION,
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        mode: policy.mode, profile, lotteryEvidence: generated.allocation });
}
