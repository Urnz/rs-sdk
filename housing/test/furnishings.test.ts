import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FurnishingPlacementStore, loadFurnishingCatalog, validateFurnishingCatalog } from '../index.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function databasePath(): string { const directory = mkdtempSync(join(tmpdir(), 'housing-furnishings-'));
    directories.push(directory); return join(directory, 'furnishings.sqlite'); }
function catalog() {
    const root = join(import.meta.dir, '..', '..', 'config');
    const properties = JSON.parse(readFileSync(join(root, 'properties.json'), 'utf8')) as
        { properties: Array<{ propertyId: string }> };
    return loadFurnishingCatalog(join(root, 'housing-furnishings.json'),
        new Set(properties.properties.map(property => property.propertyId)));
}
function place(store: FurnishingPlacementStore, values: Partial<Parameters<FurnishingPlacementStore['place']>[0]> = {}) {
    return store.place({ placementId: 'placement-1', propertyId: 'falador.south-house',
        placementSlotId: 'falador.south-house.bed-1', propertyAuthorityDigest: 'b'.repeat(64),
        evidence: { assetId: 'asset-bed-1', ownerAgentId: 'ada', furnishingTypeId: 'simple-bed',
            sourceDigest: 'a'.repeat(64) }, atSimulationTime: '2030-01-01T00:00:00.000Z', ...values });
}

