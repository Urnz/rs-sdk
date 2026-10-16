import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { assessPlayerEscrowMigration } from './PlayerEscrowMigrationPreflight.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() {
    const root = mkdtempSync(join(tmpdir(), 'escrow-preflight-')); roots.push(root);
    return { legacy: join(root, 'legacy.sqlite'), target: join(root, 'market.sqlite') };
}
function held(path: string): PlayerInventoryEscrowStore {
    const store = new PlayerInventoryEscrowStore(path);
    let coins = 100;
    store.hold('11111111-1111-4111-8111-111111111111', 'payer', { gp: 25, items: [] }, {
        count: () => coins, remove: (_id, amount) => { coins -= amount; return amount; },
        add: (_id, amount) => { coins += amount; return amount; }
    });
    return store;
}

describe('read-only escrow migration preflight', () => {
    test('fresh paths can begin a shared authority without creating either database', () => {
        const { legacy, target } = paths();
        expect(assessPlayerEscrowMigration(legacy, target)).toEqual({ legacyRecords: 0,
            legacyUnresolvedRecords: 0, targetRecords: 0, targetHasPlayerCheckpoints: false,
            canBeginFreshSharedEscrow: true, blockers: [] });
        expect(existsSync(legacy)).toBeFalse();
        expect(existsSync(target)).toBeFalse();
    });

    test('held legacy funds block automatic switching even when the target has checkpoints', () => {
        const { legacy, target } = paths();
        const source = held(legacy); source.close();
        const market = new MarketStore(target); market.db.close(true);
        const result = assessPlayerEscrowMigration(legacy, target);
        expect(result).toEqual({ legacyRecords: 1, legacyUnresolvedRecords: 1,
            targetRecords: 0, targetHasPlayerCheckpoints: true, canBeginFreshSharedEscrow: false,
            blockers: ['legacy-unresolved-escrow', 'legacy-records-require-reconciliation'] });
        const reopened = new PlayerInventoryEscrowStore(legacy);
        try { expect(reopened.get('11111111-1111-4111-8111-111111111111')?.status).toBe('held'); }
        finally { reopened.close(); }
    });

    test('terminal legacy rows and target escrow rows also require explicit reconciliation', () => {
        const { legacy, target } = paths();
        const source = held(legacy);
        source.consume('11111111-1111-4111-8111-111111111111', 'payer'); source.close();
        const market = new MarketStore(target); market.db.close(true);
        const shared = new PlayerInventoryEscrowStore(target);
        let coins = 100;
        shared.hold('22222222-2222-4222-8222-222222222222', 'payee', { gp: 10, items: [] }, {
            count: () => coins, remove: (_id, amount) => { coins -= amount; return amount; },
            add: (_id, amount) => { coins += amount; return amount; }
        });
        shared.close();
        const result = assessPlayerEscrowMigration(legacy, target);
        expect(result).toMatchObject({ legacyRecords: 1, legacyUnresolvedRecords: 0,
            targetRecords: 1, canBeginFreshSharedEscrow: false });
        expect(result.blockers).toEqual(['legacy-records-require-reconciliation',
            'target-records-require-reconciliation']);
    });

    test('rejects a target without the player checkpoint table and identical paths', () => {
        const { legacy, target } = paths();
        const raw = new Database(target); raw.run('CREATE TABLE unrelated(id INTEGER)'); raw.close();
        expect(assessPlayerEscrowMigration(legacy, target).blockers)
            .toEqual(['target-is-not-player-checkpoint-store']);
        expect(() => assessPlayerEscrowMigration(target, target)).toThrow('distinct');
    });

    test('an older escrow table without settlement columns is unresolved rather than silently migrated', () => {
        const { legacy, target } = paths();
        const raw = new Database(legacy);
        raw.run('CREATE TABLE player_inventory_escrow(escrow_id TEXT PRIMARY KEY, status TEXT NOT NULL)');
        raw.run("INSERT INTO player_inventory_escrow VALUES('old-1','held')"); raw.close();
        expect(assessPlayerEscrowMigration(legacy, target)).toMatchObject({
            legacyRecords: 1, legacyUnresolvedRecords: 1, canBeginFreshSharedEscrow: false });
    });
});
