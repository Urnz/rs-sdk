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
export interface ItemReplacementRecord {
    operationId: string;
    replacedItemInstanceId: string;
    replacementItemInstanceId: string;
    ownerActorId: string;
    evidenceDigest: string;
    occurredAtSimulationTime: string;
}
export interface ProductionToolCycleDefinition {
    cycleId: string;
    lifecycleTypeId: string;
    skillName: string;
    outputItemIds: number[];
}
export interface ProductionToolCycleCatalog {
    schemaVersion: 1;
    cycles: ProductionToolCycleDefinition[];
    digest: string;
}
export interface ProductionToolUseReceipt {
    receiptId: string;
    cycleId: string;
    itemInstanceId: string;
    actorId: string;
    expectedRevision: number;
    skillName: string;
    successfulActions: number;
    outputItemId: number;
    outputQuantity: number;
    sourceEvidenceDigest: string;
    atSimulationTime: string;
}
export interface ProductionToolReplacementReceipt {
    receiptId: string;
    cycleId: string;
    replacedItemInstanceId: string;
    replacementItemInstanceId: string;
    actorId: string;
    expectedRevision: number;
    acquiredItemId: number;
    acquiredQuantity: 1;
    replacementQualityBasisPoints: number;
    replacementProvenanceDigest: string;
    acquisitionEvidenceDigest: string;
    atSimulationTime: string;
}
