import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync,mkdirSync,linkSync,unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { assertNativeFoodPath,assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { readNativeBankingLedger } from '../server/gateway/admin/banking-ledger.js';
import { readNativeTrades } from '../external-trade/source.js';
import { readNativeCommerce } from '../server/engine/src/mods/NativeCommerceStore.js';
import { readFoodCommerce } from '../agent-operated-shop/native-commerce.js';
import { readWorkBindings,type BusinessWorkBinding } from '../business-work/binding.js';
import { readRentJournal,type NativeRentReceipt } from '../housing/native-rent.js';
import { readWealthBoundary,type NativeIntegrationOptions,type NativeWealthPaths } from './integration-sources.js';
import { validateEvaluationScope,type EvaluationScope } from './evaluation.js';

export interface FinanceBoundaryPaths extends NativeWealthPaths {bankingPath?:string;contractsPath?:string;tradePath?:string}
export interface FinanceBoundarySelection {id:string;paths:FinanceBoundaryPaths}
export interface NativeFinanceOptions {
    native:NativeIntegrationOptions;opening:FinanceBoundarySelection;closing:FinanceBoundarySelection;
    basket:readonly {itemId:number;fixedWeight:number}[];maxPriceAgeSimulationMs:number;
}
export function financeCheck(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
export function financeInteger(value:unknown):number {financeCheck(Number.isSafeInteger(value)&&Number(value)>=0,'Invalid native financial amount');return Number(value);}
export type FinanceSource<T>={status:'available';value:T}|{status:'unavailable'|'invalid';reason:string};
export function financeCapture<T>(read:()=>T):FinanceSource<T>{try{return{status:'available',value:read()};}catch(error){
    return{status:(error as NodeJS.ErrnoException).code==='ENOENT'?'unavailable':'invalid',reason:error instanceof Error?error.message:String(error)};}}
function pathCheck(options:NativeIntegrationOptions,path:string){
    // Both checks resolve physical paths; domain paths are valid for managed .local sources.
    try{assertNativeFoodPath({...options,checkpointPath:path});}catch{assertNativeFoodDomainPath({...options,checkpointPath:path});}
}
function database<T>(options:NativeIntegrationOptions,path:string|undefined,read:(db:Database)=>T):T{
    financeCheck(path,'Native financial channel not configured');pathCheck(options,path);
    const db=new OwnedDatabase(path,{readonly:true,strict:true});
    try{let value!:T;db.transaction(()=>{
        const pages=db.query('PRAGMA page_count').get() as {page_count:number},size=db.query('PRAGMA page_size').get() as {page_size:number};
        financeCheck(pages.page_count*size.page_size<=256*1024*1024,'Native financial database exceeds256 MiB');
        value=read(db);
    }).deferred();return value;}finally{db.close(true);}
}
export function financeRows(db:Database,table:string):Record<string,any>[] {
    financeCheck(/^[a-z_]+$/.test(table),'Invalid internal finance table');
    const n=db.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number};financeCheck(n.n<=100000,'Native financial table exceeds row limit');
    return db.query(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string,any>[];
}
const optionalRows=(db:Database,table:string)=>db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(table)?financeRows(db,table):null;
/** The two frozen states can place a newly committed payment in an interval without inventing its exact time. */
export function financeWageProofs(work:Array<{binding:BusinessWorkBinding;order:Record<string,any>|null}>|null,
    rewards:Record<string,any>[]|null,reservations:Record<string,any>[]){
    const payments:Array<{settlementId:string;businessId:string;workerAgentId:string;username:string;amountGp:string;digest:string}>=[];
    for(const row of work??[]){const b=row.binding,n=rewards?.find(r=>r.settlement_id===b.settlementId),d=reservations.find(r=>r.settlement_id===b.settlementId);
        if(row.order?.wage_gp===0&&b.request.rewardGp===0&&n?.status!=='committed'&&d?.status!=='committed')continue;
        if(row.order?.wage_status!=='paid'&&n?.status!=='committed'&&d?.status!=='committed')continue;
        financeCheck(row.order?.wage_status==='paid'&&row.order.wage_settlement_id===b.settlementId&&n?.status==='committed'&&d?.status==='committed'
            &&d.actor_kind==='business'&&d.actor_id===row.order.business_id&&n.username===b.username&&n.amount===b.request.rewardGp&&n.amount===row.order.wage_gp
            &&n.amount===d.amount_gp&&Number.isSafeInteger(n.coins_before)&&Number.isSafeInteger(n.coins_after)
            &&n.coins_before>=0&&n.coins_after-n.coins_before===n.amount,'Pending/mismatched native wage prevents a closed financial boundary');
        const facts={settlementId:b.settlementId,businessId:String(d.actor_id),workerAgentId:b.request.assigneeAgentId,username:b.username,amountGp:String(financeInteger(n.amount))};
        payments.push({...facts,digest:digest({...facts,coinsBefore:n.coins_before,coinsAfter:n.coins_after})});
    }
    return{status:work&&rewards?'available':'unavailable',payments};
}
function watermarks(options:NativeIntegrationOptions,paths:FinanceBoundaryPaths){
    return Object.fromEntries(Object.entries(paths).sort(([a],[b])=>a.localeCompare(b)).map(([name,path])=>[name,
        path&&existsSync(path)?database(options,path,db=>createHash('sha256').update(db.serialize()).digest('hex')):null]));
}
/** Backend-selected frozen sources, verified before/after collection. No claim of distributed ACID. */
export function readFinanceSnapshot(scope:EvaluationScope,options:NativeFinanceOptions,which:'opening'|'closing'){
    scope=validateEvaluationScope(scope);const selection=options[which],at=which==='opening'?scope.fromSimulationTime:scope.toSimulationTime;
    financeCheck(Array.isArray(options.basket)&&options.basket.length>0&&options.basket.length<=128
        &&new Set(options.basket.map(row=>row.itemId)).size===options.basket.length,'Invalid fixed finance basket');
    for(const row of options.basket)financeCheck(financeInteger(row.itemId)<=65535&&row.itemId!==995&&financeInteger(row.fixedWeight)>0,'Invalid fixed basket item/weight');
    financeCheck(financeInteger(options.maxPriceAgeSimulationMs)>0,'Invalid finance price freshness limit');
    const before=watermarks(options.native,selection.paths),wealth=readWealthBoundary(scope,options.native,selection.paths,at);
    const business=database(options.native,selection.paths.businessPath,db=>({rows:financeRows(db,'business'),
        commerce:db.query("SELECT 1 FROM sqlite_master WHERE name='business_food_commerce_schema'").get()?readFoodCommerce(db):[],
        capital:optionalRows(db,'business_capital_investment'),
        work:db.query("SELECT 1 FROM sqlite_master WHERE name='business_work_binding'").get()?readWorkBindings(db).map(binding=>({binding,
            order:db.query('SELECT * FROM business_work_order WHERE work_order_id=?').get(binding.workOrderId) as Record<string,any>|null})):null}));
    const treasury=database(options.native,selection.paths.treasuryPath,db=>({accounts:financeRows(db,'institution_treasury'),
        reservations:financeRows(db,'institution_treasury_reservation'),transfers:financeRows(db,'institution_treasury_transfer'),
        externalCredits:optionalRows(db,'institution_treasury_external_credit')}));
    const commerce=database(options.native,selection.paths.checkpointPath,db=>db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_commerce_schema'").get()?readNativeCommerce(db):[]);
    const wageAndRent=database(options.native,selection.paths.checkpointPath,db=>({rewards:optionalRows(db,'player_action_reward'),
        rent:db.query("SELECT 1 FROM sqlite_master WHERE name='native_rent_schema'").get()?readRentJournal<NativeRentReceipt>(db,'native_rent'):null}));
    const wages=financeWageProofs(business.work,wageAndRent.rewards,treasury.reservations);
    const bank=financeCapture(()=>database(options.native,selection.paths.bankingPath,db=>{
        for(const table of ['bank_deposit_account','bank_journal','bank_posting','bank_audit_chain'])financeRows(db,table);
        return{...readNativeBankingLedger(db),loans:optionalRows(db,'bank_loan'),disbursements:optionalRows(db,'bank_loan_disbursement')};}));
    const contracts=financeCapture(()=>database(options.native,selection.paths.contractsPath,db=>({contracts:financeRows(db,'economic_contract'),
        evidence:financeRows(db,'economic_contract_evidence'),settlements:financeRows(db,'economic_contract_settlement')})));
    const trades=financeCapture(()=>{financeCheck(selection.paths.tradePath,'Native price/trade channel not configured');
        pathCheck(options.native,selection.paths.tradePath);const rows=readNativeTrades(selection.paths.tradePath,selection.paths.clockPath,scope.clockId);
        financeCheck(rows.every(row=>row.stamp?.clockId===scope.clockId&&row.stamp.profileDigest===scope.clockProfileDigest
            &&row.stamp.simulationTime<=at),'Native trade source has untimed, future or foreign-profile events');return rows;});
    const after=watermarks(options.native,selection.paths);financeCheck(digest(before)===digest(after),'Financial source changed during boundary read');
    const cohort=wealth.cohort.map(row=>({actorAgentId:row.binding.actorId,username:row.binding.playerId,lifecycleId:row.binding.lifecycleId}));
    return{simulationTime:at,worldId:options.native.worldId,cohort,wealth,business,treasury,commerce,wageAndRent,wages,bank,contracts,trades,watermarks:after};
}
function observationPath(options:NativeFinanceOptions,which:'opening'|'closing'){
    const id=options[which].id;financeCheck(/^[a-z0-9][a-z0-9._-]{0,119}$/.test(id),'Invalid finance boundary id');
    const path=join(options.native.workspace,'.local/society-metrics/finance-boundaries',`${id}.json`);
    assertNativeFoodDomainPath({...options.native,checkpointPath:path});return path;
}
function binding(scope:EvaluationScope,options:NativeFinanceOptions,which:'opening'|'closing',snapshot:ReturnType<typeof readFinanceSnapshot>){
    const definition={schemaVersion:1,kind:'native-finance-boundary',id:options[which].id,worldId:snapshot.worldId,cohort:snapshot.cohort,
        simulationTime:snapshot.simulationTime,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,
        marketPolicyDigest:digest({basket:options.basket,maxPriceAgeSimulationMs:options.maxPriceAgeSimulationMs}),
        policy:'backend-frozen-paused-closed-tick-stable-double-read',sourceWatermarks:snapshot.watermarks,snapshotDigest:digest(snapshot)};
    return{...definition,digest:digest(definition)};
}
/** Called explicitly by the backend/CLI. Report reads never create observations or backfill history. */
export function captureNativeFinanceBoundary(scope:EvaluationScope,options:NativeFinanceOptions,which:'opening'|'closing'){
    const snapshot=readFinanceSnapshot(scope,options,which),value=binding(scope,options,which,snapshot),path=observationPath(options,which);
    mkdirSync(join(options.native.workspace,'.local/society-metrics/finance-boundaries'),{recursive:true});
    const temporary=`${path}.${randomUUID()}.tmp`;
    try{writeFileSync(temporary,JSON.stringify(value),{encoding:'utf8',flag:'wx'});
        try{linkSync(temporary,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    }finally{if(existsSync(temporary))unlinkSync(temporary);}
    financeCheck(readFileSync(path,'utf8')===JSON.stringify(value),'Immutable financial observation identity conflict');return value;
}
export function readNativeFinanceBoundary(scope:EvaluationScope,options:NativeFinanceOptions,which:'opening'|'closing'){
    const path=observationPath(options,which),persisted=JSON.parse(readFileSync(path,'utf8'));
    const snapshot=readFinanceSnapshot(scope,options,which),expected=binding(scope,options,which,snapshot);
    financeCheck(digest(persisted)===digest(expected),'Financial observation source/cohort/clock changed');return{binding:expected,snapshot};
}
