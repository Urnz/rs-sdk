import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BusinessAssetStore } from '../../business-assets/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import {
    loadDefaultProductionWorkflowCatalog,
    ProductionWorkInProgressStore,
    type ProductionStepEvidence
} from '../index.js';

const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });
function fixture() { const directory = mkdtempSync(join(tmpdir(), 'production-wip-')); directories.push(directory);
    const path = join(directory, 'business.sqlite'), manager = new BusinessManagerStore(path);
    manager.create({ businessId: 'varrock-smiths', name: 'Varrock Smiths', summary: 'Workflow test.',
        ownerAgentId: 'owner', propertyId: 'varrock.east-workshop' });
    manager.creditGenesisInventory('opening-copper', 'varrock-smiths', 436, 3);
    manager.creditGenesisInventory('opening-tin', 'varrock-smiths', 438, 3); manager.close();
    const assets = new BusinessAssetStore(path); assets.createStorage({ storageId: 'ore-bin', businessId: 'varrock-smiths',
        actorAgentId: 'owner', name: 'Ore bin', propertyId: 'varrock.east-workshop', capacityUnits: 20 });
    assets.move({ operationId: 'store-copper', businessId: 'varrock-smiths', actorAgentId: 'owner', itemId: 436,
        count: 3, sourceStorageId: null, targetStorageId: 'ore-bin' });
    assets.move({ operationId: 'store-tin', businessId: 'varrock-smiths', actorAgentId: 'owner', itemId: 438,
        count: 3, sourceStorageId: null, targetStorageId: 'ore-bin' }); assets.close();
    return { path, work: new ProductionWorkInProgressStore(path, loadDefaultProductionWorkflowCatalog()) }; }
function upgradeFixture() { const directory = mkdtempSync(join(tmpdir(), 'production-upgrade-')); directories.push(directory);
    const path = join(directory, 'business.sqlite'), manager = new BusinessManagerStore(path);
    manager.create({ businessId: 'varrock-smiths', name: 'Varrock Smiths', summary: 'Upgrade prototype.',
        ownerAgentId: 'owner', propertyId: 'varrock.east-workshop' });
    manager.creditGenesisInventory('upgrade-copper', 'varrock-smiths', 436, 6);
    manager.creditGenesisInventory('upgrade-tin', 'varrock-smiths', 438, 6);
    manager.creditGenesisInventory('upgrade-leather', 'varrock-smiths', 1741, 2); manager.close();
    const assets = new BusinessAssetStore(path); assets.createStorage({ storageId: 'prototype-inputs', businessId: 'varrock-smiths',
        actorAgentId: 'owner', name: 'Prototype inputs', propertyId: 'varrock.east-workshop', capacityUnits: 20 });
    for (const [operationId, itemId, count] of [['store-upgrade-copper', 436, 6], ['store-upgrade-tin', 438, 6],
        ['store-upgrade-leather', 1741, 2]] as const) assets.move({ operationId, businessId: 'varrock-smiths',
        actorAgentId: 'owner', itemId, count, sourceStorageId: null, targetStorageId: 'prototype-inputs' });
    assets.close(); return { path, work: new ProductionWorkInProgressStore(path, loadDefaultProductionWorkflowCatalog()) }; }
const reserve = { operationId: 'reserve-run-1', runId: 'bronze-run-1', businessId: 'varrock-smiths', actorAgentId: 'owner',
    workflowId: 'tools.bronze-pickaxe', workflowVersion: '1.0.0', inputs: [
        { itemId: 436, count: 3, storageId: 'ore-bin' }, { itemId: 438, count: 3, storageId: 'ore-bin' }] };
function evidence(stepId: 'smelt'|'forge', overrides: Partial<ProductionStepEvidence> = {}): ProductionStepEvidence {
    return { operationId: `${stepId}-proof`, runId: 'bronze-run-1', stepId, status: 'completed',
        inputs: stepId === 'smelt' ? [{ itemId: 436, quantity: 3 }, { itemId: 438, quantity: 3 }]
            : [{ itemId: 2349, quantity: 3 }], outputs: stepId === 'smelt' ? [{ itemId: 2349, quantity: 3 }]
            : [{ itemId: 1265, quantity: 1 }], sourceEvidenceDigest: 'a'.repeat(64),
        occurredAt: stepId === 'smelt' ? '2030-01-01T01:00:00.000Z' : '2030-01-01T02:00:00.000Z', ...overrides };
}

