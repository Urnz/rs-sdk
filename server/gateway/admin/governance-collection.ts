import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { GovernanceStore } from './governance.js';
import { GovernanceObligationStore, type GovernanceEconomicActorRef,
    type GovernanceObligation } from './governance-obligations.js';
import { InstitutionTreasuryStore, type InstitutionKind,
    type InstitutionTreasuryTransfer } from './institution-treasury.js';

export type GovernanceExemptionStatus = 'active' | 'revoked';
export type GovernanceObligationResolutionKind = 'collected' | 'exempted' | 'waived';

export interface GovernanceExemption {
    exemptionId: string;
    jurisdictionId: string;
    policyKey: string | null;
    beneficiary: GovernanceEconomicActorRef;
    validFrom: string;
    validUntil: string | null;
    reason: string;
    status: GovernanceExemptionStatus;
    revision: number;
    createdByAgentId: string;
    createdAt: string;
    revokedAt: string | null;
    updatedAt: string;
}

export interface CreateGovernanceExemption {
    exemptionId: string;
    jurisdictionId: string;
    policyKey?: string;
    beneficiary: GovernanceEconomicActorRef;
    validFrom: string;
    validUntil?: string;
    reason: string;
    createdByAgentId: string;
}

export interface GovernanceObligationResolution {
    obligationId: string;
    kind: GovernanceObligationResolutionKind;
    settlementId: string | null;
    exemptionId: string | null;
    actorAgentId: string;
    reason: string;
    resolvedAt: string;
}

export interface GovernanceArrear {
    obligation: GovernanceObligation;
    overdueSince: string;
    overdueMs: number;
}

export interface GovernanceObligationAuditEntry {
    sequence: number;
    obligationId: string;
    action: GovernanceObligationResolutionKind | 'collection-failed';
    actorAgentId: string;
    settlementId: string | null;
    reason: string;
    createdAt: string;
}

export interface GovernanceExemptionAuditEntry {
    sequence: number;
    exemptionId: string;
    action: 'created' | 'revoked';
    actorAgentId: string;
    reason: string;
    createdAt: string;
}

interface ExemptionRow {
    exemption_id: string; jurisdiction_id: string; policy_key: string | null;
    beneficiary_kind: GovernanceEconomicActorRef['kind']; beneficiary_id: string;
    valid_from: string; valid_until: string | null; reason: string; status: GovernanceExemptionStatus;
    revision: number; created_by_agent_id: string; created_at: string;
    revoked_at: string | null; updated_at: string;
}

interface ResolutionRow {
    obligation_id: string; resolution_kind: GovernanceObligationResolutionKind;
    settlement_id: string | null; exemption_id: string | null; actor_agent_id: string;
    reason: string; resolved_at: string;
}

interface AuditRow {
    sequence: number; obligation_id: string; action: GovernanceObligationAuditEntry['action'];
    actor_agent_id: string; settlement_id: string | null; reason: string; created_at: string;
}

interface ExemptionAuditRow {
    sequence: number; exemption_id: string; action: GovernanceExemptionAuditEntry['action'];
    actor_agent_id: string; reason: string; created_at: string;
}

function id(value: string, field: string, maximum = 95): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,}$/.test(normalized) || normalized.length > maximum) {
        throw new Error(`${field} is invalid`);
    }
    return normalized;
}

function actor(value: GovernanceEconomicActorRef): GovernanceEconomicActorRef {
    if (!['player', 'business', 'faction'].includes(value.kind)) throw new Error('Beneficiary kind is invalid');
    return { kind: value.kind, id: id(value.id, 'beneficiaryId', 64) };
}

function text(value: string, field: string, minimum = 1): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < minimum || normalized.length > 500) throw new Error(`${field} is invalid`);
    return normalized;
}

