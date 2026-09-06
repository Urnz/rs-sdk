import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { AdminPropertyOwner, AdminPropertyView } from './properties.js';
import { GovernanceStore, type Faction, type Jurisdiction } from './governance.js';

export interface ManorPropertyEvidence {
    propertyId: string;
    status: AdminPropertyView['state']['status'];
    owner: AdminPropertyOwner | null;
    acquiredAt: string | null;
    sourceUpdatedAt: string;
    stateVersion: number;
}

export interface VerifiedManorPropertyEvidence {
    propertyId: string;
    evidenceDigest: string;
    verifiedAt: string;
}

export interface ManorPropertyEvidenceVerifier {
    verify(evidence: Readonly<ManorPropertyEvidence>): Promise<VerifiedManorPropertyEvidence>;
}

export interface ManorPropertyLink {
    manorJurisdictionId: string;
    propertyId: string;
    propertyStateVersion: number;
    acquiredAt: string | null;
    verifiedAt: string;
    updatedAt: string;
}

export interface ManorPortfolio {
    faction: Faction;
    jurisdiction: Jurisdiction;
    properties: ManorPropertyLink[];
    seat: ManorPropertyLink | null;
    unverifiedSeatPropertyId: string | null;
}

export interface ManorPropertyAuditEntry {
    sequence: number;
    manorJurisdictionId: string;
    propertyId: string | null;
    action: 'linked' | 'verified' | 'unlinked' | 'seat-designated' | 'seat-cleared';
    propertyStateVersion: number;
    actorAgentId: string;
    reason: string;
    createdAt: string;
}

interface LinkRow {
    manor_jurisdiction_id: string; property_id: string; property_state_version: number;
    evidence_digest: string; acquired_at: string | null; verified_at: string; updated_at: string;
}

interface AuditRow {
    sequence: number; manor_jurisdiction_id: string; property_id: string | null;
    action: ManorPropertyAuditEntry['action']; property_state_version: number;
    actor_agent_id: string; reason: string; created_at: string;
}

function stableId(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized)) throw new Error(`${field} is invalid`);
    return normalized;
}

function propertyId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(normalized) || normalized.length > 64) {
        throw new Error('propertyId is invalid');
    }
    return normalized;
}

