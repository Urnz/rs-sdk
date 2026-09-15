import { createHash } from 'node:crypto';
import { generateAttributeBudget, validateAttributeBudgetPolicy } from './budget-policy.js';
import { validateAttributeProfile } from './profile.js';
import { ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION, ATTRIBUTE_KEYS, type AttributeAllocationPolicy,
    type AttributeAllocationPolicyDefinition, type AttributeAllocationStrategy, type AttributeBudgetPolicy,
    type AttributeBudgetPolicyDefinition, type AttributeValues, type GenerateAttributeBudgetInput,
    type GeneratedAttributeAllocation, type GeneratedAttributeAllocationDefinition,
    type GeneratedNpcAttributeProfile } from './types.js';

const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const STRATEGIES: AttributeAllocationStrategy[] = ['generalist', 'specialist', 'unoptimized'];
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

export function attributeAllocationPolicyDigest(value: AttributeAllocationPolicyDefinition): string {
    return digest(value);
}

export function validateAttributeAllocationPolicy(value: unknown): AttributeAllocationPolicy {
    const input = record(value, 'Attribute allocation policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'budgetPolicy', 'strategies',
        'specialistFocusCount', 'entropy'], 'Attribute allocation policy');
    if (input.schemaVersion !== ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION || input.characterKind !== 'npc') {
        throw new Error('Attribute allocation policy identity is invalid');
    }
    const budgetInput = record(input.budgetPolicy, 'budgetPolicy');
    exact(budgetInput, ['policyId', 'version'], 'budgetPolicy');
    if (!Array.isArray(input.strategies)) throw new Error('strategies must be an array');
    const strategies = input.strategies.map((entry, index) => {
        const item = record(entry, `strategies[${index}]`);
        exact(item, ['strategy', 'weight'], `strategies[${index}]`);
        if (!STRATEGIES.includes(item.strategy as AttributeAllocationStrategy)) {
            throw new Error(`strategies[${index}].strategy is invalid`);
        }
        return { strategy: item.strategy as AttributeAllocationStrategy,
            weight: integer(item.weight, `strategies[${index}].weight`, 1, 1_000_000) };
    }).sort((left, right) => STRATEGIES.indexOf(left.strategy) - STRATEGIES.indexOf(right.strategy));
    if (strategies.length !== STRATEGIES.length
        || strategies.some((entry, index) => entry.strategy !== STRATEGIES[index])) {
        throw new Error('strategies must define generalist, specialist and unoptimized exactly once');
    }
    const totalWeight = strategies.reduce((total, entry) => total + entry.weight, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight > 1_000_000_000) {
        throw new Error('strategy total weight must not exceed 1000000000');
    }
    const entropyInput = record(input.entropy, 'entropy');
    exact(entropyInput, ['algorithm', 'namespace'], 'entropy');
    if (entropyInput.algorithm !== 'sha256-rejection-v1') throw new Error('entropy.algorithm is invalid');

    const definition: AttributeAllocationPolicyDefinition = {
        schemaVersion: ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'), version: version(input.version, 'version'),
        characterKind: 'npc', budgetPolicy: {
            policyId: identifier(budgetInput.policyId, 'budgetPolicy.policyId'),
            version: version(budgetInput.version, 'budgetPolicy.version')
        }, strategies, specialistFocusCount: integer(input.specialistFocusCount, 'specialistFocusCount', 1, 3),
        entropy: { algorithm: 'sha256-rejection-v1', namespace: identifier(entropyInput.namespace, 'entropy.namespace') }
    };
    return { ...definition, digest: attributeAllocationPolicyDigest(definition) };
}

function resolveAllocationPolicy(value: AttributeAllocationPolicyDefinition | AttributeAllocationPolicy): AttributeAllocationPolicy {
    const input = record(value, 'Attribute allocation policy');
    if (!Object.hasOwn(input, 'digest')) return validateAttributeAllocationPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'characterKind', 'budgetPolicy', 'strategies',
        'specialistFocusCount', 'entropy', 'digest'], 'Validated attribute allocation policy');
    const { digest: suppliedDigest, ...definition } = input;
    const policy = validateAttributeAllocationPolicy(definition);
    if (suppliedDigest !== policy.digest) throw new Error('Validated attribute allocation policy digest does not match');
    return policy;
}

class EntropyStream {
    private counter = 0;
    lastDigest = '';

    constructor(private readonly context: string) {}

    draw(rangeNumber: number): number {
        const range = BigInt(rangeNumber), acceptanceLimit = UINT64_SIZE - (UINT64_SIZE % range);
        for (let attempt = 0; attempt < 1_000; attempt++) {
            const hash = createHash('sha256').update(this.context).update('\0').update(String(this.counter++)).digest();
            this.lastDigest = hash.toString('hex');
            const candidate = hash.readBigUInt64BE(0);
            if (candidate < acceptanceLimit) return Number(candidate % range);
        }
        throw new Error('Unable to derive unbiased attribute allocation entropy');
    }
}

