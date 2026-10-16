import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { assertFencingParticipationDecision, fencingMarketPolicyDigest } from './policy.js';
import type { FencingBusinessMoneyCommit, FencingBusinessStockCommit, FencingMarketPolicy,
    FencingProvenanceCommit, FencingSettlementPorts, FencingSettlementRecord, FencingSettlementRequest,
    FencingTradeReceipt, FencingTradeVerifier } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/i,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[0-9a-f]{64}$/,ZERO='0'.repeat(64);
type Row={settlement_id:string;candidate_id:string;opportunity_id:string;trade_receipt_id:string;request_json:string;
    request_digest:string;provenance_committed:number;stock_committed:number;money_committed:number;
    status:'settling'|'committed';last_error:string|null;created_at:string;updated_at:string};
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function freeze<T>(value:T):Readonly<T>{if(value&&typeof value==='object'){
    for(const entry of Object.values(value))freeze(entry);Object.freeze(value)}return value}
function recordedRequest(row:Row):FencingSettlementRequest{const request=JSON.parse(row.request_json) as FencingSettlementRequest;
    if(hash(request)!==row.request_digest||request.settlementId!==row.settlement_id
        ||request.candidate.candidateId!==row.candidate_id||request.opportunity.opportunityId!==row.opportunity_id
        ||request.trade.receiptId!==row.trade_receipt_id)throw new Error('Fencing recorded request integrity mismatch');return request}
function id(value:string,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value}
function exact(value:object,keys:string[],field:string):void{if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))
    throw new Error(`${field} is invalid`)}
function record(row:Row):FencingSettlementRecord{return{settlementId:row.settlement_id,candidateId:row.candidate_id,
    opportunityId:row.opportunity_id,tradeReceiptId:row.trade_receipt_id,requestDigest:row.request_digest,
    provenanceCommitted:row.provenance_committed===1,stockCommitted:row.stock_committed===1,
    moneyCommitted:row.money_committed===1,status:row.status,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at}}