function timestamp(value: string, field: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid`);
    return new Date(value).toISOString();
}

function exemption(row: ExemptionRow): GovernanceExemption {
    return { exemptionId: row.exemption_id, jurisdictionId: row.jurisdiction_id,
        policyKey: row.policy_key, beneficiary: { kind: row.beneficiary_kind, id: row.beneficiary_id },
        validFrom: row.valid_from, validUntil: row.valid_until, reason: row.reason, status: row.status,
        revision: row.revision, createdByAgentId: row.created_by_agent_id, createdAt: row.created_at,
        revokedAt: row.revoked_at, updatedAt: row.updated_at };
}

function resolution(row: ResolutionRow): GovernanceObligationResolution {
    return { obligationId: row.obligation_id, kind: row.resolution_kind,
        settlementId: row.settlement_id, exemptionId: row.exemption_id,
        actorAgentId: row.actor_agent_id, reason: row.reason, resolvedAt: row.resolved_at };
}

function audit(row: AuditRow): GovernanceObligationAuditEntry {
    return { sequence: row.sequence, obligationId: row.obligation_id, action: row.action,
        actorAgentId: row.actor_agent_id, settlementId: row.settlement_id,
        reason: row.reason, createdAt: row.created_at };
}

export class GovernanceCollectionService {
    private readonly database: Database;
    private readonly obligations: GovernanceObligationStore;
    private readonly treasury: InstitutionTreasuryStore;

    constructor(governancePath: string, treasuryPath: string) {
        const governance = new GovernanceStore(governancePath);
        governance.close();
        mkdirSync(dirname(governancePath), { recursive: true });
        this.database = new Database(governancePath, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.obligations = new GovernanceObligationStore(governancePath);
        this.treasury = new InstitutionTreasuryStore(treasuryPath);
    }

    close(): void {
        this.treasury.close();
        this.obligations.close();
        this.database.close(true);
    }

    getExemption(exemptionIdInput: string): GovernanceExemption | null {
        const row = this.database.query('SELECT * FROM governance_exemption WHERE exemption_id = ?1')
            .get(id(exemptionIdInput, 'exemptionId')) as ExemptionRow | null;
        return row ? exemption(row) : null;
    }

    createExemption(input: CreateGovernanceExemption,
        now = new Date().toISOString()): GovernanceExemption {
        const exemptionId = id(input.exemptionId, 'exemptionId');
        const jurisdictionId = id(input.jurisdictionId, 'jurisdictionId');
        const policyKey = input.policyKey ? id(input.policyKey, 'policyKey') : null;
        const beneficiary = actor(input.beneficiary);
        const validFrom = timestamp(input.validFrom, 'validFrom');
        const validUntil = input.validUntil ? timestamp(input.validUntil, 'validUntil') : null;
        if (validUntil && validUntil <= validFrom) throw new Error('Exemption validity window is invalid');
        const reason = text(input.reason, 'reason', 8);
        const createdByAgentId = id(input.createdByAgentId, 'createdByAgentId');
        const createdAt = timestamp(now, 'now');
        const scope = this.database.query('SELECT 1 FROM governance_jurisdiction WHERE jurisdiction_id = ?1')
            .get(jurisdictionId);
        if (!scope) throw new Error('Jurisdiction does not exist');
        if (policyKey && !this.database.query(`SELECT 1 FROM governance_policy
            WHERE jurisdiction_id = ?1 AND policy_key = ?2 LIMIT 1`).get(jurisdictionId, policyKey)) {
            throw new Error('Exemption policy family does not exist in the jurisdiction');
        }
        const existing = this.getExemption(exemptionId);
        if (existing) {
            const exact = existing.jurisdictionId === jurisdictionId && existing.policyKey === policyKey
                && existing.beneficiary.kind === beneficiary.kind && existing.beneficiary.id === beneficiary.id
                && existing.validFrom === validFrom && existing.validUntil === validUntil
                && existing.reason === reason && existing.createdByAgentId === createdByAgentId;
            if (!exact) throw new Error('Exemption id was reused with different content');
            return existing;
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO governance_exemption
                (exemption_id, jurisdiction_id, policy_key, beneficiary_kind, beneficiary_id,
                    valid_from, valid_until, reason, status, revision, created_by_agent_id,
                    created_at, revoked_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', 1, ?9, ?10, NULL, ?10)`,
            [exemptionId, jurisdictionId, policyKey, beneficiary.kind, beneficiary.id,
                validFrom, validUntil, reason, createdByAgentId, createdAt]);
            this.database.run(`INSERT INTO governance_exemption_audit
                (exemption_id, action, actor_agent_id, reason, created_at)
                VALUES (?1, 'created', ?2, ?3, ?4)`, [exemptionId, createdByAgentId, reason, createdAt]);
        });
        transaction.immediate();
        return this.getExemption(exemptionId)!;
    }

    revokeExemption(exemptionIdInput: string, expectedRevision: number, actorAgentIdInput: string,
        reasonInput: string, now = new Date().toISOString()): GovernanceExemption {
        const exemptionId = id(exemptionIdInput, 'exemptionId');
        const actorAgentId = id(actorAgentIdInput, 'actorAgentId');
        const reason = text(reasonInput, 'reason', 8);
        const revokedAt = timestamp(now, 'now');
        const current = this.getExemption(exemptionId);
        if (!current) throw new Error('Exemption does not exist');
        if (current.status === 'revoked') return current;
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE governance_exemption SET status = 'revoked',
                revision = revision + 1, revoked_at = ?3, updated_at = ?3
                WHERE exemption_id = ?1 AND revision = ?2 AND status = 'active'`,
            [exemptionId, expectedRevision, revokedAt]);
            if (updated.changes !== 1) throw new Error('Exemption changed before revocation; refresh and try again');
            this.database.run(`INSERT INTO governance_exemption_audit
                (exemption_id, action, actor_agent_id, reason, created_at)
                VALUES (?1, 'revoked', ?2, ?3, ?4)`, [exemptionId, actorAgentId, reason, revokedAt]);
        });
        transaction.immediate();
        return this.getExemption(exemptionId)!;
    }

    listExemptionAudit(exemptionIdInput: string): GovernanceExemptionAuditEntry[] {
        const exemptionId = id(exemptionIdInput, 'exemptionId');
        return (this.database.query(`SELECT * FROM governance_exemption_audit
            WHERE exemption_id = ?1 ORDER BY sequence`).all(exemptionId) as ExemptionAuditRow[])
            .map(row => ({ sequence: row.sequence, exemptionId: row.exemption_id, action: row.action,
                actorAgentId: row.actor_agent_id, reason: row.reason, createdAt: row.created_at }));
    }

    getResolution(obligationIdInput: string): GovernanceObligationResolution | null {
        const row = this.database.query(`SELECT * FROM governance_obligation_resolution
            WHERE obligation_id = ?1`).get(id(obligationIdInput, 'obligationId')) as ResolutionRow | null;
        return row ? resolution(row) : null;
    }

    listArrears(asOfInput = new Date().toISOString(), gracePeriodMs = 7 * 24 * 60 * 60 * 1_000,
        limit = 100): GovernanceArrear[] {
        const asOf = timestamp(asOfInput, 'asOf');
        if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0 || gracePeriodMs > 365 * 24 * 60 * 60 * 1_000) {
            throw new Error('gracePeriodMs is invalid');
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit is invalid');
        const cutoff = new Date(Date.parse(asOf) - gracePeriodMs).toISOString();
        const rows = this.database.query(`SELECT o.obligation_id FROM governance_obligation o
            LEFT JOIN governance_obligation_resolution r ON r.obligation_id = o.obligation_id
            WHERE r.obligation_id IS NULL AND o.created_at <= ?1
            ORDER BY o.created_at, o.obligation_id LIMIT ?2`).all(cutoff, limit) as Array<{ obligation_id: string }>;
        return rows.map(row => {
            const obligation = this.obligations.getObligation(row.obligation_id)!;
            const overdueSince = new Date(Date.parse(obligation.createdAt) + gracePeriodMs).toISOString();
            return { obligation, overdueSince, overdueMs: Date.parse(asOf) - Date.parse(overdueSince) };
        });
    }

    collectInstitutionObligation(obligationIdInput: string, settlementId: string,
        actorAgentIdInput: string, now = new Date().toISOString()): {
            resolution: GovernanceObligationResolution; transfer: InstitutionTreasuryTransfer;
        } {
        const obligationId = id(obligationIdInput, 'obligationId');
        if (!/^[0-9a-f-]{36}$/i.test(settlementId)) throw new Error('settlementId is invalid');
        const actorAgentId = id(actorAgentIdInput, 'actorAgentId');
        const settledAt = timestamp(now, 'now');
        const obligation = this.obligations.getObligation(obligationId);
        if (!obligation) throw new Error('Governance obligation does not exist');
        const existing = this.getResolution(obligationId);
        if (existing) {
            if (existing.kind !== 'collected' || existing.settlementId !== settlementId) {
                throw new Error('Governance obligation was already resolved differently');
            }
            const transfer = this.treasury.getTransfer(settlementId);
            if (!transfer) throw new Error('Collected obligation is missing its treasury transfer');
            return { resolution: existing, transfer };
        }
        if (obligation.debtor.kind === 'player' || obligation.creditor.kind === 'player') {
            throw new Error('Player obligations require a verified external settlement adapter');
        }
        try {
            this.treasury.reserve(obligation.debtor.kind as InstitutionKind, obligation.debtor.id,
                obligation.obligationId, obligation.amountGp, settledAt);
            this.treasury.bindSettlement(obligation.obligationId, settlementId, settledAt);
            const transfer = this.treasury.transferReserved(obligation.obligationId, settlementId,
                obligation.creditor.kind as InstitutionKind, obligation.creditor.id, settledAt);
            this.resolve(obligationId, 'collected', actorAgentId,
                'Collected through the atomic institution treasury transfer.', settledAt, settlementId, null);
            return { resolution: this.getResolution(obligationId)!, transfer };
        } catch (error) {
            const reason = text(`Collection failed: ${error instanceof Error ? error.message : String(error)}`,
                'collection failure');
            this.insertAudit(obligationId, 'collection-failed', actorAgentId, settlementId, reason, settledAt);
            throw error;
        }
    }

    waiveObligation(obligationIdInput: string, actorAgentIdInput: string, reasonInput: string,
        now = new Date().toISOString()): GovernanceObligationResolution {
        const obligationId = id(obligationIdInput, 'obligationId');
        if (!this.obligations.getObligation(obligationId)) throw new Error('Governance obligation does not exist');
        const actorAgentId = id(actorAgentIdInput, 'actorAgentId');
        const reason = text(reasonInput, 'reason', 8);
        const resolvedAt = timestamp(now, 'now');
        const existing = this.getResolution(obligationId);
        if (existing) {
            if (existing.kind === 'waived' && existing.actorAgentId === actorAgentId && existing.reason === reason) {
                return existing;
            }
            throw new Error('Governance obligation was already resolved differently');
        }
        this.resolve(obligationId, 'waived', actorAgentId, reason, resolvedAt, null, null);
        return this.getResolution(obligationId)!;
    }

    listObligationAudit(obligationIdInput: string): GovernanceObligationAuditEntry[] {
        const obligationId = id(obligationIdInput, 'obligationId');
        return (this.database.query(`SELECT * FROM governance_obligation_audit
            WHERE obligation_id = ?1 ORDER BY sequence`).all(obligationId) as AuditRow[]).map(audit);
    }

    private resolve(obligationId: string, kind: GovernanceObligationResolutionKind, actorAgentId: string,
        reason: string, resolvedAt: string, settlementId: string | null, exemptionId: string | null): void {
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO governance_obligation_resolution
                (obligation_id, resolution_kind, settlement_id, exemption_id,
                    actor_agent_id, reason, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            [obligationId, kind, settlementId, exemptionId, actorAgentId, reason, resolvedAt]);
            this.database.run(`INSERT INTO governance_obligation_audit
                (obligation_id, action, actor_agent_id, settlement_id, reason, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
            [obligationId, kind, actorAgentId, settlementId, reason, resolvedAt]);
        });
        transaction.immediate();
    }

    private insertAudit(obligationId: string, action: GovernanceObligationAuditEntry['action'],
        actorAgentId: string, settlementId: string | null, reason: string, createdAt: string): void {
        this.database.run(`INSERT INTO governance_obligation_audit
            (obligation_id, action, actor_agent_id, settlement_id, reason, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        [obligationId, action, actorAgentId, settlementId, reason, createdAt]);
    }
}