function timestamp(value: string, field: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid`);
    return new Date(value).toISOString();
}

function reason(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized.length < 8 || normalized.length > 500) throw new Error('reason is invalid');
    return normalized;
}

function link(row: LinkRow): ManorPropertyLink {
    return { manorJurisdictionId: row.manor_jurisdiction_id, propertyId: row.property_id,
        propertyStateVersion: row.property_state_version, acquiredAt: row.acquired_at,
        verifiedAt: row.verified_at, updatedAt: row.updated_at };
}

function normalizeEvidence(property: AdminPropertyView): ManorPropertyEvidence {
    const id = propertyId(property.propertyId);
    if (!Number.isSafeInteger(property.state.version) || property.state.version < 1) {
        throw new Error('Property state version is invalid');
    }
    const owner = property.state.owner ? {
        kind: property.state.owner.kind,
        id: stableId(property.state.owner.id, 'Property owner id')
    } : null;
    return { propertyId: id, status: property.state.status, owner,
        acquiredAt: property.state.acquiredAt
            ? timestamp(property.state.acquiredAt, 'Property acquiredAt') : null,
        sourceUpdatedAt: timestamp(property.state.updatedAt, 'Property updatedAt'),
        stateVersion: property.state.version };
}

export function digestManorPropertyEvidence(evidence: ManorPropertyEvidence): string {
    return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, ...evidence })).digest('hex');
}

export class GovernanceManorService {
    private readonly database: Database;
    private readonly governance: GovernanceStore;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.governance = new GovernanceStore(path);
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
    }

    close(): void {
        this.database.close(true);
        this.governance.close();
    }

    getPortfolio(manorJurisdictionIdInput: string): ManorPortfolio {
        const { jurisdiction, faction } = this.manor(manorJurisdictionIdInput);
        const properties = (this.database.query(`SELECT * FROM governance_manor_property
            WHERE manor_jurisdiction_id = ?1 ORDER BY property_id`)
            .all(jurisdiction.jurisdictionId) as LinkRow[]).map(link);
        const seat = jurisdiction.seatPropertyId
            ? properties.find(item => item.propertyId === jurisdiction.seatPropertyId) ?? null : null;
        return { faction, jurisdiction, properties, seat,
            unverifiedSeatPropertyId: jurisdiction.seatPropertyId && !seat
                ? jurisdiction.seatPropertyId : null };
    }

    async reconcileProperty(manorJurisdictionIdInput: string, property: AdminPropertyView,
        verifier: ManorPropertyEvidenceVerifier, actorAgentIdInput: string, reasonInput: string,
        now = new Date().toISOString()): Promise<ManorPropertyLink | null> {
        const { jurisdiction, faction } = this.manor(manorJurisdictionIdInput);
        const evidence = normalizeEvidence(property);
        const verified = await verifier.verify(Object.freeze({ ...evidence,
            owner: evidence.owner ? Object.freeze({ ...evidence.owner }) : null }));
        if (propertyId(verified.propertyId) !== evidence.propertyId
            || verified.evidenceDigest !== digestManorPropertyEvidence(evidence)) {
            throw new Error('Manor property verifier returned mismatched evidence');
        }
        const verifiedAt = timestamp(verified.verifiedAt, 'verifiedAt');
        if (verifiedAt < evidence.sourceUpdatedAt) {
            throw new Error('Manor property verification predates the Property state');
        }
        const evidenceDigest = digestManorPropertyEvidence(evidence);
        const updatedAt = timestamp(now, 'now');
        const actorAgentId = stableId(actorAgentIdInput, 'actorAgentId');
        const auditReason = reason(reasonInput);
        const existingRow = this.database.query(`SELECT * FROM governance_manor_property
            WHERE property_id = ?1`).get(evidence.propertyId) as LinkRow | null;
        const existing = existingRow ? link(existingRow) : null;
        if (existing && existing.manorJurisdictionId !== jurisdiction.jurisdictionId) {
            throw new Error('Property is already linked to another manor');
        }
        if (existing && evidence.stateVersion < existing.propertyStateVersion) {
            throw new Error('Property evidence is older than the stored manor link');
        }
        const ownedByManor = evidence.status === 'owned' && evidence.owner?.kind === 'faction'
            && evidence.owner.id === faction.treasuryActorId;
        if (!ownedByManor) {
            if (!existing) return null;
            if (evidence.stateVersion === existing.propertyStateVersion) {
                throw new Error('Ownership removal requires a newer Property state version');
            }
            const transaction = this.database.transaction(() => {
                this.database.run(`DELETE FROM governance_manor_property
                    WHERE manor_jurisdiction_id = ?1 AND property_id = ?2`,
                [jurisdiction.jurisdictionId, evidence.propertyId]);
                this.insertAudit(jurisdiction.jurisdictionId, evidence.propertyId, 'unlinked',
                    evidence.stateVersion, actorAgentId, auditReason, updatedAt);
                if (jurisdiction.seatPropertyId === evidence.propertyId) {
                    this.database.run(`UPDATE governance_jurisdiction SET seat_property_id = NULL,
                        revision = revision + 1, updated_at = ?2 WHERE jurisdiction_id = ?1`,
                    [jurisdiction.jurisdictionId, updatedAt]);
                    this.insertAudit(jurisdiction.jurisdictionId, evidence.propertyId, 'seat-cleared',
                        evidence.stateVersion, actorAgentId, 'Seat cleared because exact ownership ended.', updatedAt);
                }
            });
            transaction.immediate();
            return null;
        }
        if (existing && evidence.stateVersion === existing.propertyStateVersion) {
            if (existingRow!.evidence_digest !== evidenceDigest) {
                throw new Error('Property state version was reused with different evidence');
            }
            return existing;
        }
        const action: ManorPropertyAuditEntry['action'] = existing ? 'verified' : 'linked';
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO governance_manor_property
                (manor_jurisdiction_id, property_id, property_state_version, evidence_digest,
                    acquired_at, verified_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(manor_jurisdiction_id, property_id) DO UPDATE SET
                    property_state_version = excluded.property_state_version,
                    evidence_digest = excluded.evidence_digest,
                    acquired_at = excluded.acquired_at, verified_at = excluded.verified_at,
                    updated_at = excluded.updated_at`,
            [jurisdiction.jurisdictionId, evidence.propertyId, evidence.stateVersion, evidenceDigest,
                evidence.acquiredAt, verifiedAt, updatedAt]);
            this.insertAudit(jurisdiction.jurisdictionId, evidence.propertyId, action,
                evidence.stateVersion, actorAgentId, auditReason, updatedAt);
        });
        transaction.immediate();
        return this.getLink(jurisdiction.jurisdictionId, evidence.propertyId)!;
    }

    setSeat(manorJurisdictionIdInput: string, propertyIdInput: string | null,
        expectedJurisdictionRevision: number, actorAgentIdInput: string, reasonInput: string,
        now = new Date().toISOString()): ManorPortfolio {
        const { jurisdiction } = this.manor(manorJurisdictionIdInput);
        const selectedPropertyId = propertyIdInput ? propertyId(propertyIdInput) : null;
        if (selectedPropertyId && !this.getLink(jurisdiction.jurisdictionId, selectedPropertyId)) {
            throw new Error('Manor seat must be one of its verified owned properties');
        }
        if (!Number.isSafeInteger(expectedJurisdictionRevision) || expectedJurisdictionRevision < 1) {
            throw new Error('Jurisdiction revision is invalid');
        }
        const actorAgentId = stableId(actorAgentIdInput, 'actorAgentId');
        const auditReason = reason(reasonInput);
        const updatedAt = timestamp(now, 'now');
        if (jurisdiction.seatPropertyId === selectedPropertyId) return this.getPortfolio(jurisdiction.jurisdictionId);
        const evidenceVersion = selectedPropertyId
            ? this.getLink(jurisdiction.jurisdictionId, selectedPropertyId)!.propertyStateVersion
            : this.getLink(jurisdiction.jurisdictionId, jurisdiction.seatPropertyId!)?.propertyStateVersion ?? 1;
        const transaction = this.database.transaction(() => {
            const updated = this.database.run(`UPDATE governance_jurisdiction SET seat_property_id = ?3,
                revision = revision + 1, updated_at = ?4 WHERE jurisdiction_id = ?1 AND revision = ?2`,
            [jurisdiction.jurisdictionId, expectedJurisdictionRevision, selectedPropertyId, updatedAt]);
            if (updated.changes !== 1) throw new Error('Jurisdiction changed before seat update; refresh and try again');
            this.insertAudit(jurisdiction.jurisdictionId,
                selectedPropertyId ?? jurisdiction.seatPropertyId, selectedPropertyId ? 'seat-designated' : 'seat-cleared',
                evidenceVersion, actorAgentId, auditReason, updatedAt);
        });
        transaction.immediate();
        return this.getPortfolio(jurisdiction.jurisdictionId);
    }

    listAudit(manorJurisdictionIdInput: string): ManorPropertyAuditEntry[] {
        const { jurisdiction } = this.manor(manorJurisdictionIdInput);
        return (this.database.query(`SELECT * FROM governance_manor_property_audit
            WHERE manor_jurisdiction_id = ?1 ORDER BY sequence`)
            .all(jurisdiction.jurisdictionId) as AuditRow[]).map(row => ({ sequence: row.sequence,
            manorJurisdictionId: row.manor_jurisdiction_id, propertyId: row.property_id,
            action: row.action, propertyStateVersion: row.property_state_version,
            actorAgentId: row.actor_agent_id, reason: row.reason, createdAt: row.created_at }));
    }

    private manor(manorJurisdictionIdInput: string): { jurisdiction: Jurisdiction; faction: Faction } {
        const jurisdiction = this.governance.getJurisdiction(manorJurisdictionIdInput);
        if (!jurisdiction || jurisdiction.kind !== 'manor') throw new Error('Manor jurisdiction does not exist');
        const faction = this.governance.getFaction(jurisdiction.factionId)!;
        if (faction.kind !== 'manor') throw new Error('Manor jurisdiction must belong to a manor faction');
        return { jurisdiction, faction };
    }

    private getLink(manorJurisdictionId: string, propertyIdValue: string): ManorPropertyLink | null {
        const row = this.database.query(`SELECT * FROM governance_manor_property
            WHERE manor_jurisdiction_id = ?1 AND property_id = ?2`)
            .get(manorJurisdictionId, propertyIdValue) as LinkRow | null;
        return row ? link(row) : null;
    }

    private insertAudit(manorJurisdictionId: string, propertyIdValue: string | null,
        action: ManorPropertyAuditEntry['action'], propertyStateVersion: number,
        actorAgentId: string, auditReason: string, createdAt: string): void {
        this.database.run(`INSERT INTO governance_manor_property_audit
            (manor_jurisdiction_id, property_id, action, property_state_version,
                actor_agent_id, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        [manorJurisdictionId, propertyIdValue, action, propertyStateVersion,
            actorAgentId, auditReason, createdAt]);
    }
}
