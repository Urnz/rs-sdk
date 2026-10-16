import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';

import { GovernanceStore } from '../server/gateway/admin/governance.js';
import { digestJurisdictionFinePolicy } from './fine-policy.js';
import type { JurisdictionFinePolicy } from './fine-policy.js';

const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const POLICY_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const ZERO = '0'.repeat(64);
type Status = 'draft' | 'active' | 'superseded' | 'revoked';
type Action = 'created' | 'activated' | 'superseded' | 'revoked';

export interface CreateJurisdictionFinePolicy {
    policyId: string;
    jurisdictionId: string;
    version: number;
    maxFineGp: number;
    createdByAgentId: string;
}
export interface StoredJurisdictionFinePolicy extends CreateJurisdictionFinePolicy {
    status: Status;
    revision: number;
    rulesDigest: string;
    policyDigest: string | null;
    createdAt: string;
    effectiveFrom: string | null;
    endedAt: string | null;
    updatedAt: string;
}
export interface JurisdictionFinePolicyAuditEntry {
    sequence: number;
    policyId: string;
    action: Action;
    actorAgentId: string;
    fromStatus: Status | null;
    toStatus: Status;
    rulesDigest: string;
    policyDigest: string | null;
    occurredAt: string;
    previousHash: string;
    entryHash: string;
}
type PolicyRow = { policy_id: string; jurisdiction_id: string; version: number; max_fine_gp: number;
    rules_digest: string; status: Status; revision: number; created_by_agent_id: string; created_at: string;
    effective_from: string | null; ended_at: string | null; policy_digest: string | null; updated_at: string };
