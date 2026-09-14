import { createHash } from 'node:crypto';
import { ATTRIBUTE_KEYS, ATTRIBUTE_PROFILE_SCHEMA_VERSION, type AttributeKey,
    type AttributeProfile, type AttributeProfileDefinition, type AttributeProfileOrigin,
    type AttributeValues } from './types.js';

const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const ORIGINS = new Set<AttributeProfileOrigin>(['genesis-lottery', 'human-allocation', 'migration-default']);

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

function semanticVersion(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} must use semantic versioning`);
    return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function canonicalSimulationTime(value: unknown): string {
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

export function attributeProfileDigest(profile: AttributeProfileDefinition): string {
    return createHash('sha256').update(JSON.stringify(canonical(profile))).digest('hex');
}

export function validateAttributeProfile(value: unknown): AttributeProfile {
    const input = record(value, 'Attribute profile');
    exact(input, ['schemaVersion', 'profileId', 'version', 'characterAgentId',
        'lifecycleCreatedAtSimulationTime', 'source', 'scale', 'values'], 'Attribute profile');
    if (input.schemaVersion !== ATTRIBUTE_PROFILE_SCHEMA_VERSION) {
        throw new Error(`Unsupported attribute profile schema version: ${String(input.schemaVersion)}`);
    }

    const scale = record(input.scale, 'scale');
    exact(scale, ['minimum', 'maximum'], 'scale');
    const minimum = integer(scale.minimum, 'scale.minimum', 0, 1_000);
    const maximum = integer(scale.maximum, 'scale.maximum', minimum + 1, 1_000);

    const rawValues = record(input.values, 'values');
    exact(rawValues, ATTRIBUTE_KEYS, 'values');
    const values = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key,
        integer(rawValues[key], `values.${key}`, minimum, maximum)])) as AttributeValues;

    const rawSource = record(input.source, 'source');
    exact(rawSource, ['origin', 'policyId', 'policyVersion', 'seedDigest'], 'source');
    if (!ORIGINS.has(rawSource.origin as AttributeProfileOrigin)) throw new Error('source.origin is invalid');
    const origin = rawSource.origin as AttributeProfileOrigin;
    const seedDigest = rawSource.seedDigest === null ? null : (() => {
        if (typeof rawSource.seedDigest !== 'string' || !DIGEST.test(rawSource.seedDigest)) {
            throw new Error('source.seedDigest must be a lowercase SHA-256 digest or null');
        }
        return rawSource.seedDigest;
    })();
    if (origin === 'genesis-lottery' && seedDigest === null) {
        throw new Error('A genesis-lottery profile requires a seed digest');
    }
    if (origin !== 'genesis-lottery' && seedDigest !== null) {
        throw new Error('Only a genesis-lottery profile may retain a seed digest');
    }

    const definition: AttributeProfileDefinition = {
        schemaVersion: ATTRIBUTE_PROFILE_SCHEMA_VERSION,
        profileId: identifier(input.profileId, 'profileId'),
        version: semanticVersion(input.version, 'version'),
        characterAgentId: identifier(input.characterAgentId, 'characterAgentId'),
        lifecycleCreatedAtSimulationTime: canonicalSimulationTime(input.lifecycleCreatedAtSimulationTime),
        source: {
            origin,
            policyId: identifier(rawSource.policyId, 'source.policyId'),
            policyVersion: semanticVersion(rawSource.policyVersion, 'source.policyVersion'),
            seedDigest
        },
        scale: { minimum, maximum }, values
    };
    const totalPoints = ATTRIBUTE_KEYS.reduce((total, key: AttributeKey) => total + values[key], 0);
    return { ...definition, totalPoints, digest: attributeProfileDigest(definition) };
}
