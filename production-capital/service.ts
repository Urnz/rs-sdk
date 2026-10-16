import { createHash } from 'node:crypto';

import { ItemLifecycleStore } from '../item-lifecycle/index.js';
import { productionCapitalCatalogDigest } from './catalog.js';
import type {
    CapitalInstallationEvidence,
    ProductionBaseline,
    ProductionCapitalCatalog,
    ProductionCapitalDefinition,
    ProductionCapitalProjection,
    ProductionCapitalUseReceipt,
    ProductionCapitalUseResult
} from './types.js';

const DIGEST = /^[0-9a-f]{64}$/;
export type CapitalInstallationVerifier = (evidence: CapitalInstallationEvidence) => boolean;
export type CapitalUseVerifier = (receipt: ProductionCapitalUseReceipt) => boolean;
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function scale(value: number, qualityBasisPoints: number): number { return Math.floor(value * qualityBasisPoints / 10_000); }

export class ProductionCapitalService {
    constructor(private readonly store: ItemLifecycleStore, private readonly catalog: ProductionCapitalCatalog) { this.verifyCatalog(); }
    project(assetTypeId: string, itemInstanceId: string, ownerActorId: string, installation: CapitalInstallationEvidence,
        baseline: ProductionBaseline, batches: number, verify?: CapitalInstallationVerifier): ProductionCapitalProjection {
        const definition = this.definition(assetTypeId), item = this.store.get(itemInstanceId);
        if (!item || item.lifecycleTypeId !== definition.lifecycleTypeId || item.ownerActorId !== ownerActorId || item.status !== 'usable') {
            throw new Error('Production capital item is unavailable');
        }
        if (!Number.isSafeInteger(batches) || batches < 1 || !Number.isSafeInteger(baseline.durationSimulationMinutes)
            || baseline.durationSimulationMinutes < 1 || !Number.isSafeInteger(baseline.qualityBasisPoints)
            || baseline.qualityBasisPoints < 0 || baseline.qualityBasisPoints > 20_000
            || !Number.isSafeInteger(baseline.failureBasisPoints) || baseline.failureBasisPoints < 0
            || baseline.failureBasisPoints > 10_000 || !Number.isSafeInteger(baseline.capacityUnits) || baseline.capacityUnits < 1) {
            throw new Error('Production baseline is invalid');
        }
        if (installation.status !== 'active' || installation.itemInstanceId !== itemInstanceId
            || installation.capabilityId !== definition.installationCapabilityId || !DIGEST.test(installation.sourceEvidenceDigest)
            || !verify?.(installation)) throw new Error('Production capital installation is not trusted');
        const remainingSupportedBatches = Math.floor(this.store.remainingUses(itemInstanceId) / definition.wearUsesPerBatch);
        if (batches > remainingSupportedBatches) throw new Error('Production capital lacks durability for requested batches');
        const quality = item.qualityBasisPoints;
        const throughput = 10_000 + scale(definition.effects.throughputMultiplierBasisPoints - 10_000, quality);
        return { capitalAssetTypeId: definition.capitalAssetTypeId, itemInstanceId, facilityId: installation.facilityId,
            providedCapabilities: [...definition.providedCapabilities], effective: {
                durationSimulationMinutes: Math.max(1, Math.ceil(baseline.durationSimulationMinutes * 10_000 / throughput)),
                qualityBasisPoints: Math.min(20_000, baseline.qualityBasisPoints + scale(definition.effects.qualityBonusBasisPoints, quality)),
                failureBasisPoints: Math.max(0, baseline.failureBasisPoints - scale(definition.effects.failureReductionBasisPoints, quality)),
                capacityUnits: baseline.capacityUnits + scale(definition.effects.capacityBonusUnits, quality) },
            remainingSupportedBatches, maintenancePolicyId: definition.maintenancePolicyId, catalogDigest: this.catalog.digest };
    }
    recordUse(receipt: ProductionCapitalUseReceipt, verify?: CapitalUseVerifier): ProductionCapitalUseResult {
        const definition = this.definition(receipt.capitalAssetTypeId), current = this.store.get(receipt.itemInstanceId);
        const replay = this.store.hasOperation(receipt.operationId), useCount = receipt.batches * definition.wearUsesPerBatch;
        if (!current || current.lifecycleTypeId !== definition.lifecycleTypeId || current.ownerActorId !== receipt.ownerActorId
            || !Number.isSafeInteger(receipt.batches) || receipt.batches < 1 || !Number.isSafeInteger(useCount)
            || useCount < 1 || (!replay && useCount > this.store.remainingUses(receipt.itemInstanceId))
            || receipt.installation.itemInstanceId !== receipt.itemInstanceId
            || receipt.installation.capabilityId !== definition.installationCapabilityId
            || receipt.installation.status !== 'active' || !DIGEST.test(receipt.installation.sourceEvidenceDigest)
            || !DIGEST.test(receipt.sourceEvidenceDigest) || !verify?.(receipt)) throw new Error('Production capital use receipt is invalid');
        const asset = this.store.use(receipt.operationId, receipt.itemInstanceId, receipt.expectedRevision, useCount,
            hash(receipt), receipt.atSimulationTime);
        return { asset, remainingSupportedBatches: Math.floor(this.store.remainingUses(receipt.itemInstanceId) / definition.wearUsesPerBatch) };
    }
    private definition(assetTypeId: string): ProductionCapitalDefinition {
        this.verifyCatalog(); const definition = this.catalog.assets.find(asset => asset.capitalAssetTypeId === assetTypeId);
        if (!definition) throw new Error('Unknown production capital type'); return definition;
    }
    private verifyCatalog(): void { const { digest, ...definition } = this.catalog;
        if (digest !== productionCapitalCatalogDigest(definition)) throw new Error('Production capital catalog digest mismatch'); }
}
