import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reportLegacyPlayerEscrowEvidence } from './LegacyPlayerEscrowEvidenceReport.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() {
    const root = mkdtempSync(join(tmpdir(), 'escrow-evidence-')); roots.push(root);
    return { legacy: join(root, 'legacy.sqlite'), target: join(root, 'market.sqlite') };
}
function fixtures(legacyPath: string, targetPath: string): void {
    const legacy = new Database(legacyPath);
    legacy.run(`CREATE TABLE player_inventory_escrow (
        escrow_id TEXT PRIMARY KEY, username TEXT, status TEXT,
        commit_started_at TEXT, committed_at TEXT, payee_username TEXT,
        payee_balances_before_json TEXT, error TEXT, assets_json TEXT)`);
    const insert = legacy.query(`INSERT INTO player_inventory_escrow VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'{"gp":25}')`);
    insert.run('consume-1', 'secretplayer', 'held', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null, null, null);
    insert.run('consume-2', 'otherplayer', 'held', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null, null, null);
    insert.run('pending-1', 'secretplayer', 'held', null, null, null, null, null);
    insert.run('payee-1', 'secretplayer', 'held', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'payee', '[]', null);
    insert.run('bad-1', 'secretplayer', 'released', null, null, null, null, null);
    legacy.close();
    const target = new Database(targetPath);
    target.run('CREATE TABLE accounts(owner TEXT PRIMARY KEY, save BLOB NOT NULL)');
    target.run("INSERT INTO accounts VALUES('secretplayer',x'01')");
    target.close();
}

describe('read-only legacy player escrow evidence', () => {
    test('reports only aggregate terminal consume and checkpoint presence, never migration authority', () => {
        const { legacy, target } = paths(); fixtures(legacy, target);
        const beforeLegacy = readFileSync(legacy), beforeTarget = readFileSync(target);
        const report = reportLegacyPlayerEscrowEvidence(legacy, target);
        expect(report).toEqual({ legacyRecords: 5, terminalConsumeRecords: 2,
            unresolvedRecords: 1, ambiguousRecords: 2, terminalConsumeWithCheckpoint: 1,
            terminalConsumeWithoutCheckpoint: 1, terminalConsumeCheckpointUnknown: 0,
            targetHasPlayerCheckpoints: true, targetCheckpointSchemaIncomplete: false,
            atomicCorrelationAvailable: false, canMigrate: false });
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain('secretplayer');
        expect(serialized).not.toContain('otherplayer');
        expect(serialized).not.toContain('consume-1');
        expect(serialized).not.toContain('"gp"');
        expect(readFileSync(legacy)).toEqual(beforeLegacy);
        expect(readFileSync(target)).toEqual(beforeTarget);
    });

    test('missing databases remain absent and cannot authorize migration', () => {
        const { legacy, target } = paths();
        expect(reportLegacyPlayerEscrowEvidence(legacy, target)).toMatchObject({
            legacyRecords: 0, targetHasPlayerCheckpoints: false,
            atomicCorrelationAvailable: false, canMigrate: false });
        expect(existsSync(legacy)).toBeFalse();
        expect(existsSync(target)).toBeFalse();
    });

    test('older incomplete escrow schema classifies every row as ambiguous', () => {
        const { legacy, target } = paths();
        const database = new Database(legacy);
        database.run('CREATE TABLE player_inventory_escrow(escrow_id TEXT PRIMARY KEY, status TEXT)');
        database.run("INSERT INTO player_inventory_escrow VALUES('old','held')"); database.close();
        expect(reportLegacyPlayerEscrowEvidence(legacy, target)).toMatchObject({
            legacyRecords: 1, terminalConsumeRecords: 0, unresolvedRecords: 0,
            ambiguousRecords: 1, canMigrate: false });
        expect(() => reportLegacyPlayerEscrowEvidence(legacy, legacy)).toThrow('distinct');
    });

    test('malformed checkpoint table leaves checkpoint correlation unknown', () => {
        const { legacy, target } = paths(); fixtures(legacy, target);
        const database = new Database(target);
        database.run('DROP TABLE accounts');
        database.run('CREATE TABLE accounts(wrong_column TEXT)'); database.close();
        expect(reportLegacyPlayerEscrowEvidence(legacy, target)).toMatchObject({
            terminalConsumeRecords: 2, terminalConsumeWithCheckpoint: 0,
            terminalConsumeWithoutCheckpoint: 0, terminalConsumeCheckpointUnknown: 2,
            targetHasPlayerCheckpoints: false, targetCheckpointSchemaIncomplete: true,
            atomicCorrelationAvailable: false, canMigrate: false });
    });
});
