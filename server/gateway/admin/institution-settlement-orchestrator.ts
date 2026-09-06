import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { InstitutionTreasuryStore, type InstitutionKind,
    type InstitutionTreasuryTransfer } from './institution-treasury.js';

export type InstitutionSettlementDomain = 'banking' | 'taxation';
export type InstitutionSettlementStatus = 'settling' | 'committed';

export interface InstitutionSettlementEvidenceRequest {
    domain: InstitutionSettlementDomain;
    eventId: string;
    eventKind: string;
    sourceRef: string;
    payerKind: InstitutionKind;
    payerActorId: string;
    payeeKind: InstitutionKind;
    payeeActorId: string;
    amountGp: number;
}

export interface VerifiedInstitutionSettlementEvidence {
    eventId: string;
    eventDigest: string;
    verifiedAt: string;
}

export interface InstitutionSettlementEvidenceVerifier {
    verify(request: Readonly<InstitutionSettlementEvidenceRequest>):
        Promise<VerifiedInstitutionSettlementEvidence>;
}

export interface InstitutionSettlementRequest extends InstitutionSettlementEvidenceRequest {
    settlementId: string;
    reservationId: string;
}

export interface InstitutionSettlementRecord extends InstitutionSettlementRequest {
    eventDigest: string;
    verifiedAt: string;
    status: InstitutionSettlementStatus;
    createdAt: string;
    updatedAt: string;
}

interface SettlementRow {
    settlement_id: string; domain: InstitutionSettlementDomain; event_id: string;
    event_kind: string; source_ref: string; event_digest: string; verified_at: string;
    reservation_id: string; payer_kind: InstitutionKind; payer_actor_id: string;
    payee_kind: InstitutionKind; payee_actor_id: string; amount_gp: number;
    status: InstitutionSettlementStatus; created_at: string; updated_at: string;
}

const DOMAIN_EVENT_KINDS: Readonly<Record<InstitutionSettlementDomain, ReadonlySet<string>>> = {
    banking: new Set(['deposit-cleared', 'withdrawal-approved', 'interest-accrued',
        'loan-disbursed', 'repayment-cleared', 'collateral-liquidated']),
    taxation: new Set(['tax-obligation-due', 'tax-refund-approved', 'subsidy-approved'])
};

function boundedId(value: string, label: string, max = 128): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]+$/.test(normalized) || normalized.length > max) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
}

function actorId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) {
        throw new Error('Institution settlement actor id is invalid');
    }
    return normalized;
}

function uuid(value: string, label: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
}

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalize(request: InstitutionSettlementRequest): InstitutionSettlementRequest {
    if (!DOMAIN_EVENT_KINDS[request.domain]?.has(request.eventKind)) {
        throw new Error('Institution settlement event kind is not allowed for its domain');
    }
    if (!Number.isSafeInteger(request.amountGp) || request.amountGp < 1 || request.amountGp > 2_147_483_647) {
        throw new Error('Institution settlement amount is invalid');
    }
    const normalized = {
        domain: request.domain,
        eventId: boundedId(request.eventId, 'Institution settlement event id'),
        eventKind: request.eventKind,
        sourceRef: boundedId(request.sourceRef, 'Institution settlement source ref', 256),
        settlementId: uuid(request.settlementId, 'Institution settlement id'),
        reservationId: boundedId(request.reservationId, 'Institution settlement reservation id'),
        payerKind: request.payerKind,
        payerActorId: actorId(request.payerActorId),
        payeeKind: request.payeeKind,
        payeeActorId: actorId(request.payeeActorId),
        amountGp: request.amountGp
    };
    if (normalized.payerKind === normalized.payeeKind
        && normalized.payerActorId === normalized.payeeActorId) {
        throw new Error('Institution settlement payer and payee must be different');
    }
    return normalized;
}

