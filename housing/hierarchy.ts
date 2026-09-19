import { createHash } from 'node:crypto';
import { CORE_HOUSING_TIER_IDS, HOUSING_SCHEMA_VERSION, type HousingTenure,
    type HousingTierDefinition, type HousingTierPolicy, type HousingTierPolicyDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const TENURES: readonly HousingTenure[] = ['none', 'informal', 'shared', 'rented', 'owned'];

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

export function housingTierPolicyDigest(value: HousingTierPolicyDefinition): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function tier(value: unknown, index: number): HousingTierDefinition {
    const field = `tiers[${index}]`, input = record(value, field);
    exact(input, ['tierId', 'rank', 'label', 'tenure', 'comfortRating', 'securityRating'], field);
    if (typeof input.tierId !== 'string' || !ID.test(input.tierId)) throw new Error(`${field}.tierId is invalid`);
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100) {
        throw new Error(`${field}.label is invalid`);
    }
    if (!TENURES.includes(input.tenure as HousingTenure)) throw new Error(`${field}.tenure is invalid`);
    return { tierId: input.tierId, rank: integer(input.rank, `${field}.rank`, 0, 31),
        label: input.label.trim(), tenure: input.tenure as HousingTenure,
        comfortRating: integer(input.comfortRating, `${field}.comfortRating`, 0, 100),
        securityRating: integer(input.securityRating, `${field}.securityRating`, 0, 100) };
}

export function validateHousingTierPolicy(value: unknown): HousingTierPolicy {
    const input = record(value, 'Housing tier policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'tiers'], 'Housing tier policy');
    if (input.schemaVersion !== HOUSING_SCHEMA_VERSION || typeof input.policyId !== 'string'
        || !ID.test(input.policyId) || typeof input.version !== 'string' || !VERSION.test(input.version)
        || !Array.isArray(input.tiers) || input.tiers.length < CORE_HOUSING_TIER_IDS.length
        || input.tiers.length > 32) throw new Error('Housing tier policy identity or collection is invalid');
    const tiers = input.tiers.map(tier).sort((left, right) => left.rank - right.rank);
    if (new Set(tiers.map(item => item.tierId)).size !== tiers.length) {
        throw new Error('Housing tier identities must be unique');
    }
    if (new Set(tiers.map(item => item.rank)).size !== tiers.length
        || tiers.some((item, index) => item.rank !== index)) {
        throw new Error('Housing tier ranks must be unique and contiguous from zero');
    }
    for (let index = 0; index < CORE_HOUSING_TIER_IDS.length; index++) {
        if (tiers[index]?.tierId !== CORE_HOUSING_TIER_IDS[index]) {
            throw new Error('Core housing tiers must preserve the required hierarchy');
        }
    }
    for (let index = 1; index < tiers.length; index++) {
        if (tiers[index]!.comfortRating < tiers[index - 1]!.comfortRating
            || tiers[index]!.securityRating < tiers[index - 1]!.securityRating) {
            throw new Error('Housing comfort and security must not decrease with rank');
        }
    }
    const definition: HousingTierPolicyDefinition = { schemaVersion: HOUSING_SCHEMA_VERSION,
        policyId: input.policyId, version: input.version, tiers };
    return { ...definition, digest: housingTierPolicyDigest(definition) };
}

export function resolveHousingTier(policy: HousingTierPolicy, tierId: string): HousingTierDefinition {
    const { digest, ...definition } = policy;
    const validated = validateHousingTierPolicy(definition);
    if (digest !== validated.digest) throw new Error('Validated housing tier policy digest does not match');
    const normalized = tierId.trim().toLowerCase();
    const found = validated.tiers.find(item => item.tierId === normalized);
    if (!found) throw new Error(`Unknown housing tier: ${normalized}`);
    return found;
}

export function compareHousingTiers(policy: HousingTierPolicy, leftId: string, rightId: string): number {
    return resolveHousingTier(policy, leftId).rank - resolveHousingTier(policy, rightId).rank;
}
