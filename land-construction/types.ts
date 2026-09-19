export type ConstructionPropertyType = 'house' | 'farm' | 'shop' | 'workshop' | 'inn' | 'warehouse';

export interface LandParcelBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    level: number;
}

export interface LandParcelDefinition {
    landParcelId: string;
    label: string;
    region: string;
    enabled: boolean;
    purchasePriceGp: number;
    bounds: LandParcelBounds;
}

export interface ConstructionStageDefinition {
    stageId: string;
    label: string;
}

export interface ConstructionBlueprintDefinition {
    blueprintId: string;
    label: string;
    resultPropertyType: ConstructionPropertyType;
    constructionCostGp: number;
    stages: ConstructionStageDefinition[];
}

export interface LandConstructionCatalog {
    schemaVersion: 1;
    parcels: LandParcelDefinition[];
    blueprints: ConstructionBlueprintDefinition[];
    digest: string;
}

export interface ConstructionOwnerRef {
    kind: 'player' | 'business' | 'faction';
    id: string;
}

export interface ConstructionProjectReference {
    projectId: string;
    landParcelId: string;
    blueprintId: string;
    futurePropertyId: string;
    owner: ConstructionOwnerRef;
    parcelOwnershipEvidenceDigest: string;
    catalogDigest: string;
    status: 'planned';
}
