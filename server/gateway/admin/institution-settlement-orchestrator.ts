import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { BoundSimulationEventStamp, SimulationClockStatus } from '../../../simulation-clock/types.js';
import type { SimulationClockStore } from '../../../simulation-clock/store.js';
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
    simulationStamp?: BoundSimulationEventStamp | null;
}

export interface InstitutionSettlementSimulationClock { store: SimulationClockStore; clockId: string;
    engineTick?: () => number | undefined }

interface SettlementRow {
    settlement_id: string; domain: InstitutionSettlementDomain; event_id: string;
    event_kind: string; source_ref: string; event_digest: string; verified_at: string;
    reservation_id: string; payer_kind: InstitutionKind; payer_actor_id: string;
    payee_kind: InstitutionKind; payee_actor_id: string; amount_gp: number;
    status: InstitutionSettlementStatus; created_at: string; updated_at: string;
    simulation_clock_id: string | null; simulation_sequence: number | null; simulation_time: string | null;
    simulation_binding_wall_time: string | null; simulation_engine_tick: number | null;
    simulation_profile_digest: string | null; simulation_clock_status: SimulationClockStatus | null;
    simulation_clock_revision: number | null; simulation_source_digest: string | null;
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
    const stampValues=[row.simulation_clock_id,row.simulation_sequence,row.simulation_time,
        row.simulation_binding_wall_time,row.simulation_profile_digest,row.simulation_clock_status,
        row.simulation_clock_revision,row.simulation_source_digest];const hasStamp=stampValues.some(value=>value!==null);
    if(hasStamp&&stampValues.some(value=>value===null))throw new Error(`Institution settlement simulation stamp is incomplete for ${row.settlement_id}`);
    const simulationStamp:BoundSimulationEventStamp|null=hasStamp?{clockId:row.simulation_clock_id!,
        domain:'institution-settlement',sourceId:row.settlement_id,sourceDigest:row.simulation_source_digest!,
        sequence:row.simulation_sequence!,simulationTime:row.simulation_time!,wallTime:row.simulation_binding_wall_time!,
        engineTick:row.simulation_engine_tick,profileDigest:row.simulation_profile_digest!,
        status:row.simulation_clock_status!,revision:row.simulation_clock_revision!}:null;
    return { settlementId: row.settlement_id, domain: row.domain, eventId: row.event_id,
        eventKind: row.event_kind, sourceRef: row.source_ref, eventDigest: row.event_digest,
        verifiedAt: row.verified_at, reservationId: row.reservation_id,
        payerKind: row.payer_kind, payerActorId: row.payer_actor_id,
        payeeKind: row.payee_kind, payeeActorId: row.payee_actor_id, amountGp: row.amount_gp,
        status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, simulationStamp };
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

