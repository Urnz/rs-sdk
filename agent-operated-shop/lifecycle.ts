import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { BusinessStockSettlementStore, authorizeStockMovement, decideBusinessStock,
    loadDefaultBusinessStockPolicyCatalog, type BusinessStockDecision, type BusinessStockPolicyCatalog,
    type StockMovementEvidence, type StockMovementEvidenceVerifier } from '../business-stock-policy/index.js';
import { BusinessWorkStore, type BusinessWorkOrder } from '../business-work/index.js';
import { BusinessManagerStore } from '../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';

export type AgentShopOperationKind='sale'|'procurement'|'wage';
export type AgentShopOperationStatus='planned'|'stock-committed'|'money-committed'|'committed';
export interface CommittedMoneyEvidence { settlementId:string;reservationId:string|null;amountGp:number;
    sourceRef:string;status:'committed';occurredAt:string }
export type MoneyEvidenceVerifier=(evidence:Readonly<CommittedMoneyEvidence>)=>boolean;
export interface AgentShopOperation {operationId:string;kind:AgentShopOperationKind;businessId:string;
    evidenceId:string;stockSettlementId:string|null;moneySettlementId:string;reservationId:string|null;
    workOrderId:string|null;amountGp:number;status:AgentShopOperationStatus;requestDigest:string;
    error:string|null;createdAt:string;updatedAt:string}
export interface AgentShopSnapshot {businessId:string;inventory:Array<{itemId:number;count:number}>;
    treasury:{balanceGp:number;reservedGp:number;availableGp:number};grossRevenueGp:number;
    procurementCostGp:number;wageCostGp:number;operatingProfitGp:number;
    reorderDecisions:BusinessStockDecision[];operations:AgentShopOperation[]}

interface OperationRow {operation_id:string;kind:AgentShopOperationKind;business_id:string;evidence_id:string;
    stock_settlement_id:string|null;money_settlement_id:string;reservation_id:string|null;work_order_id:string|null;
    amount_gp:number;status:AgentShopOperationStatus;request_digest:string;error:string|null;created_at:string;updated_at:string}
const ID=/^[a-z0-9][a-z0-9._:-]{1,119}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function id(value:string,field:string):string{const normalized=value.trim().toLowerCase();if(!ID.test(normalized))
    throw new Error(`${field} is invalid`);return normalized}
function operation(row:OperationRow):AgentShopOperation{return {operationId:row.operation_id,kind:row.kind,
    businessId:row.business_id,evidenceId:row.evidence_id,stockSettlementId:row.stock_settlement_id,
    moneySettlementId:row.money_settlement_id,reservationId:row.reservation_id,workOrderId:row.work_order_id,
    amountGp:row.amount_gp,status:row.status,requestDigest:row.request_digest,error:row.error,
    createdAt:row.created_at,updatedAt:row.updated_at}}

/** Restart-safe coordinator. Physical player mutations must already have exact committed evidence. */
export class AgentOperatedShopLifecycle {
    private readonly database:Database;
    constructor(private readonly journalPath:string,private readonly businessPath:string,
        private readonly treasuryPath:string,private readonly policies:BusinessStockPolicyCatalog=
            loadDefaultBusinessStockPolicyCatalog()){
        mkdirSync(dirname(journalPath),{recursive:true});this.database=new Database(journalPath,{create:true,strict:true});
        this.database.run(`CREATE TABLE IF NOT EXISTS agent_shop_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            version INTEGER NOT NULL CHECK(version=1))`);this.database.run(`INSERT OR IGNORE INTO agent_shop_schema VALUES(1,1)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS agent_shop_operation(operation_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK(kind IN('sale','procurement','wage')),business_id TEXT NOT NULL,evidence_id TEXT NOT NULL UNIQUE,
            stock_settlement_id TEXT UNIQUE,money_settlement_id TEXT NOT NULL UNIQUE,reservation_id TEXT UNIQUE,work_order_id TEXT UNIQUE,
            amount_gp INTEGER NOT NULL CHECK(amount_gp>0),status TEXT NOT NULL CHECK(status IN('planned','stock-committed','money-committed','committed')),
            request_digest TEXT NOT NULL CHECK(length(request_digest)=64),error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`)
    }
    close():void{this.database.close(true)}
    get(operationIdInput:string):AgentShopOperation|null{const row=this.database.query(`SELECT * FROM agent_shop_operation
        WHERE operation_id=?1`).get(id(operationIdInput,'operationId')) as OperationRow|null;return row?operation(row):null}
    list(businessIdInput:string):AgentShopOperation[]{return (this.database.query(`SELECT * FROM agent_shop_operation
        WHERE business_id=?1 ORDER BY created_at,operation_id`).all(id(businessIdInput,'businessId')) as OperationRow[]).map(operation)}

