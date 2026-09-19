export interface ItemLifecycleDefinition {
    lifecycleTypeId: string;
    itemId: number;
    itemName: string;
    maxDurability: number;
    wearPerUse: number;
    repairable: boolean;
}
export interface ItemLifecycleCatalog { schemaVersion: 1; items: ItemLifecycleDefinition[]; digest: string }
export type ItemStateMode = 'instance' | 'stack' | 'batch';
export interface ItemStateRule {
    itemId: number;
    itemName: string;
    mode: ItemStateMode;
    lifecycleTypeId: string | null;
    batchPolicyId: string | null;
    rationale: string;
}
export interface ItemStatePolicyCatalog { schemaVersion: 1; rules: ItemStateRule[]; digest: string }
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
