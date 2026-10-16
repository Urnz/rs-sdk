import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Database } from 'bun:sqlite';

export type PlayerEscrowMigrationBlocker = 'legacy-unresolved-escrow'
    | 'legacy-records-require-reconciliation' | 'target-records-require-reconciliation'
    | 'target-is-not-player-checkpoint-store';

export interface PlayerEscrowMigrationPreflight {
    /** No player identity, balance or item data is returned by this diagnostic. */
    legacyRecords: number;
    legacyUnresolvedRecords: number;
    targetRecords: number;
    targetHasPlayerCheckpoints: boolean;
    canBeginFreshSharedEscrow: boolean;
    blockers: PlayerEscrowMigrationBlocker[];
}

function table(database: Database, name: string): boolean {
    return database.query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1`).get(name) !== null;
}
function count(database: Database, name: string): number {
    return (database.query(`SELECT COUNT(*) AS count FROM ${name}`).get() as { count: number }).count;
}
function inspect(path: string, visit: (database: Database) => void): void {
    if (!existsSync(path)) return;
    const database = new Database(path, { readonly: true });
    try { visit(database); } finally { database.close(); }
}

/** Read-only stop gate for a fresh shared escrow authority; it never migrates or trusts old balances. */
export function assessPlayerEscrowMigration(legacyPath: string, targetPath: string): PlayerEscrowMigrationPreflight {
    if (typeof legacyPath !== 'string' || !legacyPath.trim() || typeof targetPath !== 'string'
        || !targetPath.trim() || resolve(legacyPath).toLowerCase() === resolve(targetPath).toLowerCase())
        throw new Error('Escrow migration paths must be distinct');
    let legacyRecords = 0, legacyUnresolvedRecords = 0, targetRecords = 0;
    let targetHasPlayerCheckpoints = false, targetExists = false;
    inspect(legacyPath, database => {
        if (!table(database, 'player_inventory_escrow'))
            throw new Error('Legacy escrow database has no escrow table');
        legacyRecords = count(database, 'player_inventory_escrow');
        const schemaColumns = database.query('PRAGMA table_info(player_inventory_escrow)').all() as Array<{ name: string }>;
        const columns = new Set(schemaColumns.map(column => column.name));
        legacyUnresolvedRecords = ['status', 'commit_started_at', 'committed_at']
            .every(column => columns.has(column))
            ? (database.query(`SELECT COUNT(*) AS count FROM player_inventory_escrow
                WHERE committed_at IS NULL AND (status IN ('pending','held','releasing','reconcile')
                    OR commit_started_at IS NOT NULL)`)
                .get() as { count: number }).count
            : legacyRecords;
    });
    inspect(targetPath, database => {
        targetExists = true;
        targetHasPlayerCheckpoints = table(database, 'accounts');
        if (table(database, 'player_inventory_escrow')) targetRecords = count(database, 'player_inventory_escrow');
    });
    const blockers: PlayerEscrowMigrationBlocker[] = [];
    if (legacyUnresolvedRecords > 0) blockers.push('legacy-unresolved-escrow');
    if (legacyRecords > 0) blockers.push('legacy-records-require-reconciliation');
    if (targetRecords > 0) blockers.push('target-records-require-reconciliation');
    if (targetExists && !targetHasPlayerCheckpoints) blockers.push('target-is-not-player-checkpoint-store');
    return { legacyRecords, legacyUnresolvedRecords, targetRecords, targetHasPlayerCheckpoints,
        canBeginFreshSharedEscrow: blockers.length === 0, blockers };
}