describe('configurable Property furnishings', () => {
    test('loads a strict catalog whose slots reference known Properties', () => {
        const configured = catalog();
        expect(configured.furnishings.map(item => item.kind)).toEqual(['bed', 'chest', 'table']);
        expect(configured.placementSlots).toHaveLength(4);
        expect(configured.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(() => validateFurnishingCatalog({ schemaVersion: 1, furnishings: configured.furnishings,
            placementSlots: [{ ...configured.placementSlots[0], propertyId: 'unknown.house' }] },
        new Set(['falador.south-house']))).toThrow('unknown Property');
    });

    test('places a purchased furnishing with explicit Property authority and grants capabilities', () => {
        const store = new FurnishingPlacementStore(databasePath(), catalog());
        expect(place(store)).toMatchObject({ status: 'placed', ownerAgentId: 'ada',
            propertyAuthorityDigest: 'b'.repeat(64), revision: 1 });
        expect(store.capabilities('falador.south-house')).toEqual({ propertyId: 'falador.south-house',
            placementIds: ['placement-1'], sleepPlaces: 1, privateStorageSlots: 0, workSurfaces: 0 });
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
    });

    test('aggregates snapshotted bed, storage and work-surface capabilities', () => {
        const store = new FurnishingPlacementStore(databasePath(), catalog());
        place(store);
        place(store, { placementId: 'placement-2', placementSlotId: 'falador.south-house.storage-1',
            evidence: { assetId: 'asset-chest-1', ownerAgentId: 'ada', furnishingTypeId: 'wooden-chest',
                sourceDigest: 'c'.repeat(64) } });
        place(store, { placementId: 'placement-3', placementSlotId: 'falador.south-house.table-1',
            evidence: { assetId: 'asset-table-1', ownerAgentId: 'ada', furnishingTypeId: 'wooden-table',
                sourceDigest: 'd'.repeat(64) } });
        expect(store.capabilities('falador.south-house')).toMatchObject({ sleepPlaces: 1,
            privateStorageSlots: 28, workSurfaces: 1 });
        store.close();
    });

    test('rejects slot-kind mismatch, missing authority and duplicate active slot or asset', () => {
        const store = new FurnishingPlacementStore(databasePath(), catalog());
        expect(() => place(store, { placementSlotId: 'falador.south-house.storage-1' }))
            .toThrow('kind is not allowed');
        expect(() => place(store, { propertyAuthorityDigest: 'not-a-digest' }))
            .toThrow('authority digest');
        place(store);
        expect(() => place(store, { placementId: 'placement-2', evidence: { assetId: 'asset-bed-2',
            ownerAgentId: 'ada', furnishingTypeId: 'simple-bed', sourceDigest: 'c'.repeat(64) } })).toThrow();
        expect(() => place(store, { placementId: 'placement-3', placementSlotId: 'falador.south-house.bed-2' }))
            .toThrow();
        store.close();
    });

    test('replays exactly once, removes optimistically and releases capabilities', () => {
        const store = new FurnishingPlacementStore(databasePath(), catalog());
        const original = place(store);
        expect(place(store)).toEqual(original);
        expect(() => place(store, { propertyAuthorityDigest: 'c'.repeat(64) })).toThrow('different authority');
        expect(() => store.remove('placement-1', 2, '2030-01-01T01:00:00.000Z')).toThrow('changed');
        expect(() => store.remove('placement-1', 1, '2029-12-31T23:00:00.000Z'))
            .toThrow('cannot predate');
        expect(store.remove('placement-1', 1, '2030-01-01T01:00:00.000Z')).toMatchObject({
            status: 'removed', revision: 2 });
        expect(store.capabilities('falador.south-house').sleepPlaces).toBe(0);
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
    });

    test('persists placements and detects an altered audit chain', () => {
        const path = databasePath(), store = new FurnishingPlacementStore(path, catalog());
        place(store); store.close();
        const reopened = new FurnishingPlacementStore(path, catalog());
        expect(reopened.get('placement-1')?.status).toBe('placed');
        expect(reopened.verifyAuditChain()).toBeTrue();
        reopened.close();
        const database = new Database(path, { strict: true });
        database.run("UPDATE furnishing_audit SET payload_json='{}' WHERE sequence=1");
        database.close(true);
        const altered = new FurnishingPlacementStore(path, catalog());
        expect(altered.verifyAuditChain()).toBeFalse();
        altered.close();
    });

    test('rejects altered materialized storage capacity even with an intact audit chain', () => {
        const path = databasePath(), store = new FurnishingPlacementStore(path, catalog());
        place(store, { placementSlotId: 'falador.south-house.storage-1',
            evidence: { assetId: 'asset-chest-1', ownerAgentId: 'ada', furnishingTypeId: 'wooden-chest',
                sourceDigest: 'c'.repeat(64) } });
        store.close();
        const database = new Database(path, { strict: true });
        database.run('UPDATE furnishing_placement SET private_storage_slots=999 WHERE placement_id=?1',
            ['placement-1']);
        database.close(true);
        const altered = new FurnishingPlacementStore(path, catalog());
        expect(altered.verifyAuditChain()).toBeFalse();
        expect(() => altered.capabilities('falador.south-house')).toThrow('state or audit is invalid');
        expect(() => place(altered, { placementId: 'placement-2',
            placementSlotId: 'falador.south-house.bed-1' })).toThrow('state or audit is invalid');
        expect(() => altered.remove('placement-1', 1, '2030-01-01T01:00:00.000Z'))
            .toThrow('state or audit is invalid');
        altered.close();
    });

    test('audited capability snapshots survive later furnishing catalog changes', () => {
        const path = databasePath(), original = catalog();
        const store = new FurnishingPlacementStore(path, original);
        place(store, { placementSlotId: 'falador.south-house.storage-1',
            evidence: { assetId: 'asset-chest-1', ownerAgentId: 'ada', furnishingTypeId: 'wooden-chest',
                sourceDigest: 'c'.repeat(64) } });
        store.close();
        const changed = validateFurnishingCatalog({ schemaVersion: 1,
            furnishings: original.furnishings.map(value => value.furnishingTypeId === 'wooden-chest'
                ? { ...value, capabilities: { ...value.capabilities, privateStorageSlots: 56 } } : value),
            placementSlots: original.placementSlots }, new Set(['falador.south-house']));
        const reopened = new FurnishingPlacementStore(path, changed);
        expect(reopened.verifyAuditChain()).toBeTrue();
        expect(reopened.capabilities('falador.south-house').privateStorageSlots).toBe(28);
        reopened.close();
    });

    test('verifies legacy placement audits against the original catalog', () => {
        const path = databasePath(), original = catalog();
        const store = new FurnishingPlacementStore(path, original);
        place(store, { placementSlotId: 'falador.south-house.storage-1',
            evidence: { assetId: 'asset-chest-1', ownerAgentId: 'ada', furnishingTypeId: 'wooden-chest',
                sourceDigest: 'c'.repeat(64) } });
        store.close();
        const database = new Database(path, { strict: true });
        const row = database.query('SELECT payload_json,previous_hash FROM furnishing_audit').get() as
            { payload_json: string; previous_hash: string };
        const payload = JSON.parse(row.payload_json) as { detail: Record<string, unknown> };
        delete payload.detail.sleepPlaces;
        delete payload.detail.privateStorageSlots;
        delete payload.detail.workSurfaces;
        const entryHash = createHash('sha256').update(JSON.stringify({ previousHash: row.previous_hash,
            payload })).digest('hex');
        database.run('UPDATE furnishing_audit SET payload_json=?1,entry_hash=?2',
            [JSON.stringify(payload), entryHash]);
        database.close(true);
        const legacy = new FurnishingPlacementStore(path, original);
        expect(legacy.verifyAuditChain()).toBeTrue();
        legacy.close();
        const changed = validateFurnishingCatalog({ schemaVersion: 1,
            furnishings: original.furnishings.map(value => value.furnishingTypeId === 'wooden-chest'
                ? { ...value, capabilities: { ...value.capabilities, privateStorageSlots: 56 } } : value),
            placementSlots: original.placementSlots }, new Set(['falador.south-house']));
        const incompatible = new FurnishingPlacementStore(path, changed);
        expect(incompatible.verifyAuditChain()).toBeFalse();
        incompatible.close();
    });

    test('rejects a catalog whose supplied digest does not describe its content', () => {
        const configured = catalog();
        expect(() => new FurnishingPlacementStore(databasePath(), { ...configured, digest: '0'.repeat(64) }))
            .toThrow('catalog digest does not match');
    });
});
