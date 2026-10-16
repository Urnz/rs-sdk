import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Database } from 'bun:sqlite';

import { ensurePlayerSaveStore, type MarketStore } from '#/engine/market/MarketStore.js';
import { assessPlayerEscrowMigration } from './PlayerEscrowMigrationPreflight.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { legacyEscrowArchive, markerDigest, type PlayerEscrowAuthorityMarker }
    from './PlayerEscrowAuthorityMigration.js';

type LegacyMarker = { schema_version: 1; legacy_baseline_count: 0; created_at: string; digest: string };
type Marker = LegacyMarker | PlayerEscrowAuthorityMarker;
const TABLE = 'player_escrow_authority';

function digest(marker: Omit<LegacyMarker, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(marker)).digest('hex');
}
function readMarker(database: Database, allowEmpty = false): Marker | null {
    const table = database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(TABLE);
    if (!table) return null;
    const rows = database.query(`SELECT * FROM ${TABLE}`).all() as Marker[];
    if (allowEmpty && rows.length === 0) return null;
    if (rows.length !== 1) throw new Error('Shared escrow authority marker is invalid');
    const marker = rows[0]!;
    const { digest: actual, ...facts } = marker;
    const valid = marker.schema_version === 1
        ? marker.legacy_baseline_count === 0 && digest(facts as Omit<LegacyMarker, 'digest'>) === actual
        : marker.schema_version === 2 && Number.isSafeInteger(marker.legacy_baseline_count)
            && marker.legacy_baseline_count >= 0 && /^[0-9a-f]{64}$/.test(marker.legacy_archive_digest)
            && markerDigest(facts as Omit<PlayerEscrowAuthorityMarker, 'digest'>) === actual;
    if (!valid) throw new Error('Shared escrow authority marker is invalid');
    if (marker.schema_version === 2) {
        const archiveTable = database.query(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_escrow_legacy_archive'").get();
        if (!archiveTable) throw new Error('Shared escrow legacy archive is absent');
        const records = database.query(`SELECT sequence,record_json,record_digest
            FROM player_escrow_legacy_archive ORDER BY sequence`).all() as Array<{
                sequence: number; record_json: string; record_digest: string }>;
        if (records.length !== marker.legacy_baseline_count
            || records.some((row, index) => row.sequence !== index + 1
                || createHash('sha256').update(row.record_json).digest('hex') !== row.record_digest)
            || createHash('sha256').update(JSON.stringify(records.map(row => row.record_json))).digest('hex')
                !== marker.legacy_archive_digest) {
            throw new Error('Shared escrow legacy archive is invalid');
        }
    }
    return marker;
}
function inspectMarker(path: string): Marker | null {
    if (!existsSync(path)) return null;
    const database = new Database(path, { readonly: true });
    try { return readMarker(database); } finally { database.close(); }
}

/** Establishes a restart-stable shared escrow authority only for a genuinely fresh legacy ledger. */
export function openSharedPlayerEscrowAuthority(legacyPath: string, targetPath: string,
    openMarket: () => MarketStore, now = new Date().toISOString()): PlayerInventoryEscrowStore {
    const preflight = assessPlayerEscrowMigration(legacyPath, targetPath);
    if (preflight.blockers.includes('target-is-not-player-checkpoint-store'))
        throw new Error('Shared escrow target is not a player checkpoint store');
    const marker = inspectMarker(targetPath);
    if (!marker && (preflight.legacyRecords > 0 || preflight.legacyUnresolvedRecords > 0))
        throw new Error('Legacy player escrow requires reconciliation before shared authority');
    if (marker?.schema_version === 1 && preflight.legacyRecords > 0)
        throw new Error('Legacy player escrow changed after shared authority was established');
    if (marker?.schema_version === 2) {
        const archive = legacyEscrowArchive(legacyPath);
        if (archive.records.length !== marker.legacy_baseline_count
            || archive.digest !== marker.legacy_archive_digest)
            throw new Error('Legacy player escrow changed after migration');
    }
    if (!marker && preflight.targetRecords > 0)
        throw new Error('Unmarked player escrow records require reconciliation');
    const market = openMarket();
    const databasePath = (market.db.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>)
        .find(value => value.name === 'main')?.file;
    if (!databasePath || resolve(databasePath).toLowerCase() !== resolve(targetPath).toLowerCase())
        throw new Error('Shared escrow checkpoint database path mismatch');
    const createdAt = new Date(now).toISOString();
    market.db.transaction(() => {
        market.db.run(`CREATE TABLE IF NOT EXISTS ${TABLE}(
            schema_version INTEGER NOT NULL, legacy_baseline_count INTEGER NOT NULL,
            legacy_archive_digest TEXT NOT NULL, created_at TEXT NOT NULL, digest TEXT NOT NULL)`);
        const current = readMarker(market.db, marker === null);
        if (current) {
            if (marker && current.digest !== marker.digest)
                throw new Error('Shared escrow authority changed during startup');
            if (!marker) throw new Error('Shared escrow authority changed during startup');
        } else {
            if (marker || preflight.targetRecords > 0)
                throw new Error('Shared escrow authority changed during startup');
            const facts = { schema_version: 2 as const, legacy_baseline_count: 0,
                legacy_archive_digest: legacyEscrowArchive(legacyPath).digest, created_at: createdAt };
            market.db.run(`CREATE TABLE IF NOT EXISTS player_escrow_legacy_archive(
                sequence INTEGER PRIMARY KEY, record_json TEXT NOT NULL, record_digest TEXT NOT NULL UNIQUE,
                historical_atomicity TEXT NOT NULL CHECK(historical_atomicity='unverified'))`);
            market.db.run(`INSERT INTO ${TABLE} VALUES(?1,?2,?3,?4,?5)`,
                [facts.schema_version, facts.legacy_baseline_count, facts.legacy_archive_digest,
                    facts.created_at, markerDigest(facts)]);
        }
    }).immediate();
    return new PlayerInventoryEscrowStore(market);
}

let liveStore: PlayerInventoryEscrowStore | null = null;
/** World-tick singleton; never falls back to the legacy store on a failed preflight. */
export function getSharedPlayerEscrowAuthority(): PlayerInventoryEscrowStore {
    return (liveStore ??= openSharedPlayerEscrowAuthority('data/mods/player-inventory-escrow.sqlite',
        process.env.PLAYER_CHECKPOINT_DATABASE ?? process.env.GE_DATABASE ?? 'data/player-checkpoints.sqlite',
        ensurePlayerSaveStore));
}
