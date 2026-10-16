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

export const HOUSING_EFFECT_SCHEMA_VERSION = 1 as const;

export interface HousingTierEffects {
    tierId: string;
    fatigueRecoveryMultiplierBasisPoints: number;
    privateStorageSlots: number;
    theftProtectionBasisPoints: number;
}

export interface HousingEffectPolicyDefinition {
    schemaVersion: typeof HOUSING_EFFECT_SCHEMA_VERSION;
    policyId: string;
    version: string;
    hierarchyPolicy: { policyId: string; version: string; digest: string };
    effects: HousingTierEffects[];
}

export interface HousingEffectPolicy extends HousingEffectPolicyDefinition {
    digest: string;
}

export interface HousingEffectPolicyCatalog {
    schemaVersion: typeof HOUSING_EFFECT_SCHEMA_VERSION;
    policies: HousingEffectPolicy[];
}

export interface HousingStorageCapability {
    privateStorageAllowed: boolean;
    privateStorageSlots: number;
}

export interface HousingTheftOutcome {
    prevented: boolean;
    protectionBasisPoints: number;
    residualRiskBasisPoints: number;
}

export interface BedSlotDefinition {
    bedSlotId: string;
    label: string;
}

export interface HousingUnitDefinition {
    housingUnitId: string;
    propertyId: string;
    tierId: string;
    enabled: boolean;
    capacity: number;
    rentGpPerPeriod: number;
    rentPeriodSimulationMinutes: number;
    bedSlots: BedSlotDefinition[];
}

export interface HousingUnitCatalog {
    schemaVersion: 1;
    units: HousingUnitDefinition[];
    digest: string;
}

export type HousingTenancyStatus = 'active' | 'arrears' | 'expired' | 'ended';

export interface HousingTenancy {
    tenancyId: string;
    housingUnitId: string;
    bedSlotId: string;
    tenantAgentId: string;
    status: HousingTenancyStatus;
    startsAtSimulationTime: string;
    endsAtSimulationTime: string;
    nextRentDueAtSimulationTime: string;
    rentGpPerPeriod: number;
    rentPeriodSimulationMinutes: number;
    arrearsGp: number;
    unitCatalogDigest: string;
    revision: number;
}

export interface RentPaymentEvidence {
    paymentId: string;
    amountGp: number;
    sourceDigest: string;
    occurredAtSimulationTime: string;
}

export interface BedAccessEntitlement {
    kind: 'bed-entitlement';
    evidenceId: string;
    sourceDigest: string;
    sleepPlaceId: string;
    validUntilSimulationTime: string;
}

export type FurnishingKind = 'bed' | 'chest' | 'table' | 'other';

export interface FurnishingCapabilities {
    sleepPlaces: number;
    privateStorageSlots: number;
    workSurfaces: number;
}

export interface FurnishingDefinition {
    furnishingTypeId: string;
    kind: FurnishingKind;
    label: string;
    capabilities: FurnishingCapabilities;
}

export interface FurnishingPlacementSlotDefinition {
    placementSlotId: string;
    propertyId: string;
    roomId: string;
    allowedKinds: FurnishingKind[];
}

export interface FurnishingCatalog {
    schemaVersion: 1;
    furnishings: FurnishingDefinition[];
    placementSlots: FurnishingPlacementSlotDefinition[];
    digest: string;
}

export interface FurnishingPurchaseEvidence {
    assetId: string;
    ownerAgentId: string;
    furnishingTypeId: string;
    sourceDigest: string;
}

export interface FurnishingPlacement {
    placementId: string;
    propertyId: string;
    placementSlotId: string;
    furnishingTypeId: string;
    assetId: string;
    ownerAgentId: string;
    purchaseEvidenceDigest: string;
    propertyAuthorityDigest: string;
    status: 'placed' | 'removed';
    placedAtSimulationTime: string;
    removedAtSimulationTime: string | null;
    revision: number;
}

export interface PropertyFurnishingCapabilities extends FurnishingCapabilities {
    propertyId: string;
    placementIds: string[];
}

export interface PlacedHousingStorage extends FurnishingPlacement {
    storageSlots: number;
}

export type HousingAttackSurfaceKind = 'sleeping-person' | 'property-entry' | 'storage';
export interface HousingSecurityTier {
    tierId: string;
    sleepingExposureBasisPoints: number;
    entryLockLevel: number;
    entryTraceBasisPoints: number;
    allowedStorageSurfaceIds: string[];
}
export interface HousingStorageSecuritySurface {
    surfaceId: string;
    lockLevel: number;
    traceBasisPoints: number;
}
export interface HousingSecurityPolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    hierarchyPolicy: { policyId: string; version: string; digest: string };
    effectPolicy: { policyId: string; version: string; digest: string };
    tiers: HousingSecurityTier[];
    storageSurfaces: HousingStorageSecuritySurface[];
}
export interface HousingSecurityPolicy extends HousingSecurityPolicyDefinition { digest: string }

/** Attested location/surface snapshot; it is not automatically visible to an attacker. */
export interface HousingAttackSurfaceObservation {
    observationId: string;
    kind: HousingAttackSurfaceKind;
    housingUnitId: string | null;
    storageSurfaceId: string | null;
    storageSlots: number;
    /** Exact Property door lock level for an entry surface; null otherwise. */
    propertyLockLevel: number | null;
    sourceEvidenceDigest: string;
}
export interface HousingSecurityProjection {
    kind: HousingAttackSurfaceKind;
    housingUnitId: string | null;
    propertyId: string | null;
    tierId: string;
    storageSurfaceId: string | null;
    lockLevel: number;
    exposureBasisPoints: number;
    traceBasisPoints: number;
    theftProtectionBasisPoints: number;
    observationId: string;
    sourceEvidenceDigest: string;
    policyDigest: string;
    unitCatalogDigest: string;
    projectionDigest: string;
}
export type HousingAttackSurfaceVerifier = (observation: Readonly<HousingAttackSurfaceObservation>) => boolean;
