import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HousingTenancyStore, housingUnitCatalogDigest, loadHousingTierPolicyCatalog, loadHousingUnitCatalog,
    validateHousingUnitCatalog } from '../index.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function path(): string { const directory = mkdtempSync(join(tmpdir(), 'housing-tenancy-'));
    directories.push(directory); return join(directory, 'tenancy.sqlite'); }
function catalog() {
    const hierarchy = loadHousingTierPolicyCatalog(join(import.meta.dir, '..', '..', 'config',
        'housing-tier-policies.json')).policies[0]!;
    return validateHousingUnitCatalog({ schemaVersion: 1, units: [{ housingUnitId: 'varrock.dorm-1',
        propertyId: 'varrock.east-workshop', tierId: 'shared-dormitory', enabled: true, capacity: 2,
        rentGpPerPeriod: 100, rentPeriodSimulationMinutes: 60,
        bedSlots: [{ bedSlotId: 'varrock.dorm-1.bed-1', label: 'Bed 1' },
            { bedSlotId: 'varrock.dorm-1.bed-2', label: 'Bed 2' }] }] }, hierarchy);
}
function create(store: HousingTenancyStore, tenancyId = 'tenancy-1', bedSlotId = 'varrock.dorm-1.bed-1',
    tenantAgentId = 'ada') {
    return store.create({ tenancyId, housingUnitId: 'varrock.dorm-1', bedSlotId, tenantAgentId,
        startsAtSimulationTime: '2030-01-01T00:00:00.000Z', periodCount: 3 });
}

