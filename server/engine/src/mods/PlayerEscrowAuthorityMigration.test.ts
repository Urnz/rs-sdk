import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { migrateLegacyPlayerEscrowAuthority } from './PlayerEscrowAuthorityMigration.js';
import { openSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(terminal = true) {
    const root = mkdtempSync(join(tmpdir(), 'escrow-authority-migration-')); roots.push(root);
    const legacy = join(root, 'legacy.sqlite'), target = join(root, 'checkpoint.sqlite');
    const source = new PlayerInventoryEscrowStore(legacy); let coins = 100;
    source.hold('11111111-1111-4111-8111-111111111111', 'payer', { gp: 25, items: [] }, {
        count: () => coins, remove: (_id, amount) => { coins -= amount; return amount; },
        add: (_id, amount) => { coins += amount; return amount; } });
    if (terminal) source.consume('11111111-1111-4111-8111-111111111111', 'payer');
    source.close();
    const market = new MarketStore(target); market.db.close(true);
    return { root, legacy, target, backup: join(root, 'backup') };
}

describe('legacy escrow authority migration', () => {
    test('backs up and archives terminal evidence without fabricating live escrow history', () => {
        const f = fixture(), before = readFileSync(f.legacy);
        const result = migrateLegacyPlayerEscrowAuthority(f.legacy, f.target, f.backup,
            '2030-01-01T00:00:00.000Z');
        expect(result.legacyRecords).toBe(1);
        expect(existsSync(result.legacyBackup)).toBeTrue(); expect(existsSync(result.targetBackup)).toBeTrue();
        expect(existsSync(result.manifestPath)).toBeTrue(); expect(readFileSync(f.legacy)).toEqual(before);
        const raw = new Database(f.target, { readonly: true });
        expect((raw.query('SELECT COUNT(*) AS n FROM player_escrow_legacy_archive').get() as { n: number }).n).toBe(1);
        expect(raw.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_inventory_escrow'").get())
            .toBeNull();
        const archived = raw.query<{ historical_atomicity: string }, []>(
            'SELECT historical_atomicity FROM player_escrow_legacy_archive').get()!;
        expect(archived.historical_atomicity).toBe('unverified'); raw.close();
        const market = new MarketStore(f.target);
        const authority = openSharedPlayerEscrowAuthority(f.legacy, f.target, () => market);
        authority.close(); market.db.close(true);
    });

    test('refuses unresolved legacy value and preserves both databases', () => {
        const f = fixture(false), legacy = readFileSync(f.legacy), target = readFileSync(f.target);
        expect(() => migrateLegacyPlayerEscrowAuthority(f.legacy, f.target, f.backup)).toThrow('non-terminal');
        expect(readFileSync(f.legacy)).toEqual(legacy); expect(readFileSync(f.target)).toEqual(target);
        expect(existsSync(f.backup)).toBeFalse();
    });

    test('migrated authority fails closed if the legacy source changes later', () => {
        const f = fixture(); migrateLegacyPlayerEscrowAuthority(f.legacy, f.target, f.backup);
        const raw = new Database(f.legacy); raw.run("UPDATE player_inventory_escrow SET error='tampered'"); raw.close();
        expect(() => openSharedPlayerEscrowAuthority(f.legacy, f.target, () => new MarketStore(f.target)))
            .toThrow('non-terminal');
    });
});
