import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { GovernanceStore } from './governance.js';

export type GovernancePolicyKind = 'tax' | 'tariff' | 'fee' | 'subsidy';
export type GovernancePolicyTrigger = 'property-transfer' | 'property-ownership' | 'business-revenue'
    | 'business-registration' | 'goods-import' | 'property-development';
export type GovernancePolicyStatus = 'draft' | 'active' | 'superseded' | 'revoked';
export type GovernancePolicyCalculation = { mode: 'flat'; amountGp: number }
    | { mode: 'basis-points'; rateBps: number; minimumGp: number; maximumGp: number };

export interface GovernancePolicy {
    policyId: string;
    jurisdictionId: string;
    policyKey: string;
    version: number;
    kind: GovernancePolicyKind;
    trigger: GovernancePolicyTrigger;
    name: string;
    calculation: GovernancePolicyCalculation;
    status: GovernancePolicyStatus;
    revision: number;
    createdAt: string;
    activatedAt: string | null;
    revokedAt: string | null;
    updatedAt: string;
}

export interface CreateGovernancePolicy {
    policyId: string;
    jurisdictionId: string;
    policyKey: string;
    version: number;
    kind: GovernancePolicyKind;
    trigger: GovernancePolicyTrigger;
    name: string;
    calculation: GovernancePolicyCalculation;
    createdByAgentId: string;
}

export interface GovernancePolicyAuditEntry {
    sequence: number;
    policyId: string;
    jurisdictionId: string;
    action: 'created' | 'activated' | 'superseded' | 'revoked';
    actorAgentId: string;
    fromStatus: GovernancePolicyStatus | null;
    toStatus: GovernancePolicyStatus;
    createdAt: string;
}

interface PolicyRow {
    policy_id: string; jurisdiction_id: string; policy_key: string; version: number;
    kind: GovernancePolicyKind; trigger_kind: GovernancePolicyTrigger; name: string;
    calculation_mode: 'flat' | 'basis-points'; flat_amount_gp: number | null; rate_bps: number | null;
    minimum_gp: number; maximum_gp: number; status: GovernancePolicyStatus; revision: number;
    created_at: string; activated_at: string | null; revoked_at: string | null; updated_at: string;
}

interface AuditRow {
    sequence: number; policy_id: string; jurisdiction_id: string;
    action: GovernancePolicyAuditEntry['action']; actor_agent_id: string;
    from_status: GovernancePolicyStatus | null; to_status: GovernancePolicyStatus; created_at: string;
}

const ALLOWED_TRIGGERS: Readonly<Record<GovernancePolicyKind, ReadonlySet<GovernancePolicyTrigger>>> = {
    tax: new Set(['property-transfer', 'property-ownership', 'business-revenue']),
    tariff: new Set(['goods-import']),
    fee: new Set(['property-transfer', 'business-registration']),
    subsidy: new Set(['business-revenue', 'property-development'])
};

function stableId(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,95}$/.test(normalized)) throw new Error(`${field} is invalid`);
    return normalized;
}

function text(value: string, field: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 120) throw new Error(`${field} is invalid`);
    return normalized;
}

