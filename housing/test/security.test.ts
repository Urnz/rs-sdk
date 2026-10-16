import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog,
    loadHousingUnitCatalog } from '../config.js';
import { loadHousingSecurityPolicy, projectHousingSecurity, validateHousingSecurityPolicy } from '../security.js';
import { validateHousingUnitCatalog } from '../units.js';
import type { HousingAttackSurfaceObservation, HousingUnitDefinition } from '../types.js';

const config = join(import.meta.dir, '..', '..', 'config');
const hierarchy = loadHousingTierPolicyCatalog(join(config, 'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config, 'housing-effect-policies.json'), hierarchy).policies[0]!;
const policy = loadHousingSecurityPolicy(join(config, 'housing-security-policy.json'), hierarchy, effects);
function unit(tierId: string): HousingUnitDefinition { return { housingUnitId: `test.${tierId}`,
    propertyId: `test.${tierId}`, tierId, enabled: true, capacity: 1, rentGpPerPeriod: 0,
    rentPeriodSimulationMinutes: 1440, bedSlots: [{ bedSlotId: `bed.${tierId}`, label: 'Bed' }] }; }
const units = validateHousingUnitCatalog({ schemaVersion: 1, units: [unit('shared-dormitory'), unit('rented-room'),
    unit('fortified-property')] }, hierarchy);
function observation(kind: HousingAttackSurfaceObservation['kind'], housingUnitId: string | null,
    storageSurfaceId: string | null = null, storageSlots = 0, propertyLockLevel: number | null = null):
    HousingAttackSurfaceObservation {
    return { observationId: 'surface-observation-1', kind, housingUnitId, storageSurfaceId, storageSlots,
        propertyLockLevel,
        sourceEvidenceDigest: 'a'.repeat(64) };
}
const trusted = () => true;

describe('configurable housing and storage attack surfaces', () => {
    test('matches the configured Property door lock for an active housing unit', () => {
        const properties = loadPropertyCatalog(join(config, 'properties.json'));
        const configuredUnits = loadHousingUnitCatalog(join(config, 'housing-units.json'), hierarchy,
            new Set(properties.properties.map(value => value.propertyId)));
        const active = configuredUnits.units.find(value => value.enabled)!;
        const property = properties.properties.find(value => value.propertyId === active.propertyId)!;
        const result = projectHousingSecurity(policy, hierarchy, effects, configuredUnits,
            observation('property-entry', active.housingUnitId, null, 0, property.security.lockLevel), trusted);
        expect(result).toMatchObject({ housingUnitId: active.housingUnitId,
            propertyId: active.propertyId, lockLevel: property.security.lockLevel });
    });
    test('separates street exposure, shared lockbox, private room and fortified Property', () => {
        const street = projectHousingSecurity(policy, hierarchy, effects, units,
            observation('sleeping-person', null), trusted);
        const shared = projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.shared-dormitory', 'shared-lockbox', 8), trusted);
        const room = projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.rented-room', 'private-room-chest', 28), trusted);
        const fortified = projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.fortified-property', 'fortified-vault', 100), trusted);
        expect(street).toMatchObject({ tierId: 'street', propertyId: null, lockLevel: 0,
            exposureBasisPoints: 10_000 });
        expect([shared.lockLevel, room.lockLevel, fortified.lockLevel]).toEqual([15, 30, 90]);
        expect(shared.propertyId).toBe('test.shared-dormitory');
        expect(fortified.traceBasisPoints).toBeGreaterThan(room.traceBasisPoints);
        expect(JSON.stringify(fortified)).not.toContain('actual-thief');
    });
    test('derives a later building from the unit catalog without changing code', () => {
        const extended = validateHousingUnitCatalog({ schemaVersion: 1,
            units: [...units.units, { ...unit('rented-room'), housingUnitId: 'new-town.new-house',
                propertyId: 'new-town.new-house' }] }, hierarchy);
        const projected = projectHousingSecurity(policy, hierarchy, effects, extended,
            observation('property-entry', 'new-town.new-house', null, 0, 35), trusted);
        expect(projected).toMatchObject({ propertyId: 'new-town.new-house', tierId: 'rented-room',
            lockLevel: 35 });
    });
    test('rejects untrusted observations, invented storage and unavailable housing', () => {
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.rented-room', 'private-room-chest', 28))).toThrow('not trusted');
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.shared-dormitory', 'fortified-vault', 8), trusted))
            .toThrow('not available');
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', 'test.rented-room', 'private-room-chest', 29), trusted))
            .toThrow('not available');
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('property-entry', 'missing-unit'), trusted)).toThrow('unavailable unit');
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('property-entry', 'test.rented-room', null, 0, 20), trusted))
            .toThrow('below the housing security policy minimum');
        expect(() => projectHousingSecurity(policy, hierarchy, effects, units,
            observation('storage', null, 'shared-lockbox', 1), trusted)).toThrow('Street exposure');
    });
    test('rejects weakened or mismatched policies and tampered unit catalogs', () => {
        expect(() => projectHousingSecurity({ ...policy, tiers: policy.tiers.map(tier => tier.tierId === 'street'
            ? { ...tier, entryLockLevel: 99 } : tier) }, hierarchy, effects, units,
        observation('sleeping-person', null), trusted)).toThrow();
        expect(() => validateHousingSecurityPolicy({ ...policy, digest: undefined,
            hierarchyPolicy: { ...policy.hierarchyPolicy, digest: 'b'.repeat(64) } }, hierarchy, effects))
            .toThrow();
        expect(() => projectHousingSecurity(policy, hierarchy, effects, { ...units, units: [] },
            observation('sleeping-person', null), trusted)).toThrow('digest mismatch');
    });
});
