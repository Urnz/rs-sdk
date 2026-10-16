import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

type CreditRow = { settlement_id: string; actor_kind: string; actor_id: string;
    amount_gp: number; source_ref: string; created_at: string };
type Marker = { schema_version: number; archived_count: number; archive_digest: string;
    created_at: string; digest: string };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const record = (row: CreditRow) => JSON.stringify([row.settlement_id, row.actor_kind, row.actor_id,
    row.amount_gp, row.source_ref, row.created_at]);
const archiveDigest = (records: string[]) => sha(JSON.stringify(records));
const markerDigest = (value: Omit<Marker, 'digest'>) => sha(JSON.stringify(value));

function table(database: Database, name: string): boolean {
    return database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(name) !== null;
}
function rows(database: Database): CreditRow[] {
    if (!table(database, 'institution_treasury_external_credit')) return [];
    return database.query<CreditRow, []>(`SELECT * FROM institution_treasury_external_credit
        ORDER BY settlement_id`).all();
}

export function verifyLegacyTreasuryCreditArchive(database: Database): void {
    const hasArchive = table(database, 'institution_treasury_legacy_external_credit_archive');
    const hasMarker = table(database, 'institution_treasury_external_credit_migration');
    if (!hasArchive && !hasMarker) return;
    if (!hasArchive || !hasMarker) throw new Error('Legacy treasury credit archive is incomplete');
    const markers = database.query<Marker, []>('SELECT * FROM institution_treasury_external_credit_migration').all();
    if (markers.length !== 1) throw new Error('Legacy treasury credit migration marker is invalid');
    const marker = markers[0]!, { digest, ...facts } = marker;
    const archived = database.query<{ sequence: number; record_json: string; record_digest: string }, []>(
        'SELECT sequence,record_json,record_digest FROM institution_treasury_legacy_external_credit_archive ORDER BY sequence').all();
    if (marker.schema_version !== 1 || marker.archived_count !== archived.length
        || marker.digest !== markerDigest(facts)
        || archived.some((item, index) => item.sequence !== index + 1 || item.record_digest !== sha(item.record_json))
        || marker.archive_digest !== archiveDigest(archived.map(item => item.record_json))) {
        throw new Error('Legacy treasury credit archive is invalid');
    }
}

function snapshot(source: string, destination: string): void {
    mkdirSync(dirname(destination), { recursive: true });
    const database = new Database(source, { strict: true });
    try { database.run(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); }
    finally { database.close(true); }
    const backup = new Database(destination, { readonly: true });
    try {
        if ((backup.query('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok')
            throw new Error('Treasury backup integrity check failed');
    } finally { backup.close(); }
}

/** Offline migration: preserve unaudited receipts as historical evidence without changing any balance. */
export function migrateLegacyTreasuryExternalCredits(path: string, backupDirectory: string,
    now = new Date().toISOString()): { archivedRecords: number; archiveDigest: string;
        backupPath: string; manifestPath: string } {
    if (!existsSync(path)) throw new Error('Treasury database is absent');
    if (existsSync(backupDirectory)) throw new Error('Treasury migration backup directory already exists');
    const readonly = new Database(path, { readonly: true });
    let source: CreditRow[];
    try {
        source = rows(readonly);
        const audits = table(readonly, 'institution_treasury_external_credit_audit')
            ? readonly.query<{ count: number }, []>(
                'SELECT COUNT(*) AS count FROM institution_treasury_external_credit_audit').get()!.count : 0;
        if (audits !== 0) throw new Error('Mixed legacy treasury credit evidence requires manual reconciliation');
        if (table(readonly, 'institution_treasury_external_credit_migration'))
            throw new Error('Legacy treasury credit migration is already recorded');
    } finally { readonly.close(); }
    const records = source.map(record), digest = archiveDigest(records);
    mkdirSync(backupDirectory, { recursive: true });
    const backupPath = join(backupDirectory, basename(path));
    snapshot(path, backupPath);
    const backup = new Database(backupPath, { readonly: true });
    try {
        if (archiveDigest(rows(backup).map(record)) !== digest) throw new Error('Treasury backup differs from source');
    } finally { backup.close(); }
    const createdAt = new Date(now).toISOString(), database = new Database(path, { strict: true });
    try {
        database.transaction(() => {
            database.run(`CREATE TABLE institution_treasury_legacy_external_credit_archive(
                sequence INTEGER PRIMARY KEY,record_json TEXT NOT NULL,record_digest TEXT NOT NULL UNIQUE,
                historical_audit TEXT NOT NULL CHECK(historical_audit='unverified'),
                balance_effect TEXT NOT NULL CHECK(balance_effect='preserved'))`);
            records.forEach((value, index) => database.run(
                "INSERT INTO institution_treasury_legacy_external_credit_archive VALUES(?1,?2,?3,'unverified','preserved')",
                [index + 1, value, sha(value)]));
            database.run('DELETE FROM institution_treasury_external_credit');
            database.run(`CREATE TABLE institution_treasury_external_credit_migration(
                schema_version INTEGER NOT NULL,archived_count INTEGER NOT NULL,
                archive_digest TEXT NOT NULL,created_at TEXT NOT NULL,digest TEXT NOT NULL)`);
            const facts = { schema_version: 1, archived_count: records.length,
                archive_digest: digest, created_at: createdAt };
            database.run('INSERT INTO institution_treasury_external_credit_migration VALUES(?1,?2,?3,?4,?5)',
                [facts.schema_version, facts.archived_count, facts.archive_digest,
                    facts.created_at, markerDigest(facts)]);
            verifyLegacyTreasuryCreditArchive(database);
        }).immediate();
    } finally { database.close(true); }
    const manifestPath = join(backupDirectory, 'migration-manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify({ version: 1, createdAt, treasuryPath: resolve(path),
        archivedRecords: records.length, archiveDigest: digest, backup: resolve(backupPath),
        balanceChanged: false, rollback: ['stop the local stack',
            'verify no new audited external credits exist', 'restore the treasury backup'] }, null, 2)}\n`);
    return { archivedRecords: records.length, archiveDigest: digest, backupPath, manifestPath };
}
