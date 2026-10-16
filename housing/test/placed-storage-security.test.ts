import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog,
    loadHousingUnitCatalog, loadFurnishingCatalog } from '../config.js';
import { FurnishingPlacementStore } from '../furnishing-store.js';
import { validateFurnishingCatalog } from '../furnishings.js';
import { loadStorageSurfaceBindings, projectPlacedStorageSecurity,
    validateStorageSurfaceBindings } from '../placed-storage-security.js';
import { loadHousingSecurityPolicy } from '../security.js';
import { validateHousingUnitCatalog } from '../units.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(): string { const root = mkdtempSync(join(tmpdir(), 'placed-storage-security-'));
    roots.push(root); return join(root, 'furnishings.sqlite'); }
const properties = loadPropertyCatalog(join(config, 'properties.json'));
const propertyIds = new Set(properties.properties.map(value => value.propertyId));
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const units = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy, propertyIds);
const furnishings = loadFurnishingCatalog(join(config, 'housing-furnishings.json'), propertyIds);
const policy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
const bindings = loadStorageSurfaceBindings(join(config, 'housing-storage-bindings.json'), furnishings, units, policy);
const placedAt = '2030-01-01T00:00:00.000Z';
function placeChest(store: FurnishingPlacementStore): void {
    store.place({ placementId: 'chest-1', propertyId: 'falador.south-house',
        placementSlotId: 'falador.south-house.storage-1', propertyAuthorityDigest: 'b'.repeat(64),
        evidence: { assetId: 'asset-chest-1', ownerAgentId: 'owner-1', furnishingTypeId: 'wooden-chest',
            sourceDigest: 'a'.repeat(64) }, atSimulationTime: placedAt });
}

describe('exact placed Housing storage security surface', () => {
    test('projects only an audited active chest through its configured unit and security tier', () => {
        const store = new FurnishingPlacementStore(path(), furnishings);
        try { expect(() => projectPlacedStorageSecurity('chest-1', store, bindings, furnishings,
            policy, hierarchy, effects, units)).toThrow('No active audited storage placement');
            placeChest(store);
            const projected = projectPlacedStorageSecurity('chest-1', store, bindings, furnishings,
                policy, hierarchy, effects, units);
            expect(projected).toMatchObject({ placementId: 'chest-1', placementRevision: 1,
                storageSlots: 28,
                bindingDigest: bindings.digest, security: { kind: 'storage',
                    housingUnitId: 'falador.south-house.main', propertyId: 'falador.south-house',
                    storageSurfaceId: 'private-room-chest', lockLevel: 30 } });
            expect(projected.security.sourceEvidenceDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(projected.security.projectionDigest).toMatch(/^[0-9a-f]{64}$/);
            store.remove('chest-1', 1, '2030-01-01T01:00:00.000Z');
            expect(() => projectPlacedStorageSecurity('chest-1', store, bindings, furnishings,
                policy, hierarchy, effects, units)).toThrow('No active audited storage placement');
        } finally { store.close(); }
    });
    test('rejects forged, duplicate and cross-tier storage bindings', () => {
        expect(() => validateStorageSurfaceBindings({ schemaVersion: 1, bindings: [
            { ...bindings.bindings[0], storageSurfaceId: 'fortified-vault' }] }, furnishings, units, policy))
            .toThrow('active storage surface');
        expect(() => validateStorageSurfaceBindings({ schemaVersion: 1, bindings: [
            bindings.bindings[0], bindings.bindings[0]] }, furnishings, units, policy))
            .toThrow('duplicate');
        const store = new FurnishingPlacementStore(path(), furnishings);
        try { placeChest(store);
            expect(() => projectPlacedStorageSecurity('chest-1', store,
                { ...bindings, bindings: [] }, furnishings, policy, hierarchy, effects, units))
                .toThrow('digest mismatch');
        } finally { store.close(); }
    });
    test('does not project a placement whose materialized capacity was altered', () => {
        const databasePath = path(), store = new FurnishingPlacementStore(databasePath, furnishings);
        placeChest(store);
        store.close();
        const database = new Database(databasePath);
        database.run('UPDATE furnishing_placement SET private_storage_slots=100 WHERE placement_id=?1',
            ['chest-1']);
        database.close();
        const altered = new FurnishingPlacementStore(databasePath, furnishings);
        try { expect(() => projectPlacedStorageSecurity('chest-1', altered, bindings, furnishings,
            policy, hierarchy, effects, units)).toThrow('state or audit is invalid');
        } finally { altered.close(); }
    });
    test('accepts a later house entirely through unit, slot and surface configuration', () => {
        const newProperty = 'new-town.house';
        const known = new Set([...propertyIds, newProperty]);
        const extendedUnits = validateHousingUnitCatalog({ schemaVersion: 1, units: [
            ...units.units, { ...units.units[0]!, housingUnitId: 'new-town.house.main',
                propertyId: newProperty, capacity: 1,
                bedSlots: [{ bedSlotId: 'new-town.house.bed-1', label: 'Bed' }] }
        ] }, hierarchy, known);
        const extendedFurnishings = validateFurnishingCatalog({ schemaVersion: 1,
            furnishings: furnishings.furnishings, placementSlots: [
                ...furnishings.placementSlots, { placementSlotId: 'new-town.house.storage-1',
                    propertyId: newProperty, roomId: 'ground-floor', allowedKinds: ['chest'] }
            ] }, known);
        const extendedBindings = validateStorageSurfaceBindings({ schemaVersion: 1, bindings: [
            ...bindings.bindings, { placementSlotId: 'new-town.house.storage-1',
                housingUnitId: 'new-town.house.main', storageSurfaceId: 'private-room-chest' }
        ] }, extendedFurnishings, extendedUnits, policy);
        const store = new FurnishingPlacementStore(path(), extendedFurnishings);
        try { store.place({ placementId: 'new-chest', propertyId: newProperty,
            placementSlotId: 'new-town.house.storage-1', propertyAuthorityDigest: 'b'.repeat(64),
            evidence: { assetId: 'new-asset', ownerAgentId: 'owner-1', furnishingTypeId: 'wooden-chest',
                sourceDigest: 'a'.repeat(64) }, atSimulationTime: placedAt });
            const result = projectPlacedStorageSecurity('new-chest', store, extendedBindings,
                extendedFurnishings, policy, hierarchy, effects, extendedUnits);
            expect(result.security).toMatchObject({ propertyId: newProperty,
                housingUnitId: 'new-town.house.main', storageSurfaceId: 'private-room-chest' });
        } finally { store.close(); }
    });
});
