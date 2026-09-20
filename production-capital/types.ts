import type { ItemInstanceState } from '../item-lifecycle/index.js';

export interface ProductionCapitalEffects {
    throughputMultiplierBasisPoints: number;
    qualityBonusBasisPoints: number;
    failureReductionBasisPoints: number;
    capacityBonusUnits: number;
}
export interface ProductionCapitalDefinition {
    capitalAssetTypeId: string;
    lifecycleTypeId: string;
    installationCapabilityId: string;
    providedCapabilities: string[];
    effects: ProductionCapitalEffects;
    wearUsesPerBatch: number;
    maintenancePolicyId: string;
}
export interface ProductionCapitalCatalog { schemaVersion: 1; assets: ProductionCapitalDefinition[]; digest: string }
export interface CapitalInstallationEvidence {
    installationEvidenceId: string;
    itemInstanceId: string;
    facilityId: string;
    capabilityId: string;
    status: 'active';
    sourceEvidenceDigest: string;
}
export interface ProductionBaseline {
    durationSimulationMinutes: number;
    qualityBasisPoints: number;
    failureBasisPoints: number;
    capacityUnits: number;
}
export interface ProductionCapitalProjection {
    capitalAssetTypeId: string;
    itemInstanceId: string;
    facilityId: string;
    providedCapabilities: string[];
    effective: ProductionBaseline;
    remainingSupportedBatches: number;
    maintenancePolicyId: string;
    catalogDigest: string;
}
export interface ProductionCapitalUseReceipt {
    operationId: string;
    capitalAssetTypeId: string;
    itemInstanceId: string;
    ownerActorId: string;
    expectedRevision: number;
    workflowId: string;
    workflowVersion: string;
    stepId: string;
    batches: number;
    installation: CapitalInstallationEvidence;
    sourceEvidenceDigest: string;
    atSimulationTime: string;
}
export interface ProductionCapitalUseResult { asset: ItemInstanceState; remainingSupportedBatches: number }
