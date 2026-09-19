import { createHash } from 'node:crypto';
import { resolveHousingTier, validateHousingTierPolicy } from './hierarchy.js';
import { HOUSING_EFFECT_SCHEMA_VERSION, type HousingEffectPolicy, type HousingEffectPolicyDefinition,
    type HousingStorageCapability, type HousingTheftOutcome, type HousingTierEffects,
    type HousingTierPolicy } from './types.js';

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

export function housingEffectPolicyDigest(value: HousingEffectPolicyDefinition): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function effect(value: unknown, index: number): HousingTierEffects {
    const field = `effects[${index}]`, input = record(value, field);
    exact(input, ['tierId', 'fatigueRecoveryMultiplierBasisPoints', 'privateStorageSlots',
        'theftProtectionBasisPoints'], field);
    if (typeof input.tierId !== 'string' || !ID.test(input.tierId)) throw new Error(`${field}.tierId is invalid`);
    return { tierId: input.tierId,
        fatigueRecoveryMultiplierBasisPoints: integer(input.fatigueRecoveryMultiplierBasisPoints,
            `${field}.fatigueRecoveryMultiplierBasisPoints`, 0, 100_000),
        privateStorageSlots: integer(input.privateStorageSlots, `${field}.privateStorageSlots`, 0, 100_000),
        theftProtectionBasisPoints: integer(input.theftProtectionBasisPoints,
            `${field}.theftProtectionBasisPoints`, 0, 10_000) };
}

export function validateHousingEffectPolicy(value: unknown, hierarchy: HousingTierPolicy): HousingEffectPolicy {
    resolveHousingTier(hierarchy, hierarchy.tiers[0]!.tierId);
    const input = record(value, 'Housing effect policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'hierarchyPolicy', 'effects'], 'Housing effect policy');
    if (input.schemaVersion !== HOUSING_EFFECT_SCHEMA_VERSION || typeof input.policyId !== 'string'
        || !ID.test(input.policyId) || typeof input.version !== 'string' || !VERSION.test(input.version)
        || !Array.isArray(input.effects)) throw new Error('Housing effect policy identity or collection is invalid');
    const reference = record(input.hierarchyPolicy, 'hierarchyPolicy');
    exact(reference, ['policyId', 'version'], 'hierarchyPolicy');
    if (reference.policyId !== hierarchy.policyId || reference.version !== hierarchy.version) {
        throw new Error('Housing effect policy references a different hierarchy');
    }
    const effects = input.effects.map(effect).sort((left, right) =>
        resolveHousingTier(hierarchy, left.tierId).rank - resolveHousingTier(hierarchy, right.tierId).rank);
    if (effects.length !== hierarchy.tiers.length || new Set(effects.map(item => item.tierId)).size !== effects.length
        || hierarchy.tiers.some(tier => !effects.some(item => item.tierId === tier.tierId))) {
        throw new Error('Housing effects must contain every hierarchy tier exactly once');
    }
    for (let index = 1; index < effects.length; index++) {
        const current = effects[index]!, previous = effects[index - 1]!;
        if (current.fatigueRecoveryMultiplierBasisPoints < previous.fatigueRecoveryMultiplierBasisPoints
            || current.privateStorageSlots < previous.privateStorageSlots
            || current.theftProtectionBasisPoints < previous.theftProtectionBasisPoints) {
            throw new Error('Housing effects must not decrease at a higher tier');
        }
    }
    const definition: HousingEffectPolicyDefinition = { schemaVersion: HOUSING_EFFECT_SCHEMA_VERSION,
        policyId: input.policyId, version: input.version,
        hierarchyPolicy: { policyId: hierarchy.policyId, version: hierarchy.version, digest: hierarchy.digest }, effects };
    return { ...definition, digest: housingEffectPolicyDigest(definition) };
}

function resolvePolicy(policy: HousingEffectPolicy, hierarchy: HousingTierPolicy): HousingEffectPolicy {
    const { digest, hierarchyPolicy: reference, ...definition } = policy;
    if (reference.digest !== hierarchy.digest) throw new Error('Housing hierarchy digest does not match effect policy');
    const validated = validateHousingEffectPolicy({ ...definition,
        hierarchyPolicy: { policyId: reference.policyId, version: reference.version } }, hierarchy);
    if (digest !== validated.digest) throw new Error('Validated housing effect policy digest does not match');
    return validated;
}

export function resolveHousingEffects(policy: HousingEffectPolicy, hierarchy: HousingTierPolicy,
    tierId: string): HousingTierEffects {
    const validated = resolvePolicy(policy, hierarchy), normalized = resolveHousingTier(hierarchy, tierId).tierId;
    return validated.effects.find(item => item.tierId === normalized)!;
}

export function applyHousingFatigueRecoveryRate(baseRecoveryPerHour: number, effects: HousingTierEffects): number {
    const base = integer(baseRecoveryPerHour, 'baseRecoveryPerHour', -1_000_000, 0);
    return Math.trunc(base * effects.fatigueRecoveryMultiplierBasisPoints / 10_000);
}

export function housingStorageCapability(effects: HousingTierEffects): HousingStorageCapability {
    return { privateStorageAllowed: effects.privateStorageSlots > 0,
        privateStorageSlots: effects.privateStorageSlots };
}

export function resolveHousingTheftOutcome(effects: HousingTierEffects, protectionRoll: number): HousingTheftOutcome {
    const roll = integer(protectionRoll, 'protectionRoll', 0, 9_999);
    return { prevented: roll < effects.theftProtectionBasisPoints,
        protectionBasisPoints: effects.theftProtectionBasisPoints,
        residualRiskBasisPoints: 10_000 - effects.theftProtectionBasisPoints };
}
