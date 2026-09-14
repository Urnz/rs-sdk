export const ATTRIBUTE_PROFILE_SCHEMA_VERSION = 1 as const;

export const ATTRIBUTE_KEYS = [
    'intellect', 'dexterity', 'vigor', 'endurance', 'perception', 'will'
] as const;

export type AttributeKey = typeof ATTRIBUTE_KEYS[number];
export type AttributeValues = Record<AttributeKey, number>;
export type AttributeProfileOrigin = 'genesis-lottery' | 'human-allocation' | 'migration-default';

export interface AttributeScale {
    minimum: number;
    maximum: number;
}

export interface AttributeProfileSource {
    origin: AttributeProfileOrigin;
    policyId: string;
    policyVersion: string;
    seedDigest: string | null;
}

/**
 * Immutable base aptitudes for one persistent player character.
 *
 * RuneScape levels, executable agent skills and facility capabilities deliberately
 * do not belong in this model. Later systems may derive effects from these values,
 * but must not rewrite the base profile to represent learning or equipment.
 */
export interface AttributeProfileDefinition {
    schemaVersion: typeof ATTRIBUTE_PROFILE_SCHEMA_VERSION;
    profileId: string;
    version: string;
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    source: AttributeProfileSource;
    scale: AttributeScale;
    values: AttributeValues;
}

export interface AttributeProfile extends AttributeProfileDefinition {
    totalPoints: number;
    digest: string;
}