describe('atomic Business input reservation and work in progress', () => {
    test('reserves storage inputs once, advances verified steps and releases only final output', () => {
        const { path, work } = fixture(); try {
            expect(work.reserve(reserve, '2030-01-01T00:00:00.000Z').status).toBe('reserved');
            expect(work.reserve(reserve, '2030-01-01T00:00:00.000Z').status).toBe('reserved');
            expect(() => work.reserve({ ...reserve, operationId: 'reserve-run-2', runId: 'bronze-run-2' },
                '2030-01-01T00:00:00.000Z')).toThrow('insufficient');
            expect(() => work.completeStep('bronze-run-1', 'forge', evidence('forge'), () => true)).toThrow('dependencies');
            expect(work.completeStep('bronze-run-1', 'smelt', evidence('smelt'), () => true).status).toBe('running');
            expect(work.completeStep('bronze-run-1', 'smelt', evidence('smelt'), () => true).status).toBe('running');
            expect(() => work.completeStep('bronze-run-1', 'smelt', evidence('smelt', {
                sourceEvidenceDigest: 'b'.repeat(64) }), () => true)).toThrow('reused');
            work.completeStep('bronze-run-1', 'forge', evidence('forge'), () => true);
            expect(work.completeRun('bronze-run-1', null, '2030-01-01T03:00:00.000Z').status).toBe('completed');
            const assets = new BusinessAssetStore(path); try {
                expect(assets.listAssets('varrock-smiths', null)).toEqual(expect.arrayContaining([
                    expect.objectContaining({ itemId: 1265, count: 1 })]));
                expect(assets.listAssets('varrock-smiths', null).find(item => item.itemId === 2349)).toBeUndefined();
                expect(assets.listAssets('varrock-smiths', 'ore-bin').filter(item => item.count > 0)).toEqual([]);
            } finally { assets.close(); }
        } finally { work.close(); }
    });

    test('returns exact reserved inputs when an unstarted run is cancelled', () => {
        const { path, work } = fixture(); try { work.reserve(reserve, '2030-01-01T00:00:00.000Z');
            expect(work.cancelReserved('bronze-run-1', '2030-01-01T00:30:00.000Z').status).toBe('cancelled');
            expect(work.cancelReserved('bronze-run-1', '2030-01-01T00:30:00.000Z').status).toBe('cancelled');
            const assets = new BusinessAssetStore(path); try {
                expect(assets.listAssets('varrock-smiths', 'ore-bin').filter(item => item.count > 0))
                    .toEqual([expect.objectContaining({ itemId: 436, count: 3 }), expect.objectContaining({ itemId: 438, count: 3 })]);
            } finally { assets.close(); }
        } finally { work.close(); }
    });

    test('runs the longer ore-to-tool-and-facility-upgrade prototype through Business WIP', () => {
        const { path, work } = upgradeFixture(), runId = 'facility-upgrade-run-1'; try {
            work.reserve({ operationId: 'reserve-upgrade-run-1', runId, businessId: 'varrock-smiths', actorAgentId: 'owner',
                workflowId: 'facility.bronze-bellows-upgrade', workflowVersion: '1.0.0', inputs: [
                    { itemId: 436, count: 6, storageId: 'prototype-inputs' },
                    { itemId: 438, count: 6, storageId: 'prototype-inputs' },
                    { itemId: 1741, count: 2, storageId: 'prototype-inputs' }
                ] }, '2030-01-01T00:00:00.000Z');
            const proof = (stepId: string, inputs: ProductionStepEvidence['inputs'], outputs: ProductionStepEvidence['outputs'], hour: number) =>
                ({ operationId: `${stepId}-proof`, runId, stepId, status: 'completed' as const, inputs, outputs,
                    sourceEvidenceDigest: String(hour).repeat(64), occurredAt: `2030-01-01T0${hour}:00:00.000Z` });
            work.completeStep(runId, 'smelt', proof('smelt', [{ itemId: 436, quantity: 6 }, { itemId: 438, quantity: 6 }],
                [{ itemId: 2349, quantity: 6 }], 1), () => true);
            work.completeStep(runId, 'forge-tool', proof('forge-tool', [{ itemId: 2349, quantity: 3 }],
                [{ itemId: 1265, quantity: 1 }], 2), () => true);
            work.completeStep(runId, 'assemble-upgrade', proof('assemble-upgrade', [{ itemId: 1741, quantity: 2 },
                { itemId: 2349, quantity: 3 }], [{ itemId: 65000, quantity: 1 }], 3), () => true);
            expect(work.completeRun(runId, null, '2030-01-01T04:00:00.000Z').status).toBe('completed');
            const assets = new BusinessAssetStore(path); try { expect(assets.listAssets('varrock-smiths', null))
                .toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 1265, count: 1 }),
                    expect.objectContaining({ itemId: 65000, count: 1 })]));
            } finally { assets.close(); }
        } finally { work.close(); }
    });

    test('does not mutate WIP from untrusted or mismatched step evidence', () => {
        const { work } = fixture(); try { work.reserve(reserve, '2030-01-01T00:00:00.000Z');
            expect(() => work.completeStep('bronze-run-1', 'smelt', evidence('smelt'), () => false)).toThrow('invalid');
            expect(() => work.completeStep('bronze-run-1', 'smelt', evidence('smelt', {
                outputs: [{ itemId: 2349, quantity: 4 }] }), () => true)).toThrow('invalid');
            expect(work.get('bronze-run-1')?.status).toBe('reserved');
        } finally { work.close(); }
    });
});