    settleStock(input:{operationId:string;kind:'sale'|'procurement';policyId:string;decision:BusinessStockDecision;
        stockEvidence:StockMovementEvidence;stockSettlementId:string;moneyEvidence:CommittedMoneyEvidence},
        verifyStock:StockMovementEvidenceVerifier,verifyMoney:MoneyEvidenceVerifier,
        now=new Date().toISOString()):AgentShopOperation {
        const policy=this.policies.policies.find(value=>value.policyId===input.policyId);
        if(!policy)throw new Error('Agent shop stock policy does not exist');
        const authorization=authorizeStockMovement(policy,input.decision,input.stockEvidence,verifyStock);
        if(authorization.direction!==input.kind)throw new Error('Agent shop operation direction differs from evidence');
        const amountGp=authorization.quantity*authorization.evidence.unitPriceGp;
        this.validateMoney(input.moneyEvidence,amountGp,verifyMoney);
        const preflightTreasury=new InstitutionTreasuryStore(this.treasuryPath);
        try{if(input.kind==='sale'){const account=preflightTreasury.get('business',authorization.businessId);
            if(account&&account.balanceGp>2_147_483_647-amountGp)throw new Error('Sale credit would overflow Business treasury')}
        else {const reservation=preflightTreasury.getReservation(input.moneyEvidence.reservationId!);
            if(!reservation||reservation.kind!=='business'||reservation.actorId!==authorization.businessId
                ||reservation.amountGp!==amountGp||reservation.status==='released'
                ||reservation.settlementId&&reservation.settlementId!==input.moneyEvidence.settlementId)
                throw new Error('Procurement does not match its funded Business reservation')}}finally{preflightTreasury.close()}
        const request={kind:input.kind,businessId:authorization.businessId,evidenceId:authorization.evidence.evidenceId,
            stockSettlementId:id(input.stockSettlementId,'stockSettlementId'),moneySettlementId:input.moneyEvidence.settlementId,
            reservationId:input.moneyEvidence.reservationId,workOrderId:null,amountGp,authorizationDigest:authorization.authorizationDigest,
            sourceRef:input.moneyEvidence.sourceRef};let current=this.plan(input.operationId,request,now);
        const stock=new BusinessStockSettlementStore(this.businessPath);
        try {if(current.status==='planned'){stock.apply(request.stockSettlementId,authorization,now);
            current=this.advance(current.operationId,'stock-committed',now)}}catch(error){this.fail(current.operationId,error,now);throw error}
        finally{stock.close()}
        const treasury=new InstitutionTreasuryStore(this.treasuryPath);
        try {if(current.status==='stock-committed'){
            if(input.kind==='sale')treasury.creditExternalSettlement({settlementId:input.moneyEvidence.settlementId,
                kind:'business',actorId:authorization.businessId,amountGp,sourceRef:input.moneyEvidence.sourceRef,
                status:'committed',occurredAt:input.moneyEvidence.occurredAt},()=>true,now);
            else {const reservation=treasury.getReservation(input.moneyEvidence.reservationId!);
                if(!reservation||reservation.kind!=='business'||reservation.actorId!==authorization.businessId
                    ||reservation.amountGp!==amountGp)throw new Error('Procurement does not match its funded Business reservation');
                treasury.bindSettlement(reservation.reservationId,input.moneyEvidence.settlementId,now);
                treasury.commit(reservation.reservationId,input.moneyEvidence.settlementId,now)}
            current=this.advance(current.operationId,'money-committed',now)}
        }catch(error){this.fail(current.operationId,error,now);throw error}finally{treasury.close()}
        return current.status==='money-committed'?this.advance(current.operationId,'committed',now):current
    }

    settleWage(input:{operationId:string;businessId:string;workOrderId:string;moneyEvidence:CommittedMoneyEvidence},
        verifyMoney:MoneyEvidenceVerifier,now=new Date().toISOString()):AgentShopOperation {
        const work=new BusinessWorkStore(this.businessPath),order=work.get(input.workOrderId);
        if(!order||order.businessId!==input.businessId||order.status!=='completed'||order.wageStatus!=='earned'){
            work.close();throw new Error('Agent shop wage requires exact earned work')}
        try{this.validateMoney(input.moneyEvidence,order.wageGp,verifyMoney);const request={kind:'wage' as const,
            businessId:order.businessId,evidenceId:order.evidenceId!,stockSettlementId:null,
            moneySettlementId:input.moneyEvidence.settlementId,reservationId:input.moneyEvidence.reservationId,
            workOrderId:order.workOrderId,amountGp:order.wageGp,sourceRef:input.moneyEvidence.sourceRef};
            let current=this.plan(input.operationId,request,now);const treasury=new InstitutionTreasuryStore(this.treasuryPath);
            try{if(current.status==='planned'){const reservation=treasury.getReservation(input.moneyEvidence.reservationId!);
                if(!reservation||reservation.kind!=='business'||reservation.actorId!==order.businessId
                    ||reservation.amountGp!==order.wageGp)throw new Error('Wage does not match its funded Business reservation');
                treasury.bindSettlement(reservation.reservationId,input.moneyEvidence.settlementId,now);
                treasury.commit(reservation.reservationId,input.moneyEvidence.settlementId,now);
                current=this.advance(current.operationId,'money-committed',now)}}catch(error){this.fail(current.operationId,error,now);throw error}
            finally{treasury.close()}
            if(current.status==='money-committed'){work.settleWage(order.workOrderId,input.moneyEvidence.settlementId,
                (candidate,settlementId)=>this.exactWage(candidate,order)&&settlementId===input.moneyEvidence.settlementId,now);
                current=this.advance(current.operationId,'committed',now)}return current
        }finally{work.close()}
    }

