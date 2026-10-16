import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { createFineProposalVerifier } from './fine-policy.js';
import type { FineProposal, FineProposalSources } from './fine-policy.js';
import { JurisdictionFinePolicyStore } from './fine-policy-store.js';
import { JurisdictionCrimePolicyStore } from './jurisdiction-policy-store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, ZERO = '0'.repeat(64);
const FIELDS = ['proposalId', 'findingId', 'findingDigest', 'suspectAgentId', 'jurisdictionId',
    'policyId', 'policyDigest', 'amountGp', 'authorityEvidenceDigest', 'occurredAt'];

export interface RecordedFineProposal extends FineProposal {
    proposalDigest: string;
    recordedAt: string;
}
type ProposalRow = { proposal_id: string; finding_id: string; finding_digest: string;
    suspect_agent_id: string; jurisdiction_id: string; policy_id: string; policy_digest: string;
    amount_gp: number; authority_evidence_digest: string; occurred_at: string;
    proposal_digest: string; recorded_at: string };
type AuditRow = { sequence: number; proposal_id: string; proposal_digest: string;
    recorded_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function time(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}
function proposal(row: ProposalRow): RecordedFineProposal {
    return { proposalId: row.proposal_id, findingId: row.finding_id,
        findingDigest: row.finding_digest, suspectAgentId: row.suspect_agent_id,
        jurisdictionId: row.jurisdiction_id, policyId: row.policy_id,
        policyDigest: row.policy_digest, amountGp: row.amount_gp,
        authorityEvidenceDigest: row.authority_evidence_digest, occurredAt: row.occurred_at,
        proposalDigest: row.proposal_digest, recordedAt: row.recorded_at };
}
function facts(value: RecordedFineProposal): FineProposal {
    return { proposalId: value.proposalId, findingId: value.findingId,
        findingDigest: value.findingDigest, suspectAgentId: value.suspectAgentId,
        jurisdictionId: value.jurisdictionId, policyId: value.policyId,
        policyDigest: value.policyDigest, amountGp: value.amountGp,
        authorityEvidenceDigest: value.authorityEvidenceDigest, occurredAt: value.occurredAt };
}

/** Append-only recommendation ledger; cannot create a debt, debit or treasury credit. */
export class FineProposalStore {
    private readonly database: Database;
    private readonly verifyProposal: (proposal: Readonly<FineProposal>) => boolean;

    constructor(path: string, policies: JurisdictionFinePolicyStore,
        crimePolicies: JurisdictionCrimePolicyStore,
        sources: Omit<FineProposalSources, 'crimePolicies'>) {
        if (!(policies instanceof JurisdictionFinePolicyStore)
            || !(crimePolicies instanceof JurisdictionCrimePolicyStore))
            throw new Error('Fine proposals require durable audited policy catalogs');
        this.verifyProposal = createFineProposalVerifier(policies, { ...sources, crimePolicies });
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(proposalIdInput: string): RecordedFineProposal | null {
        if (typeof proposalIdInput !== 'string' || !ID.test(proposalIdInput))
            throw new Error('proposalId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine proposal audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_proposal WHERE proposal_id=?1')
            .get(proposalIdInput) as ProposalRow | null;
        return row ? proposal(row) : null;
    }
    listForFinding(findingIdInput: string): RecordedFineProposal[] {
        if (typeof findingIdInput !== 'string' || !ID.test(findingIdInput))
            throw new Error('findingId is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine proposal audit chain is invalid');
        return (this.database.query('SELECT * FROM fine_proposal WHERE finding_id=?1 ORDER BY sequence')
            .all(findingIdInput) as ProposalRow[]).map(proposal);
    }
    record(input: FineProposal, recordedAtInput = new Date().toISOString()): RecordedFineProposal {
        if (!input || Object.keys(input).sort().join(',') !== [...FIELDS].sort().join(','))
            throw new Error('Fine proposal fields are invalid');
        const request: FineProposal = { proposalId: input.proposalId, findingId: input.findingId,
            findingDigest: input.findingDigest, suspectAgentId: input.suspectAgentId,
            jurisdictionId: input.jurisdictionId, policyId: input.policyId,
            policyDigest: input.policyDigest, amountGp: input.amountGp,
            authorityEvidenceDigest: input.authorityEvidenceDigest, occurredAt: input.occurredAt };
        if (!time(recordedAtInput) || !time(request.occurredAt)
            || recordedAtInput < request.occurredAt)
            throw new Error('Fine proposal recording predates its decision');
        if (!this.verifyAuditChain()) throw new Error('Fine proposal audit chain is invalid');
        if (!this.verifyProposal(Object.freeze({ ...request })))
            throw new Error('Fine proposal is not trusted by policy and evidence');
        const proposalDigest = hash(request);
        const existing = this.get(request.proposalId);
        if (existing) {
            if (existing.proposalDigest !== proposalDigest)
                throw new Error('Fine proposal id was reused with different content');
            return existing;
        }
        this.database.transaction(() => {
            this.database.run(`INSERT INTO fine_proposal
                (proposal_id,finding_id,finding_digest,suspect_agent_id,jurisdiction_id,policy_id,
                    policy_digest,amount_gp,authority_evidence_digest,occurred_at,proposal_digest,recorded_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
            [request.proposalId, request.findingId, request.findingDigest,
                request.suspectAgentId, request.jurisdictionId, request.policyId,
                request.policyDigest, request.amountGp, request.authorityEvidenceDigest,
                request.occurredAt, proposalDigest, recordedAtInput]);
            const previous = (this.database.query(`SELECT entry_hash FROM fine_proposal_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { proposalId: request.proposalId, proposalDigest, recordedAt: recordedAtInput };
            this.database.run(`INSERT INTO fine_proposal_audit
                (proposal_id,proposal_digest,recorded_at,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5)`,
            [request.proposalId, proposalDigest, recordedAtInput,
                previous, hash({ previousHash: previous, payload })]);
        }).immediate();
        return this.get(request.proposalId)!;
    }
    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM fine_proposal_audit ORDER BY sequence')
                .all() as AuditRow[];
            const count = this.database.query('SELECT COUNT(*) AS proposals FROM fine_proposal')
                .get() as { proposals: number };
            if (rows.length !== count.proposals) return false;
            let previous = ZERO;
            for (const row of rows) {
                const stored = this.database.query('SELECT * FROM fine_proposal WHERE proposal_id=?1')
                    .get(row.proposal_id) as ProposalRow | null;
                if (!stored) return false;
                const value = proposal(stored), request = facts(value);
                if (!time(value.recordedAt) || !time(value.occurredAt)
                    || value.recordedAt < value.occurredAt
                    || value.proposalDigest !== hash(request)
                    || row.proposal_digest !== value.proposalDigest
                    || row.recorded_at !== value.recordedAt
                    || !this.verifyProposal(Object.freeze({ ...request }))) return false;
                const payload = { proposalId: value.proposalId, proposalDigest: value.proposalDigest,
                    recordedAt: value.recordedAt };
                if (row.previous_hash !== previous
                    || row.entry_hash !== hash({ previousHash: previous, payload })) return false;
                previous = row.entry_hash;
            }
            return true;
        } catch { return false; }
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Fine proposal schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE fine_proposal (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id TEXT NOT NULL UNIQUE,
                finding_id TEXT NOT NULL UNIQUE, finding_digest TEXT NOT NULL,
                suspect_agent_id TEXT NOT NULL, jurisdiction_id TEXT NOT NULL, policy_id TEXT NOT NULL,
                policy_digest TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK (amount_gp BETWEEN 1 AND 1000000000),
                authority_evidence_digest TEXT NOT NULL, occurred_at TEXT NOT NULL,
                proposal_digest TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE fine_proposal_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id TEXT NOT NULL UNIQUE REFERENCES fine_proposal(proposal_id),
                proposal_digest TEXT NOT NULL, recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}
