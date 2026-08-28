import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { parsePropertyCatalog } from './Properties.js';
import { PropertyRuntime, type PropertyPlayerWalletTarget } from './PropertyRuntime.js';
import { PropertyStore } from './PropertyStore.js';

const temporaryDirectories: string[] = [];
const catalog = parsePropertyCatalog({
    schemaVersion: 1,
    properties: [{
        propertyId: 'varrock.test-workshop',
        displayName: 'Test workshop',
        description: 'A test property used for the engine inventory wallet.',
        type: 'workshop',
        location: { x: 3253, z: 3421, level: 0, region: 'Varrock East' },
        purchasePrice: 25000,
        entryPoints: [{ entryPointId: 'front-door', label: 'Front door', x: 3253, z: 3421, level: 0 }],
        revenue: { mode: 'none', amount: 0, intervalMinutes: 1440 },
        maintenance: { amount: 250, intervalMinutes: 1440 },
        permissions: {
            inspect: ['everyone'], purchase: ['eligible-player'], enter: ['owner', 'admin'], manage: ['owner', 'admin']
        }
    }]
});

function runtime(): { runtime: PropertyRuntime; store: PropertyStore; path: string } {
    const directory = mkdtempSync(join(tmpdir(), 'property-runtime-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'properties.sqlite');
    const store = new PropertyStore(catalog, path);
    return { runtime: new PropertyRuntime(catalog, store), store, path };
}

function player(coins: number): PropertyPlayerWalletTarget & { coins: number } {
    return {
        username: 'Ferry14',
        coins,
        coinBalance() { return this.coins; },
        removeCoins(amount) {
            const removed = Math.min(this.coins, amount);
            this.coins -= removed;
            return removed;
        },
        addCoins(amount) {
            this.coins += amount;
            return amount;
        }
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    }
});

describe('property runtime inventory wallet', () => {
    test('resolves only an exact configured property entry point', () => {
        const active = runtime();
        expect(active.runtime.findAtEntryPoint(3253, 3421, 0)?.propertyId).toBe('varrock.test-workshop');
        expect(active.runtime.findAtEntryPoint(3253, 3421, 1)).toBeNull();
        expect(active.runtime.findAtEntryPoint(3254, 3421, 0)).toBeNull();
        active.store.close();
    });

    test('deducts inventory coins and assigns the property to the normalized player identity', () => {
        const active = runtime();
        const target = player(40000);
        const result = active.runtime.purchase(target, 'varrock.test-workshop', 'runtime-purchase-0001', true);
        expect(result).toMatchObject({ coinsBefore: 40000, coinsAfter: 15000 });
        expect(result.property.state).toMatchObject({ status: 'owned', owner: { kind: 'player', id: 'ferry14' } });
        active.store.close();
    });

    test('is read-only while the mod is disabled', () => {
        const active = runtime();
        const target = player(40000);
        expect(() => active.runtime.purchase(target, 'varrock.test-workshop', 'runtime-purchase-0002', false))
            .toThrow('read-only');
        expect(target.coins).toBe(40000);
        expect(active.runtime.list()[0]?.state.status).toBe('available');
        active.store.close();
    });

    test('does not create ownership when inventory funds are insufficient', () => {
        const active = runtime();
        const target = player(1000);
        expect(() => active.runtime.purchase(target, 'varrock.test-workshop', 'runtime-purchase-0003', true))
            .toThrow('Insufficient inventory coins');
        expect(target.coins).toBe(1000);
        expect(active.runtime.list()[0]?.state.status).toBe('available');
        active.store.close();
    });

    test('fails closed instead of blindly re-debiting a pending inventory transaction', () => {
        const active = runtime();
        const target = player(40000);
        active.store.close();
        const database = new Database(active.path, { strict: true });
        database.run("UPDATE property_state SET status = 'locked' WHERE property_id = ?1", ['varrock.test-workshop']);
        database.run(`INSERT INTO property_purchase
            (transaction_id, property_id, buyer_kind, buyer_id, amount, status, created_at, updated_at, error)
            VALUES (?1, ?2, 'player', 'ferry14', 25000, 'pending', ?3, ?3, NULL)`,
        ['runtime-purchase-0004', 'varrock.test-workshop', '2026-08-28T12:00:00.000Z']);
        database.close(true);
        const recoveredStore = new PropertyStore(catalog, active.path);
        const recoveredRuntime = new PropertyRuntime(catalog, recoveredStore);
        expect(() => recoveredRuntime.purchase(target, 'varrock.test-workshop', 'runtime-purchase-0004', true))
            .toThrow('requires administrator reconciliation');
        expect(target.coins).toBe(40000);
        recoveredStore.close();
    });
});
