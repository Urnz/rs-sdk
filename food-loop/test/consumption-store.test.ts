import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeFoodLoop, FoodConsumptionStore, loadFoodLoopCatalog } from '../index.js';
import { createInitialNeedsState, loadNeedsPolicyCatalog, needsStateDigest } from '../../needs/index.js';
import type { FoodInventoryReceipt } from '../types.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function path(): string { const directory = mkdtempSync(join(tmpdir(), 'food-consumption-'));
    directories.push(directory); return join(directory, 'ledger.sqlite'); }
const root = join(import.meta.dir, '..', '..', 'config');
const catalog = () => loadFoodLoopCatalog(join(root, 'food-loops.json'));
const policy = () => loadNeedsPolicyCatalog(join(root, 'needs-policies.json')).policies[0]!;
function receipt(kind: FoodInventoryReceipt['kind'], ordinal: number, inputs: FoodInventoryReceipt['inputs'],
    outputs: FoodInventoryReceipt['outputs'], skill: FoodInventoryReceipt['skill']): FoodInventoryReceipt {
    return { receiptId: `${kind}-${ordinal}`, actorAgentId: 'ada', kind,
        occurredAtSimulationTime: `2030-01-01T0${ordinal}:00:00.000Z`, skill, inputs, outputs,
        sourceDigest: String(ordinal).repeat(64) };
}
function closure(closureId = 'closure-1') { const needsPolicy = policy();
    const initial = createInitialNeedsState(needsPolicy, { characterAgentId: 'ada', clockId: 'world',
        observedAtSimulationTime: '2030-01-01T00:00:00.000Z' });
    const definition = { ...initial, values: initial.values.map(item => item.needId === 'hunger'
        ? { ...item, value: 4000 } : item) }; delete (definition as Partial<typeof initial>).digest;
    const state = { ...definition, digest: needsStateDigest(definition) };
    return closeFoodLoop({ closureId, foodChainId: 'lobster', state,
        gathered: receipt('gathered', 1, [], [{ itemId: 377, quantity: 1 }], 'Fishing'),
        processed: receipt('processed', 2, [{ itemId: 377, quantity: 1 }],
            [{ itemId: 379, quantity: 1 }], 'Cooking'),
        consumed: receipt('consumed', 3, [{ itemId: 379, quantity: 1 }], [], null) }, catalog(), needsPolicy); }

describe('food consumption economic ledger', () => {
    test('persists one idempotent final-use event and measurable summary', () => {
        const store = new FoodConsumptionStore(path(), catalog()), closed = closure();
        const first = store.record(closed);
        expect(first).toMatchObject({ eventId: 'closure-1:consumption', kind: 'food-consumption',
            actorAgentId: 'ada', itemId: 379, itemName: 'Lobster', quantity: 1, hungerRelief: 1800 });
        expect(store.record(closed)).toEqual(first);
        expect(store.summary()).toEqual({ events: 1, foodUnitsConsumed: 1, hungerRelief: 1800 });
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
    });

    test('prevents any trusted inventory receipt from funding a second closure', () => {
        const store = new FoodConsumptionStore(path(), catalog());
        store.record(closure());
        expect(() => store.record(closure('closure-2'))).toThrow();
        expect(store.summary().events).toBe(1);
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
    });

    test('rejects a changed closure replay and tampered closure digest', () => {
        const store = new FoodConsumptionStore(path(), catalog()), closed = closure();
        store.record(closed);
        expect(() => store.record({ ...closed, hungerRelief: 1 })).toThrow('closure digest mismatch');
        expect(() => store.record({ ...closed, digest: '0'.repeat(64) })).toThrow('closure digest mismatch');
        store.close();
    });

    test('survives restart, filters actors and detects audit alteration', () => {
        const databasePath = path(); let store = new FoodConsumptionStore(databasePath, catalog());
        store.record(closure()); store.close();
        store = new FoodConsumptionStore(databasePath, catalog());
        expect(store.list('ada')).toHaveLength(1);
        expect(store.list('bob')).toHaveLength(0);
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
        const database = new Database(databasePath, { strict: true });
        database.run("UPDATE food_consumption_audit SET payload_json='{}' WHERE sequence=1");
        database.close(true);
        store = new FoodConsumptionStore(databasePath, catalog());
        expect(store.verifyAuditChain()).toBeFalse();
        store.close();
    });
});