function record(row: SettlementRow): InstitutionSettlementRecord {
    return { settlementId: row.settlement_id, domain: row.domain, eventId: row.event_id,
        eventKind: row.event_kind, sourceRef: row.source_ref, eventDigest: row.event_digest,
        verifiedAt: row.verified_at, reservationId: row.reservation_id,
        payerKind: row.payer_kind, payerActorId: row.payer_actor_id,
        payeeKind: row.payee_kind, payeeActorId: row.payee_actor_id, amountGp: row.amount_gp,
        status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function immutablePayload(value: InstitutionSettlementRecord | InstitutionSettlementRequest,
    evidence?: VerifiedInstitutionSettlementEvidence): unknown {
    return { domain: value.domain, eventId: value.eventId, eventKind: value.eventKind,
        sourceRef: value.sourceRef, reservationId: value.reservationId,
        payerKind: value.payerKind, payerActorId: value.payerActorId,
        payeeKind: value.payeeKind, payeeActorId: value.payeeActorId, amountGp: value.amountGp,
        eventDigest: evidence?.eventDigest ?? ('eventDigest' in value ? value.eventDigest : undefined) };
}

export class InstitutionSettlementOrchestrator {
    private readonly database: Database;

    constructor(private readonly path: string, private readonly treasuryPath: string = path) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_domain_settlement (
            settlement_id TEXT PRIMARY KEY, domain TEXT NOT NULL CHECK (domain IN ('banking', 'taxation')),
            event_id TEXT NOT NULL, event_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
            event_digest TEXT NOT NULL CHECK (length(event_digest) = 64), verified_at TEXT NOT NULL,
            reservation_id TEXT NOT NULL UNIQUE, payer_kind TEXT NOT NULL, payer_actor_id TEXT NOT NULL,
            payee_kind TEXT NOT NULL, payee_actor_id TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK (amount_gp > 0),
            status TEXT NOT NULL CHECK (status IN ('settling', 'committed')),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE (domain, event_id))`);
    }

    close(): void { this.database.close(true); }

    get(settlementId: string): InstitutionSettlementRecord | null {
        const row = this.database.query(`SELECT * FROM institution_domain_settlement
            WHERE settlement_id = ?1`).get(settlementId.trim().toLowerCase()) as SettlementRow | null;
        return row ? record(row) : null;
    }

    list(limit = 100): InstitutionSettlementRecord[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Institution settlement list limit must be between 1 and 1000');
        }
        return (this.database.query(`SELECT * FROM institution_domain_settlement
            ORDER BY created_at DESC, settlement_id DESC LIMIT ?1`).all(limit) as SettlementRow[]).map(record);
    }

    async settle(requestInput: InstitutionSettlementRequest,
        verifier: InstitutionSettlementEvidenceVerifier,
        now = new Date().toISOString()): Promise<{ settlement: InstitutionSettlementRecord;
            transfer: InstitutionTreasuryTransfer }> {
        const request = normalize(requestInput);
        if (Number.isNaN(Date.parse(now))) throw new Error('Institution settlement timestamp is invalid');
        let current = this.get(request.settlementId);
        const evidence = await verifier.verify(Object.freeze({ domain: request.domain,
            eventId: request.eventId, eventKind: request.eventKind, sourceRef: request.sourceRef,
            payerKind: request.payerKind, payerActorId: request.payerActorId,
            payeeKind: request.payeeKind, payeeActorId: request.payeeActorId, amountGp: request.amountGp }));
        if (evidence.eventId.trim().toLowerCase() !== request.eventId
            || !/^[0-9a-f]{64}$/.test(evidence.eventDigest)
            || Number.isNaN(Date.parse(evidence.verifiedAt))) {
            throw new Error('Institution settlement verifier returned mismatched evidence');
        }
        if (current) {
            if (digest(immutablePayload(current)) !== digest(immutablePayload(request, evidence))) {
                throw new Error('Institution settlement or its evidence changed after verification');
            }
        } else {
            try {
                this.database.run(`INSERT INTO institution_domain_settlement
                    (settlement_id, domain, event_id, event_kind, source_ref, event_digest, verified_at,
                        reservation_id, payer_kind, payer_actor_id, payee_kind, payee_actor_id, amount_gp,
                        status, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'settling', ?14, ?14)`,
                [request.settlementId, request.domain, request.eventId, request.eventKind, request.sourceRef,
                    evidence.eventDigest, evidence.verifiedAt, request.reservationId, request.payerKind,
                    request.payerActorId, request.payeeKind, request.payeeActorId, request.amountGp, now]);
            } catch (error) {
                const raced = this.get(request.settlementId);
                if (!raced || digest(immutablePayload(raced)) !== digest(immutablePayload(request, evidence))) throw error;
            }
            current = this.get(request.settlementId)!;
        }

        const treasury = new InstitutionTreasuryStore(this.treasuryPath);
        try {
            const reservation = treasury.getReservation(request.reservationId);
            if (!reservation || reservation.kind !== request.payerKind
                || reservation.actorId !== request.payerActorId || reservation.amountGp !== request.amountGp) {
                throw new Error('Institution settlement does not match its funded reservation');
            }
            treasury.bindSettlement(request.reservationId, request.settlementId, now);
            const transfer = treasury.transferReserved(request.reservationId, request.settlementId,
                request.payeeKind, request.payeeActorId, now);
            this.database.run(`UPDATE institution_domain_settlement SET status = 'committed', updated_at = ?2
                WHERE settlement_id = ?1 AND status = 'settling'`, [request.settlementId, now]);
            return { settlement: this.get(request.settlementId)!, transfer };
        } finally { treasury.close(); }
    }
}

export function bankingInstitutionSettlement(orchestrator: InstitutionSettlementOrchestrator,
    request: Omit<InstitutionSettlementRequest, 'domain'>, verifier: InstitutionSettlementEvidenceVerifier,
    now?: string) {
    return orchestrator.settle({ ...request, domain: 'banking' }, verifier, now);
}

export function taxationInstitutionSettlement(orchestrator: InstitutionSettlementOrchestrator,
    request: Omit<InstitutionSettlementRequest, 'domain'>, verifier: InstitutionSettlementEvidenceVerifier,
    now?: string) {
    return orchestrator.settle({ ...request, domain: 'taxation' }, verifier, now);
}
