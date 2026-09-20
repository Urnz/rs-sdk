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
export interface BatchExpiryItemDefinition {
    itemId: number;
    shelfLifeSimulationMinutes: number;
}
export interface BatchStorageProfileDefinition {
    storageProfileId: string;
    label: string;
    shelfLifeMultiplierBasisPoints: number;
    requiredCapabilityId: string | null;
}
export interface BatchExpiryPolicyDefinition {
    policyId: string;
    expiryClock: 'simulation-time';
    defaultStorageProfileId: string;
    items: BatchExpiryItemDefinition[];
    storageProfiles: BatchStorageProfileDefinition[];
}
export interface BatchExpiryPolicyCatalog {
    schemaVersion: 1;
    activation: 'prepared';
    policies: BatchExpiryPolicyDefinition[];
    digest: string;
}
export interface PreparedBatchExpiryContract {
    activation: 'prepared';
    policy: BatchExpiryPolicyDefinition;
    item: BatchExpiryItemDefinition;
}
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
export interface ItemLifecycleLoopMetrics {
    lifecycleTypeId: string;
    ownerActorId: string | null;
    usableStock: number;
    brokenAwaitingReplacement: number;
    successfulUses: number;
    breakages: number;
    replacements: number;
    replacementCoverageBasisPoints: number | null;
    replacementsPerThousandUses: number | null;
}
export interface ProductionToolCycleDefinition {
    cycleId: string;
    lifecycleTypeId: string;
    capabilityId: string;
    skillName: string;
    outputItemIds: number[];
    outputQuantityPerAction: number;
}
export interface ProductionToolCycleCatalog {
    schemaVersion: 2;
    cycles: ProductionToolCycleDefinition[];
    digest: string;
}
export interface ProductionToolUtility {
    cycleId: string;
    itemInstanceId: string;
    ownerActorId: string;
    capabilityId: string;
    capabilityAvailable: boolean;
    skillName: string;
    outputItemIds: number[];
    outputQuantityPerAction: number;
    remainingSuccessfulActions: number;
    remainingOutputCapacity: number;
    status: 'available' | 'broken' | 'replaced';
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