type AuditRow = { sequence: number; policy_id: string; action: Action; actor_agent_id: string;
    from_status: Status | null; to_status: Status; rules_digest: string; policy_digest: string | null;
    occurred_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: string, field: string, pattern = ID): string {
    if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: string, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`);
    return value;
}
function rules(input: Pick<CreateJurisdictionFinePolicy, 'policyId' | 'jurisdictionId' | 'version'
    | 'maxFineGp'>): string {
    return hash({ schemaVersion: 1, policyId: input.policyId, jurisdictionId: input.jurisdictionId,
        version: input.version, maxFineGp: input.maxFineGp });
}
function policy(row: PolicyRow): StoredJurisdictionFinePolicy {
    return { policyId: row.policy_id, jurisdictionId: row.jurisdiction_id, version: row.version,
        maxFineGp: row.max_fine_gp, createdByAgentId: row.created_by_agent_id, status: row.status,
        revision: row.revision, rulesDigest: row.rules_digest, policyDigest: row.policy_digest,
        createdAt: row.created_at, effectiveFrom: row.effective_from, endedAt: row.ended_at,
        updatedAt: row.updated_at };
}
function activePolicy(value: StoredJurisdictionFinePolicy): JurisdictionFinePolicy {
    if (!value.effectiveFrom) throw new Error('Fine policy was never activated');
    return { schemaVersion: 1, policyId: value.policyId, jurisdictionId: value.jurisdictionId,
        version: value.version, createdAt: value.createdAt, effectiveFrom: value.effectiveFrom,
        maxFineGp: value.maxFineGp };
}
function audit(row: AuditRow): JurisdictionFinePolicyAuditEntry {
    return { sequence: row.sequence, policyId: row.policy_id, action: row.action,
        actorAgentId: row.actor_agent_id, fromStatus: row.from_status, toStatus: row.to_status,
        rulesDigest: row.rules_digest, policyDigest: row.policy_digest, occurredAt: row.occurred_at,
        previousHash: row.previous_hash, entryHash: row.entry_hash };
}

/** Same Governance database and FK; each policy transition and audit append commit together. */
export class JurisdictionFinePolicyStore {
    private readonly database: Database;

    constructor(path: string) {
        const governance = new GovernanceStore(path);
        governance.close();
        this.database = new Database(path, { strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
    }
    close(): void { this.database.close(true); }

    get(policyIdInput: string): StoredJurisdictionFinePolicy | null {
        if (!this.verifyAuditChain()) throw new Error('Fine policy audit chain is invalid');
        const row = this.database.query('SELECT * FROM governance_fine_policy WHERE policy_id=?1')
            .get(id(policyIdInput, 'policyId', POLICY_ID)) as PolicyRow | null;
        return row ? policy(row) : null;
    }
    listForJurisdiction(jurisdictionIdInput: string): StoredJurisdictionFinePolicy[] {
        if (!this.verifyAuditChain()) throw new Error('Fine policy audit chain is invalid');
        return (this.database.query(`SELECT * FROM governance_fine_policy WHERE jurisdiction_id=?1
            ORDER BY version`).all(id(jurisdictionIdInput, 'jurisdictionId')) as PolicyRow[]).map(policy);
    }
    listAudit(): JurisdictionFinePolicyAuditEntry[] {
        if (!this.verifyAuditChain()) throw new Error('Fine policy audit chain is invalid');
        return (this.database.query('SELECT * FROM governance_fine_policy_audit ORDER BY sequence')
            .all() as AuditRow[]).map(audit);
    }
    create(input: CreateJurisdictionFinePolicy, now = new Date().toISOString()): StoredJurisdictionFinePolicy {
        const policyId = id(input.policyId, 'policyId', POLICY_ID);
        const jurisdictionId = id(input.jurisdictionId, 'jurisdictionId');
        const createdByAgentId = id(input.createdByAgentId, 'createdByAgentId');
        const createdAt = time(now, 'now');
        if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 1_000_000
            || !Number.isSafeInteger(input.maxFineGp) || input.maxFineGp < 1
            || input.maxFineGp > 1_000_000_000) throw new Error('Fine policy version or limit is invalid');
        const rulesDigest = rules({ policyId, jurisdictionId, version: input.version,
            maxFineGp: input.maxFineGp });
        if (!this.verifyAuditChain()) throw new Error('Fine policy audit chain is invalid');
        const existing = this.get(policyId);
        if (existing) {
            if (existing.rulesDigest !== rulesDigest || existing.createdByAgentId !== createdByAgentId)
                throw new Error('Fine policy id was reused with different content');
            return existing;
        }
        this.assertWritable(jurisdictionId);
        this.database.transaction(() => {
            const latest = this.database.query(`SELECT COALESCE(MAX(version),0) AS version
                FROM governance_fine_policy WHERE jurisdiction_id=?1`)
                .get(jurisdictionId) as { version: number };
            if (input.version !== latest.version + 1)
                throw new Error('Fine policy version must follow its jurisdiction family');
            this.database.run(`INSERT INTO governance_fine_policy
                (policy_id,jurisdiction_id,version,max_fine_gp,rules_digest,status,revision,
                    created_by_agent_id,created_at,effective_from,ended_at,policy_digest,updated_at)
                VALUES (?1,?2,?3,?4,?5,'draft',1,?6,?7,NULL,NULL,NULL,?7)`,
            [policyId, jurisdictionId, input.version, input.maxFineGp, rulesDigest,
                createdByAgentId, createdAt]);
            this.insertAudit(policyId, 'created', createdByAgentId, null, 'draft', rulesDigest,
                null, createdAt);
        }).immediate();
        return this.get(policyId)!;
    }
    activate(policyIdInput: string, expectedRevision: number, approvedByAgentIdInput: string,
        now = new Date().toISOString()): StoredJurisdictionFinePolicy {
        const policyId = id(policyIdInput, 'policyId', POLICY_ID);
        const actor = id(approvedByAgentIdInput, 'approvedByAgentId');
        const activatedAt = time(now, 'now');
        const current = this.get(policyId);
        if (!current) throw new Error('Fine policy does not exist');
        if (current.status === 'active') {
            if (this.listAudit().find(entry => entry.policyId === policyId && entry.action === 'activated')
                ?.actorAgentId !== actor) throw new Error('Fine policy activation replay has a different approver');
            return current;
        }
        if (current.status !== 'draft') throw new Error('Only a draft fine policy may be activated');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
            throw new Error('Fine policy revision is invalid');
        this.assertWritable(current.jurisdictionId);
        if (activatedAt < current.createdAt) throw new Error('Fine policy activation predates creation');
        const policyDigest = digestJurisdictionFinePolicy(activePolicy({ ...current,
            effectiveFrom: activatedAt }));
        this.database.transaction(() => {
            const previous = this.database.query(`SELECT * FROM governance_fine_policy
                WHERE jurisdiction_id=?1 AND status='active'`)
                .get(current.jurisdictionId) as PolicyRow | null;
            const newest = this.database.query(`SELECT MAX(version) AS version, MAX(effective_from) AS effective_from
                FROM governance_fine_policy WHERE jurisdiction_id=?1 AND effective_from IS NOT NULL`)
                .get(current.jurisdictionId) as { version: number | null; effective_from: string | null };
            if ((newest.version !== null && current.version <= newest.version)
                || (newest.effective_from !== null && activatedAt <= newest.effective_from))
                throw new Error('Fine policy activation must advance version and time');
            if (previous) {
                this.database.run(`UPDATE governance_fine_policy SET status='superseded', revision=revision+1,
                    ended_at=?2, updated_at=?2 WHERE policy_id=?1 AND status='active'`,
                [previous.policy_id, activatedAt]);
                this.insertAudit(previous.policy_id, 'superseded', actor, 'active', 'superseded',
                    previous.rules_digest, previous.policy_digest, activatedAt);
            }
            const updated = this.database.run(`UPDATE governance_fine_policy SET status='active',
                revision=revision+1, effective_from=?3, policy_digest=?4, updated_at=?3
                WHERE policy_id=?1 AND revision=?2 AND status='draft'`,
            [policyId, expectedRevision, activatedAt, policyDigest]);
            if (updated.changes !== 1) throw new Error('Fine policy changed before activation');
            this.insertAudit(policyId, 'activated', actor, 'draft', 'active', current.rulesDigest,
                policyDigest, activatedAt);
        }).immediate();
        return this.get(policyId)!;
    }
    revoke(policyIdInput: string, expectedRevision: number, revokedByAgentIdInput: string,
        now = new Date().toISOString()): StoredJurisdictionFinePolicy {
        const policyId = id(policyIdInput, 'policyId', POLICY_ID);
        const actor = id(revokedByAgentIdInput, 'revokedByAgentId');
        const revokedAt = time(now, 'now');
        const current = this.get(policyId);
        if (!current) throw new Error('Fine policy does not exist');
        if (current.status === 'revoked') {
            if (this.listAudit().find(entry => entry.policyId === policyId && entry.action === 'revoked')
                ?.actorAgentId !== actor) throw new Error('Fine policy revocation replay has a different actor');
            return current;
        }
        if (current.status === 'superseded') throw new Error('Superseded fine policy is immutable');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
            throw new Error('Fine policy revision is invalid');
        this.assertWritable(current.jurisdictionId);
        if (revokedAt < (current.effectiveFrom ?? current.createdAt))
            throw new Error('Fine policy revocation predates its current state');
        this.database.transaction(() => {
            const updated = this.database.run(`UPDATE governance_fine_policy SET status='revoked',
                revision=revision+1, ended_at=CASE WHEN effective_from IS NULL THEN NULL ELSE ?3 END,
                updated_at=?3 WHERE policy_id=?1 AND revision=?2 AND status IN ('draft','active')`,
            [policyId, expectedRevision, revokedAt]);
            if (updated.changes !== 1) throw new Error('Fine policy changed before revocation');
            this.insertAudit(policyId, 'revoked', actor, current.status, 'revoked', current.rulesDigest,
                current.policyDigest, revokedAt);
        }).immediate();
        return this.get(policyId)!;
    }
    /** Historical intervals retain their original cap, even after supersession or revocation. */
    listEffectiveAt(jurisdictionIdInput: string, occurredAtInput: string): JurisdictionFinePolicy[] {
        const jurisdictionId = id(jurisdictionIdInput, 'jurisdictionId');
        const occurredAt = time(occurredAtInput, 'occurredAt');
        if (!this.verifyAuditChain()) throw new Error('Fine policy audit chain is invalid');
        const rows = this.database.query(`SELECT * FROM governance_fine_policy
            WHERE jurisdiction_id=?1 AND effective_from<=?2 AND (ended_at IS NULL OR ended_at>?2)
            ORDER BY version DESC`).all(jurisdictionId, occurredAt) as PolicyRow[];
        if (rows.length > 1) throw new Error('Overlapping fine policy effective intervals');
        return rows.map(row => activePolicy(policy(row)));
    }
    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM governance_fine_policy').all() as PolicyRow[];
            const audits = this.database.query('SELECT * FROM governance_fine_policy_audit ORDER BY sequence')
                .all() as AuditRow[];
            const states = new Map<string, { status: Status; revision: number; createdAt: string;
                createdBy: string; effectiveFrom: string | null; endedAt: string | null;
                policyDigest: string | null; updatedAt: string }>();
            let previous = ZERO;
            for (const row of audits) {
                time(row.occurred_at, 'audit occurredAt');
                const facts = { policyId: row.policy_id, action: row.action, actorAgentId: row.actor_agent_id,
                    fromStatus: row.from_status, toStatus: row.to_status, rulesDigest: row.rules_digest,
                    policyDigest: row.policy_digest, occurredAt: row.occurred_at };
                if (row.previous_hash !== previous || row.entry_hash !== hash({ previousHash: previous, facts }))
                    return false;
                previous = row.entry_hash;
                const prior = states.get(row.policy_id);
                if (row.action === 'created') {
                    if (prior || row.from_status !== null || row.to_status !== 'draft'
                        || row.policy_digest !== null) return false;
                    states.set(row.policy_id, { status: 'draft', revision: 1, createdAt: row.occurred_at,
                        createdBy: row.actor_agent_id, effectiveFrom: null, endedAt: null,
                        policyDigest: null, updatedAt: row.occurred_at });
                    continue;
                }
                if (!prior || row.from_status !== prior.status || row.occurred_at < prior.updatedAt)
                    return false;
                if (row.action === 'activated' && prior.status === 'draft' && row.to_status === 'active'
                    && row.policy_digest) {
                    prior.effectiveFrom = row.occurred_at;
                    prior.policyDigest = row.policy_digest;
                } else if (row.action === 'superseded' && prior.status === 'active'
                    && row.to_status === 'superseded' && row.policy_digest === prior.policyDigest)
                    prior.endedAt = row.occurred_at;
                else if (row.action === 'revoked' && (prior.status === 'draft' || prior.status === 'active')
                    && row.to_status === 'revoked' && row.policy_digest === prior.policyDigest) {
                    if (prior.effectiveFrom) prior.endedAt = row.occurred_at;
                } else return false;
                prior.status = row.to_status;
                prior.revision++;
                prior.updatedAt = row.occurred_at;
            }
            if (states.size !== rows.length) return false;
            for (const row of rows) {
                const current = policy(row), state = states.get(row.policy_id);
                if (!state || current.rulesDigest !== rules(current)
                    || current.createdAt !== state.createdAt || current.createdByAgentId !== state.createdBy
                    || current.status !== state.status || current.revision !== state.revision
                    || current.effectiveFrom !== state.effectiveFrom || current.endedAt !== state.endedAt
                    || current.updatedAt !== state.updatedAt || current.policyDigest !== state.policyDigest
                    || current.policyDigest !== (current.effectiveFrom
                        ? digestJurisdictionFinePolicy(activePolicy(current)) : null)) return false;
                for (const entry of audits.filter(value => value.policy_id === row.policy_id)) {
                    if (entry.rules_digest !== current.rulesDigest || entry.policy_digest !== null
                        && entry.policy_digest !== current.policyDigest) return false;
                }
            }
            return true;
        } catch { return false; }
    }
    private assertWritable(jurisdictionId: string): void {
        const active = this.database.query(`SELECT 1 FROM governance_jurisdiction j
            JOIN governance_faction f ON f.faction_id=j.faction_id
            WHERE j.jurisdiction_id=?1 AND f.status='active'`).get(jurisdictionId);
        if (!active) throw new Error('Jurisdiction is absent or its faction is disabled');
    }
    private insertAudit(policyId: string, action: Action, actorAgentId: string,
        fromStatus: Status | null, toStatus: Status, rulesDigest: string,
        policyDigest: string | null, occurredAt: string): void {
        const latest = this.database.query(`SELECT entry_hash FROM governance_fine_policy_audit
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null;
        const previousHash = latest?.entry_hash ?? ZERO;
        const facts = { policyId, action, actorAgentId, fromStatus, toStatus,
            rulesDigest, policyDigest, occurredAt };
        const entryHash = hash({ previousHash, facts });
        this.database.run(`INSERT INTO governance_fine_policy_audit
            (policy_id,action,actor_agent_id,from_status,to_status,rules_digest,policy_digest,
                occurred_at,previous_hash,entry_hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
        [policyId, action, actorAgentId, fromStatus, toStatus, rulesDigest, policyDigest,
            occurredAt, previousHash, entryHash]);
    }
}
