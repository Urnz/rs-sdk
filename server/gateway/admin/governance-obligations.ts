import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { EconomyEvent } from './transaction-telemetry.js';
import { GovernanceStore } from './governance.js';
import { calculateGovernancePolicyAmount, GovernancePolicyStore,
    type GovernancePolicyTrigger } from './governance-policy.js';

export type GovernanceSourceDomain = 'property' | 'business';

export interface GovernanceEconomicActorRef {
    kind: 'player' | 'business' | 'faction';
    id: string;
}

export interface GovernanceWorldLocation {
    x: number;
    z: number;
    level: number;
}

export interface GovernancePropertyTransferEvidence {
    transferId: string;
    propertyId: string;
    from: GovernanceEconomicActorRef;
    to: GovernanceEconomicActorRef;
    beforeVersion: number;
    version: number;
    createdAt: string;
}

export interface GovernancePropertyReference {
    propertyId: string;
    location: GovernanceWorldLocation;
}

export interface GovernanceSourceEvent {
    eventId: string;
    sourceDomain: GovernanceSourceDomain;
    trigger: GovernancePolicyTrigger;
    sourceRef: string;
    subject: GovernanceEconomicActorRef;
    location: GovernanceWorldLocation;
    basisGp: number;
    occurredAt: string;
}

export interface GovernanceSourceEventEvidence {
    eventId: string;
    eventDigest: string;
    verifiedAt: string;
}

export interface GovernanceSourceEventVerifier {
    verify(event: Readonly<GovernanceSourceEvent>): Promise<GovernanceSourceEventEvidence>;
}

export interface GovernanceObligation {
    obligationId: string;
    eventId: string;
    policyId: string;
    policyVersion: number;
    jurisdictionId: string;
    sequence: number;
    kind: 'tax' | 'tariff' | 'fee' | 'subsidy';
    debtor: GovernanceEconomicActorRef;
    creditor: GovernanceEconomicActorRef;
    amountGp: number;
    status: 'due';
    createdAt: string;
}

interface EventRow {
    event_id: string; source_domain: GovernanceSourceDomain; trigger_kind: GovernancePolicyTrigger;
    source_ref: string; event_digest: string; subject_kind: GovernanceEconomicActorRef['kind']; subject_id: string;
    level: number; x: number; z: number; basis_gp: number; occurred_at: string;
    verified_at: string; processed_at: string;
}

interface ObligationRow {
    obligation_id: string; event_id: string; policy_id: string; policy_version: number;
    jurisdiction_id: string; sequence: number; kind: GovernanceObligation['kind'];
    debtor_kind: GovernanceEconomicActorRef['kind']; debtor_id: string;
    creditor_kind: GovernanceEconomicActorRef['kind']; creditor_id: string;
    amount_gp: number; status: 'due'; created_at: string;
}

const DOMAIN_TRIGGERS: Readonly<Record<GovernanceSourceDomain, ReadonlySet<GovernancePolicyTrigger>>> = {
    property: new Set(['property-transfer', 'property-ownership', 'property-development']),
    business: new Set(['business-revenue', 'business-registration', 'goods-import'])
};

function boundedId(value: string, field: string, maximum = 128): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{2,}$/.test(normalized) || normalized.length > maximum) {
        throw new Error(`${field} is invalid`);
    }
    return normalized;
}

function actor(value: GovernanceEconomicActorRef): GovernanceEconomicActorRef {
    if (!['player', 'business', 'faction'].includes(value.kind)) throw new Error('Event subject kind is invalid');
    const id = value.id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) throw new Error('Event subject id is invalid');
    return { kind: value.kind, id };
}

function coordinate(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) throw new Error(`${field} is invalid`);
    return value;
}

