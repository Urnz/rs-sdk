import { createHash } from 'node:crypto';
import { ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION, ATTRIBUTE_KEYS, type AttributeBudgetPolicy,
    type AttributeBudgetPolicyDefinition, type GenerateAttributeBudgetInput,
    type GeneratedAttributeBudget, type GeneratedAttributeBudgetDefinition } from './types.js';

const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_WEIGHT = 1_000_000;
const MAX_TOTAL_WEIGHT = 1_000_000_000;
const UINT64_SIZE = 1n << 64n;

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

export function attributeBudgetPolicyDigest(policy: AttributeBudgetPolicyDefinition): string {
    return digest(policy);
}

export function validateAttributeBudgetPolicy(value: unknown): AttributeBudgetPolicy {
    const input = record(value, 'Attribute budget policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'scale', 'distribution', 'entropy'],
        'Attribute budget policy');
    if (input.schemaVersion !== ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION || input.characterKind !== 'npc') {
        throw new Error('Attribute budget policy identity is invalid');
    }

    const scaleInput = record(input.scale, 'scale');
    exact(scaleInput, ['minimum', 'maximum'], 'scale');
    const scaleMinimum = integer(scaleInput.minimum, 'scale.minimum', 0, 1_000);
    const scaleMaximum = integer(scaleInput.maximum, 'scale.maximum', scaleMinimum + 1, 1_000);
    const feasibleMinimum = scaleMinimum * ATTRIBUTE_KEYS.length;
    const feasibleMaximum = scaleMaximum * ATTRIBUTE_KEYS.length;

    const distributionInput = record(input.distribution, 'distribution');
    exact(distributionInput, ['kind', 'minimumTotalPoints', 'maximumTotalPoints', 'weights'], 'distribution');
    if (distributionInput.kind !== 'bounded-discrete') throw new Error('distribution.kind is invalid');
    const minimumTotalPoints = integer(distributionInput.minimumTotalPoints, 'minimumTotalPoints',
        feasibleMinimum, feasibleMaximum);
    const maximumTotalPoints = integer(distributionInput.maximumTotalPoints, 'maximumTotalPoints',
        minimumTotalPoints, feasibleMaximum);
    if (!Array.isArray(distributionInput.weights)) throw new Error('distribution.weights must be an array');
    const weights = distributionInput.weights.map((entry, index) => {
        const item = record(entry, `weights[${index}]`);
        exact(item, ['points', 'weight'], `weights[${index}]`);
        return { points: integer(item.points, `weights[${index}].points`, minimumTotalPoints, maximumTotalPoints),
            weight: integer(item.weight, `weights[${index}].weight`, 1, MAX_WEIGHT) };
    }).sort((left, right) => left.points - right.points);
    const expectedCount = maximumTotalPoints - minimumTotalPoints + 1;
    if (weights.length !== expectedCount || weights.some((entry, index) => entry.points !== minimumTotalPoints + index)) {
        throw new Error('distribution.weights must cover every bounded total exactly once');
    }
    const totalWeight = weights.reduce((total, entry) => total + entry.weight, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight > MAX_TOTAL_WEIGHT) {
        throw new Error(`distribution total weight must not exceed ${MAX_TOTAL_WEIGHT}`);
    }

    const entropyInput = record(input.entropy, 'entropy');
    exact(entropyInput, ['algorithm', 'namespace'], 'entropy');
    if (entropyInput.algorithm !== 'sha256-rejection-v1') throw new Error('entropy.algorithm is invalid');

    const definition: AttributeBudgetPolicyDefinition = {
        schemaVersion: ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'),
        version: version(input.version, 'version'), characterKind: 'npc',
        scale: { minimum: scaleMinimum, maximum: scaleMaximum },
        distribution: { kind: 'bounded-discrete', minimumTotalPoints, maximumTotalPoints, weights },
        entropy: { algorithm: 'sha256-rejection-v1', namespace: identifier(entropyInput.namespace, 'entropy.namespace') }
    };
    return { ...definition, digest: attributeBudgetPolicyDigest(definition) };
}

function weightedTicket(policy: AttributeBudgetPolicy, seed: string, characterAgentId: string,
    createdAt: string): { ticket: number; entropyDigest: string } {
    const totalWeight = policy.distribution.weights.reduce((total, entry) => total + entry.weight, 0);
    const range = BigInt(totalWeight), acceptanceLimit = UINT64_SIZE - (UINT64_SIZE % range);
    for (let counter = 0; counter < 1_000; counter++) {
        const hash = createHash('sha256').update(policy.entropy.namespace).update('\0').update(policy.digest)
            .update('\0').update(seed).update('\0').update(characterAgentId).update('\0').update(createdAt)
            .update('\0').update(String(counter)).digest();
        const candidate = hash.readBigUInt64BE(0);
        if (candidate < acceptanceLimit) {
            return { ticket: Number(candidate % range), entropyDigest: hash.toString('hex') };
        }
    }
    throw new Error('Unable to derive unbiased attribute budget entropy');
}

export function generatedAttributeBudgetDigest(value: GeneratedAttributeBudgetDefinition): string {
    return digest(value);
}

function resolvePolicy(value: AttributeBudgetPolicyDefinition | AttributeBudgetPolicy): AttributeBudgetPolicy {
    const input = record(value, 'Attribute budget policy');
    if (!Object.hasOwn(input, 'digest')) return validateAttributeBudgetPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'scale', 'distribution', 'entropy',
        'digest'], 'Validated attribute budget policy');
    const { digest: suppliedDigest, ...definition } = input;
    const policy = validateAttributeBudgetPolicy(definition);
    if (typeof suppliedDigest !== 'string' || suppliedDigest !== policy.digest) {
        throw new Error('Validated attribute budget policy digest does not match its definition');
    }
    return policy;
}

export function generateAttributeBudget(policyValue: AttributeBudgetPolicyDefinition | AttributeBudgetPolicy,
    input: GenerateAttributeBudgetInput): GeneratedAttributeBudget {
    const policy = resolvePolicy(policyValue);
    if (typeof input.seed !== 'string' || input.seed.length < 1 || input.seed.length > 256
        || input.seed.trim() !== input.seed) throw new Error('seed must contain 1-256 trimmed characters');
    const characterAgentId = identifier(input.characterAgentId, 'characterAgentId');
    const lifecycleCreatedAtSimulationTime = simulationTime(input.lifecycleCreatedAtSimulationTime);
    const seedDigest = createHash('sha256').update(input.seed).digest('hex');
    const { ticket, entropyDigest } = weightedTicket(policy, input.seed, characterAgentId,
        lifecycleCreatedAtSimulationTime);
    let cursor = 0, totalPoints: number | null = null;
    for (const entry of policy.distribution.weights) {
        cursor += entry.weight;
        if (ticket < cursor) {
            totalPoints = entry.points;
            break;
        }
    }
    if (totalPoints === null) throw new Error('Attribute budget distribution did not resolve a total');

    const definition: GeneratedAttributeBudgetDefinition = {
        schemaVersion: ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION, characterAgentId,
        lifecycleCreatedAtSimulationTime,
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        source: { origin: 'genesis-lottery', policyId: policy.policyId,
            policyVersion: policy.version, seedDigest },
        totalPoints, entropyDigest
    };
    return { ...definition, digest: generatedAttributeBudgetDigest(definition) };
}