function chooseStrategy(policy: AttributeAllocationPolicy, entropy: EntropyStream): AttributeAllocationStrategy {
    const total = policy.strategies.reduce((sum, entry) => sum + entry.weight, 0);
    const ticket = entropy.draw(total);
    let cursor = 0;
    for (const entry of policy.strategies) {
        cursor += entry.weight;
        if (ticket < cursor) return entry.strategy;
    }
    throw new Error('Attribute allocation strategy did not resolve');
}

function pick(entropy: EntropyStream, candidates: number[]): number {
    if (!candidates.length) throw new Error('Attribute point budget does not fit its scale');
    return candidates[entropy.draw(candidates.length)]!;
}

function allocateGeneralist(values: number[], remaining: number, maximum: number, entropy: EntropyStream): void {
    while (remaining-- > 0) {
        const lowest = Math.min(...values.filter(value => value < maximum));
        const candidates = values.flatMap((value, index) => value === lowest ? [index] : []);
        values[pick(entropy, candidates)]!++;
    }
}

function allocateRandom(values: number[], remaining: number, maximum: number, entropy: EntropyStream): void {
    while (remaining-- > 0) {
        const candidates = values.flatMap((value, index) => value < maximum ? [index] : []);
        values[pick(entropy, candidates)]!++;
    }
}

function allocateSpecialist(values: number[], remaining: number, maximum: number, focusCount: number,
    entropy: EntropyStream): void {
    const available = ATTRIBUTE_KEYS.map((_key, index) => index), focus: number[] = [];
    while (focus.length < focusCount) focus.push(available.splice(entropy.draw(available.length), 1)[0]!);
    while (remaining > 0) {
        const candidates = focus.filter(index => values[index]! < maximum);
        if (!candidates.length) break;
        values[pick(entropy, candidates)]!++;
        remaining--;
    }
    allocateRandom(values, remaining, maximum, entropy);
}

export function generatedAttributeAllocationDigest(value: GeneratedAttributeAllocationDefinition): string {
    return digest(value);
}

export function generateNpcAttributeProfile(budgetPolicyValue: AttributeBudgetPolicyDefinition | AttributeBudgetPolicy,
    allocationPolicyValue: AttributeAllocationPolicyDefinition | AttributeAllocationPolicy,
    input: GenerateAttributeBudgetInput): GeneratedNpcAttributeProfile {
    const budgetPolicy = validateAttributeBudgetPolicy('digest' in budgetPolicyValue
        ? (() => { const { digest: _digest, ...definition } = budgetPolicyValue; return definition; })()
        : budgetPolicyValue);
    if ('digest' in budgetPolicyValue && budgetPolicyValue.digest !== budgetPolicy.digest) {
        throw new Error('Validated attribute budget policy digest does not match');
    }
    const policy = resolveAllocationPolicy(allocationPolicyValue);
    if (policy.budgetPolicy.policyId !== budgetPolicy.policyId
        || policy.budgetPolicy.version !== budgetPolicy.version) {
        throw new Error('Attribute allocation policy does not reference the supplied budget policy');
    }
    const budget = generateAttributeBudget(budgetPolicy, input);
    const entropy = new EntropyStream([policy.entropy.namespace, policy.digest, input.seed,
        input.characterAgentId, input.lifecycleCreatedAtSimulationTime, budget.digest].join('\0'));
    const strategy = chooseStrategy(policy, entropy);
    const values = ATTRIBUTE_KEYS.map(() => budgetPolicy.scale.minimum);
    const remaining = budget.totalPoints - budgetPolicy.scale.minimum * ATTRIBUTE_KEYS.length;
    if (strategy === 'generalist') allocateGeneralist(values, remaining, budgetPolicy.scale.maximum, entropy);
    else if (strategy === 'specialist') allocateSpecialist(values, remaining, budgetPolicy.scale.maximum,
        policy.specialistFocusCount, entropy);
    else allocateRandom(values, remaining, budgetPolicy.scale.maximum, entropy);
    const attributeValues = Object.fromEntries(ATTRIBUTE_KEYS.map((key, index) => [key, values[index]!])) as AttributeValues;

    const allocationDefinition: GeneratedAttributeAllocationDefinition = {
        schemaVersion: ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION, characterAgentId: budget.characterAgentId,
        lifecycleCreatedAtSimulationTime: budget.lifecycleCreatedAtSimulationTime, budget,
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        strategy, values: attributeValues, entropyDigest: entropy.lastDigest
    };
    const allocation = { ...allocationDefinition, digest: generatedAttributeAllocationDigest(allocationDefinition) };
    const profile = validateAttributeProfile({ schemaVersion: 1,
        profileId: `attribute:${budget.characterAgentId}:${allocation.digest.slice(0, 16)}`,
        version: policy.version, characterAgentId: budget.characterAgentId,
        lifecycleCreatedAtSimulationTime: budget.lifecycleCreatedAtSimulationTime,
        source: { origin: 'genesis-lottery', policyId: policy.policyId,
            policyVersion: policy.version, seedDigest: budget.source.seedDigest },
        scale: budgetPolicy.scale, values: attributeValues });
    return { budget, allocation, profile };
}
