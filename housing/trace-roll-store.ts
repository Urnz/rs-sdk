import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { ThievingOutcomeReceipt } from '../thieving-procedures/types.js';
import type { HousingTraceRollEvidence } from './trace-discovery.js';
import type { HousingSecurityProjection } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);
type RollRow = { outcome_receipt_id: string; outcome_receipt_digest: string; observation_id: string;
    security_projection_digest: string; roll: number; occurred_at: string; source_evidence_digest: string };
type AuditRow = { sequence: number; outcome_receipt_id: string; previous_hash: string; entry_hash: string };
export interface HousingTraceRollRecord extends HousingTraceRollEvidence {
    outcomeReceiptId: string;
    outcomeReceiptDigest: string;
    observationId: string;
    securityProjectionDigest: string;
}

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function timestamp(value: unknown, field: string): string { if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error(`${field} is invalid`); return value; }
function record(row: RollRow): HousingTraceRollRecord { return { outcomeReceiptId: row.outcome_receipt_id,
    outcomeReceiptDigest: row.outcome_receipt_digest, observationId: row.observation_id,
    securityProjectionDigest: row.security_projection_digest, roll: row.roll,
    occurredAt: row.occurred_at, sourceEvidenceDigest: row.source_evidence_digest }; }
function recordDigest(value: Omit<HousingTraceRollRecord, 'sourceEvidenceDigest'>): string { return hash(value); }
function withoutDigest(value: HousingTraceRollRecord): Omit<HousingTraceRollRecord, 'sourceEvidenceDigest'> {
    const { sourceEvidenceDigest: _digest, ...rest } = value; return rest;
}

