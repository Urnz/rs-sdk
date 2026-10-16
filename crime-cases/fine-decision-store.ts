import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { GovernanceStore } from '../server/gateway/admin/governance.js';
import { createFineAdjudicatorAuthorityVerifier } from './fine-adjudicator-grants.js';
import { FineAdjudicatorGrantStore } from './fine-adjudicator-grants.js';
import type { FineProposalStore, RecordedFineProposal } from './fine-proposal-store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);
const FIELDS = ['decisionId', 'proposalId', 'proposalDigest', 'jurisdictionId', 'suspectAgentId',
    'disposition', 'adjudicatorAgentId', 'decisionEvidenceDigest', 'occurredAt'];

/** A separate institutional choice; this request is never a payment command. */
export interface FineDecisionRequest {
    decisionId: string;
    proposalId: string;
    proposalDigest: string;
    jurisdictionId: string;
    suspectAgentId: string;
    disposition: 'approved' | 'rejected';
    adjudicatorAgentId: string;
    decisionEvidenceDigest: string;
    occurredAt: string;
}
export interface RecordedFineDecision extends FineDecisionRequest {
    amountGp: number;
    decisionDigest: string;
    recordedAt: string;
}
export type FineDecisionAuthorityVerifier = (request: Readonly<FineDecisionRequest>,
    proposal: Readonly<RecordedFineProposal>) => string | null;

type DecisionRow = { decision_id: string; proposal_id: string; proposal_digest: string;
    jurisdiction_id: string; suspect_agent_id: string; disposition: FineDecisionRequest['disposition'];
    adjudicator_agent_id: string; decision_evidence_digest: string; occurred_at: string;
    amount_gp: number; decision_digest: string; recorded_at: string };