    constructor(private readonly path: string, private readonly treasuryPath: string = path,
        private readonly simulationClock?: InstitutionSettlementSimulationClock) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.migrate(); if(simulationClock)this.backfillSimulationStamps() }
        catch(error){this.database.close(true);throw error}
    }

    private migrate():void { const schemaTable=this.database.query(`SELECT 1 AS found FROM sqlite_master
            WHERE type='table' AND name='institution_settlement_schema'`).get();
        if(schemaTable){const schema=this.database.query(`SELECT version FROM institution_settlement_schema WHERE singleton=1`).get() as {version:number}|null;
            if(!schema||schema.version!==1)throw new Error(`Unsupported institution settlement schema version: ${schema?.version??'missing'}`)}
        const migration=this.database.transaction(()=>{this.database.run(`CREATE TABLE IF NOT EXISTS institution_settlement_schema(
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>=1))`);
        this.database.run(`INSERT OR IGNORE INTO institution_settlement_schema(singleton,version) VALUES(1,1)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS institution_domain_settlement (
            settlement_id TEXT PRIMARY KEY, domain TEXT NOT NULL CHECK (domain IN ('banking', 'taxation')),
            event_id TEXT NOT NULL, event_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
            event_digest TEXT NOT NULL CHECK (length(event_digest) = 64), verified_at TEXT NOT NULL,
            reservation_id TEXT NOT NULL UNIQUE, payer_kind TEXT NOT NULL, payer_actor_id TEXT NOT NULL,
            payee_kind TEXT NOT NULL, payee_actor_id TEXT NOT NULL, amount_gp INTEGER NOT NULL CHECK (amount_gp > 0),
            status TEXT NOT NULL CHECK (status IN ('settling', 'committed')),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE (domain, event_id))`);
        const columns=this.database.query('PRAGMA table_info(institution_domain_settlement)').all() as Array<{name:string}>;
        const existing=new Set(columns.map(column=>column.name));const additions:Array<[string,string]>=[
            ['simulation_clock_id','TEXT'],['simulation_sequence','INTEGER'],['simulation_time','TEXT'],
            ['simulation_binding_wall_time','TEXT'],['simulation_engine_tick','INTEGER'],
            ['simulation_profile_digest','TEXT'],['simulation_clock_status','TEXT'],
            ['simulation_clock_revision','INTEGER'],['simulation_source_digest','TEXT']];
        for(const [name,type] of additions)if(!existing.has(name))this.database.run(`ALTER TABLE institution_domain_settlement ADD COLUMN ${name} ${type}`);
        this.database.run(`CREATE UNIQUE INDEX IF NOT EXISTS institution_settlement_simulation_sequence
            ON institution_domain_settlement(simulation_clock_id,simulation_sequence) WHERE simulation_clock_id IS NOT NULL`)
        });migration.immediate()
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
            if(current.simulationStamp==null){const stamp=this.bindSimulationStamp(request.settlementId,
                digest(immutablePayload(request,evidence)),current.createdAt);if(stamp)this.writeSimulationStamp(request.settlementId,stamp)}
        } else {
            const stamp=this.bindSimulationStamp(request.settlementId,digest(immutablePayload(request,evidence)),now);
            try {
                this.database.run(`INSERT INTO institution_domain_settlement
                    (settlement_id, domain, event_id, event_kind, source_ref, event_digest, verified_at,
                        reservation_id, payer_kind, payer_actor_id, payee_kind, payee_actor_id, amount_gp,
                        status, created_at, updated_at,simulation_clock_id,simulation_sequence,simulation_time,
                        simulation_binding_wall_time,simulation_engine_tick,simulation_profile_digest,
                        simulation_clock_status,simulation_clock_revision,simulation_source_digest)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'settling', ?14, ?14,
                        ?15,?16,?17,?18,?19,?20,?21,?22,?23)`,
                [request.settlementId, request.domain, request.eventId, request.eventKind, request.sourceRef,
                    evidence.eventDigest, evidence.verifiedAt, request.reservationId, request.payerKind,
                    request.payerActorId, request.payeeKind, request.payeeActorId, request.amountGp, now,
                    stamp?.clockId??null,stamp?.sequence??null,stamp?.simulationTime??null,stamp?.wallTime??null,
                    stamp?.engineTick??null,stamp?.profileDigest??null,stamp?.status??null,stamp?.revision??null,
                    stamp?.sourceDigest??null]);
            } catch (error) {
                const raced = this.get(request.settlementId);
                if (!raced || digest(immutablePayload(raced)) !== digest(immutablePayload(request, evidence))) throw error;
                if(stamp&&raced.simulationStamp==null)this.writeSimulationStamp(request.settlementId,stamp);
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

    private bindSimulationStamp(settlementId:string,sourceDigest:string,requestedWallTime:string):BoundSimulationEventStamp|null{
        if(!this.simulationClock)return null;const clock=this.simulationClock.store.get(this.simulationClock.clockId);
        if(!clock)throw new Error(`Simulation clock ${this.simulationClock.clockId} does not exist`);
        const normalized=new Date(requestedWallTime).toISOString();const wallTime=normalized<clock.lastObservedWallTime
            ?clock.lastObservedWallTime:normalized;return this.simulationClock.store.bindEvent({clockId:this.simulationClock.clockId,
                domain:'institution-settlement',sourceId:settlementId,sourceDigest,wallTime,
                engineTick:this.simulationClock.engineTick?.()}).stamp
    }
    private writeSimulationStamp(settlementId:string,stamp:BoundSimulationEventStamp):void{
        this.database.run(`UPDATE institution_domain_settlement SET simulation_clock_id=?2,simulation_sequence=?3,
            simulation_time=?4,simulation_binding_wall_time=?5,simulation_engine_tick=?6,
            simulation_profile_digest=?7,simulation_clock_status=?8,simulation_clock_revision=?9,
            simulation_source_digest=?10 WHERE settlement_id=?1 AND simulation_clock_id IS NULL`,
        [settlementId,stamp.clockId,stamp.sequence,stamp.simulationTime,stamp.wallTime,stamp.engineTick,
            stamp.profileDigest,stamp.status,stamp.revision,stamp.sourceDigest])
    }
    private backfillSimulationStamps():void{const rows=this.database.query(`SELECT * FROM institution_domain_settlement
        WHERE simulation_clock_id IS NULL ORDER BY created_at,settlement_id`).all() as SettlementRow[];
        for(const row of rows){const value=record(row);const stamp=this.bindSimulationStamp(row.settlement_id,
            digest(immutablePayload(value)),row.created_at)!;this.writeSimulationStamp(row.settlement_id,stamp)}}
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
