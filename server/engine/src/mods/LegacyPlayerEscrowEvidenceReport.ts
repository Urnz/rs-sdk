import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Database } from 'bun:sqlite';

export interface LegacyPlayerEscrowEvidenceReport {
    /** Aggregate counts only: no player, escrow, balance, or item data leaves this diagnostic. */
    legacyRecords: number;
    terminalConsumeRecords: number;
    unresolvedRecords: number;
    ambiguousRecords: number;
    terminalConsumeWithCheckpoint: number;
    terminalConsumeWithoutCheckpoint: number;
    terminalConsumeCheckpointUnknown: number;
    targetHasPlayerCheckpoints: boolean;
    targetCheckpointSchemaIncomplete: boolean;
    /** A matching account row is presence evidence, not proof of an atomic escrow/checkpoint commit. */
    atomicCorrelationAvailable: false;
    canMigrate: false;
}

interface LegacyRow {
    username: string;
    status: string;
    commit_started_at: string | null;
    committed_at: string | null;
    payee_username: string | null;
    payee_balances_before_json: string | null;
    error: string | null;
}

function hasTable(database: Database, name: string): boolean {
    return database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(name) !== null;
}

function columns(database: Database, name: string): Set<string> {
    return new Set((database.query(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map(row => row.name));
}

/** Read-only evidence for a manual legacy reconciliation; deliberately never authorizes migration. */
export function reportLegacyPlayerEscrowEvidence(legacyPath: string, targetPath: string): LegacyPlayerEscrowEvidenceReport {
    if (typeof legacyPath !== 'string' || !legacyPath.trim() || typeof targetPath !== 'string'
        || !targetPath.trim() || resolve(legacyPath).toLowerCase() === resolve(targetPath).toLowerCase()) {
        throw new Error('Escrow evidence paths must be distinct');
    }
    const report: LegacyPlayerEscrowEvidenceReport = {
        legacyRecords: 0, terminalConsumeRecords: 0, unresolvedRecords: 0, ambiguousRecords: 0,
        terminalConsumeWithCheckpoint: 0, terminalConsumeWithoutCheckpoint: 0,
        terminalConsumeCheckpointUnknown: 0, targetHasPlayerCheckpoints: false,
        targetCheckpointSchemaIncomplete: false, atomicCorrelationAvailable: false, canMigrate: false
    };
    const checkpointOwners = new Set<string>();
    if (existsSync(targetPath)) {
        const target = new Database(targetPath, { readonly: true });
        try {
            if (hasTable(target, 'accounts')) {
                const accountColumns = columns(target, 'accounts');
                report.targetHasPlayerCheckpoints = accountColumns.has('owner') && accountColumns.has('save');
                report.targetCheckpointSchemaIncomplete = !report.targetHasPlayerCheckpoints;
            }
            if (report.targetHasPlayerCheckpoints) {
                for (const row of target.query('SELECT owner FROM accounts').all() as Array<{ owner: string }>) {
                    checkpointOwners.add(row.owner);
                }
            }
        } finally { target.close(); }
    }
    if (!existsSync(legacyPath)) return report;
    const legacy = new Database(legacyPath, { readonly: true });
    try {
        if (!hasTable(legacy, 'player_inventory_escrow')) {
            throw new Error('Legacy escrow database has no escrow table');
        }
        const required = ['username', 'status', 'commit_started_at', 'committed_at',
            'payee_username', 'payee_balances_before_json', 'error'];
        const available = columns(legacy, 'player_inventory_escrow');
        if (!required.every(column => available.has(column))) {
            report.legacyRecords = (legacy.query('SELECT COUNT(*) AS count FROM player_inventory_escrow')
                .get() as { count: number }).count;
            report.ambiguousRecords = report.legacyRecords;
            return report;
        }
        for (const row of legacy.query(`SELECT username,status,commit_started_at,committed_at,
            payee_username,payee_balances_before_json,error FROM player_inventory_escrow`).all() as LegacyRow[]) {
            report.legacyRecords++;
            const terminalConsume = row.status === 'held' && row.commit_started_at !== null
                && row.committed_at === row.commit_started_at && row.payee_username === null
                && row.payee_balances_before_json === null && row.error === null;
            if (terminalConsume) {
                report.terminalConsumeRecords++;
                if (report.targetCheckpointSchemaIncomplete) report.terminalConsumeCheckpointUnknown++;
                else if (checkpointOwners.has(row.username)) report.terminalConsumeWithCheckpoint++;
                else report.terminalConsumeWithoutCheckpoint++;
            } else if (row.committed_at === null && (row.status === 'pending' || row.status === 'held'
                || row.status === 'releasing' || row.status === 'reconcile' || row.commit_started_at !== null)) {
                report.unresolvedRecords++;
            } else {
                report.ambiguousRecords++;
            }
        }
        return report;
    } finally { legacy.close(); }
}
