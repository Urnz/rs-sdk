import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { AgentStateStore } from '../agent-state/store.js';
import type { GovernanceStore } from '../server/gateway/admin/governance.js';
import type { FineDecisionAuthorityVerifier } from './fine-decision-store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);

export interface IssueFineAdjudicatorGrant {
    grantId: string;
    jurisdictionId: string;
    adjudicatorAgentId: string;
    issuedByAgentId: string;
    authorityEvidenceDigest: string;
    occurredAt: string;
}
export interface RevokeFineAdjudicatorGrant {
    grantId: string;
    revokedByAgentId: string;
    authorityEvidenceDigest: string;
    occurredAt: string;
}
export interface FineAdjudicatorGrant extends IssueFineAdjudicatorGrant {
    grantDigest: string;
    status: 'active' | 'revoked';
    revision: number;
    revokedByAgentId: string | null;
    revocationEvidenceDigest: string | null;
    revokedAt: string | null;
}
export type FineGrantAuthorityVerifier = (command: Readonly<IssueFineAdjudicatorGrant
    | RevokeFineAdjudicatorGrant>) => string | null;

type GrantRow = { grant_id: string; jurisdiction_id: string; adjudicator_agent_id: string;
    issued_by_agent_id: string; authority_evidence_digest: string; granted_at: string;
    grant_digest: string; status: 'active' | 'revoked'; revision: number;
    revoked_by_agent_id: string | null; revocation_evidence_digest: string | null;
    revoked_at: string | null };
type AuditRow = { sequence: number; grant_id: string; action: 'issued' | 'revoked';
    actor_agent_id: string; authority_evidence_digest: string; grant_digest: string;
    occurred_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown): value is string { return typeof value === 'string' && DIGEST.test(value); }
function time(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}
function grant(row: GrantRow): FineAdjudicatorGrant {
    return { grantId: row.grant_id, jurisdictionId: row.jurisdiction_id,
        adjudicatorAgentId: row.adjudicator_agent_id, issuedByAgentId: row.issued_by_agent_id,
        authorityEvidenceDigest: row.authority_evidence_digest, occurredAt: row.granted_at,
        grantDigest: row.grant_digest, status: row.status, revision: row.revision,
        revokedByAgentId: row.revoked_by_agent_id,
        revocationEvidenceDigest: row.revocation_evidence_digest, revokedAt: row.revoked_at };
}
function issueFacts(value: FineAdjudicatorGrant): IssueFineAdjudicatorGrant {
    return { grantId: value.grantId, jurisdictionId: value.jurisdictionId,
        adjudicatorAgentId: value.adjudicatorAgentId, issuedByAgentId: value.issuedByAgentId,
        authorityEvidenceDigest: value.authorityEvidenceDigest, occurredAt: value.occurredAt };
}

/** Historical, capability-specific appointment; no agent profession class or payment authority. */
export class FineAdjudicatorGrantStore {
    private readonly database: Database;

