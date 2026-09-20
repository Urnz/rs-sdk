import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ItemLifecycleStore, loadItemLifecycleCatalog } from '../../item-lifecycle/index.js';
import { loadDefaultProductionCapitalCatalog, ProductionCapitalService } from '../index.js';
import type { CapitalInstallationEvidence, ProductionCapitalUseReceipt } from '../index.js';

const directories: string[] = [], root = join(import.meta.dir, '..', '..', 'config');
afterEach(() => { directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });
function fixture(qualityBasisPoints = 10_000) { const directory = mkdtempSync(join(tmpdir(), 'production-capital-')); directories.push(directory);
    const lifecycle = loadItemLifecycleCatalog(join(root, 'item-lifecycle.json'));
    const store = new ItemLifecycleStore(join(directory, 'items.sqlite'), lifecycle);
    const item = store.create({ itemInstanceId: 'bellows-1', lifecycleTypeId: 'workshop-bellows', ownerActorId: 'varrock-smiths',
        qualityBasisPoints, provenanceDigest: 'a'.repeat(64), atSimulationTime: '2030-01-01T00:00:00.000Z' });
    return { store, item, service: new ProductionCapitalService(store, loadDefaultProductionCapitalCatalog()) }; }
const installation: CapitalInstallationEvidence = { installationEvidenceId: 'install-1', itemInstanceId: 'bellows-1',
    facilityId: 'varrock.east-workshop.forge', capabilityId: 'smithing.basic-forging', status: 'active',
    sourceEvidenceDigest: 'b'.repeat(64) };
function receipt(overrides: Partial<ProductionCapitalUseReceipt> = {}): ProductionCapitalUseReceipt { return {
    operationId: 'capital-use-1', capitalAssetTypeId: 'workshop.bronze-bellows', itemInstanceId: 'bellows-1',
    ownerActorId: 'varrock-smiths', expectedRevision: 1, workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0',
    stepId: 'forge', batches: 10, installation, sourceEvidenceDigest: 'c'.repeat(64),
    atSimulationTime: '2030-01-01T01:00:00.000Z', ...overrides }; }

describe('wearing production capital with mechanical utility', () => {
    test('improves throughput, quality, failure rate and capacity without assigning an artificial price', () => {
        const { store, service } = fixture();
        const projection = service.project('workshop.bronze-bellows', 'bellows-1', 'varrock-smiths', installation,
            { durationSimulationMinutes: 100, qualityBasisPoints: 8_000, failureBasisPoints: 2_000, capacityUnits: 2 }, 10, () => true);
        expect(projection).toMatchObject({ effective: { durationSimulationMinutes: 80, qualityBasisPoints: 8_500,
            failureBasisPoints: 1_000, capacityUnits: 3 }, remainingSupportedBatches: 200,
        maintenancePolicyId: 'workshop-bellows-repair', providedCapabilities: ['smithing.enhanced-airflow'] });
        expect('valueGp' in projection).toBeFalse(); store.close();
    });

    test('scales utility by item quality and consumes durable capacity from verified production', () => {
        const { store, service } = fixture(5_000);
        expect(service.project('workshop.bronze-bellows', 'bellows-1', 'varrock-smiths', installation,
            { durationSimulationMinutes: 100, qualityBasisPoints: 8_000, failureBasisPoints: 2_000, capacityUnits: 2 }, 10, () => true))
            .toMatchObject({ effective: { durationSimulationMinutes: 89, qualityBasisPoints: 8_250,
                failureBasisPoints: 1_500, capacityUnits: 2 } });
        const result = service.recordUse(receipt(), () => true);
        expect(result).toMatchObject({ asset: { durability: 190, revision: 2, status: 'usable' }, remainingSupportedBatches: 190 });
        expect(service.recordUse(receipt(), () => true)).toEqual(result); expect(store.verifyAuditChain()).toBeTrue(); store.close();
    });

    test('rejects untrusted installation, foreign ownership and use beyond remaining durability', () => {
        const { store, service } = fixture(); const baseline = { durationSimulationMinutes: 10, qualityBasisPoints: 8_000,
            failureBasisPoints: 2_000, capacityUnits: 1 };
        expect(() => service.project('workshop.bronze-bellows', 'bellows-1', 'varrock-smiths', installation,
            baseline, 1, () => false)).toThrow('not trusted');
        expect(() => service.project('workshop.bronze-bellows', 'bellows-1', 'other-business', installation,
            baseline, 1, () => true)).toThrow('unavailable');
        expect(() => service.recordUse(receipt({ batches: 201 }), () => true)).toThrow('receipt');
        expect(() => service.recordUse(receipt(), () => false)).toThrow('receipt'); store.close();
    });
});