type AuditRow = { sequence: number; decision_id: string; decision_digest: string;
    recorded_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function time(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}
function rowDecision(row: DecisionRow): RecordedFineDecision {
    return { decisionId: row.decision_id, proposalId: row.proposal_id,
        proposalDigest: row.proposal_digest, jurisdictionId: row.jurisdiction_id,
        suspectAgentId: row.suspect_agent_id, disposition: row.disposition,
        adjudicatorAgentId: row.adjudicator_agent_id,
        decisionEvidenceDigest: row.decision_evidence_digest, occurredAt: row.occurred_at,
        amountGp: row.amount_gp, decisionDigest: row.decision_digest, recordedAt: row.recorded_at };
}
function request(value: RecordedFineDecision): FineDecisionRequest {
    return { decisionId: value.decisionId, proposalId: value.proposalId,
        proposalDigest: value.proposalDigest, jurisdictionId: value.jurisdictionId,
        suspectAgentId: value.suspectAgentId, disposition: value.disposition,
        adjudicatorAgentId: value.adjudicatorAgentId,
        decisionEvidenceDigest: value.decisionEvidenceDigest, occurredAt: value.occurredAt };
}

/** Append-only adjudication; no debt, custody or asset transfer occurs here. */
export class FineDecisionStore {
    private readonly database: Database;
    private readonly verifyAuthority: FineDecisionAuthorityVerifier;

    constructor(path: string, private readonly proposals: FineProposalStore,
        private readonly governance: Pick<GovernanceStore, 'getJurisdiction' | 'isFactionActiveAt'>,
        grants: FineAdjudicatorGrantStore, verifyExplicitAction: FineDecisionAuthorityVerifier) {
        if (!(grants instanceof FineAdjudicatorGrantStore))
            throw new Error('Fine decisions require an audited adjudicator grant catalog');
        this.verifyAuthority = createFineAdjudicatorAuthorityVerifier(grants, verifyExplicitAction);
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(decisionIdInput: string): RecordedFineDecision | null {
        if (typeof decisionIdInput !== 'string' || !ID.test(decisionIdInput))
            throw new Error('decisionId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine decision audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_decision WHERE decision_id=?1')
            .get(decisionIdInput) as DecisionRow | null;
        return row ? rowDecision(row) : null;
    }
    getForProposal(proposalIdInput: string): RecordedFineDecision | null {
        if (typeof proposalIdInput !== 'string' || !ID.test(proposalIdInput))
            throw new Error('proposalId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine decision audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_decision WHERE proposal_id=?1')
            .get(proposalIdInput) as DecisionRow | null;
        return row ? rowDecision(row) : null;
    }
    record(input: FineDecisionRequest, recordedAtInput = new Date().toISOString()): RecordedFineDecision {
        if (!input || Object.keys(input).sort().join(',') !== [...FIELDS].sort().join(','))
            throw new Error('Fine decision fields are invalid');
        const decision: FineDecisionRequest = { decisionId: input.decisionId,
            proposalId: input.proposalId, proposalDigest: input.proposalDigest,
            jurisdictionId: input.jurisdictionId, suspectAgentId: input.suspectAgentId,
            disposition: input.disposition, adjudicatorAgentId: input.adjudicatorAgentId,
            decisionEvidenceDigest: input.decisionEvidenceDigest, occurredAt: input.occurredAt };
        if (!this.validShape(decision) || !time(recordedAtInput)
            || recordedAtInput < decision.occurredAt)
            throw new Error('Fine decision schema or time is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine decision audit chain is invalid');
        const proposal = this.proposals.get(decision.proposalId);
        if (!proposal || !this.trusted(decision, proposal))
            throw new Error('Fine decision is not trusted by proposal and authority');
        const amountGp = decision.disposition === 'approved' ? proposal.amountGp : 0;
        const decisionDigest = hash({ ...decision, amountGp });
        const existing = this.get(decision.decisionId);
        if (existing) {
            if (existing.decisionDigest !== decisionDigest)
                throw new Error('Fine decision id was reused with different content');
            return existing;
        }
        this.database.transaction(() => {
            this.database.run(`INSERT INTO fine_decision
                (decision_id,proposal_id,proposal_digest,jurisdiction_id,suspect_agent_id,
                    disposition,adjudicator_agent_id,decision_evidence_digest,occurred_at,
                    amount_gp,decision_digest,recorded_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
            [decision.decisionId, decision.proposalId, decision.proposalDigest,
                decision.jurisdictionId, decision.suspectAgentId, decision.disposition,
                decision.adjudicatorAgentId, decision.decisionEvidenceDigest,
                decision.occurredAt, amountGp, decisionDigest, recordedAtInput]);
            const previous = (this.database.query(`SELECT entry_hash FROM fine_decision_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { decisionId: decision.decisionId, decisionDigest, recordedAt: recordedAtInput };
            this.database.run(`INSERT INTO fine_decision_audit
                (decision_id,decision_digest,recorded_at,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5)`,
            [decision.decisionId, decisionDigest, recordedAtInput,
                previous, hash({ previousHash: previous, payload })]);
        }).immediate();
        return this.get(decision.decisionId)!;
    }
    verifyAuditChain(): boolean {
        try {
            const audits = this.database.query('SELECT * FROM fine_decision_audit ORDER BY sequence')
                .all() as AuditRow[];
            const count = this.database.query('SELECT COUNT(*) AS decisions FROM fine_decision')
                .get() as { decisions: number };
            if (audits.length !== count.decisions) return false;
            let previous = ZERO;
            for (const row of audits) {
                const raw = this.database.query('SELECT * FROM fine_decision WHERE decision_id=?1')
                    .get(row.decision_id) as DecisionRow | null;
                if (!raw) return false;
                const value = rowDecision(raw), input = request(value);
                const proposal = this.proposals.get(value.proposalId);
                if (!proposal || !this.validShape(input) || !time(value.recordedAt)
                    || value.recordedAt < value.occurredAt
                    || !this.trusted(input, proposal)
                    || value.amountGp !== (input.disposition === 'approved' ? proposal.amountGp : 0)
                    || value.decisionDigest !== hash({ ...input, amountGp: value.amountGp })
                    || row.decision_digest !== value.decisionDigest || row.recorded_at !== value.recordedAt)
                    return false;
                const payload = { decisionId: value.decisionId, decisionDigest: value.decisionDigest,
                    recordedAt: value.recordedAt };
                if (row.previous_hash !== previous
                    || row.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = row.entry_hash;
            }
            return true;
        } catch { return false; }
    }
    private validShape(value: FineDecisionRequest): boolean {
        return typeof value.decisionId === 'string' && ID.test(value.decisionId)
            && typeof value.proposalId === 'string' && ID.test(value.proposalId)
            && typeof value.proposalDigest === 'string' && DIGEST.test(value.proposalDigest)
            && typeof value.jurisdictionId === 'string' && ID.test(value.jurisdictionId)
            && typeof value.suspectAgentId === 'string' && ID.test(value.suspectAgentId)
            && ['approved', 'rejected'].includes(value.disposition)
            && typeof value.adjudicatorAgentId === 'string' && ID.test(value.adjudicatorAgentId)
            && typeof value.decisionEvidenceDigest === 'string'
            && DIGEST.test(value.decisionEvidenceDigest)
            && time(value.occurredAt);
    }
    private trusted(value: FineDecisionRequest, proposal: RecordedFineProposal): boolean {
        if (value.proposalDigest !== proposal.proposalDigest
            || value.jurisdictionId !== proposal.jurisdictionId
            || value.suspectAgentId !== proposal.suspectAgentId
            || value.occurredAt < proposal.recordedAt) return false;
        const jurisdiction = this.governance.getJurisdiction(value.jurisdictionId);
        if (!jurisdiction || !this.governance.isFactionActiveAt(jurisdiction.factionId, value.occurredAt))
            return false;
        const attested = this.verifyAuthority(Object.freeze({ ...value }), Object.freeze({ ...proposal }));
        return attested === value.decisionEvidenceDigest;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Fine decision schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE fine_decision (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT NOT NULL UNIQUE,
                proposal_id TEXT NOT NULL UNIQUE, proposal_digest TEXT NOT NULL,
                jurisdiction_id TEXT NOT NULL, suspect_agent_id TEXT NOT NULL,
                disposition TEXT NOT NULL CHECK (disposition IN ('approved','rejected')),
                adjudicator_agent_id TEXT NOT NULL, decision_evidence_digest TEXT NOT NULL,
                occurred_at TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK (amount_gp BETWEEN 0 AND 1000000000),
                decision_digest TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE fine_decision_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                decision_id TEXT NOT NULL UNIQUE REFERENCES fine_decision(decision_id),
                decision_digest TEXT NOT NULL, recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}