function timestamp(value: string, field: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} is invalid`);
    return new Date(value).toISOString();
}

function normalizeEvent(value: GovernanceSourceEvent): GovernanceSourceEvent {
    if (!DOMAIN_TRIGGERS[value.sourceDomain]?.has(value.trigger)) {
        throw new Error('Governance event trigger is not allowed for its source domain');
    }
    if (!Number.isSafeInteger(value.location.level) || value.location.level < 0 || value.location.level > 3) {
        throw new Error('Governance event level is invalid');
    }
    if (!Number.isSafeInteger(value.basisGp) || value.basisGp < 0 || value.basisGp > 2_147_483_647) {
        throw new Error('Governance event basis is invalid');
    }
    return { eventId: boundedId(value.eventId, 'Governance event id'), sourceDomain: value.sourceDomain,
        trigger: value.trigger, sourceRef: boundedId(value.sourceRef, 'Governance event source ref', 256),
        subject: actor(value.subject), location: { level: value.location.level,
            x: coordinate(value.location.x, 'Governance event x'),
            z: coordinate(value.location.z, 'Governance event z') },
        basisGp: value.basisGp, occurredAt: timestamp(value.occurredAt, 'Governance event timestamp') };
}

export function digestGovernanceSourceEvent(value: GovernanceSourceEvent): string {
    const event = normalizeEvent(value);
    return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, ...event })).digest('hex');
}

function sourceEvent(row: EventRow): GovernanceSourceEvent {
    return { eventId: row.event_id, sourceDomain: row.source_domain, trigger: row.trigger_kind,
        sourceRef: row.source_ref, subject: { kind: row.subject_kind, id: row.subject_id },
        location: { level: row.level, x: row.x, z: row.z }, basisGp: row.basis_gp,
        occurredAt: row.occurred_at };
}

function obligation(row: ObligationRow): GovernanceObligation {
    return { obligationId: row.obligation_id, eventId: row.event_id, policyId: row.policy_id,
        policyVersion: row.policy_version, jurisdictionId: row.jurisdiction_id, sequence: row.sequence,
        kind: row.kind, debtor: { kind: row.debtor_kind, id: row.debtor_id },
        creditor: { kind: row.creditor_kind, id: row.creditor_id }, amountGp: row.amount_gp,
        status: row.status, createdAt: row.created_at };
}

function obligationId(eventId: string, policyId: string): string {
    return `obligation.${createHash('sha256').update(`${eventId}\0${policyId}`).digest('hex').slice(0, 48)}`;
}

export function propertyTransferGovernanceEvent(receipt: GovernancePropertyTransferEvidence,
    property: GovernancePropertyReference, basisGp: number): GovernanceSourceEvent {
    if (receipt.propertyId !== property.propertyId) throw new Error('Property transfer receipt does not match definition');
    return normalizeEvent({ eventId: `property:${receipt.transferId}`, sourceDomain: 'property',
        trigger: 'property-transfer', sourceRef: `property-transfer:${receipt.transferId}`,
        subject: receipt.to, location: property.location, basisGp, occurredAt: receipt.createdAt });
}

export function businessRevenueGovernanceEvent(event: EconomyEvent, businessId: string,
    location: GovernanceWorldLocation): GovernanceSourceEvent {
    if (event.partial || !['shop-sell', 'player-trade'].includes(event.kind) || event.coinsDelta <= 0) {
        throw new Error('Economy event is not verified business revenue');
    }
    return normalizeEvent({ eventId: `business:${event.id}`, sourceDomain: 'business',
        trigger: 'business-revenue', sourceRef: `economy-event:${event.id}`,
        subject: { kind: 'business', id: businessId }, location,
        basisGp: event.coinsDelta, occurredAt: event.timestamp });
}

export class GovernanceObligationStore {
    private readonly database: Database;
    private readonly governance: GovernanceStore;
    private readonly policies: GovernancePolicyStore;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.governance = new GovernanceStore(path);
        this.policies = new GovernancePolicyStore(path);
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
    }

    close(): void {
        this.database.close(true);
        this.policies.close();
        this.governance.close();
    }

    getEvent(eventIdInput: string): GovernanceSourceEvent | null {
        const eventId = boundedId(eventIdInput, 'Governance event id');
        const row = this.database.query('SELECT * FROM governance_source_event WHERE event_id = ?1')
            .get(eventId) as EventRow | null;
        return row ? sourceEvent(row) : null;
    }

    getObligation(obligationIdInput: string): GovernanceObligation | null {
        const obligationIdValue = boundedId(obligationIdInput, 'Governance obligation id');
        const row = this.database.query('SELECT * FROM governance_obligation WHERE obligation_id = ?1')
            .get(obligationIdValue) as ObligationRow | null;
        return row ? obligation(row) : null;
    }

    listForEvent(eventIdInput: string): GovernanceObligation[] {
        const eventId = boundedId(eventIdInput, 'Governance event id');
        return (this.database.query(`SELECT * FROM governance_obligation
            WHERE event_id = ?1 ORDER BY sequence, obligation_id`).all(eventId) as ObligationRow[]).map(obligation);
    }

    listForActor(actorInput: GovernanceEconomicActorRef, limit = 100): GovernanceObligation[] {
        const actorValue = actor(actorInput);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit is invalid');
        return (this.database.query(`SELECT * FROM governance_obligation
            WHERE (debtor_kind = ?1 AND debtor_id = ?2) OR (creditor_kind = ?1 AND creditor_id = ?2)
            ORDER BY created_at DESC, obligation_id LIMIT ?3`)
            .all(actorValue.kind, actorValue.id, limit) as ObligationRow[]).map(obligation);
    }

    async process(eventInput: GovernanceSourceEvent, verifier: GovernanceSourceEventVerifier,
        now = new Date().toISOString()): Promise<GovernanceObligation[]> {
        const event = normalizeEvent(eventInput);
        const processedAt = timestamp(now, 'Governance processing timestamp');
        const evidence = await verifier.verify(Object.freeze({ ...event, subject: Object.freeze({ ...event.subject }),
            location: Object.freeze({ ...event.location }) }));
        if (evidence.eventId.trim().toLowerCase() !== event.eventId
            || !/^[0-9a-f]{64}$/.test(evidence.eventDigest)
            || !Number.isFinite(Date.parse(evidence.verifiedAt))) {
            throw new Error('Governance event verifier returned mismatched evidence');
        }
        const expectedDigest = digestGovernanceSourceEvent(event);
        if (evidence.eventDigest !== expectedDigest) throw new Error('Governance event evidence does not match normalized input');
        const existing = this.database.query('SELECT * FROM governance_source_event WHERE event_id = ?1')
            .get(event.eventId) as EventRow | null;
        if (existing) {
            this.assertReplay(existing, event, evidence.eventDigest);
            return this.listForEvent(event.eventId);
        }
        const claimedSource = this.database.query(`SELECT * FROM governance_source_event
            WHERE source_domain = ?1 AND source_ref = ?2`).get(event.sourceDomain, event.sourceRef) as EventRow | null;
        if (claimedSource) throw new Error('Governance source event was already processed under another id');

        const transaction = this.database.transaction(() => {
            const raced = this.database.query('SELECT * FROM governance_source_event WHERE event_id = ?1')
                .get(event.eventId) as EventRow | null;
            if (raced) {
                this.assertReplay(raced, event, evidence.eventDigest);
                return;
            }
            const racedSource = this.database.query(`SELECT event_id FROM governance_source_event
                WHERE source_domain = ?1 AND source_ref = ?2`).get(event.sourceDomain, event.sourceRef);
            if (racedSource) throw new Error('Governance source event was already processed under another id');
            this.database.run(`INSERT INTO governance_source_event
                (event_id, source_domain, trigger_kind, source_ref, event_digest, subject_kind, subject_id,
                    level, x, z, basis_gp, occurred_at, verified_at, processed_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
            [event.eventId, event.sourceDomain, event.trigger, event.sourceRef, evidence.eventDigest,
                event.subject.kind, event.subject.id, event.location.level, event.location.x, event.location.z,
                event.basisGp, event.occurredAt,
                timestamp(evidence.verifiedAt, 'Governance evidence timestamp'), processedAt]);
            const scopes = this.governance.resolveAt(event.location.x, event.location.z, event.location.level);
            let sequence = 0;
            for (const scope of scopes) {
                if (scope.faction.status !== 'active'
                    || !this.governance.isFactionActiveAt(scope.faction.factionId, event.occurredAt)) continue;
                const policies = this.policies.listEffective(scope.jurisdictionId, event.trigger, event.occurredAt);
                for (const policy of policies) {
                    const exemption = this.database.query(`SELECT exemption_id FROM governance_exemption
                        WHERE jurisdiction_id = ?1 AND (policy_key IS NULL OR policy_key = ?2)
                        AND beneficiary_kind = ?3 AND beneficiary_id = ?4
                        AND created_at <= ?5 AND valid_from <= ?5
                        AND (valid_until IS NULL OR valid_until > ?5)
                        AND (revoked_at IS NULL OR revoked_at > ?5)
                        ORDER BY exemption_id LIMIT 1`)
                        .get(scope.jurisdictionId, policy.policyKey, event.subject.kind,
                            event.subject.id, event.occurredAt);
                    if (exemption) continue;
                    const amountGp = calculateGovernancePolicyAmount(policy, event.basisGp);
                    if (amountGp === 0) continue;
                    const treasuryActor: GovernanceEconomicActorRef = {
                        kind: 'faction', id: scope.faction.treasuryActorId
                    };
                    const debtor = policy.kind === 'subsidy' ? treasuryActor : event.subject;
                    const creditor = policy.kind === 'subsidy' ? event.subject : treasuryActor;
                    if (debtor.kind === creditor.kind && debtor.id === creditor.id) {
                        throw new Error('Governance policy would create a self-obligation');
                    }
                    this.database.run(`INSERT INTO governance_obligation
                        (obligation_id, event_id, policy_id, policy_version, jurisdiction_id, sequence, kind,
                            debtor_kind, debtor_id, creditor_kind, creditor_id, amount_gp, status, created_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'due', ?13)`,
                    [obligationId(event.eventId, policy.policyId), event.eventId, policy.policyId, policy.version,
                        scope.jurisdictionId, sequence++, policy.kind, debtor.kind, debtor.id,
                        creditor.kind, creditor.id, amountGp, processedAt]);
                }
            }
        });
        transaction.immediate();
        return this.listForEvent(event.eventId);
    }

    private assertReplay(row: EventRow, event: GovernanceSourceEvent, eventDigest: string): void {
        if (row.event_digest !== eventDigest
            || digestGovernanceSourceEvent(sourceEvent(row)) !== digestGovernanceSourceEvent(event)) {
            throw new Error('Governance event id was reused with different verified content');
        }
    }
}