/** Restart-safe cross-ledger saga. Every supplied port must be atomic and idempotent by operation id. */
export class FencingSettlementCoordinator{
    private readonly database:Database;
    constructor(path:string,private readonly policy:FencingMarketPolicy,private readonly ports:FencingSettlementPorts){
        const{digest,...definition}=policy;if(digest!==fencingMarketPolicyDigest(definition))
            throw new Error('Fencing market policy digest mismatch');mkdirSync(dirname(path),{recursive:true});
        this.database=new Database(path,{create:true,strict:true});this.database.run('PRAGMA foreign_keys = ON');this.migrate()}
    close():void{this.database.close(true)}
    get(settlementIdInput:string):FencingSettlementRecord|null{const settlementId=settlementIdInput.trim().toLowerCase();
        if(!UUID.test(settlementId))throw new Error('settlementId is invalid');const row=this.database.query(
            'SELECT * FROM fencing_settlement WHERE settlement_id=?1').get(settlementId) as Row|null;return row?record(row):null}
    /** Recorded, audit-bound request evidence; not verification that the seller received money. */
    getRecordedRequest(settlementIdInput:string):Readonly<FencingSettlementRequest>|null{
        if(typeof settlementIdInput!=='string')throw new Error('settlementId is invalid');
        const settlementId=settlementIdInput.trim().toLowerCase();if(!UUID.test(settlementId))throw new Error('settlementId is invalid');
        let result:Readonly<FencingSettlementRequest>|null=null;
        const transaction=this.database.transaction(()=>{if(!this.verifyAuditChain())throw new Error('Fencing settlement audit integrity mismatch');
            const row=this.database.query('SELECT * FROM fencing_settlement WHERE settlement_id=?1').get(settlementId) as Row|null;
            result=row?freeze(recordedRequest(row)):null});transaction.deferred();return result}
    settle(input:FencingSettlementRequest,verifyTrade?:FencingTradeVerifier,
        now=new Date().toISOString()):FencingSettlementRecord{
        const normalized=this.validate(input,verifyTrade),requestDigest=hash(normalized),existing=this.get(normalized.settlementId);
        if(existing&&existing.requestDigest!==requestDigest)throw new Error('Fencing settlement id was reused');
        if(!existing){const business=normalized.candidate.kind==='business',transaction=this.database.transaction(()=>{
            this.database.run(`INSERT INTO fencing_settlement VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,'settling',NULL,?9,?9)`,
            [normalized.settlementId,normalized.candidate.candidateId,normalized.opportunity.opportunityId,
                normalized.trade.receiptId,JSON.stringify(canonical(normalized)),requestDigest,
                normalized.opportunity.assetId===null?1:0,business?0:1,now]);
            this.audit(normalized.settlementId,'planned',requestDigest,now)});transaction.immediate()}
        let current=this.get(normalized.settlementId)!;if(current.status==='committed')return current;
        try{
            if(!current.provenanceCommitted){this.ports.commitProvenance(this.provenance(normalized));
                current=this.advance(normalized.settlementId,'provenance',now)}
            if(!current.stockCommitted){this.ports.commitBusinessStock(this.stock(normalized));
                current=this.advance(normalized.settlementId,'stock',now)}
            if(!current.moneyCommitted){this.ports.commitBusinessMoney(this.money(normalized));
                current=this.advance(normalized.settlementId,'money',now)}
            if(current.status!=='committed')current=this.advance(normalized.settlementId,'committed',now);return current;
        }catch(error){this.database.run(`UPDATE fencing_settlement SET last_error=?2,updated_at=?3 WHERE settlement_id=?1`,
            [normalized.settlementId,(error instanceof Error?error.message:String(error)).slice(0,500),now]);throw error}
    }
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM fencing_settlement_audit ORDER BY sequence').all() as
        Array<{settlement_id:string;step:string;request_digest:string;occurred_at:string;previous_hash:string;entry_hash:string}>;
        const settlements=this.database.query('SELECT * FROM fencing_settlement').all() as Row[];
        const requests=new Map(settlements.map(row=>[row.settlement_id,recordedRequest(row)]));
        const digests=new Map(settlements.map(row=>[row.settlement_id,row.request_digest]));
        let previous=ZERO;const steps=new Map<string,Set<string>>();for(const row of rows){const payload={settlementId:row.settlement_id,
            step:row.step,requestDigest:row.request_digest,occurredAt:row.occurred_at};if(row.previous_hash!==previous
            ||hash({previousHash:previous,payload})!==row.entry_hash||digests.get(row.settlement_id)!==row.request_digest)return false;previous=row.entry_hash;
            const set=steps.get(row.settlement_id)??new Set<string>();set.add(row.step);steps.set(row.settlement_id,set)}
        for(const row of settlements){const request=requests.get(row.settlement_id)!,set=steps.get(row.settlement_id);
            if(!set?.has('planned')||(row.provenance_committed===1)!==(set.has('provenance')||request.opportunity.assetId===null)
                ||(row.stock_committed===1)!==(set.has('stock')||request.candidate.kind==='agent')
                ||(row.money_committed===1)!==(set.has('money')||request.candidate.kind==='agent')
                ||(row.status==='committed')!==set.has('committed'))return false}return true}catch{return false}}
    private validate(input:FencingSettlementRequest,verify?:FencingTradeVerifier):FencingSettlementRequest{
        if(!input||typeof input!=='object')throw new Error('Fencing settlement request is invalid');
        exact(input,['settlementId','reservationId','storageId','candidate','opportunity','decision','trade'],'Fencing settlement request');
        const settlementId=input.settlementId.trim().toLowerCase();if(!UUID.test(settlementId))throw new Error('settlementId is invalid');
        assertFencingParticipationDecision(this.policy,input.candidate,input.opportunity,input.decision);
        const trade=this.trade(input.trade);if(!verify?.(Object.freeze(trade)))throw new Error('Fencing trade receipt is not trusted');
        if(trade.buyerAgentId!==input.candidate.operatorAgentId||trade.sellerAgentId!==input.opportunity.sellerAgentId
            ||trade.itemId!==input.opportunity.itemId||trade.quantity!==input.opportunity.quantity
            ||trade.coinsPaid!==input.opportunity.acquisitionCostGp||trade.assetId!==input.opportunity.assetId
            ||trade.provenanceDigest!==input.opportunity.provenanceDigest)throw new Error('Fencing trade does not match the opportunity');
        const business=input.candidate.kind==='business',reservationId=input.reservationId===null?null:id(input.reservationId,'reservationId');
        const storageId=input.storageId===null?null:id(input.storageId,'storageId');if(business!== (reservationId!==null)
            ||!business&&storageId!==null)throw new Error('Fencing settlement resource bindings are invalid');
        return{settlementId,reservationId,storageId,candidate:input.candidate,opportunity:input.opportunity,
            decision:input.decision,trade}}
    private trade(value:FencingTradeReceipt):FencingTradeReceipt{if(!value||typeof value!=='object'||value.status!=='committed'
            ||value.partial!==false||!DIGEST.test(value.sourceEvidenceDigest)||Number.isNaN(Date.parse(value.occurredAt))
            ||!Number.isSafeInteger(value.itemId)||value.itemId<0||!Number.isSafeInteger(value.quantity)||value.quantity<1
            ||!Number.isSafeInteger(value.coinsPaid)||value.coinsPaid<1)return(()=>{throw new Error('Fencing trade receipt is invalid')})();
        exact(value,['receiptId','buyerAgentId','sellerAgentId','itemId','quantity','coinsPaid','assetId','assetRevision',
            'provenanceDigest','status','partial','sourceEvidenceDigest','occurredAt'],'Fencing trade receipt');
        const assetId=value.assetId===null?null:id(value.assetId,'trade.assetId');if((assetId===null)!==(value.assetRevision===null)
            ||(assetId===null)!==(value.provenanceDigest===null)||value.assetRevision!==null&&(!Number.isSafeInteger(value.assetRevision)
                ||value.assetRevision<1)||value.provenanceDigest!==null&&!DIGEST.test(value.provenanceDigest))
            throw new Error('Fencing trade provenance is invalid');return{receiptId:id(value.receiptId,'trade.receiptId'),
                buyerAgentId:id(value.buyerAgentId,'trade.buyerAgentId'),sellerAgentId:id(value.sellerAgentId,'trade.sellerAgentId'),
                itemId:value.itemId,quantity:value.quantity,coinsPaid:value.coinsPaid,assetId,assetRevision:value.assetRevision,
                provenanceDigest:value.provenanceDigest,status:'committed',partial:false,sourceEvidenceDigest:value.sourceEvidenceDigest,
                occurredAt:new Date(value.occurredAt).toISOString()}}
    private provenance(input:FencingSettlementRequest):FencingProvenanceCommit{return{operationId:`${input.settlementId}.custody`,
        assetId:input.trade.assetId!,expectedRevision:input.trade.assetRevision!,fromAgentId:input.trade.sellerAgentId,
        to:{kind:input.candidate.kind,id:input.candidate.candidateId},tradeReceiptId:input.trade.receiptId,
        sourceEvidenceDigest:input.trade.sourceEvidenceDigest,occurredAt:input.trade.occurredAt}}
    private stock(input:FencingSettlementRequest):FencingBusinessStockCommit{return{operationId:`${input.settlementId}.stock`,
        businessId:input.candidate.candidateId,operatorAgentId:input.candidate.operatorAgentId,storageId:input.storageId,
        itemId:input.trade.itemId,quantity:input.trade.quantity,tradeReceiptId:input.trade.receiptId,
        sourceEvidenceDigest:input.trade.sourceEvidenceDigest,occurredAt:input.trade.occurredAt}}
    private money(input:FencingSettlementRequest):FencingBusinessMoneyCommit{return{settlementId:input.settlementId,
        reservationId:input.reservationId!,businessId:input.candidate.candidateId,amountGp:input.trade.coinsPaid,
        tradeReceiptId:input.trade.receiptId,sourceEvidenceDigest:input.trade.sourceEvidenceDigest,occurredAt:input.trade.occurredAt}}
    private advance(settlementId:string,step:'provenance'|'stock'|'money'|'committed',now:string):FencingSettlementRecord{
        const column=step==='provenance'?'provenance_committed':step==='stock'?'stock_committed':step==='money'?'money_committed':null;
        const transaction=this.database.transaction(()=>{const changed=column?this.database.run(`UPDATE fencing_settlement SET ${column}=1,
                last_error=NULL,updated_at=?2 WHERE settlement_id=?1 AND ${column}=0`,[settlementId,now]):this.database.run(
                `UPDATE fencing_settlement SET status='committed',last_error=NULL,updated_at=?2 WHERE settlement_id=?1
                AND status='settling' AND provenance_committed=1 AND stock_committed=1 AND money_committed=1`,[settlementId,now]);
            if(changed.changes!==1)throw new Error(`Fencing settlement ${step} state changed before commit`);
            this.audit(settlementId,step,this.get(settlementId)!.requestDigest,now)});transaction.immediate();return this.get(settlementId)!}
    private audit(settlementId:string,step:string,requestDigest:string,occurredAt:string):void{const previous=(this.database.query(
        'SELECT entry_hash FROM fencing_settlement_audit ORDER BY sequence DESC LIMIT 1').get() as{entry_hash:string}|null)?.entry_hash??ZERO;
        const payload={settlementId,step,requestDigest,occurredAt};this.database.run(`INSERT INTO fencing_settlement_audit
            (settlement_id,step,request_digest,occurred_at,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5,?6)`,
        [settlementId,step,requestDigest,occurredAt,previous,hash({previousHash:previous,payload})])}
    private migrate():void{const version=Number((this.database.query('PRAGMA user_version').get() as{user_version:number}).user_version);
        if(version>1)throw new Error(`Fencing settlement schema ${version} is newer than supported version 1`);if(version===1)return;
        const transaction=this.database.transaction(()=>{this.database.run(`CREATE TABLE fencing_settlement(
            settlement_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,trade_receipt_id TEXT NOT NULL UNIQUE,
            request_json TEXT NOT NULL,request_digest TEXT NOT NULL,provenance_committed INTEGER NOT NULL,stock_committed INTEGER NOT NULL,
            money_committed INTEGER NOT NULL,status TEXT NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE fencing_settlement_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                settlement_id TEXT NOT NULL REFERENCES fencing_settlement(settlement_id),step TEXT NOT NULL,request_digest TEXT NOT NULL,
                occurred_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,UNIQUE(settlement_id,step))`);
            this.database.run('PRAGMA user_version = 1')});transaction.immediate()}
}