function timestamp(value: string, field: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid`);
    return new Date(value).toISOString();
}

function gp(value: number, field: string, allowZero = true): number {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
        throw new Error(`${field} is invalid`);
    }
    return value;
}

function normalizeCalculation(value: GovernancePolicyCalculation): GovernancePolicyCalculation {
    if (value.mode === 'flat') return { mode: 'flat', amountGp: gp(value.amountGp, 'amountGp', false) };
    if (value.mode !== 'basis-points' || !Number.isSafeInteger(value.rateBps)
        || value.rateBps < 1 || value.rateBps > 10_000) throw new Error('rateBps is invalid');
    const minimumGp = gp(value.minimumGp, 'minimumGp');
    const maximumGp = gp(value.maximumGp, 'maximumGp');
    if (maximumGp < minimumGp) throw new Error('Policy calculation bounds are invalid');
    return { mode: 'basis-points', rateBps: value.rateBps, minimumGp, maximumGp };
}

function policy(row: PolicyRow): GovernancePolicy {
    const calculation: GovernancePolicyCalculation = row.calculation_mode === 'flat'
        ? { mode: 'flat', amountGp: row.flat_amount_gp! }
        : { mode: 'basis-points', rateBps: row.rate_bps!,
            minimumGp: row.minimum_gp, maximumGp: row.maximum_gp };
    return { policyId: row.policy_id, jurisdictionId: row.jurisdiction_id,
        policyKey: row.policy_key, version: row.version, kind: row.kind, trigger: row.trigger_kind,
        name: row.name, calculation, status: row.status, revision: row.revision,
        createdAt: row.created_at, activatedAt: row.activated_at,
        revokedAt: row.revoked_at, updatedAt: row.updated_at };
}

function audit(row: AuditRow): GovernancePolicyAuditEntry {
    return { sequence: row.sequence, policyId: row.policy_id, jurisdictionId: row.jurisdiction_id,
        action: row.action, actorAgentId: row.actor_agent_id, fromStatus: row.from_status,
        toStatus: row.to_status, createdAt: row.created_at };
}

export function calculateGovernancePolicyAmount(policyValue: GovernancePolicy, basisGpInput: number): number {
    const basisGp = gp(basisGpInput, 'basisGp');
    if (policyValue.calculation.mode === 'flat') return policyValue.calculation.amountGp;
    const proportional = Math.floor(basisGp * policyValue.calculation.rateBps / 10_000);
    return Math.min(policyValue.calculation.maximumGp,
        Math.max(policyValue.calculation.minimumGp, proportional));
}

export class GovernancePolicyStore {
    private readonly database: Database;

    constructor(path: string) {
        const governance = new GovernanceStore(path);
        governance.close();
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
    }

    close(): void { this.database.close(true); }

    create(input: CreateGovernancePolicy, now = new Date().toISOString()): GovernancePolicy {
        const policyId = stableId(input.policyId, 'policyId');
        const jurisdictionId = stableId(input.jurisdictionId, 'jurisdictionId');
        const policyKey = stableId(input.policyKey, 'policyKey');
        if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 1_000_000) {
            throw new Error('Policy version is invalid');
        }
        if (!ALLOWED_TRIGGERS[input.kind]?.has(input.trigger)) {
            throw new Error('Policy trigger is not allowed for its kind');
        }
        const name = text(input.name, 'name');
        const calculation = normalizeCalculation(input.calculation);
        const createdByAgentId = stableId(input.createdByAgentId, 'createdByAgentId');
        const createdAt = timestamp(now, 'now');
        const scope = this.database.query(`SELECT j.jurisdiction_id, f.status FROM governance_jurisdiction j
            JOIN governance_faction f ON f.faction_id = j.faction_id
            WHERE j.jurisdiction_id = ?1`).get(jurisdictionId) as { jurisdiction_id: string;
                status: 'active' | 'disabled' } | null;
        if (!scope) throw new Error('Jurisdiction does not exist');
        if (scope.status !== 'active') throw new Error('Faction is disabled and read-only');
        const existing = this.get(policyId);
        if (existing) {
            const exact = existing.jurisdictionId === jurisdictionId && existing.policyKey === policyKey
                && existing.version === input.version && existing.kind === input.kind
                && existing.trigger === input.trigger && existing.name === name
                && JSON.stringify(existing.calculation) === JSON.stringify(calculation)
                && this.getAuditActor(policyId, 'created') === createdByAgentId;
            if (!exact) throw new Error('Policy id was reused with different content');
            return existing;
        }
        const latest = this.database.query(`SELECT COALESCE(MAX(version), 0) AS version FROM governance_policy
            WHERE jurisdiction_id = ?1 AND policy_key = ?2`).get(jurisdictionId, policyKey) as { version: number };
        if (input.version !== latest.version + 1) throw new Error('Policy version must follow its policy family');
        const flatAmountGp = calculation.mode === 'flat' ? calculation.amountGp : null;
        const rateBps = calculation.mode === 'basis-points' ? calculation.rateBps : null;
        const minimumGp = calculation.mode === 'basis-points' ? calculation.minimumGp : 0;
        const maximumGp = calculation.mode === 'basis-points' ? calculation.maximumGp : 2_147_483_647;
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO governance_policy
                (policy_id, jurisdiction_id, policy_key, version, kind, trigger_kind, name,
                    calculation_mode, flat_amount_gp, rate_bps, minimum_gp, maximum_gp,
                    status, revision, created_at, activated_at, revoked_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    'draft', 1, ?13, NULL, NULL, ?13)`,
            [policyId, jurisdictionId, policyKey, input.version, input.kind, input.trigger, name,
                calculation.mode, flatAmountGp, rateBps, minimumGp, maximumGp, createdAt]);
            this.insertAudit(policyId, jurisdictionId, 'created', createdByAgentId, null, 'draft', createdAt);
        });
        try { transaction.immediate(); } catch (error) {
            if (String(error).includes('UNIQUE constraint failed')) {
                throw new Error('Policy id or jurisdiction policy version already exists');
            }
            throw error;
        }
        return this.get(policyId)!;
    }

    get(policyIdInput: string): GovernancePolicy | null {
        const policyId = stableId(policyIdInput, 'policyId');
        const row = this.database.query('SELECT * FROM governance_policy WHERE policy_id = ?1')
            .get(policyId) as PolicyRow | null;
        return row ? policy(row) : null;
    }

    listForJurisdiction(jurisdictionIdInput: string, limit = 100): GovernancePolicy[] {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit is invalid');
        return (this.database.query(`SELECT * FROM governance_policy WHERE jurisdiction_id = ?1
            ORDER BY policy_key, version DESC, policy_id LIMIT ?2`)
            .all(jurisdictionId, limit) as PolicyRow[]).map(policy);
    }

    listActive(jurisdictionIdInput: string, trigger?: GovernancePolicyTrigger): GovernancePolicy[] {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        const rows = trigger
            ? this.database.query(`SELECT * FROM governance_policy WHERE jurisdiction_id = ?1
                AND trigger_kind = ?2 AND status = 'active' ORDER BY kind, policy_key`)
                .all(jurisdictionId, trigger) as PolicyRow[]
            : this.database.query(`SELECT * FROM governance_policy WHERE jurisdiction_id = ?1
                AND status = 'active' ORDER BY trigger_kind, kind, policy_key`)
                .all(jurisdictionId) as PolicyRow[];
        return rows.map(policy);
    }

    listEffective(jurisdictionIdInput: string, trigger: GovernancePolicyTrigger,
        occurredAtInput: string): GovernancePolicy[] {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        const occurredAt = timestamp(occurredAtInput, 'occurredAt');
        return (this.database.query(`SELECT * FROM governance_policy
            WHERE jurisdiction_id = ?1 AND trigger_kind = ?2 AND activated_at IS NOT NULL
            AND activated_at <= ?3 AND (revoked_at IS NULL OR revoked_at > ?3)
            ORDER BY kind, policy_key, version`).all(jurisdictionId, trigger, occurredAt) as PolicyRow[]).map(policy);
    }

    activate(policyIdInput: string, expectedRevision: number, approvedByAgentIdInput: string,
        now = new Date().toISOString()): GovernancePolicy {
        const policyId = stableId(policyIdInput, 'policyId');
        const approvedByAgentId = stableId(approvedByAgentIdInput, 'approvedByAgentId');
        const current = this.get(policyId);
        if (!current) throw new Error('Policy does not exist');
        this.assertJurisdictionWritable(current.jurisdictionId);
        if (current.status === 'active') {
            if (this.getAuditActor(policyId, 'activated') !== approvedByAgentId) {
                throw new Error('Policy activation replay has a different approver');
            }
            return current;
        }
        if (current.status !== 'draft') throw new Error('Only a draft policy may be activated');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Policy revision is invalid');
        const activatedAt = timestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            const previousRow = this.database.query(`SELECT * FROM governance_policy
                WHERE jurisdiction_id = ?1 AND policy_key = ?2 AND status = 'active'`)
                .get(current.jurisdictionId, current.policyKey) as PolicyRow | null;
            if (previousRow) {
                const previous = policy(previousRow);
                this.database.run(`UPDATE governance_policy SET status = 'superseded',
                    revision = revision + 1, revoked_at = ?2, updated_at = ?2
                    WHERE policy_id = ?1 AND status = 'active'`, [previous.policyId, activatedAt]);
                this.insertAudit(previous.policyId, previous.jurisdictionId, 'superseded', approvedByAgentId,
                    'active', 'superseded', activatedAt);
            }
            const updated = this.database.run(`UPDATE governance_policy SET status = 'active',
                revision = revision + 1, activated_at = ?3, updated_at = ?3
                WHERE policy_id = ?1 AND revision = ?2 AND status = 'draft'`,
            [policyId, expectedRevision, activatedAt]);
            if (updated.changes !== 1) throw new Error('Policy changed before activation; refresh and try again');
            this.insertAudit(policyId, current.jurisdictionId, 'activated', approvedByAgentId,
                'draft', 'active', activatedAt);
        });
        transaction.immediate();
        return this.get(policyId)!;
    }

    revoke(policyIdInput: string, expectedRevision: number, revokedByAgentIdInput: string,
        now = new Date().toISOString()): GovernancePolicy {
        const policyId = stableId(policyIdInput, 'policyId');
        const revokedByAgentId = stableId(revokedByAgentIdInput, 'revokedByAgentId');
        const current = this.get(policyId);
        if (!current) throw new Error('Policy does not exist');
        this.assertJurisdictionWritable(current.jurisdictionId);
        if (current.status === 'revoked') {
            if (this.getAuditActor(policyId, 'revoked') !== revokedByAgentId) {
                throw new Error('Policy revocation replay has a different actor');
            }
            return current;
        }
        if (current.status === 'superseded') throw new Error('Superseded policy is immutable');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Policy revision is invalid');
        const revokedAt = timestamp(now, 'now');
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE governance_policy SET status = 'revoked',
                revision = revision + 1, revoked_at = ?3, updated_at = ?3
                WHERE policy_id = ?1 AND revision = ?2 AND status IN ('draft', 'active')`,
            [policyId, expectedRevision, revokedAt]);
            if (updated.changes !== 1) throw new Error('Policy changed before revocation; refresh and try again');
            this.insertAudit(policyId, current.jurisdictionId, 'revoked', revokedByAgentId,
                current.status, 'revoked', revokedAt);
        });
        transaction.immediate();
        return this.get(policyId)!;
    }

    listAudit(jurisdictionIdInput: string): GovernancePolicyAuditEntry[] {
        const jurisdictionId = stableId(jurisdictionIdInput, 'jurisdictionId');
        return (this.database.query(`SELECT * FROM governance_policy_audit
            WHERE jurisdiction_id = ?1 ORDER BY sequence`).all(jurisdictionId) as AuditRow[]).map(audit);
    }

    private insertAudit(policyId: string, jurisdictionId: string,
        action: GovernancePolicyAuditEntry['action'], actorAgentId: string,
        fromStatus: GovernancePolicyStatus | null, toStatus: GovernancePolicyStatus, createdAt: string): void {
        this.database.run(`INSERT INTO governance_policy_audit
            (policy_id, jurisdiction_id, action, actor_agent_id, from_status, to_status, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        [policyId, jurisdictionId, action, actorAgentId, fromStatus, toStatus, createdAt]);
    }

    private getAuditActor(policyId: string, action: GovernancePolicyAuditEntry['action']): string | null {
        const row = this.database.query(`SELECT actor_agent_id FROM governance_policy_audit
            WHERE policy_id = ?1 AND action = ?2 ORDER BY sequence DESC LIMIT 1`)
            .get(policyId, action) as { actor_agent_id: string } | null;
        return row?.actor_agent_id ?? null;
    }

    private assertJurisdictionWritable(jurisdictionId: string): void {
        const active = this.database.query(`SELECT 1 FROM governance_jurisdiction j
            JOIN governance_faction f ON f.faction_id = j.faction_id
            WHERE j.jurisdiction_id = ?1 AND f.status = 'active'`).get(jurisdictionId);
        if (!active) throw new Error('Faction is disabled and read-only');
    }
}
