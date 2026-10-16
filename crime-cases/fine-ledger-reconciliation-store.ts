import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { fineLedgerIds, inspectFineLedger, type FineLedgerReconciliation } from './fine-ledger-reconciliation.js';

type Sources = Parameters<typeof inspectFineLedger>[1];
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const COLLECTION = /^fine-collection:[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);
const STATUSES = ['unverifiable', 'conflict', 'no-movement', 'held', 'released', 'debit-only', 'matching-receipt-shape'];

/** Historical diagnostic evidence only, never collection consent or payment authority. */
export interface RecordedFineLedgerReconciliation extends FineLedgerReconciliation {
    observationId: string;
    recordedAt: string;
    observationDigest: string;
}
type Payload = Omit<RecordedFineLedgerReconciliation, 'observationDigest'>;
type Row = { sequence: number; observation_id: string; collection_id: string;
    payload_json: string; observation_digest: string };
type Audit = { sequence: number; observation_id: string; observation_digest: string;
    previous_hash: string; entry_hash: string };

function hash(domain: string, value: unknown): string {
    return createHash('sha256').update(`fine-ledger-observation/v1/${domain}\0`).update(JSON.stringify(value)).digest('hex');
}
function timestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function payload(value: Payload): Payload {
    return { observationId: value.observationId, recordedAt: value.recordedAt,
        collectionId: value.collectionId, escrowId: value.escrowId, settlementId: value.settlementId,
        status: value.status, reasons: value.reasons, canCollect: false, canMarkPaid: false };
}
function decode(row: Row): RecordedFineLedgerReconciliation {
    const value = JSON.parse(row.payload_json) as Payload;
    if (!value || typeof value !== 'object' || typeof value.observationId !== 'string'
        || !ID.test(value.observationId) || typeof value.collectionId !== 'string'
        || !COLLECTION.test(value.collectionId) || !timestamp(value.recordedAt)
        || !STATUSES.includes(value.status) || !Array.isArray(value.reasons)
        || value.reasons.some(reason => typeof reason !== 'string' || !/^[a-z][a-z0-9-]{0,127}$/.test(reason))
        || value.canCollect !== false || value.canMarkPaid !== false)
        throw new Error('Fine ledger observation payload is invalid');
    const ids = fineLedgerIds(value.collectionId);
    if (value.escrowId !== ids.escrowId || value.settlementId !== ids.settlementId
        || value.observationId !== row.observation_id || value.collectionId !== row.collection_id
        || JSON.stringify(payload(value)) !== row.payload_json
        || hash('payload', payload(value)) !== row.observation_digest)
        throw new Error('Fine ledger observation payload digest is invalid');
    return { ...payload(value), observationDigest: row.observation_digest };
}

/** Separate append-only journal; it never mutates any financial source. */
export class FineLedgerReconciliationStore {
    private readonly database: Database;

