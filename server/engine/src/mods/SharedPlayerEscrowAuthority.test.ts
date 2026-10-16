import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { openSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() {
    const root = mkdtempSync(join(tmpdir(), 'shared-escrow-authority-')); roots.push(root);
    return { legacy: join(root, 'legacy.sqlite'), target: join(root, 'market.sqlite') };
}

describe('restart-stable shared player escrow authority', () => {
    test('fresh world marks one authority and reopens its committed checkpoint and held escrow', () => {
        const { legacy, target } = paths();
        const market = new MarketStore(target);
        const store = openSharedPlayerEscrowAuthority(legacy, target, () => market,
            '2030-01-01T10:00:00.000Z');
        let coins = 100;
        const wallet = { count: () => coins, remove: (_id: number, amount: number) => { coins -= amount; return amount; },
            add: (_id: number, amount: number) => { coins += amount; return amount; } };
        const id = '11111111-1111-4111-8111-111111111111';
        store.mutateWithCheckpoint({ operation: 'hold', escrowId: id, username: 'payer',
            assets: { gp: 25, items: [] } }, wallet,
        { owner: 'payer', save: () => new Uint8Array([coins]), rollback: () => { coins = 100; } });
        store.close(); market.db.close(true);
        const reopenedMarket = new MarketStore(target);
        const reopened = openSharedPlayerEscrowAuthority(legacy, target, () => reopenedMarket);
        try {
            expect(reopened.get(id)?.status).toBe('held');
            expect([...reopenedMarket.saved('payer')!]).toEqual([75]);
            expect(existsSync(legacy)).toBeFalse();
        } finally { reopened.close(); reopenedMarket.db.close(true); }
    });

    test('legacy records block shared startup before a target file is created', () => {
        const { legacy, target } = paths();
        const source = new PlayerInventoryEscrowStore(legacy);
        let coins = 100;
        source.hold('22222222-2222-4222-8222-222222222222', 'payer', { gp: 25, items: [] }, {
            count: () => coins, remove: (_id, amount) => { coins -= amount; return amount; },
            add: (_id, amount) => { coins += amount; return amount; }
        });
        source.consume('22222222-2222-4222-8222-222222222222', 'payer'); source.close();
        expect(() => openSharedPlayerEscrowAuthority(legacy, target, () => new MarketStore(target)))
            .toThrow('requires reconciliation');
        expect(existsSync(target)).toBeFalse();
    });

    test('unmarked target rows and corrupted authority marker fail closed', () => {
        const { legacy, target } = paths();
        const market = new MarketStore(target); market.db.close(true);
        const unmarked = new PlayerInventoryEscrowStore(target);
        let coins = 100;
        unmarked.hold('33333333-3333-4333-8333-333333333333', 'payer', { gp: 25, items: [] }, {
            count: () => coins, remove: (_id, amount) => { coins -= amount; return amount; },
            add: (_id, amount) => { coins += amount; return amount; }
        });
        unmarked.close();
        expect(() => openSharedPlayerEscrowAuthority(legacy, target, () => new MarketStore(target)))
            .toThrow('Unmarked');
        const other = paths(), cleanMarket = new MarketStore(other.target);
        openSharedPlayerEscrowAuthority(other.legacy, other.target, () => cleanMarket).close();
        cleanMarket.db.close(true);
        const raw = new Database(other.target);
        raw.run("UPDATE player_escrow_authority SET legacy_baseline_count=1"); raw.close();
        expect(() => openSharedPlayerEscrowAuthority(other.legacy, other.target,
            () => new MarketStore(other.target))).toThrow('marker is invalid');
    });
});
