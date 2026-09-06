import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { InstitutionSettlementOrchestrator, bankingInstitutionSettlement,
    type InstitutionSettlementEvidenceRequest, type InstitutionSettlementEvidenceVerifier,
    type InstitutionSettlementRequest, type VerifiedInstitutionSettlementEvidence } from './institution-settlement-orchestrator.js';

export interface BankingCompletionSource {
    verify(request: Readonly<InstitutionSettlementEvidenceRequest>): Promise<VerifiedInstitutionSettlementEvidence>;
}
interface EventRow { event_id:string; event_kind:string; source_ref:string; event_digest:string; verified_at:string;
    payer_kind:'business'|'faction';payer_actor_id:string;payee_kind:'business'|'faction';payee_actor_id:string;amount_gp:number }

export class BankingVerifiedEventStore implements InstitutionSettlementEvidenceVerifier {
    private readonly db:Database;
    constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.db=new Database(path,{create:true,strict:true});
        this.db.run('PRAGMA foreign_keys = ON');
        this.db.run(`CREATE TABLE IF NOT EXISTS banking_verified_event(event_id TEXT PRIMARY KEY,event_kind TEXT NOT NULL,
            source_ref TEXT NOT NULL,event_digest TEXT NOT NULL CHECK(length(event_digest)=64),verified_at TEXT NOT NULL,
            payer_kind TEXT NOT NULL,payer_actor_id TEXT NOT NULL,payee_kind TEXT NOT NULL,payee_actor_id TEXT NOT NULL,
            amount_gp INTEGER NOT NULL CHECK(amount_gp>0))`)}
    close(){this.db.close(true)}
    async record(request:InstitutionSettlementEvidenceRequest,source:BankingCompletionSource){if(request.domain!=='banking')throw new Error('Banking event store accepts only banking events');
        const proof=await source.verify(Object.freeze({...request}));if(proof.eventId!==request.eventId||!/^[a-f0-9]{64}$/.test(proof.eventDigest)||Number.isNaN(Date.parse(proof.verifiedAt)))throw new Error('Banking completion source returned mismatched evidence');
        const existing=this.row(request.eventId);if(existing){this.assert(existing,request,proof);return proof}
        try{this.db.run(`INSERT INTO banking_verified_event VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,[request.eventId,request.eventKind,request.sourceRef,proof.eventDigest,proof.verifiedAt,request.payerKind,request.payerActorId,request.payeeKind,request.payeeActorId,request.amountGp])}
        catch(error){const raced=this.row(request.eventId);if(!raced)throw error;this.assert(raced,request,proof)}return proof}
    async verify(request:Readonly<InstitutionSettlementEvidenceRequest>):Promise<VerifiedInstitutionSettlementEvidence>{const row=this.row(request.eventId);if(!row)throw new Error('Banking completion event is not in the trusted event store');
        const proof={eventId:row.event_id,eventDigest:row.event_digest,verifiedAt:row.verified_at};this.assert(row,request,proof);return proof}
    private row(eventId:string){return this.db.query(`SELECT * FROM banking_verified_event WHERE event_id=?1`).get(eventId) as EventRow|null}
    private assert(row:EventRow,r:Readonly<InstitutionSettlementEvidenceRequest>,p:VerifiedInstitutionSettlementEvidence){if(row.event_kind!==r.eventKind||row.source_ref!==r.sourceRef||row.event_digest!==p.eventDigest||row.payer_kind!==r.payerKind||row.payer_actor_id!==r.payerActorId||row.payee_kind!==r.payeeKind||row.payee_actor_id!==r.payeeActorId||row.amount_gp!==r.amountGp)throw new Error('Banking completion event changed after verification')}
}

export class BankingSettlementService {
    constructor(private readonly path:string,private readonly treasuryPath:string=path){}
    async settle(request:Omit<InstitutionSettlementRequest,'domain'>,source:BankingCompletionSource,now?:string){
        const events=new BankingVerifiedEventStore(this.path);const orchestrator=new InstitutionSettlementOrchestrator(this.path,this.treasuryPath);
        try{const normalized={...request,eventId:request.eventId.trim().toLowerCase(),eventKind:request.eventKind.trim().toLowerCase(),
            sourceRef:request.sourceRef.trim().toLowerCase(),settlementId:request.settlementId.trim().toLowerCase(),reservationId:request.reservationId.trim().toLowerCase(),
            payerActorId:request.payerActorId.trim().toLowerCase(),payeeActorId:request.payeeActorId.trim().toLowerCase()};
            const evidenceRequest:InstitutionSettlementEvidenceRequest={domain:'banking',eventId:normalized.eventId,eventKind:normalized.eventKind,sourceRef:normalized.sourceRef,payerKind:normalized.payerKind,payerActorId:normalized.payerActorId,payeeKind:normalized.payeeKind,payeeActorId:normalized.payeeActorId,amountGp:normalized.amountGp};
            await events.record(evidenceRequest,source);return await bankingInstitutionSettlement(orchestrator,normalized,events,now)}finally{orchestrator.close();events.close()}}
}
