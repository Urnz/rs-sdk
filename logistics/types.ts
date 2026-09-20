import type { FacilityCapabilityAuthorization } from '../facility-capability/index.js';

export interface LogisticsLocation { locationId: string; label: string; propertyId: string; storageId: string }
export interface LogisticsRoute { routeId: string; fromLocationId: string; toLocationId: string; distanceTiles: number }
export interface LogisticsCarrierMode {
    carrierModeId: string;
    kind: 'pedestrian' | 'vehicle';
    capacityUnits: number;
    speedTilesPerSimulationMinute: number;
    fixedCostGp: number;
    costGpPer100Tiles: number;
    requiredFacilityCapabilityId: string | null;
}
export interface LogisticsCatalog { schemaVersion: 1; locations: LogisticsLocation[]; routes: LogisticsRoute[];
    carrierModes: LogisticsCarrierMode[]; digest: string }
export interface LogisticsCargo { itemId: number; count: number }
export interface LogisticsRequest { businessId: string; actorAgentId: string; routeId: string; carrierModeId: string;
    cargo: LogisticsCargo[] }
export interface LogisticsAuthorityEvidence {
    evidenceId: string;
    businessId: string;
    actorAgentId: string;
    roleDefinitionId: string;
    sourcePropertyId: string;
    sourceStorageId: string;
    sourceStorageEntitlementId: string;
    targetPropertyId: string;
    targetStorageId: string;
    targetStorageEntitlementId: string;
    validAt: string;
    sourceEvidenceDigest: string;
}
export interface LogisticsPlan {
    businessId: string;
    actorAgentId: string;
    routeId: string;
    from: LogisticsLocation;
    to: LogisticsLocation;
    carrierModeId: string;
    carrierKind: LogisticsCarrierMode['kind'];
    cargo: LogisticsCargo[];
    cargoUnits: number;
    capacityUnits: number;
    durationSimulationMinutes: number;
    costGp: number;
    authorityEvidenceId: string;
    vehicleFacilityAuthorization: FacilityCapabilityAuthorization | null;
    catalogDigest: string;
    planDigest: string;
}
