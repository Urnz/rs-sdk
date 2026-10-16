import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { executeSharedEscrowWorldCommand } from './PlayerEscrowWorldAdapter.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'escrow-world-adapter-')); roots.push(root);
    const market = new MarketStore(join(root, 'market.sqlite'));
    const store = new PlayerInventoryEscrowStore(market);
    const inventory = {
        items: [{ id: 995, count: 100 }] as Array<{ id: number; count: number } | null>,
        set(slot: number, item: { id: number; count: number } | null) { this.items[slot] = item; }
    };
    const wallet = {
        count: () => inventory.items[0]?.count ?? 0,
        remove: (_id: number, amount: number) => { inventory.items[0]!.count -= amount; return amount; },
        add: (_id: number, amount: number) => { inventory.items[0]!.count += amount; return amount; }
    };
    return { market, store, inventory, wallet, close: () => { store.close(); market.db.close(true); } };
}

describe('world-tick shared escrow adapter', () => {
    test('checkpoints the actual post-debit inventory in the escrow transaction', () => {
        const source = fixture();
        try {
            const result = executeSharedEscrowWorldCommand(source.store, {
                operation: 'hold', escrowId: '11111111-1111-4111-8111-111111111111',
                username: 'payer', assets: { gp: 25, items: [] }
            }, { username: 'payer', wallet: source.wallet, inventory: source.inventory,
                save: () => new Uint8Array([source.inventory.items[0]?.count ?? 0]),
                checkpointAll: bytes => source.market.checkpoint('payer', bytes, true) });
            expect(result.escrow.status).toBe('held');
            expect([...result.save]).toEqual([75]);
            expect([...source.market.saved('payer')!]).toEqual([75]);
            expect(source.inventory.items[0]?.count).toBe(75);
        } finally { source.close(); }
    });

    test('a failed world checkpoint restores slot state and leaves no escrow debit', () => {
        const source = fixture();
        try {
            expect(() => executeSharedEscrowWorldCommand(source.store, {
                operation: 'hold', escrowId: '22222222-2222-4222-8222-222222222222',
                username: 'payer', assets: { gp: 25, items: [] }
            }, { username: 'payer', wallet: source.wallet, inventory: source.inventory,
                save: () => new Uint8Array([source.inventory.items[0]?.count ?? 0]),
                checkpointAll: () => { throw new Error('checkpoint failed'); } }))
                .toThrow('checkpoint failed');
            expect(source.inventory.items[0]).toEqual({ id: 995, count: 100 });
            expect(source.store.get('22222222-2222-4222-8222-222222222222')).toBeNull();
            expect(source.market.saved('payer')).toBeUndefined();
        } finally { source.close(); }
    });
});