    constructor(path: string, private readonly sources: Sources) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }

    close(): void { this.database.close(true); }

    record(observationId: string, collectionId: string, recordedAt = new Date().toISOString()): RecordedFineLedgerReconciliation {
        this.validateObservationId(observationId);
        this.validateCollectionId(collectionId);
        if (!timestamp(recordedAt)) throw new Error('Fine ledger observation time is invalid');
        let recorded: RecordedFineLedgerReconciliation | undefined;
        this.database.transaction(() => {
            this.requireAudit();
            const existing = this.read(observationId);
            if (existing) {
                if (existing.collectionId !== collectionId)
                    throw new Error('Fine ledger observation id is already bound to a different collection');
                recorded = existing;
                return;
            }
            const diagnosis = inspectFineLedger(collectionId, this.sources);
            const value = payload({ observationId, recordedAt, ...diagnosis });
            const observationDigest = hash('payload', value);
            // Source adapters are not trusted to leave this journal unchanged during inspection.
            this.requireAudit();
            const previous = (this.database.query(`SELECT entry_hash FROM fine_ledger_observation_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            this.database.run(`INSERT INTO fine_ledger_observation
                (observation_id,collection_id,payload_json,observation_digest) VALUES(?1,?2,?3,?4)`,
            [observationId, collectionId, JSON.stringify(value), observationDigest]);
            this.database.run(`INSERT INTO fine_ledger_observation_audit
                (observation_id,observation_digest,previous_hash,entry_hash) VALUES(?1,?2,?3,?4)`,
            [observationId, observationDigest, previous,
                hash('audit', { previousHash: previous, observationId, observationDigest })]);
            this.requireAudit();
            recorded = this.read(observationId)!;
        }).immediate();
        if (!recorded) throw new Error('Fine ledger observation was not recorded');
        return recorded;
    }

    get(observationId: string): RecordedFineLedgerReconciliation | null {
        this.validateObservationId(observationId);
        return this.database.transaction(() => { this.requireAudit(); return this.read(observationId); })();
    }

    list(collectionId?: string): RecordedFineLedgerReconciliation[] {
        if (collectionId !== undefined) this.validateCollectionId(collectionId);
        return this.database.transaction(() => {
            this.requireAudit();
            const rows = collectionId === undefined
                ? this.database.query('SELECT * FROM fine_ledger_observation ORDER BY sequence').all()
                : this.database.query('SELECT * FROM fine_ledger_observation WHERE collection_id=?1 ORDER BY sequence').all(collectionId);
            return (rows as Row[]).map(decode);
        })();
    }

    verifyAuditChain(): boolean {
        try { return this.database.transaction(() => this.verifyPersisted())(); } catch { return false; }
    }

    private read(observationId: string): RecordedFineLedgerReconciliation | null {
        const row = this.database.query('SELECT * FROM fine_ledger_observation WHERE observation_id=?1').get(observationId) as Row | null;
        return row ? decode(row) : null;
    }
    private validateObservationId(value: string): void {
        if (typeof value !== 'string' || !ID.test(value)) throw new Error('Fine ledger observation id is invalid');
    }
    private validateCollectionId(value: string): void {
        if (typeof value !== 'string' || !COLLECTION.test(value)) throw new Error('Fine ledger collection id is invalid');
    }
    private requireAudit(): void {
        if (!this.verifyPersisted()) throw new Error('Fine ledger observation audit chain is invalid');
    }
    private verifyPersisted(): boolean {
        try {
            if ((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version !== 1) return false;
            const rows = this.database.query('SELECT * FROM fine_ledger_observation ORDER BY sequence').all() as Row[];
            const audits = this.database.query('SELECT * FROM fine_ledger_observation_audit ORDER BY sequence').all() as Audit[];
            if (rows.length !== audits.length) return false;
            for (const table of ['fine_ledger_observation', 'fine_ledger_observation_audit']) {
                const highWater = this.database.query('SELECT seq FROM sqlite_sequence WHERE name=?1').get(table) as { seq: number } | null;
                if ((highWater?.seq ?? 0) !== rows.length) return false;
            }
            let previous = ZERO;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const audit = audits[i];
                if (!row || !audit) return false;
                const value = decode(row);
                if (row.sequence !== i + 1 || audit.sequence !== i + 1
                    || audit.observation_id !== value.observationId || audit.observation_digest !== value.observationDigest
                    || audit.previous_hash !== previous
                    || audit.entry_hash !== hash('audit', { previousHash: previous,
                        observationId: value.observationId, observationDigest: value.observationDigest })) return false;
                previous = audit.entry_hash;
            }
            return true;
        } catch { return false; }
    }

    private migrate(): void {
        this.database.transaction(() => {
            const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
            if (version > 1) throw new Error(`Fine ledger observation schema ${version} is newer than supported version 1`);
            if (version === 1) return;
            const objects = this.database.query("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
            if (objects.length) throw new Error('Fine ledger observation database has an unknown unversioned schema');
            this.database.run(`CREATE TABLE fine_ledger_observation (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, observation_id TEXT NOT NULL UNIQUE,
                collection_id TEXT NOT NULL, payload_json TEXT NOT NULL, observation_digest TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE fine_ledger_observation_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                observation_id TEXT NOT NULL UNIQUE REFERENCES fine_ledger_observation(observation_id),
                observation_digest TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}
