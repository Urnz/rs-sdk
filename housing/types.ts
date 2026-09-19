export const HOUSING_SCHEMA_VERSION = 1 as const;

export const CORE_HOUSING_TIER_IDS = [
    'street',
    'temporary-shelter',
    'shared-dormitory',
    'rented-room',
    'owned-home',
    'fortified-property'
] as const;

export type CoreHousingTierId = typeof CORE_HOUSING_TIER_IDS[number];
export type HousingTenure = 'none' | 'informal' | 'shared' | 'rented' | 'owned';

export interface HousingTierDefinition {
    tierId: string;
    rank: number;
    label: string;
    tenure: HousingTenure;
    comfortRating: number;
    securityRating: number;
}

export interface HousingTierPolicyDefinition {
    schemaVersion: typeof HOUSING_SCHEMA_VERSION;
    policyId: string;
    version: string;
    tiers: HousingTierDefinition[];
}

export interface HousingTierPolicy extends HousingTierPolicyDefinition {
    digest: string;
}

export interface HousingTierPolicyCatalog {
    schemaVersion: typeof HOUSING_SCHEMA_VERSION;
    policies: HousingTierPolicy[];
}
