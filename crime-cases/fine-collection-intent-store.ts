import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { inspectFineCollection } from './fine-collection-preflight.js';

type Sources = Parameters<typeof inspectFineCollection>[1];
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);

/** An immutable plan only. It cannot debit an avatar or credit a treasury. */
export interface RecordedFineCollectionIntent {
    collectionId: string;
    decisionId: string;
    decisionDigest: string;
    amountGp: number;
    payerUsername: string;
    creditorFactionId: string;
    treasuryActorId: string;
    intentDigest: string;
    recordedAt: string;
}

type IntentRow = { collection_id: string; decision_id: string; decision_digest: string;
    amount_gp: number; payer_username: string; creditor_faction_id: string;
    treasury_actor_id: string; intent_digest: string; recorded_at: string };
type AuditRow = { sequence: number; collection_id: string; intent_digest: string;
    recorded_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function timestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}
function fromRow(row: IntentRow): RecordedFineCollectionIntent {
    return { collectionId: row.collection_id, decisionId: row.decision_id,
        decisionDigest: row.decision_digest, amountGp: row.amount_gp,
        payerUsername: row.payer_username, creditorFactionId: row.creditor_faction_id,
        treasuryActorId: row.treasury_actor_id, intentDigest: row.intent_digest,
        recordedAt: row.recorded_at };
}
function facts(value: RecordedFineCollectionIntent) {
    const { collectionId, decisionId, decisionDigest, amountGp, payerUsername,
        creditorFactionId, treasuryActorId } = value;
    return { collectionId, decisionId, decisionDigest, amountGp, payerUsername,
        creditorFactionId, treasuryActorId };
}
function candidate(decisionId: string, sources: Sources): ReturnType<typeof facts> {
    const preflight = inspectFineCollection(decisionId, sources);
    if (!preflight || preflight.decisionId !== decisionId || preflight.blockers.length !== 0
        || !preflight.canCollect
        || !DIGEST.test(preflight.decisionDigest)
        || !Number.isSafeInteger(preflight.amountGp) || preflight.amountGp <= 0
        || !preflight.candidatePayerUsername
        || preflight.candidatePayerUsername !== preflight.candidatePayerUsername.trim().toLowerCase()
        || !preflight.creditorFactionId || !ID.test(preflight.creditorFactionId)
        || !preflight.treasuryActorId || !ID.test(preflight.treasuryActorId))
        throw new Error('Fine collection has no approved active exact-avatar treasury endpoints');
    // The ID is deterministic and is never supplied by a client.
    return { collectionId: `fine-collection:${hash(preflight.decisionId)}`,
        decisionId: preflight.decisionId, decisionDigest: preflight.decisionDigest,
        amountGp: preflight.amountGp, payerUsername: preflight.candidatePayerUsername,
        creditorFactionId: preflight.creditorFactionId, treasuryActorId: preflight.treasuryActorId };
}

/** Separate append-only authority handoff. Asset movement remains in the settlement coordinator. */
export class FineCollectionIntentStore {
    private readonly database: Database;
    constructor(path: string, private readonly sources: Sources) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }

    record(decisionId: string, recordedAt = new Date().toISOString()): RecordedFineCollectionIntent {
        if (typeof decisionId !== 'string' || !ID.test(decisionId) || !timestamp(recordedAt))
            throw new Error('Fine collection intent id or time is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine collection intent audit chain is invalid');
        const expected = candidate(decisionId, this.sources);
        const intentDigest = hash(expected);
        const existing = this.getForDecision(decisionId);
        if (existing) {
            if (existing.intentDigest !== intentDigest)
                throw new Error('Fine collection decision changed after intent recording');
            return existing;
        }
        this.database.transaction(() => {
            this.database.run(`INSERT INTO fine_collection_intent
                (collection_id,decision_id,decision_digest,amount_gp,payer_username,
                    creditor_faction_id,treasury_actor_id,intent_digest,recorded_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            [expected.collectionId, expected.decisionId, expected.decisionDigest,
                expected.amountGp, expected.payerUsername, expected.creditorFactionId,
                expected.treasuryActorId, intentDigest, recordedAt]);
            const previous = (this.database.query(`SELECT entry_hash FROM fine_collection_intent_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { collectionId: expected.collectionId, intentDigest, recordedAt };
            this.database.run(`INSERT INTO fine_collection_intent_audit
                (collection_id,intent_digest,recorded_at,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5)`,
            [expected.collectionId, intentDigest, recordedAt,
                previous, hash({ previousHash: previous, payload })]);
        }).immediate();
        return this.get(expected.collectionId)!;
    }

    get(collectionId: string): RecordedFineCollectionIntent | null {
        if (typeof collectionId !== 'string' || !ID.test(collectionId))
            throw new Error('collectionId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine collection intent audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_collection_intent WHERE collection_id=?1')
            .get(collectionId) as IntentRow | null;
        return row ? fromRow(row) : null;
    }
    getForDecision(decisionId: string): RecordedFineCollectionIntent | null {
        if (typeof decisionId !== 'string' || !ID.test(decisionId))
            throw new Error('decisionId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine collection intent audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_collection_intent WHERE decision_id=?1')
            .get(decisionId) as IntentRow | null;
        return row ? fromRow(row) : null;
    }
    list(): RecordedFineCollectionIntent[] {
        if (!this.verifyAuditChain()) throw new Error('Fine collection intent audit chain is invalid');
        return (this.database.query('SELECT * FROM fine_collection_intent ORDER BY sequence')
            .all() as IntentRow[]).map(fromRow);
    }
    verifyAuditChain(): boolean {
        try {
            const audits = this.database.query('SELECT * FROM fine_collection_intent_audit ORDER BY sequence')
                .all() as AuditRow[];
            const count = this.database.query('SELECT COUNT(*) AS n FROM fine_collection_intent')
                .get() as { n: number };
            if (audits.length !== count.n) return false;
            let previous = ZERO;
            for (const audit of audits) {
                const raw = this.database.query('SELECT * FROM fine_collection_intent WHERE collection_id=?1')
                    .get(audit.collection_id) as IntentRow | null;
                if (!raw) return false;
                const value = fromRow(raw);
                const expected = candidate(value.decisionId, this.sources);
                if (!timestamp(value.recordedAt) || JSON.stringify(facts(value)) !== JSON.stringify(expected)
                    || value.intentDigest !== hash(expected)
                    || audit.intent_digest !== value.intentDigest || audit.recorded_at !== value.recordedAt)
                    return false;
                const payload = { collectionId: value.collectionId, intentDigest: value.intentDigest,
                    recordedAt: value.recordedAt };
                if (audit.previous_hash !== previous
                    || audit.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = audit.entry_hash;
            }
            return true;
        } catch { return false; }
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Fine collection intent schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE fine_collection_intent (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, collection_id TEXT NOT NULL UNIQUE,
                decision_id TEXT NOT NULL UNIQUE, decision_digest TEXT NOT NULL,
                amount_gp INTEGER NOT NULL CHECK (amount_gp BETWEEN 1 AND 2147483647),
                payer_username TEXT NOT NULL, creditor_faction_id TEXT NOT NULL,
                treasury_actor_id TEXT NOT NULL, intent_digest TEXT NOT NULL,
                recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE fine_collection_intent_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id TEXT NOT NULL UNIQUE REFERENCES fine_collection_intent(collection_id),
                intent_digest TEXT NOT NULL, recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}
