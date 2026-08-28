import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePropertyCatalog } from './Properties.js';
import { PropertyStore, type PropertyWallet } from './PropertyStore.js';
import type { EconomicActorRef } from './EconomicActors.js';

const temporaryDirectories: string[] = [];
const property = {
    propertyId: 'varrock.test-workshop',
    displayName: 'Test workshop',
    description: 'A test property used to validate purchase transactions.',
    type: 'workshop',
    location: { x: 3253, z: 3421, level: 0, region: 'Varrock East' },
    purchasePrice: 25000,
    entryPoints: [{ entryPointId: 'front-door', label: 'Front door', x: 3253, z: 3421, level: 0 }],
    revenue: { mode: 'none', amount: 0, intervalMinutes: 1440 },
    maintenance: { amount: 250, intervalMinutes: 1440 },
    permissions: {
        inspect: ['everyone'], purchase: ['eligible-player'], enter: ['owner', 'admin'], manage: ['owner', 'admin']
    }
};
const catalog = parsePropertyCatalog({ schemaVersion: 1, properties: [property] });
const buyer: EconomicActorRef = { kind: 'player', id: 'ferry14' };

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'property-store-'));
    temporaryDirectories.push(directory);
    return join(directory, 'properties.sqlite');
}

function wallet(balance = 100000): PropertyWallet & { balance: number; debits: number; refunds: number } {
    const debited = new Set<string>();
    const refunded = new Set<string>();
    return {
        balance,
        debits: 0,
        refunds: 0,
        debit(_owner, amount, transactionId) {
            if (debited.has(transactionId)) return;
            if (this.balance < amount) throw new Error('insufficient funds');
            this.balance -= amount;
            this.debits++;
            debited.add(transactionId);
        },
        refund(_owner, amount, transactionId) {
            if (refunded.has(transactionId)) return;
            this.balance += amount;
            this.refunds++;
            refunded.add(transactionId);
        }
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    }
});

describe('property purchase store', () => {
    test('persists an atomic ownership claim and reloads it after restart', () => {
        const path = databasePath();
        const funds = wallet();
        const store = new PropertyStore(catalog, path, '2026-08-28T12:00:00.000Z');
        const purchase = store.purchase({
            transactionId: 'purchase-0001', propertyId: property.propertyId, buyer
        }, funds, '2026-08-28T12:01:00.000Z');
        expect(purchase).toMatchObject({ status: 'committed', amount: 25000, buyer });
        expect(funds.balance).toBe(75000);
        expect(store.listProperties()[0]).toMatchObject({ status: 'owned', owner: buyer });
        store.close();

        const restarted = new PropertyStore(catalog, path, '2026-08-28T12:02:00.000Z');
        expect(restarted.listProperties()[0]).toMatchObject({ status: 'owned', owner: buyer });
        expect(restarted.getPurchase('purchase-0001')).toMatchObject({ status: 'committed' });
        restarted.close();
    });

    test('returns the committed result idempotently without a second debit', () => {
        const store = new PropertyStore(catalog, databasePath());
        const funds = wallet();
        const request = { transactionId: 'purchase-0002', propertyId: property.propertyId, buyer };
        expect(store.purchase(request, funds).status).toBe('committed');
        expect(store.purchase(request, funds).status).toBe('committed');
        expect(funds.debits).toBe(1);
        expect(funds.balance).toBe(75000);
        store.close();
    });

    test('allows only one buyer to win a contested property', () => {
        const store = new PropertyStore(catalog, databasePath());
        const firstFunds = wallet();
        const secondFunds = wallet();
        store.purchase({ transactionId: 'purchase-0003', propertyId: property.propertyId, buyer }, firstFunds);
        expect(() => store.purchase({
            transactionId: 'purchase-0004',
            propertyId: property.propertyId,
            buyer: { kind: 'player', id: 'other-agent' }
        }, secondFunds)).toThrow('not available');
        expect(firstFunds.balance).toBe(75000);
        expect(secondFunds.balance).toBe(100000);
        store.close();
    });

    test('releases the reservation when the buyer has insufficient funds', () => {
        const store = new PropertyStore(catalog, databasePath());
        const poorWallet = wallet(100);
        expect(() => store.purchase({
            transactionId: 'purchase-0005', propertyId: property.propertyId, buyer
        }, poorWallet)).toThrow('insufficient funds');
        expect(store.getPurchase('purchase-0005')).toMatchObject({ status: 'rejected', error: 'insufficient funds' });
        expect(store.listProperties()[0]).toMatchObject({ status: 'available', owner: null });
        store.close();
    });

    test('does not allow a transaction id to be reused for another actor', () => {
        const store = new PropertyStore(catalog, databasePath());
        const funds = wallet();
        store.purchase({ transactionId: 'purchase-0006', propertyId: property.propertyId, buyer }, funds);
        expect(() => store.purchase({
            transactionId: 'purchase-0006', propertyId: property.propertyId, buyer: { kind: 'business', id: 'smiths-guild' }
        }, funds)).toThrow('already used');
        store.close();
    });

    test('refuses to orphan persisted property state when a catalog entry disappears', () => {
        const path = databasePath();
        const store = new PropertyStore(catalog, path);
        store.close();
        const replacement = parsePropertyCatalog({
            schemaVersion: 1,
            properties: [{ ...property, propertyId: 'falador.replacement-house', type: 'house' }]
        });
        expect(() => new PropertyStore(replacement, path)).toThrow('cannot remove persisted property');
    });
});
