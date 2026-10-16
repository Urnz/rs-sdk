import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

export interface PlayerEscrowAuthorityMarker {
    schema_version: 2;
    legacy_baseline_count: number;
    legacy_archive_digest: string;
    created_at: string;
    digest: string;
}

export interface PlayerEscrowMigrationResult {
    legacyRecords: number;
    archiveDigest: string;
    legacyBackup: string;
    targetBackup: string;
    manifestPath: string;
}

const REQUIRED = ['escrow_id', 'username', 'assets_json', 'status', 'balances_before_json',
    'payee_username', 'payee_balances_before_json', 'commit_started_at', 'committed_at',
    'created_at', 'updated_at', 'error'];

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function normalized(value: unknown): unknown {
    if (value instanceof Uint8Array) return { blobHex: Buffer.from(value).toString('hex') };
    return value;
}

export function markerDigest(marker: Omit<PlayerEscrowAuthorityMarker, 'digest'>): string {
    return sha(JSON.stringify(marker));
}

export function legacyEscrowArchive(path: string): { records: string[]; digest: string } {
    if (!existsSync(path)) return { records: [], digest: sha('[]') };
    const database = new Database(path, { readonly: true });
    try {
        const table = database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_inventory_escrow'").get();
        if (!table) throw new Error('Legacy escrow database has no escrow table');
        const columns = (database.query('PRAGMA table_info(player_inventory_escrow)').all() as Array<{ name: string }>)
            .map(value => value.name);
        if (!REQUIRED.every(column => columns.includes(column)))
            throw new Error('Legacy escrow schema is incomplete and requires manual reconciliation');
        const rows = database.query<Record<string, unknown>, []>(
            'SELECT * FROM player_inventory_escrow ORDER BY escrow_id').all();
        const records = rows.map(row => {
            const terminalConsume = row.status === 'held' && row.commit_started_at !== null
                && row.committed_at === row.commit_started_at && row.payee_username === null
                && row.payee_balances_before_json === null && row.error === null;
            if (!terminalConsume) throw new Error('Legacy escrow contains a non-terminal or ambiguous record');
            return JSON.stringify(Object.fromEntries(columns.slice().sort()
                .map(column => [column, normalized(row[column])])));
        });
        return { records, digest: sha(JSON.stringify(records)) };
    } finally { database.close(); }
}

function snapshot(source: string, destination: string): void {
    mkdirSync(dirname(destination), { recursive: true });
    const database = new Database(source, { strict: true });
    try {
        const escaped = destination.replaceAll("'", "''");
        database.run(`VACUUM INTO '${escaped}'`);
    } finally { database.close(true); }
    const backup = new Database(destination, { readonly: true });
    try {
        const result = backup.query('PRAGMA integrity_check').get() as { integrity_check: string };
        if (result.integrity_check !== 'ok') throw new Error(`SQLite backup integrity check failed: ${destination}`);
    } finally { backup.close(); }
}

/**
 * Offline, evidence-preserving migration. Historical rows are archived verbatim and explicitly remain
 * non-atomic historical evidence; they are never inserted into the live shared escrow ledger.
 */
export function migrateLegacyPlayerEscrowAuthority(legacyPath: string, targetPath: string,
    backupDirectory: string, now = new Date().toISOString()): PlayerEscrowMigrationResult {
    if (resolve(legacyPath).toLowerCase() === resolve(targetPath).toLowerCase())
        throw new Error('Escrow migration paths must be distinct');
    if (!existsSync(legacyPath) || !existsSync(targetPath))
        throw new Error('Escrow migration requires both existing source and target databases');
    if (existsSync(backupDirectory)) throw new Error('Escrow migration backup directory already exists');
    const archive = legacyEscrowArchive(legacyPath);
    const target = new Database(targetPath, { strict: true });
    try {
        const accounts = target.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get();
        if (!accounts) throw new Error('Shared escrow target is not a player checkpoint store');
        const existingMarker = target.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_escrow_authority'").get();
        if (existingMarker) throw new Error('Shared escrow authority is already marked');
        const existingEscrow = target.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_inventory_escrow'").get();
        if (existingEscrow) {
            const count = target.query('SELECT COUNT(*) AS count FROM player_inventory_escrow').get() as { count: number };
            if (count.count !== 0) throw new Error('Target escrow records require manual reconciliation');
        }
    } finally { target.close(true); }

    mkdirSync(backupDirectory, { recursive: true });
    const legacyBackup = join(backupDirectory, basename(legacyPath));
    const targetBackup = join(backupDirectory, basename(targetPath));
    snapshot(legacyPath, legacyBackup);
    snapshot(targetPath, targetBackup);
    const backupArchive = legacyEscrowArchive(legacyBackup);
    if (backupArchive.digest !== archive.digest || backupArchive.records.length !== archive.records.length)
        throw new Error('Legacy escrow backup does not match the migration source');

    const createdAt = new Date(now).toISOString();
    const writable = new Database(targetPath, { strict: true });
    try {
        writable.transaction(() => {
            writable.run(`CREATE TABLE player_escrow_legacy_archive(
                sequence INTEGER PRIMARY KEY, record_json TEXT NOT NULL, record_digest TEXT NOT NULL UNIQUE,
                historical_atomicity TEXT NOT NULL CHECK(historical_atomicity='unverified'))`);
            archive.records.forEach((record, index) => writable.run(
                'INSERT INTO player_escrow_legacy_archive VALUES(?1,?2,?3,\'unverified\')',
                [index + 1, record, sha(record)]));
            writable.run(`CREATE TABLE player_escrow_authority(
                schema_version INTEGER NOT NULL, legacy_baseline_count INTEGER NOT NULL,
                legacy_archive_digest TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL)`);
            const facts = { schema_version: 2 as const, legacy_baseline_count: archive.records.length,
                legacy_archive_digest: archive.digest, created_at: createdAt };
            writable.run('INSERT INTO player_escrow_authority VALUES(?1,?2,?3,?4,?5)',
                [facts.schema_version, facts.legacy_baseline_count, facts.legacy_archive_digest,
                    facts.created_at, markerDigest(facts)]);
        }).immediate();
    } finally { writable.close(true); }

    const manifestPath = join(backupDirectory, 'migration-manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify({ version: 1, createdAt, legacyPath: resolve(legacyPath),
        targetPath: resolve(targetPath), legacyRecords: archive.records.length, archiveDigest: archive.digest,
        backups: { legacy: resolve(legacyBackup), target: resolve(targetBackup) },
        rollback: ['stop the local stack', 'verify no new shared escrow rows exist',
            'restore the target backup; the legacy source was never modified'] }, null, 2)}\n`, 'utf8');
    return { legacyRecords: archive.records.length, archiveDigest: archive.digest,
        legacyBackup, targetBackup, manifestPath };
}