    snapshot(businessIdInput:string):AgentShopSnapshot{const businessId=id(businessIdInput,'businessId');
        const manager=new BusinessManagerStore(this.businessPath),treasury=new InstitutionTreasuryStore(this.treasuryPath);
        try{const inventory=manager.listInventory(businessId).map(item=>({itemId:item.itemId,count:item.count}));
            const account=treasury.get('business',businessId);if(!account)throw new Error('Agent shop treasury does not exist');
            const operations=this.list(businessId).filter(value=>value.status==='committed');
            const total=(kind:AgentShopOperationKind)=>operations.filter(value=>value.kind===kind)
                .reduce((sum,value)=>sum+value.amountGp,0);const grossRevenueGp=total('sale'),procurementCostGp=total('procurement'),
                wageCostGp=total('wage');return{businessId,inventory,treasury:{balanceGp:account.balanceGp,
                    reservedGp:account.reservedGp,availableGp:account.availableGp},grossRevenueGp,procurementCostGp,wageCostGp,
                    operatingProfitGp:grossRevenueGp-procurementCostGp-wageCostGp,reorderDecisions:this.policies.policies
                        .filter(policy=>policy.businessId===businessId).map(policy=>decideBusinessStock(policy,this.policies,
                            inventory.find(item=>item.itemId===policy.itemId)?.count??0)).filter(value=>value.procurement!==null),operations}
        }finally{manager.close();treasury.close()}}

    private validateMoney(evidence:CommittedMoneyEvidence,amountGp:number,verify:MoneyEvidenceVerifier):void{
        const normalized={...evidence,settlementId:evidence.settlementId.trim().toLowerCase(),
            reservationId:evidence.reservationId?.trim().toLowerCase()??null,sourceRef:evidence.sourceRef.trim().toLowerCase()};
        if(!UUID.test(normalized.settlementId)||normalized.reservationId!==null&&!ID.test(normalized.reservationId)
            ||normalized.amountGp!==amountGp||normalized.status!=='committed'||!ID.test(normalized.sourceRef)
            ||Number.isNaN(Date.parse(normalized.occurredAt))||!verify(Object.freeze(normalized)))
            throw new Error('Agent shop money evidence is not trusted')
    }
    private plan(operationIdInput:string,request:Omit<AgentShopOperation,'operationId'|'status'|'requestDigest'|'error'|'createdAt'|'updatedAt'>
        &Record<string,unknown>,now:string):AgentShopOperation{const operationId=id(operationIdInput,'operationId'),requestDigest=hash(request);
        const existing=this.get(operationId);if(existing){if(existing.requestDigest!==requestDigest)throw new Error('Agent shop operation id was reused');return existing}
        this.database.run(`INSERT INTO agent_shop_operation VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'planned',?10,NULL,?11,?11)`,
            [operationId,request.kind,request.businessId,request.evidenceId,request.stockSettlementId,request.moneySettlementId,
                request.reservationId,request.workOrderId,request.amountGp,requestDigest,now]);return this.get(operationId)!}
    private advance(operationId:string,status:AgentShopOperationStatus,now:string):AgentShopOperation{this.database.run(
        `UPDATE agent_shop_operation SET status=?2,error=NULL,updated_at=?3 WHERE operation_id=?1`,[operationId,status,now]);return this.get(operationId)!}
    private fail(operationId:string,error:unknown,now:string):void{this.database.run(`UPDATE agent_shop_operation SET error=?2,updated_at=?3
        WHERE operation_id=?1`,[operationId,(error instanceof Error?error.message:String(error)).slice(0,500),now])}
    private exactWage(left:BusinessWorkOrder,right:BusinessWorkOrder):boolean{return left.workOrderId===right.workOrderId
        &&left.businessId===right.businessId&&left.workerAgentId===right.workerAgentId&&left.wageGp===right.wageGp}
}
