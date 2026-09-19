export interface ItemLifecycleDefinition {
    lifecycleTypeId: string;
    itemId: number;
    itemName: string;
    maxDurability: number;
    wearPerUse: number;
    repairable: boolean;
}
export interface ItemLifecycleCatalog { schemaVersion: 1; items: ItemLifecycleDefinition[]; digest: string }
export interface ItemInstanceState {
    itemInstanceId: string;
    lifecycleTypeId: string;
    itemId: number;
    ownerActorId: string;
    durability: number;
    maxDurability: number;
    status: 'usable' | 'broken';
    qualityBasisPoints: number;
    provenanceDigest: string;
    createdAtSimulationTime: string;
    updatedAtSimulationTime: string;
    revision: number;
}
