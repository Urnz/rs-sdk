import { createHash, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingDiscoveryObservation } from './types.js';
import type { ThievingProcedureStore } from './store.js';
import { projectThievingWitnessOpportunities, type WitnessAttentionPolicy,
    type WitnessOpportunity } from './witness-attention.js';

const ZERO = '0'.repeat(64), ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
type Row = { event_id: string; observer_username: string; observer_agent_id: string | null;
    outcome_receipt_id: string; outcome_receipt_digest: string; opportunity_digest: string;
    policy_digest: string; attention_basis_points: number; roll: number; occurred_at: string;
    decision_digest: string };
type AuditRow = { sequence: number; event_id: string; observer_username: string;
    previous_hash: string; entry_hash: string };
export interface WitnessAttentionDecision {
    eventId: string;
    observerUsername: string;
    observerAgentId: string | null;
    outcomeReceiptId: string;
    outcomeReceiptDigest: string;
    opportunityDigest: string;
    policyDigest: string;
    attentionBasisPoints: number;
    roll: number;
    occurredAt: string;
    decisionDigest: string;
}
export interface WitnessAttentionResult {
    noticed: boolean;
    decision: WitnessAttentionDecision;
    observation: ThievingDiscoveryObservation | null;
}
export type ResolveWitnessAgent = (observerUsername: string) => string | null;

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function timestamp(value: unknown, field: string): string { if (typeof value !== 'string'
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error(`${field} is invalid`); return value; }
function decision(row: Row): WitnessAttentionDecision { return { eventId: row.event_id,
    observerUsername: row.observer_username, observerAgentId: row.observer_agent_id,
    outcomeReceiptId: row.outcome_receipt_id, outcomeReceiptDigest: row.outcome_receipt_digest,
    opportunityDigest: row.opportunity_digest, policyDigest: row.policy_digest,
    attentionBasisPoints: row.attention_basis_points, roll: row.roll,
    occurredAt: row.occurred_at, decisionDigest: row.decision_digest }; }
function facts(value: WitnessAttentionDecision): Omit<WitnessAttentionDecision, 'decisionDigest'> {
    const { decisionDigest: _digest, ...rest } = value; return rest;
}
function stableId(prefix: string, eventId: string, observer: string): string {
    return `${prefix}:${hash({ eventId, observer })}`;
}

/** One server draw per event and observer; a miss is durable and never retried. */
export class WitnessAttentionDecisionStore {
    private readonly database: Database;
    constructor(path: string, private readonly source: ThievingEvidenceStore,
        private readonly thieving: ThievingProcedureStore, private readonly policy: WitnessAttentionPolicy) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(eventIdInput: string, observerUsernameInput: string): WitnessAttentionDecision | null {
        const row = this.database.query(`SELECT * FROM witness_attention_decision
            WHERE event_id=?1 AND observer_username=?2`)
            .get(id(eventIdInput, 'eventId'), id(observerUsernameInput, 'observerUsername')) as Row | null;
        return row ? decision(row) : null;
    }
    listNoticedForObserver(observerUsernameInput: string): WitnessAttentionDecision[] {
        const observerUsername = id(observerUsernameInput.trim().toLowerCase(), 'observerUsername');
        if (!this.verifyAuditChain()) throw new Error('Witness decision audit is invalid');
        return (this.database.query(`SELECT * FROM witness_attention_decision
            WHERE observer_username=?1 AND roll<attention_basis_points ORDER BY rowid`)
            .all(observerUsername) as Row[]).map(decision);
    }
    decide(eventIdInput: string, observerUsernameInput: string, resolveAgent: ResolveWitnessAgent,
        occurredAtInput = new Date().toISOString()): WitnessAttentionResult {
        const eventId = id(eventIdInput, 'eventId'), observerUsername = id(observerUsernameInput, 'observerUsername');
        const occurredAt = timestamp(occurredAtInput, 'occurredAt');
        if (!this.verifyAuditChain()) throw new Error('Witness decision audit is invalid');
        const opportunity = projectThievingWitnessOpportunities(eventId, this.source, this.thieving, this.policy)
            .find(value => value.observerUsername === observerUsername);
        if (!opportunity) throw new Error('Observer is not a verified sight candidate');
        const outcome = this.thieving.getOutcome(opportunity.outcomeReceiptId)!;
        if (Date.parse(occurredAt) < Date.parse(outcome.occurredAt))
            throw new Error('Witness decision predates the burglary or theft');
        const existing = this.get(eventId, observerUsername);
        const resolved = existing?.observerAgentId === null ? null : resolveAgent(observerUsername);
        const observerAgentId = resolved === null ? null : id(resolved, 'observerAgentId');
        if (observerAgentId === outcome.actorAgentId) throw new Error('Offender cannot witness their own burglary or theft');
        const value = this.issue(opportunity, outcome.receiptDigest, observerAgentId, occurredAt);
        const noticed = value.roll < value.attentionBasisPoints;
        if (!noticed) return { noticed, decision: value, observation: null };
        const sourceEvent = this.source.get(eventId)!;
        const observationId = stableId('witness', eventId, observerUsername);
        const evidence = { evidenceId: stableId('witness-evidence', eventId, observerUsername),
            outcomeReceiptId: value.outcomeReceiptId, source: 'direct-witness' as const,
            observerAgentId: value.observerAgentId, actorIdentification: 'none' as const, suspectAgentId: null,
            facts: [sourceEvent.procedureKind === 'property-burglary'
                ? `A person was noticed entering Property ${sourceEvent.propertyAccess!.propertyId}.`
                : sourceEvent.procedureKind === 'pickpocket'
                    ? 'A person was noticed pickpocketing an NPC.'
                    : 'A person was noticed stealing from a container or stall.'],
            sourceEvidenceDigest: value.decisionDigest, occurredAt: value.occurredAt };
        const observation = this.thieving.recordDiscovery(observationId, evidence,
            candidate => this.verifyAuditChain() && candidate.sourceEvidenceDigest === value.decisionDigest,
            occurredAt);
        return { noticed, decision: value, observation };
    }
    verifyAuditChain(): boolean {
        if (!this.source.verifyChain() || !this.thieving.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM witness_attention_decision ORDER BY rowid').all() as Row[];
        const audits = this.database.query('SELECT * FROM witness_attention_audit ORDER BY sequence').all() as AuditRow[];
        if (rows.length !== audits.length) return false;
        let head = ZERO;
        for (let index = 0; index < rows.length; index++) {
            const value = decision(rows[index]!), audit = audits[index]!;
            const event = this.source.get(value.eventId), outcome = this.thieving.getOutcome(value.outcomeReceiptId);
            if (audit.sequence !== index + 1 || audit.event_id !== value.eventId
                || audit.observer_username !== value.observerUsername || audit.previous_hash !== head
                || !event || !outcome || outcome.sourceEventId !== value.eventId
                || outcome.receiptDigest !== value.outcomeReceiptDigest
                || event.eventDigest !== outcome.sourceEvidenceDigest
                || !Number.isSafeInteger(value.roll) || value.roll < 0 || value.roll > 9_999
                || hash(facts(value)) !== value.decisionDigest
                || hash({ previousHash: head, decision: value }) !== audit.entry_hash) return false;
            head = audit.entry_hash;
        }
        return true;
    }
    private issue(opportunity: WitnessOpportunity, outcomeReceiptDigest: string,
        observerAgentId: string | null, occurredAt: string): WitnessAttentionDecision {
        let result: WitnessAttentionDecision | null = null;
        const transaction = this.database.transaction(() => {
            const existing = this.get(opportunity.eventId, opportunity.observerUsername);
            if (existing) {
                // A player-only witness remains player-only for this event after a later agent binding.
                if ((existing.observerAgentId !== null && existing.observerAgentId !== observerAgentId)
                    || existing.outcomeReceiptDigest !== outcomeReceiptDigest
                    || existing.opportunityDigest !== opportunity.opportunityDigest
                    || existing.policyDigest !== opportunity.policyDigest)
                    throw new Error('Witness decision was already issued with different binding');
                result = existing; return;
            }
            const base = { eventId: opportunity.eventId, observerUsername: opportunity.observerUsername,
                observerAgentId, outcomeReceiptId: opportunity.outcomeReceiptId, outcomeReceiptDigest,
                opportunityDigest: opportunity.opportunityDigest, policyDigest: opportunity.policyDigest,
                attentionBasisPoints: opportunity.attentionBasisPoints, roll: randomInt(10_000), occurredAt };
            const issued = { ...base, decisionDigest: hash(base) };
            this.database.run(`INSERT INTO witness_attention_decision
                (event_id,observer_username,observer_agent_id,outcome_receipt_id,outcome_receipt_digest,
                opportunity_digest,policy_digest,attention_basis_points,roll,occurred_at,decision_digest) VALUES
                (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
            [issued.eventId, issued.observerUsername, issued.observerAgentId, issued.outcomeReceiptId,
                issued.outcomeReceiptDigest, issued.opportunityDigest, issued.policyDigest,
                issued.attentionBasisPoints, issued.roll, issued.occurredAt, issued.decisionDigest]);
            const previous = this.database.query(`SELECT entry_hash FROM witness_attention_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null;
            const previousHash = previous?.entry_hash ?? ZERO;
            this.database.run(`INSERT INTO witness_attention_audit
                (event_id,observer_username,previous_hash,entry_hash) VALUES(?1,?2,?3,?4)`,
            [issued.eventId, issued.observerUsername, previousHash,
                hash({ previousHash, decision: issued })]);
            result = issued;
        });
        transaction.immediate();
        return result!;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 2) throw new Error(`Witness decision schema ${version} is newer than supported version 2`);
        if (version === 2) return;
        if (version === 1) {
            if (!this.verifyAuditChain()) throw new Error('Cannot migrate invalid witness decision audit');
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE witness_attention_decision_v2 (
                    event_id TEXT NOT NULL,observer_username TEXT NOT NULL,observer_agent_id TEXT,
                    outcome_receipt_id TEXT NOT NULL,outcome_receipt_digest TEXT NOT NULL,
                    opportunity_digest TEXT NOT NULL,policy_digest TEXT NOT NULL,
                    attention_basis_points INTEGER NOT NULL CHECK(attention_basis_points BETWEEN 0 AND 10000),
                    roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 9999),occurred_at TEXT NOT NULL,
                    decision_digest TEXT NOT NULL UNIQUE,PRIMARY KEY(event_id,observer_username))`);
                this.database.run(`INSERT INTO witness_attention_decision_v2
                    SELECT * FROM witness_attention_decision`);
                this.database.run(`CREATE TABLE witness_attention_audit_v2 (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,
                    observer_username TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                    UNIQUE(event_id,observer_username),FOREIGN KEY(event_id,observer_username)
                    REFERENCES witness_attention_decision_v2(event_id,observer_username))`);
                this.database.run('INSERT INTO witness_attention_audit_v2 SELECT * FROM witness_attention_audit');
                this.database.run('DROP TABLE witness_attention_audit');
                this.database.run('DROP TABLE witness_attention_decision');
                this.database.run('ALTER TABLE witness_attention_decision_v2 RENAME TO witness_attention_decision');
                this.database.run('ALTER TABLE witness_attention_audit_v2 RENAME TO witness_attention_audit');
                if ((this.database.query('PRAGMA foreign_key_check').all() as unknown[]).length > 0
                    || !this.verifyAuditChain()) throw new Error('Witness decision v2 migration verification failed');
                this.database.run('PRAGMA user_version = 2');
            });
            migration.immediate();
            return;
        }
        const migration = this.database.transaction(() => {
            this.database.run(`CREATE TABLE witness_attention_decision (
                event_id TEXT NOT NULL,observer_username TEXT NOT NULL,observer_agent_id TEXT,
                outcome_receipt_id TEXT NOT NULL,outcome_receipt_digest TEXT NOT NULL,
                opportunity_digest TEXT NOT NULL,policy_digest TEXT NOT NULL,
                attention_basis_points INTEGER NOT NULL CHECK(attention_basis_points BETWEEN 0 AND 10000),
                roll INTEGER NOT NULL CHECK(roll BETWEEN 0 AND 9999),occurred_at TEXT NOT NULL,
                decision_digest TEXT NOT NULL UNIQUE,PRIMARY KEY(event_id,observer_username))`);
            this.database.run(`CREATE TABLE witness_attention_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,
                observer_username TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                UNIQUE(event_id,observer_username),FOREIGN KEY(event_id,observer_username)
                REFERENCES witness_attention_decision(event_id,observer_username))`);
            this.database.run('PRAGMA user_version = 2');
        });
        migration.immediate();
    }
}