/** Server-owned one-shot trace rolls; never accepts a caller-supplied random value. */
export class HousingTraceRollStore {
    private readonly database: Database;
    constructor(path: string, private readonly thieving: ThievingProcedureStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.migrate();
    }
    close(): void { this.database.close(true); }
    get(outcomeReceiptIdInput: string): HousingTraceRollRecord | null {
        const row = this.database.query('SELECT * FROM housing_trace_roll WHERE outcome_receipt_id=?1')
            .get(id(outcomeReceiptIdInput, 'outcomeReceiptId')) as RollRow | null;
        return row ? record(row) : null;
    }
    issue(outcomeReceiptIdInput: string, observationIdInput: string, security: HousingSecurityProjection,
        occurredAtInput = new Date().toISOString()): HousingTraceRollRecord {
        const outcomeReceiptId = id(outcomeReceiptIdInput, 'outcomeReceiptId');
        const observationId = id(observationIdInput, 'observationId');
        const occurredAt = timestamp(occurredAtInput, 'occurredAt');
        if (!this.thieving.verifyAuditChain() || !this.verifyAuditChain()) throw new Error('Trace source audit is invalid');
        const outcome = this.thieving.getOutcome(outcomeReceiptId);
        const propertyEntry = outcome?.result === 'succeeded' && outcome.procedureKind === 'property-burglary'
            && outcome.effect === 'entry-completed' && outcome.target.kind === 'loc'
            && security.kind === 'property-entry';
        const storageTheft = outcome?.result === 'succeeded' && outcome.procedureKind === 'container-theft'
            && outcome.effect === 'item-transfer' && outcome.target.kind === 'loc'
            && security.kind === 'storage';
        if (!outcome || (!propertyEntry && !storageTheft)) throw new Error(security.kind === 'property-entry'
            ? 'Trace roll requires a successful Property burglary entry'
            : 'Trace roll requires a successful protected Housing operation');
        if (!security.propertyId || !security.housingUnitId
            || security.sourceEvidenceDigest !== outcome.sourceEvidenceDigest
            || !DIGEST.test(security.projectionDigest) || Date.parse(occurredAt) < Date.parse(outcome.occurredAt))
            throw new Error('Trace roll security projection or time does not bind to the operation');
        let result: HousingTraceRollRecord | null = null;
        const transaction = this.database.transaction(() => {
            const existing = this.get(outcomeReceiptId);
            if (existing) {
                if (existing.outcomeReceiptDigest !== outcome.receiptDigest
                    || existing.observationId !== observationId
                    || existing.securityProjectionDigest !== security.projectionDigest)
                    throw new Error('Trace roll was already issued with different binding');
                result = existing; return;
            }
            const base = { outcomeReceiptId, outcomeReceiptDigest: outcome.receiptDigest,
                observationId, securityProjectionDigest: security.projectionDigest,
                roll: randomInt(10_000), occurredAt };
            const issued: HousingTraceRollRecord = { ...base, sourceEvidenceDigest: recordDigest(base) };
            this.database.run(`INSERT INTO housing_trace_roll
                (outcome_receipt_id,outcome_receipt_digest,observation_id,security_projection_digest,
                roll,occurred_at,source_evidence_digest) VALUES(?1,?2,?3,?4,?5,?6,?7)`,
            [issued.outcomeReceiptId, issued.outcomeReceiptDigest, issued.observationId,
                issued.securityProjectionDigest, issued.roll, issued.occurredAt, issued.sourceEvidenceDigest]);
            const previous = this.database.query('SELECT entry_hash FROM housing_trace_roll_audit ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null;
            const previousHash = previous?.entry_hash ?? ZERO;
            const entryHash = hash({ previousHash, record: issued });
            this.database.run(`INSERT INTO housing_trace_roll_audit
                (outcome_receipt_id,previous_hash,entry_hash) VALUES(?1,?2,?3)`,
            [outcomeReceiptId, previousHash, entryHash]);
            result = issued;
        });
        transaction.immediate();
        return result!;
    }
    verifyRollFor(roll: Readonly<HousingTraceRollEvidence>, outcome: Readonly<ThievingOutcomeReceipt>,
        observationId: string, securityProjectionDigest: string): boolean {
        if (!this.verifyAuditChain() || !this.thieving.verifyAuditChain()) return false;
        const saved = this.get(outcome.receiptId);
        return !!saved && saved.outcomeReceiptDigest === outcome.receiptDigest
            && saved.observationId === observationId && saved.securityProjectionDigest === securityProjectionDigest
            && saved.roll === roll.roll && saved.occurredAt === roll.occurredAt
            && saved.sourceEvidenceDigest === roll.sourceEvidenceDigest;
    }
    verifyAuditChain(): boolean {
        const rolls = this.database.query('SELECT * FROM housing_trace_roll ORDER BY rowid').all() as RollRow[];
        const audits = this.database.query('SELECT * FROM housing_trace_roll_audit ORDER BY sequence').all() as AuditRow[];
        if (rolls.length !== audits.length) return false;
        let head = ZERO;
        for (let index = 0; index < rolls.length; index++) {
            const value = record(rolls[index]!), audit = audits[index]!;
            const outcome = this.thieving.getOutcome(value.outcomeReceiptId);
            if (audit.sequence !== index + 1 || audit.outcome_receipt_id !== value.outcomeReceiptId
                || audit.previous_hash !== head || value.sourceEvidenceDigest !== recordDigest(withoutDigest(value))
                || !outcome || outcome.receiptDigest !== value.outcomeReceiptDigest
                || !Number.isSafeInteger(value.roll) || value.roll < 0 || value.roll > 9_999
                || !DIGEST.test(value.securityProjectionDigest) || !DIGEST.test(value.sourceEvidenceDigest)
                || hash({ previousHash: head, record: value }) !== audit.entry_hash) return false;
            head = audit.entry_hash;
        }
        return true;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Housing trace roll schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const migration = this.database.transaction(() => {
            this.database.run(`CREATE TABLE housing_trace_roll (
                outcome_receipt_id TEXT PRIMARY KEY,outcome_receipt_digest TEXT NOT NULL,
                observation_id TEXT NOT NULL,security_projection_digest TEXT NOT NULL,
                roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 9999),occurred_at TEXT NOT NULL,
                source_evidence_digest TEXT NOT NULL UNIQUE)`);
            this.database.run(`CREATE TABLE housing_trace_roll_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,outcome_receipt_id TEXT NOT NULL UNIQUE
                REFERENCES housing_trace_roll(outcome_receipt_id),previous_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        });
        migration.immediate();
    }
}
