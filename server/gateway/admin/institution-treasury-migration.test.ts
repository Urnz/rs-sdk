import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InstitutionTreasuryStore } from './institution-treasury.js';
import { migrateLegacyTreasuryExternalCredits } from './institution-treasury-migration.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('legacy treasury external-credit migration', () => {
    test('archives unaudited evidence without changing balance and starts a clean audited ledger', () => {
        const root = mkdtempSync(join(tmpdir(), 'treasury-credit-migration-')); roots.push(root);
        const path = join(root, 'treasury.sqlite'), backup = join(root, 'backup');
        const store = new InstitutionTreasuryStore(path);
        const account = store.ensure('faction', 'town'); store.setBalance('faction', 'town', account.revision, 25);
        store.close();
        const raw = new Database(path); raw.run(`INSERT INTO institution_treasury_external_credit VALUES
            ('11111111-1111-4111-8111-111111111111','faction','town',25,'legacy-source','2030-01-01T00:00:00.000Z')`);
        raw.close();
        const result = migrateLegacyTreasuryExternalCredits(path, backup, '2030-01-02T00:00:00.000Z');
        expect(result.archivedRecords).toBe(1); expect(existsSync(result.backupPath)).toBeTrue();
        const migrated = new InstitutionTreasuryStore(path);
        try {
            expect(migrated.get('faction', 'town')?.balanceGp).toBe(25);
            expect(migrated.listExternalCredits()).toEqual([]);
            migrated.creditExternalSettlement({ settlementId: '22222222-2222-4222-8222-222222222222',
                kind: 'faction', actorId: 'town', amountGp: 5, sourceRef: 'new-source',
                status: 'committed', occurredAt: '2030-01-03T00:00:00.000Z' }, () => true);
            expect(migrated.get('faction', 'town')?.balanceGp).toBe(30);
            expect(migrated.listExternalCredits()).toHaveLength(1);
        } finally { migrated.close(); }
        expect(readFileSync(result.backupPath).length).toBeGreaterThan(0);
    });

    test('rejects mixed historical audit evidence before creating a backup', () => {
        const root = mkdtempSync(join(tmpdir(), 'treasury-credit-migration-')); roots.push(root);
        const path = join(root, 'treasury.sqlite'), backup = join(root, 'backup');
        const store = new InstitutionTreasuryStore(path); store.close();
        const raw = new Database(path);
        raw.run(`INSERT INTO institution_treasury_external_credit_audit VALUES
            (1,'missing','hash','genesis','audit')`); raw.close();
        expect(() => migrateLegacyTreasuryExternalCredits(path, backup)).toThrow('Mixed');
        expect(existsSync(backup)).toBeFalse();
    });
});