describe('housing units and tenancy ledger', () => {
    test('loads user-configured units only for existing Properties', () => {
        const hierarchy = loadHousingTierPolicyCatalog(join(import.meta.dir, '..', '..', 'config',
            'housing-tier-policies.json')).policies[0]!;
        const properties = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'config',
            'properties.json'), 'utf8')) as { properties: Array<{ propertyId: string }> };
        const known = new Set(properties.properties.map(property => property.propertyId));
        const configured = loadHousingUnitCatalog(join(import.meta.dir, '..', '..', 'config',
            'housing-units.json'), hierarchy, known);
        expect(configured.units[0]).toMatchObject({ propertyId: 'falador.south-house', enabled: true, capacity: 2 });
        expect(() => validateHousingUnitCatalog({ schemaVersion: 1, units: [{ ...configured.units[0],
            propertyId: 'lumbridge.not-a-property' }] }, hierarchy, known)).toThrow('unknown Property');
    });

    test('validates capacity against unique bed slots and exact hierarchy tiers', () => {
        const value = catalog();
        expect(value.units[0]).toMatchObject({ propertyId: 'varrock.east-workshop', capacity: 2,
            rentGpPerPeriod: 100, rentPeriodSimulationMinutes: 60 });
        expect(value.digest).toMatch(/^[0-9a-f]{64}$/);
        const hierarchy = loadHousingTierPolicyCatalog(join(import.meta.dir, '..', '..', 'config',
            'housing-tier-policies.json')).policies[0]!;
        expect(() => validateHousingUnitCatalog({ schemaVersion: 1, units: [{ ...value.units[0], capacity: 3 }] },
            hierarchy)).toThrow('capacity must equal');
    });

    test('reserves one bed atomically and issues an expiring access entitlement', () => {
        const store = new HousingTenancyStore(path(), catalog());
        const tenancy = create(store);
        expect(tenancy).toMatchObject({ status: 'active', arrearsGp: 0,
            endsAtSimulationTime: '2030-01-01T03:00:00.000Z',
            nextRentDueAtSimulationTime: '2030-01-01T01:00:00.000Z' });
        expect(store.bedEntitlement('tenancy-1', '2030-01-01T00:30:00.000Z')).toMatchObject({
            kind: 'bed-entitlement', sleepPlaceId: 'varrock.dorm-1.bed-1',
            validUntilSimulationTime: '2030-01-01T01:00:00.000Z' });
        expect(() => create(store, 'tenancy-2', 'varrock.dorm-1.bed-1', 'bob')).toThrow('already has');
        expect(() => create(store, 'tenancy-3', 'varrock.dorm-1.bed-2', 'ada')).toThrow('already has');
        store.close();
    });

    test('assesses arrears, suspends access and applies an idempotent audited payment', () => {
        const databasePath = path(), store = new HousingTenancyStore(databasePath, catalog());
        create(store);
        const overdue = store.assessRent('tenancy-1', '2030-01-01T01:30:00.000Z');
        expect(overdue).toMatchObject({ status: 'arrears', arrearsGp: 100,
            nextRentDueAtSimulationTime: '2030-01-01T02:00:00.000Z' });
        expect(store.bedEntitlement('tenancy-1', '2030-01-01T01:30:00.000Z')).toBeNull();
        const evidence = { paymentId: 'rent-payment-1', amountGp: 100, sourceDigest: 'a'.repeat(64),
            occurredAtSimulationTime: '2030-01-01T01:31:00.000Z' };
        const paid = store.recordPayment('tenancy-1', evidence);
        expect(paid).toMatchObject({ status: 'active', arrearsGp: 0 });
        expect(store.recordPayment('tenancy-1', evidence)).toEqual(paid);
        expect(store.verifyAuditChain()).toMatchObject({ valid: true, entries: 3 });
        store.close();
        const reopened = new HousingTenancyStore(databasePath, catalog());
        expect(reopened.get('tenancy-1')).toEqual(paid);
        expect(reopened.verifyAuditChain().valid).toBeTrue();
        reopened.close();
    });

    test('expires at the fixed duration and rejects overpayment or changed replay', () => {
        const store = new HousingTenancyStore(path(), catalog());
        create(store);
        const expired = store.assessRent('tenancy-1', '2030-01-01T03:00:00.000Z');
        expect(expired).toMatchObject({ status: 'expired', arrearsGp: 300 });
        expect(store.bedEntitlement('tenancy-1', '2030-01-01T03:00:00.000Z')).toBeNull();
        expect(() => store.recordPayment('tenancy-1', { paymentId: 'too-much', amountGp: 301,
            sourceDigest: 'b'.repeat(64), occurredAtSimulationTime: '2030-01-01T03:01:00.000Z' }))
            .toThrow('exceeds arrears');
        const payment = { paymentId: 'partial', amountGp: 100, sourceDigest: 'c'.repeat(64),
            occurredAtSimulationTime: '2030-01-01T03:01:00.000Z' };
        store.recordPayment('tenancy-1', payment);
        expect(() => store.recordPayment('tenancy-1', { ...payment, amountGp: 99 })).toThrow('reused');
        store.close();
    });

    test('snapshots tenancy terms across later unit catalog changes', () => {
        const databasePath = path(), original = catalog();
        const store = new HousingTenancyStore(databasePath, original);
        create(store);
        store.close();
        expect(() => new HousingTenancyStore(databasePath, { ...original, digest: '0'.repeat(64) }))
            .toThrow('catalog digest does not match');
        const changed = { ...original, units: original.units.map(unit => ({ ...unit, rentGpPerPeriod: 101 })) };
        changed.digest = housingUnitCatalogDigest({ schemaVersion: changed.schemaVersion, units: changed.units });
        const reopened = new HousingTenancyStore(databasePath, changed);
        expect(reopened.get('tenancy-1')?.rentGpPerPeriod).toBe(100);
        reopened.close();
    });

    test('lets configuration disable a unit for new tenancy without invalidating history', () => {
        const original = catalog(), databasePath = path();
        const store = new HousingTenancyStore(databasePath, original);
        create(store);
        store.close();
        const disabled = { ...original, units: original.units.map(unit => ({ ...unit, enabled: false })) };
        disabled.digest = housingUnitCatalogDigest({ schemaVersion: disabled.schemaVersion, units: disabled.units });
        const reopened = new HousingTenancyStore(databasePath, disabled);
        expect(reopened.get('tenancy-1')?.status).toBe('active');
        expect(() => create(reopened, 'tenancy-2', 'varrock.dorm-1.bed-2', 'bob')).toThrow('disabled');
        reopened.close();
    });
});
