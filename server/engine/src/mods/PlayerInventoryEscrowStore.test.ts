import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerInventoryEscrowStore, type PlayerInventoryEscrowWallet } from './PlayerInventoryEscrowStore.js';

const directories: string[] = [];

function memoryWallet(entries: Record<number, number>) {
    const inventory = new Map(Object.entries(entries).map(([id, count]) => [Number(id), count]));
    const wallet: PlayerInventoryEscrowWallet = {
        count: id => inventory.get(id) ?? 0,
        remove: (id, count) => { const actual = Math.min(count, inventory.get(id) ?? 0);
            inventory.set(id, (inventory.get(id) ?? 0) - actual); return actual; },
        add: (id, count) => { inventory.set(id, (inventory.get(id) ?? 0) + count); return count; }
    };
    return { wallet, inventory };
}

function fixture(entries: Record<number, number>) {
    const directory = mkdtempSync(join(tmpdir(), 'rs-player-escrow-'));
    directories.push(directory);
    const { wallet, inventory } = memoryWallet(entries);
    const path = join(directory, 'escrow.sqlite');
    return { store: new PlayerInventoryEscrowStore(path), path, wallet, inventory };
}

afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('player inventory escrow', () => {
    test('holds GP and canonical item totals exactly once, then releases them exactly once', () => {
        const { store, path, wallet, inventory } = fixture({ 995: 1_000, 436: 10 });
        const id = '11111111-1111-4111-8111-111111111111';
        const held = store.hold(id, 'Ferrye14', { gp: 400,
            items: [{ id: 436, count: 2 }, { id: 436, count: 3 }] }, wallet);
        expect(held).toMatchObject({ username: 'ferrye14', status: 'held',
            assets: { gp: 400, items: [{ id: 436, count: 5 }] } });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 600, copper: 5 });
        expect(store.hold(id, 'ferrye14', { gp: 400, items: [{ id: 436, count: 5 }] }, wallet)).toEqual(held);
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 600, copper: 5 });
        expect(() => store.hold(id, 'ferrye14', { gp: 401, items: [{ id: 436, count: 5 }] }, wallet))
            .toThrow('different assets');
        expect(store.list()).toEqual([held]);
        store.close();
        const reopened = new PlayerInventoryEscrowStore(path);
        expect(reopened.get(id)).toEqual(held);
        expect(reopened.release(id, 'ferrye14', wallet)).toMatchObject({ status: 'released' });
        expect(reopened.release(id, 'ferrye14', wallet)).toMatchObject({ status: 'released' });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 1_000, copper: 10 });
        reopened.close();
    });

    test('fails before mutation when inventory funding is insufficient', () => {
        const { store, wallet, inventory } = fixture({ 995: 100, 436: 1 });
        const id = '22222222-2222-4222-8222-222222222222';
        expect(() => store.hold(id, 'worker', { gp: 101, items: [] }, wallet)).toThrow('Insufficient');
        expect(store.get(id)).toBeNull();
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 100, copper: 1 });
        store.close();
    });

    test('compensates a partial hold and leaves an auditable terminal rejection', () => {
        const { store, wallet, inventory } = fixture({ 995: 500, 436: 5 });
        const originalRemove = wallet.remove;
        wallet.remove = (id, count) => originalRemove(id, id === 436 ? count - 1 : count);
        const id = '33333333-3333-4333-8333-333333333333';
        expect(() => store.hold(id, 'worker', { gp: 200, items: [{ id: 436, count: 3 }] }, wallet))
            .toThrow('incomplete');
        expect(store.get(id)).toMatchObject({ status: 'rejected', error: expect.stringContaining('item 436') });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 500, copper: 5 });
        store.close();
    });

    test('keeps a held escrow retryable when release credit is compensated', () => {
        const { store, wallet, inventory } = fixture({ 995: 500, 436: 5 });
        const id = '44444444-4444-4444-8444-444444444444';
        store.hold(id, 'worker', { gp: 200, items: [{ id: 436, count: 3 }] }, wallet);
        const originalAdd = wallet.add;
        wallet.add = (itemId, count) => originalAdd(itemId, itemId === 436 ? count - 1 : count);
        expect(() => store.release(id, 'worker', wallet)).toThrow('incomplete');
        expect(store.get(id)).toMatchObject({ status: 'held' });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 300, copper: 2 });
        wallet.add = originalAdd;
        expect(store.release(id, 'worker', wallet)).toMatchObject({ status: 'released' });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 500, copper: 5 });
        store.close();
    });

    test('fails closed in reconcile when a partial hold cannot be compensated', () => {
        const { store, wallet, inventory } = fixture({ 995: 500, 436: 5 });
        const originalRemove = wallet.remove;
        wallet.remove = (id, count) => originalRemove(id, id === 436 ? count - 1 : count);
        wallet.add = () => 0;
        const id = '55555555-5555-4555-8555-555555555555';
        expect(() => store.hold(id, 'worker', { gp: 200, items: [{ id: 436, count: 3 }] }, wallet))
            .toThrow('incomplete');
        expect(store.get(id)).toMatchObject({ status: 'reconcile' });
        expect({ coins: inventory.get(995), copper: inventory.get(436) }).toEqual({ coins: 300, copper: 3 });
        expect(() => store.hold(id, 'worker', { gp: 200, items: [{ id: 436, count: 3 }] }, wallet))
            .toThrow('manual reconciliation');
        store.close();
    });

    test('commits held assets to one exact payee once and survives reopening', () => {
        const { store, path, wallet: payer } = fixture({ 995: 1_000, 436: 10 });
        const { wallet: payee, inventory: payeeInventory } = memoryWallet({ 995: 50, 436: 1 });
        const id = '66666666-6666-4666-8666-666666666666';
        store.hold(id, 'payer', { gp: 400, items: [{ id: 436, count: 5 }] }, payer);
        const committed = store.commit(id, 'payer', 'payee', payee);
        expect(committed).toMatchObject({ status: 'committed', payeeUsername: 'payee',
            committedAt: expect.any(String) });
        expect({ coins: payeeInventory.get(995), copper: payeeInventory.get(436) })
            .toEqual({ coins: 450, copper: 6 });
        expect(store.commit(id, 'payer', 'payee', payee)).toEqual(committed);
        expect(() => store.commit(id, 'payer', 'other', payee)).toThrow('another payee');
        expect(() => store.release(id, 'payer', payer)).toThrow('Only held');
        store.close();
        const reopened = new PlayerInventoryEscrowStore(path);
        expect(reopened.get(id)).toEqual(committed);
        reopened.close();
    });

    test('compensates a partial payee credit and keeps the held settlement retryable', () => {
        const { store, wallet: payer } = fixture({ 995: 1_000, 436: 10 });
        const { wallet: payee, inventory: payeeInventory } = memoryWallet({ 995: 50, 436: 1 });
        const id = '77777777-7777-4777-8777-777777777777';
        store.hold(id, 'payer', { gp: 400, items: [{ id: 436, count: 5 }] }, payer);
        const originalAdd = payee.add;
        payee.add = (itemId, count) => originalAdd(itemId, itemId === 436 ? count - 1 : count);
        expect(() => store.commit(id, 'payer', 'payee', payee)).toThrow('incomplete');
        expect(store.get(id)).toMatchObject({ status: 'held', payeeUsername: null });
        expect({ coins: payeeInventory.get(995), copper: payeeInventory.get(436) })
            .toEqual({ coins: 50, copper: 1 });
        payee.add = originalAdd;
        expect(store.commit(id, 'payer', 'payee', payee)).toMatchObject({ status: 'committed' });
        expect({ coins: payeeInventory.get(995), copper: payeeInventory.get(436) })
            .toEqual({ coins: 450, copper: 6 });
        store.close();
    });
});