    constructor(path: string,
        private readonly governance: Pick<GovernanceStore, 'getJurisdiction' | 'isFactionActiveAt'>,
        private readonly agents: Pick<AgentStateStore, 'getIdentity'>,
        private readonly verifyGrantAuthority: FineGrantAuthorityVerifier) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(grantIdInput: string): FineAdjudicatorGrant | null {
        const grantId = id(grantIdInput, 'grantId');
        if (!this.verifyAuditChain()) throw new Error('Fine grant audit chain is invalid');
        const row = this.database.query('SELECT * FROM fine_adjudicator_grant WHERE grant_id=?1')
            .get(grantId) as GrantRow | null;
        return row ? grant(row) : null;
    }
    issue(input: IssueFineAdjudicatorGrant): FineAdjudicatorGrant {
        if (!input || Object.keys(input).sort().join(',') !== [
            'grantId', 'jurisdictionId', 'adjudicatorAgentId', 'issuedByAgentId',
            'authorityEvidenceDigest', 'occurredAt'
        ].sort().join(',')) throw new Error('Fine grant fields are invalid');
        const command: IssueFineAdjudicatorGrant = { grantId: id(input.grantId, 'grantId'),
            jurisdictionId: id(input.jurisdictionId, 'jurisdictionId'),
            adjudicatorAgentId: id(input.adjudicatorAgentId, 'adjudicatorAgentId'),
            issuedByAgentId: id(input.issuedByAgentId, 'issuedByAgentId'),
            authorityEvidenceDigest: input.authorityEvidenceDigest,
            occurredAt: input.occurredAt };
        if (!digest(command.authorityEvidenceDigest) || !time(command.occurredAt))
            throw new Error('Fine grant evidence or time is invalid');
        if (command.adjudicatorAgentId === command.issuedByAgentId)
            throw new Error('Fine adjudicator cannot appoint themselves');
        if (!this.verifyAuditChain()) throw new Error('Fine grant audit chain is invalid');
        const existing = this.get(command.grantId), grantDigest = hash(command);
        if (existing) {
            if (existing.grantDigest !== grantDigest) throw new Error('Fine grant id was reused');
            return existing;
        }
        const jurisdiction = this.governance.getJurisdiction(command.jurisdictionId);
        if (!jurisdiction || jurisdiction.createdAt > command.occurredAt
            || !this.governance.isFactionActiveAt(jurisdiction.factionId, command.occurredAt))
            throw new Error('Fine grant jurisdiction is absent or inactive');
        for (const agentId of [command.adjudicatorAgentId, command.issuedByAgentId]) {
            const identity = this.agents.getIdentity(agentId);
            if (!identity || identity.createdAt > command.occurredAt)
                throw new Error('Fine grant requires existing agent identities');
        }
        if (this.verifyGrantAuthority(Object.freeze({ ...command })) !== command.authorityEvidenceDigest)
            throw new Error('Fine grant issuance authority is not trusted');
        this.database.transaction(() => {
            const history = this.database.query(`SELECT granted_at,revoked_at
                FROM fine_adjudicator_grant WHERE jurisdiction_id=?1 AND adjudicator_agent_id=?2`)
                .all(command.jurisdictionId, command.adjudicatorAgentId) as Array<{
                    granted_at: string; revoked_at: string | null }>;
            if (history.some(row => row.granted_at >= command.occurredAt
                || row.revoked_at === null || row.revoked_at > command.occurredAt))
                throw new Error('Fine grant interval overlaps existing appointment');
            this.database.run(`INSERT INTO fine_adjudicator_grant
                (grant_id,jurisdiction_id,adjudicator_agent_id,issued_by_agent_id,
                    authority_evidence_digest,granted_at,grant_digest,status,revision,
                    revoked_by_agent_id,revocation_evidence_digest,revoked_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,'active',1,NULL,NULL,NULL)`,
            [command.grantId, command.jurisdictionId, command.adjudicatorAgentId,
                command.issuedByAgentId, command.authorityEvidenceDigest,
                command.occurredAt, grantDigest]);
            this.insertAudit(command.grantId, 'issued', command.issuedByAgentId,
                command.authorityEvidenceDigest, grantDigest, command.occurredAt);
        }).immediate();
        return this.get(command.grantId)!;
    }
    revoke(input: RevokeFineAdjudicatorGrant, expectedRevision: number): FineAdjudicatorGrant {
        if (!input || Object.keys(input).sort().join(',') !== [
            'grantId', 'revokedByAgentId', 'authorityEvidenceDigest', 'occurredAt'
        ].sort().join(',')) throw new Error('Fine grant revocation fields are invalid');
        const command: RevokeFineAdjudicatorGrant = { grantId: id(input.grantId, 'grantId'),
            revokedByAgentId: id(input.revokedByAgentId, 'revokedByAgentId'),
            authorityEvidenceDigest: input.authorityEvidenceDigest,
            occurredAt: input.occurredAt };
        if (!digest(command.authorityEvidenceDigest) || !time(command.occurredAt)
            || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
            throw new Error('Fine grant revocation evidence, time or revision is invalid');
        const current = this.get(command.grantId);
        if (!current) throw new Error('Fine grant does not exist');
        if (current.status === 'revoked') {
            if (current.revokedByAgentId !== command.revokedByAgentId
                || current.revocationEvidenceDigest !== command.authorityEvidenceDigest
                || current.revokedAt !== command.occurredAt)
                throw new Error('Fine grant revocation replay differs');
            return current;
        }
        if (command.occurredAt < current.occurredAt)
            throw new Error('Fine grant revocation predates issuance');
        const revoker = this.agents.getIdentity(command.revokedByAgentId);
        if (!revoker || revoker.createdAt > command.occurredAt)
            throw new Error('Fine grant revocation requires an existing agent');
        if (this.verifyGrantAuthority(Object.freeze({ ...command })) !== command.authorityEvidenceDigest)
            throw new Error('Fine grant revocation authority is not trusted');
        this.database.transaction(() => {
            const changed = this.database.run(`UPDATE fine_adjudicator_grant SET status='revoked',
                revision=revision+1, revoked_by_agent_id=?3, revocation_evidence_digest=?4,
                revoked_at=?5 WHERE grant_id=?1 AND revision=?2 AND status='active'`,
            [command.grantId, expectedRevision, command.revokedByAgentId,
                command.authorityEvidenceDigest, command.occurredAt]);
            if (changed.changes !== 1) throw new Error('Fine grant changed before revocation');
            this.insertAudit(command.grantId, 'revoked', command.revokedByAgentId,
                command.authorityEvidenceDigest, current.grantDigest, command.occurredAt);
        }).immediate();
        return this.get(command.grantId)!;
    }
    isAuthorizedAt(jurisdictionIdInput: string, adjudicatorAgentIdInput: string,
        occurredAtInput: string): boolean {
        const jurisdictionId = id(jurisdictionIdInput, 'jurisdictionId');
        const adjudicatorAgentId = id(adjudicatorAgentIdInput, 'adjudicatorAgentId');
        if (!time(occurredAtInput)) throw new Error('Fine adjudication time is invalid');
        if (!this.verifyAuditChain()) throw new Error('Fine grant audit chain is invalid');
        const row = this.database.query(`SELECT 1 FROM fine_adjudicator_grant
            WHERE jurisdiction_id=?1 AND adjudicator_agent_id=?2 AND granted_at<=?3
                AND (revoked_at IS NULL OR revoked_at>?3) LIMIT 1`)
            .get(jurisdictionId, adjudicatorAgentId, occurredAtInput);
        const jurisdiction = this.governance.getJurisdiction(jurisdictionId);
        return Boolean(row && jurisdiction
            && this.governance.isFactionActiveAt(jurisdiction.factionId, occurredAtInput));
    }
    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM fine_adjudicator_grant').all() as GrantRow[];
            const audits = this.database.query('SELECT * FROM fine_adjudicator_grant_audit ORDER BY sequence')
                .all() as AuditRow[];
            const states = new Map<string, { status: 'active' | 'revoked'; revision: number;
                revokedBy: string | null; revocationEvidence: string | null; revokedAt: string | null }>();
            let previous = ZERO;
            for (const row of audits) {
                const facts = { grantId: row.grant_id, action: row.action,
                    actorAgentId: row.actor_agent_id,
                    authorityEvidenceDigest: row.authority_evidence_digest,
                    grantDigest: row.grant_digest, occurredAt: row.occurred_at };
                if (!time(row.occurred_at) || !digest(row.authority_evidence_digest)
                    || row.previous_hash !== previous
                    || row.entry_hash !== hash({ previousHash: previous, facts })) return false;
                previous = row.entry_hash;
                const state = states.get(row.grant_id);
                if (row.action === 'issued') {
                    if (state) return false;
                    states.set(row.grant_id, { status: 'active', revision: 1,
                        revokedBy: null, revocationEvidence: null, revokedAt: null });
                } else if (row.action === 'revoked' && state?.status === 'active') {
                    state.status = 'revoked'; state.revision++;
                    state.revokedBy = row.actor_agent_id;
                    state.revocationEvidence = row.authority_evidence_digest;
                    state.revokedAt = row.occurred_at;
                } else return false;
            }
            if (states.size !== rows.length) return false;
            for (const row of rows) {
                const value = grant(row), state = states.get(value.grantId);
                if (!state || !time(value.occurredAt) || !digest(value.authorityEvidenceDigest)
                    || value.grantDigest !== hash(issueFacts(value))
                    || value.status !== state.status || value.revision !== state.revision
                    || value.revokedByAgentId !== state.revokedBy
                    || value.revocationEvidenceDigest !== state.revocationEvidence
                    || value.revokedAt !== state.revokedAt) return false;
                const entries = audits.filter(entry => entry.grant_id === value.grantId);
                if (entries[0]?.action !== 'issued' || entries[0].actor_agent_id !== value.issuedByAgentId
                    || entries[0].authority_evidence_digest !== value.authorityEvidenceDigest
                    || entries[0].occurred_at !== value.occurredAt
                    || entries.some(entry => entry.grant_digest !== value.grantDigest)
                    || (value.revokedAt !== null && value.revokedAt < value.occurredAt)) return false;
            }
            return true;
        } catch { return false; }
    }
    private insertAudit(grantId: string, action: 'issued' | 'revoked', actorAgentId: string,
        authorityEvidenceDigest: string, grantDigest: string, occurredAt: string): void {
        const latest = this.database.query(`SELECT entry_hash FROM fine_adjudicator_grant_audit
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null;
        const previousHash = latest?.entry_hash ?? ZERO;
        const facts = { grantId, action, actorAgentId, authorityEvidenceDigest,
            grantDigest, occurredAt };
        this.database.run(`INSERT INTO fine_adjudicator_grant_audit
            (grant_id,action,actor_agent_id,authority_evidence_digest,grant_digest,
                occurred_at,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
        [grantId, action, actorAgentId, authorityEvidenceDigest, grantDigest,
            occurredAt, previousHash, hash({ previousHash, facts })]);
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Fine grant schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE fine_adjudicator_grant (
                grant_id TEXT PRIMARY KEY, jurisdiction_id TEXT NOT NULL,
                adjudicator_agent_id TEXT NOT NULL, issued_by_agent_id TEXT NOT NULL,
                authority_evidence_digest TEXT NOT NULL, granted_at TEXT NOT NULL,
                grant_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','revoked')),
                revision INTEGER NOT NULL CHECK(revision>=1), revoked_by_agent_id TEXT,
                revocation_evidence_digest TEXT, revoked_at TEXT,
                CHECK ((status='active' AND revoked_by_agent_id IS NULL
                    AND revocation_evidence_digest IS NULL AND revoked_at IS NULL)
                    OR (status='revoked' AND revoked_by_agent_id IS NOT NULL
                    AND revocation_evidence_digest IS NOT NULL AND revoked_at IS NOT NULL)))`);
            this.database.run(`CREATE UNIQUE INDEX fine_adjudicator_active_grant
                ON fine_adjudicator_grant(jurisdiction_id,adjudicator_agent_id)
                WHERE status='active'`);
            this.database.run(`CREATE TABLE fine_adjudicator_grant_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                grant_id TEXT NOT NULL REFERENCES fine_adjudicator_grant(grant_id),
                action TEXT NOT NULL CHECK(action IN ('issued','revoked')),
                actor_agent_id TEXT NOT NULL, authority_evidence_digest TEXT NOT NULL,
                grant_digest TEXT NOT NULL, occurred_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}

/** Use a separately authenticated action; a grant alone never proves a decision happened. */
export function createFineAdjudicatorAuthorityVerifier(grants: FineAdjudicatorGrantStore,
    verifyExplicitAction: FineDecisionAuthorityVerifier): FineDecisionAuthorityVerifier {
    return (decision, proposal) => grants.isAuthorizedAt(decision.jurisdictionId,
        decision.adjudicatorAgentId, decision.occurredAt)
        ? verifyExplicitAction(decision, proposal) : null;
}
