import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { bindNativeEconomicEvent, nativeBusinessProductionPath } from '../external-trade/engine-clock.js';
import { initializeProductionEvidence, readProductionEvidence, appendProductionEvidence, productionSourceId,
    type ProductionClockBinder, type ProductionLotEvidence } from './evidence.js';

import { businessRoleHasPermission, loadDefaultBusinessRoleCatalog, resolveBusinessRole,
    type BusinessPermission, type BusinessPermissionDomain, type BusinessRoleCatalog } from '../business-roles/index.js';
import { compileProductionWorkflow } from './planner.js';
import { productionWorkflowCatalogDigest } from './catalog.js';
import type { CompiledProductionWorkflow, ProductionItemQuantity, ProductionWorkflowCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/, DIGEST = /^[0-9a-f]{64}$/;
export interface ProductionInputAllocation { itemId: number; count: number; storageId: string | null }
export interface ReserveProductionRun { operationId: string; runId: string; businessId: string; actorAgentId: string;
    workflowId: string; workflowVersion: string; inputs: ProductionInputAllocation[] }
export interface ProductionStepEvidence { operationId: string; runId: string; stepId: string; status: 'completed';
    inputs: ProductionItemQuantity[]; outputs: ProductionItemQuantity[]; sourceEvidenceDigest: string; occurredAt: string }
export interface ProductionRunState { runId: string; businessId: string; actorAgentId: string; workflowId: string;
    workflowVersion: string; status: 'reserved'|'running'|'completed'|'cancelled'; catalogDigest: string;
    createdAt: string; updatedAt: string }
export type ProductionStepVerifier = (evidence: ProductionStepEvidence) => boolean;
type RunRow = { run_id:string;business_id:string;actor_agent_id:string;workflow_id:string;workflow_version:string;
    status:ProductionRunState['status'];catalog_digest:string;plan_json:string;request_digest:string;created_at:string;updated_at:string };
type MaterialRow = { material_id:number;item_id:number;count:number;source_storage_id:string|null;origin_step_id:string|null };

function identifier(value:string,field:string):string{if(!ID.test(value))throw new Error(`${field} is invalid`);return value}
function itemId(value:number):number{if(!Number.isSafeInteger(value)||value<0||value>65_535)throw new Error('itemId is invalid');return value}
function positive(value:number,field:string):number{if(!Number.isSafeInteger(value)||value<1||value>2_147_483_647)
    throw new Error(`${field} is invalid`);return value}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function state(row:RunRow):ProductionRunState{return{runId:row.run_id,businessId:row.business_id,actorAgentId:row.actor_agent_id,
    workflowId:row.workflow_id,workflowVersion:row.workflow_version,status:row.status,catalogDigest:row.catalog_digest,
    createdAt:row.created_at,updatedAt:row.updated_at}}
function quantities(values:ProductionItemQuantity[]):ProductionItemQuantity[]{return [...values].sort((a,b)=>a.itemId-b.itemId)}

export class ProductionWorkInProgressStore {
    private readonly database:Database;
    private readonly productionClock:ProductionClockBinder|undefined;
    constructor(path:string,private readonly catalog:ProductionWorkflowCatalog,
        private readonly roles:BusinessRoleCatalog=loadDefaultBusinessRoleCatalog(),clockBinder?:ProductionClockBinder|false){
        const{digest,...definition}=catalog;if(digest!==productionWorkflowCatalogDigest(definition))
            throw new Error('Production workflow catalog digest mismatch');
        mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        this.productionClock=clockBinder===false?undefined:clockBinder??(resolve(path).toLowerCase()===resolve(nativeBusinessProductionPath).toLowerCase()
            ?(facts,factsDigest)=>bindNativeEconomicEvent({domain:'business-production',sourceId:productionSourceId(facts.evidence.operationId),
                sourceDigest:factsDigest,wallTime:facts.recordedAt}):undefined);
        try{this.database.run('PRAGMA foreign_keys = ON');
            if(this.database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_production_evidence_schema'").get()){
                const schema=this.database.query('SELECT version FROM business_production_evidence_schema WHERE singleton=1').get() as{version:number}|null;
                if(schema?.version!==1)throw new Error('Unsupported production evidence schema');}
            this.migrate();initializeProductionEvidence(this.database)}
        catch(error){this.close();throw error}}
    close():void{(this.database as Database & {clearQueryCache():void}).clearQueryCache();this.database.close(true)}
    get(runIdInput:string):ProductionRunState|null{const row=this.database.query('SELECT * FROM business_production_run WHERE run_id=?1')
        .get(identifier(runIdInput,'runId')) as RunRow|null;return row?state(row):null}
    reserve(input:ReserveProductionRun,now=new Date().toISOString()):ProductionRunState{
        const operationId=identifier(input.operationId,'operationId'),runId=identifier(input.runId,'runId'),
            businessId=identifier(input.businessId,'businessId'),actorAgentId=identifier(input.actorAgentId,'actorAgentId'),
            plan=compileProductionWorkflow(this.catalog,input.workflowId,input.workflowVersion);
        const allocations=input.inputs.map(value=>({itemId:itemId(value.itemId),count:positive(value.count,'count'),
            storageId:value.storageId===null?null:identifier(value.storageId,'storageId')}))
            .sort((a,b)=>a.itemId-b.itemId||(a.storageId??'').localeCompare(b.storageId??''));
        const totals=new Map<number,number>();for(const allocation of allocations)totals.set(allocation.itemId,
            (totals.get(allocation.itemId)??0)+allocation.count);
        if(JSON.stringify([...totals].sort(([a],[b])=>a-b).map(([id,count])=>({itemId:id,quantity:count})))
            !==JSON.stringify(plan.externalInputs))throw new Error('Production input allocations do not match compiled workflow');
        const requestDigest=hash({operationId,runId,businessId,actorAgentId,workflowId:input.workflowId,
            workflowVersion:input.workflowVersion,allocations,catalogDigest:this.catalog.digest}),existing=this.get(runId);
        if(existing){const row=this.run(runId);if(row.request_digest!==requestDigest)throw new Error('Production run id was reused');return existing}
        if(allocations.some(allocation=>allocation.storageId===null))this.requirePermission(businessId,actorAgentId,'inventory','issue');
        const transaction=this.database.transaction(()=>{this.database.run(
                `INSERT INTO business_production_run VALUES(?1,?2,?3,?4,?5,?6,'reserved',?7,?8,?9,?10,?10)`,
                [runId,operationId,businessId,actorAgentId,input.workflowId,input.workflowVersion,this.catalog.digest,
                    JSON.stringify(plan),requestDigest,now]);
            for(const allocation of allocations){if(allocation.storageId){
                this.requirePermission(businessId,actorAgentId,'storage','withdraw');this.requireStorage(businessId,allocation.storageId);
                const changed=this.database.run(`UPDATE business_storage_item SET count=count-?4,revision=revision+1,updated_at=?5
                    WHERE business_id=?1 AND storage_id=?2 AND item_id=?3 AND count>=?4`,
                [businessId,allocation.storageId,allocation.itemId,allocation.count,now]);
                if(changed.changes!==1)throw new Error('Business production input stock is insufficient');
            }else{const changed=this.database.run(`UPDATE business_inventory SET count=count-?3,revision=revision+1,updated_at=?4
                    WHERE business_id=?1 AND item_id=?2 AND count>=?3`,[businessId,allocation.itemId,allocation.count,now]);
                if(changed.changes!==1)throw new Error('Business production input stock is insufficient')}
            this.database.run(`INSERT INTO business_production_material(run_id,item_id,count,source_storage_id,origin_step_id)
                VALUES(?1,?2,?3,?4,NULL)`,[runId,allocation.itemId,allocation.count,allocation.storageId])}
        });transaction.immediate();return this.get(runId)!}
    completeStep(runIdInput:string,stepIdInput:string,evidence:ProductionStepEvidence,verify?:ProductionStepVerifier,
        recordedAt=new Date().toISOString()):ProductionRunState{
        const runId=identifier(runIdInput,'runId'),stepId=identifier(stepIdInput,'stepId'),row=this.run(runId),
            plan=JSON.parse(row.plan_json) as CompiledProductionWorkflow,step=plan.steps.find(value=>value.stepId===stepId);
        if(!step||evidence.runId!==runId||evidence.stepId!==stepId||evidence.status!=='completed'
            ||JSON.stringify(quantities(evidence.inputs))!==JSON.stringify(quantities(step.inputs))
            ||JSON.stringify(quantities(evidence.outputs))!==JSON.stringify(quantities(step.outputs))
            ||!DIGEST.test(evidence.sourceEvidenceDigest)||!Number.isFinite(Date.parse(evidence.occurredAt))||!verify?.(evidence))
            throw new Error('Production step evidence is invalid');
        const operationId=identifier(evidence.operationId,'operationId'),requestDigest=hash(evidence),existing=this.database.query(
            'SELECT request_digest FROM business_production_step WHERE operation_id=?1').get(operationId) as {request_digest:string}|null;
        if(existing){if(existing.request_digest!==requestDigest)throw new Error('Production step operation id was reused');
            readProductionEvidence(this.database);return this.get(runId)!}
        if(!Number.isSafeInteger(Date.parse(recordedAt))||new Date(recordedAt).toISOString()!==recordedAt)throw new Error('Production commit wall time is invalid');
        if(row.status!=='reserved'&&row.status!=='running')throw new Error('Production run is not active');
        const completed=new Set((this.database.query('SELECT step_id FROM business_production_step WHERE run_id=?1')
            .all(runId) as Array<{step_id:string}>).map(value=>value.step_id));
        if(completed.has(stepId))throw new Error('Production step was already completed with another operation id');
        if(step.dependsOn.some(dependency=>!completed.has(dependency)))throw new Error('Production step dependencies are incomplete');
        const ancestors=this.ancestors(plan,stepId),transaction=this.database.transaction(()=>{
            readProductionEvidence(this.database);
            const consumedLots:ProductionLotEvidence[]=[],producedLots:ProductionLotEvidence[]=[];
            for(const required of step.inputs){let remaining=required.quantity;
                const lots=(this.database.query(`SELECT material_id,item_id,count,source_storage_id,origin_step_id
                    FROM business_production_material WHERE run_id=?1 AND item_id=?2 AND count>0
                    ORDER BY CASE WHEN origin_step_id IS NULL THEN 1 ELSE 0 END,material_id`).all(runId,required.itemId) as MaterialRow[])
                    .filter(lot=>lot.origin_step_id===null||ancestors.has(lot.origin_step_id));
                for(const lot of lots){const used=Math.min(lot.count,remaining);if(used>0){this.database.run(
                    'UPDATE business_production_material SET count=count-?2 WHERE material_id=?1',[lot.material_id,used]);
                    consumedLots.push({materialId:lot.material_id,itemId:lot.item_id,quantity:used,before:lot.count,after:lot.count-used,
                        sourceStorageId:lot.source_storage_id,originStepId:lot.origin_step_id});}
                    remaining-=used;if(remaining===0)break}if(remaining!==0)throw new Error('Reserved production material is insufficient')}
            for(const output of step.outputs){const created=this.database.run(`INSERT INTO business_production_material
                (run_id,item_id,count,source_storage_id,origin_step_id) VALUES(?1,?2,?3,NULL,?4)`,
            [runId,output.itemId,output.quantity,stepId]);
                producedLots.push({materialId:Number(created.lastInsertRowid),itemId:output.itemId,quantity:output.quantity,before:0,after:output.quantity,
                    sourceStorageId:null,originStepId:stepId});}
            this.database.run(`INSERT INTO business_production_step VALUES(?1,?2,?3,?4,?5,?6)`,
                [operationId,runId,stepId,requestDigest,evidence.sourceEvidenceDigest,evidence.occurredAt]);
            this.database.run(`UPDATE business_production_run SET status='running',updated_at=?2 WHERE run_id=?1`,
                [runId,evidence.occurredAt]);
            appendProductionEvidence(this.database,this.catalog,{schemaVersion:1,runId,businessId:row.business_id,recordedActorAgentId:row.actor_agent_id,
                workflowId:row.workflow_id,workflowVersion:row.workflow_version,runRequestDigest:row.request_digest,catalogDigest:row.catalog_digest,
                plan:structuredClone(plan),evidence:structuredClone(evidence),consumedLots,producedLots,recordedAt},this.productionClock);
            readProductionEvidence(this.database);
        });transaction.immediate();return this.get(runId)!}
    completeRun(runIdInput:string,targetStorageIdInput:string|null,now=new Date().toISOString()):ProductionRunState{
        const runId=identifier(runIdInput,'runId'),row=this.run(runId),plan=JSON.parse(row.plan_json) as CompiledProductionWorkflow;
        if(row.status==='completed')return state(row);if(row.status!=='running')throw new Error('Production run is not running');
        const completed=Number((this.database.query('SELECT COUNT(*) count FROM business_production_step WHERE run_id=?1')
            .get(runId) as {count:number}).count);if(completed!==plan.steps.length)throw new Error('Production run steps are incomplete');
        const target=targetStorageIdInput===null?null:identifier(targetStorageIdInput,'targetStorageId'),lots=this.materials(runId),totals=new Map<number,number>();
        this.requirePermission(row.business_id,row.actor_agent_id,target?'storage':'inventory',target?'deposit':'receive');
        lots.forEach(lot=>{if(lot.count>0)totals.set(lot.item_id,(totals.get(lot.item_id)??0)+lot.count)});
        if(JSON.stringify([...totals].sort(([a],[b])=>a-b).map(([id,count])=>({itemId:id,quantity:count})))
            !==JSON.stringify(plan.finalOutputs))throw new Error('Production final WIP does not match compiled workflow');
        const transaction=this.database.transaction(()=>{if(target){this.requireStorage(row.business_id,target);
                const storage=this.database.query(`SELECT capacity_units-(SELECT COALESCE(SUM(count),0) FROM business_storage_item
                    WHERE storage_id=?2) free FROM business_storage WHERE business_id=?1 AND storage_id=?2`)
                    .get(row.business_id,target) as {free:number}|null;
                const total=[...totals.values()].reduce((sum,count)=>sum+count,0);if(!storage||storage.free<total)
                    throw new Error('Business storage capacity exceeded')}
            for(const [id,count] of totals){if(target)this.database.run(`INSERT INTO business_storage_item VALUES(?1,?2,?3,?4,1,?5)
                    ON CONFLICT(storage_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
                [row.business_id,target,id,count,now]);else this.database.run(`INSERT INTO business_inventory VALUES(?1,?2,?3,1,?4)
                    ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
                [row.business_id,id,count,now])}
            this.database.run('UPDATE business_production_material SET count=0 WHERE run_id=?1',[runId]);
            this.database.run(`UPDATE business_production_run SET status='completed',updated_at=?2 WHERE run_id=?1`,[runId,now]);
        });transaction.immediate();return this.get(runId)!}
    cancelReserved(runIdInput:string,now=new Date().toISOString()):ProductionRunState{const runId=identifier(runIdInput,'runId'),row=this.run(runId);
        if(row.status==='cancelled')return state(row);if(row.status!=='reserved')throw new Error('Only an unstarted production run can be cancelled');
        const transaction=this.database.transaction(()=>{for(const lot of this.materials(runId)){if(lot.origin_step_id!==null||lot.count===0)continue;
                if(lot.source_storage_id)this.database.run(`INSERT INTO business_storage_item VALUES(?1,?2,?3,?4,1,?5)
                    ON CONFLICT(storage_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
                [row.business_id,lot.source_storage_id,lot.item_id,lot.count,now]);else this.database.run(`INSERT INTO business_inventory VALUES(?1,?2,?3,1,?4)
                    ON CONFLICT(business_id,item_id) DO UPDATE SET count=count+excluded.count,revision=revision+1,updated_at=excluded.updated_at`,
                [row.business_id,lot.item_id,lot.count,now])}
            this.database.run('UPDATE business_production_material SET count=0 WHERE run_id=?1',[runId]);
            this.database.run(`UPDATE business_production_run SET status='cancelled',updated_at=?2 WHERE run_id=?1`,[runId,now]);
        });transaction.immediate();return this.get(runId)!}
    private run(runId:string):RunRow{const row=this.database.query('SELECT * FROM business_production_run WHERE run_id=?1').get(runId) as RunRow|null;
        if(!row)throw new Error('Production run does not exist');return row}
    private materials(runId:string):MaterialRow[]{return this.database.query(`SELECT material_id,item_id,count,source_storage_id,origin_step_id
        FROM business_production_material WHERE run_id=?1 ORDER BY material_id`).all(runId) as MaterialRow[]}
    private ancestors(plan:CompiledProductionWorkflow,stepId:string):Set<string>{const result=new Set<string>();const visit=(id:string)=>{
        const step=plan.steps.find(value=>value.stepId===id)!;for(const dependency of step.dependsOn)if(!result.has(dependency)){result.add(dependency);visit(dependency)}};
        visit(stepId);return result}
    private requireStorage(businessId:string,storageId:string):void{if(!this.database.query(
        'SELECT 1 ok FROM business_storage WHERE business_id=?1 AND storage_id=?2').get(businessId,storageId))
        throw new Error('Business storage does not exist')}
    private requirePermission(businessId:string,actorAgentId:string,domain:BusinessPermissionDomain,permission:BusinessPermission):void{
        const business=this.database.query('SELECT owner_agent_id,status FROM business WHERE business_id=?1').get(businessId) as
            {owner_agent_id:string;status:string}|null;if(!business||business.status!=='active')throw new Error('Production requires an active Business');
        if(business.owner_agent_id===actorAgentId)return;const employment=this.database.query(`SELECT role_definition_id FROM business_employment
            WHERE business_id=?1 AND worker_agent_id=?2 AND status='active'`).get(businessId,actorAgentId) as{role_definition_id:string}|null;
        if(!employment||!businessRoleHasPermission(resolveBusinessRole(this.roles,employment.role_definition_id),domain,permission))
            throw new Error(`Business role lacks ${domain}.${permission} permission`)}
    private migrate():void{this.database.run(`CREATE TABLE IF NOT EXISTS business_production_run(run_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,
        business_id TEXT NOT NULL REFERENCES business(business_id),actor_agent_id TEXT NOT NULL,workflow_id TEXT NOT NULL,workflow_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('reserved','running','completed','cancelled')),catalog_digest TEXT NOT NULL,plan_json TEXT NOT NULL,
        request_digest TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_production_material(material_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL REFERENCES business_production_run(run_id),item_id INTEGER NOT NULL,count INTEGER NOT NULL CHECK(count>=0),
            source_storage_id TEXT,origin_step_id TEXT)`);
        this.database.run(`CREATE TABLE IF NOT EXISTS business_production_step(operation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL
            REFERENCES business_production_run(run_id),step_id TEXT NOT NULL,request_digest TEXT NOT NULL,source_evidence_digest TEXT NOT NULL,
            completed_at TEXT NOT NULL,UNIQUE(run_id,step_id))`)}
}
