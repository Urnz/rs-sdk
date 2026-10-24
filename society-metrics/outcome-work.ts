import type { Database } from 'bun:sqlite';
import { NativeToolWorkStore } from '../production-workflow/native-tool-work.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import { assertFoodProductionSchema,readFoodProductionReceipt } from '../server/engine/src/mods/NativeFoodProductionStore.js';
import type { EvaluationScope } from './evaluation.js';

export interface OutcomeActor {agentId:string;username:string|null;lifecycleId:string|null}
export interface WorkerEvidence {
    id:string;workerAgentId:string;stage:string;simulationTime:string;outputItems:{itemId:number;quantity:number}[];
    serviceCapacityAfter:number|null;creditedSimulationMs:string|null;elapsedSimulationMs:string|null;
    noncreditedElapsedSimulationMs:string|null;relatedRunId:string|null;relatedBatchId:string|null;
}
export function outcomeCheck(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
export const outcomeTime=(value:unknown)=>{outcomeCheck(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Invalid outcome time');return Date.parse(value);};
export const outcomeCount=(value:unknown)=>{outcomeCheck(Number.isSafeInteger(value)&&Number(value)>=0,'Invalid native outcome count');return Number(value);};
export function outcomeRows(db:Database,table:string):Record<string,any>[] {
    outcomeCheck(/^[a-z_]+$/.test(table),'Invalid internal outcome table');
    outcomeCheck((db.query(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n<=100000,'Outcome source exceeds row limit');
    return db.query(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string,any>[];
}
export const outcomeTable=(db:Database,table:string)=>!!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
/** Only committed physical receipts produce outputs; roles and credited time are independent observations. */
export function readNativeWorkerEvidence(db:Database,scope:EvaluationScope,worldId:string,actors:OutcomeActor[]){
    const from=outcomeTime(scope.fromSimulationTime),to=outcomeTime(scope.toSimulationTime),rows:WorkerEvidence[]=[],credits:Array<{
        operationId:string;workerAgentId:string;from:string;to:string;creditedMs:string|null}>=[];
    const actorMap=new Map(actors.map(a=>[a.agentId,a]));
    const included=(at:string)=>outcomeTime(at)>from&&outcomeTime(at)<=to;
    const identity=(owner:{actorId:string;username:string;lifecycleId:string;worldId:string;clockId:string;clockProfileDigest:string})=>{
        const actor=actorMap.get(owner.actorId);if(!actor||owner.clockId!==scope.clockId)return false;
        outcomeCheck(owner.worldId===worldId&&owner.clockProfileDigest===scope.clockProfileDigest&&owner.username===actor.username
            &&owner.lifecycleId===actor.lifecycleId,'Native worker world/lifecycle/profile differs');return true;
    };
    const channel={toolWork:NativeToolWorkStore.present(db),mining:outcomeTable(db,'native_tool_event'),food:outcomeTable(db,'native_food_production_schema')};
    const events=new Map<string,Record<string,any>>();
    if(channel.mining)for(const r of outcomeRows(db,'native_tool_event')){const value=JSON.parse(r.payload);
        outcomeCheck(nativeToolDigest(value)===r.digest,'Native worker event digest differs');events.set(r.event_id,value);}
    if(channel.toolWork){
        outcomeRows(db,'native_tool_work_audit');outcomeRows(db,'native_tool_work');const jobs=NativeToolWorkStore.read(db),byId=new Map(jobs.map(j=>[j.intent.operationId,j]));
        const previous=new Map<string,Record<string,any>>();
        for(const r of outcomeRows(db,'native_tool_work_audit')){const e=JSON.parse(r.payload),job=byId.get(e.operationId);
            outcomeCheck(job,'Native work audit has no job');if(!identity(job.intent.owner))continue;
            const prior=previous.get(e.operationId);outcomeCheck(e.revision===(prior?.revision??0)+1,'Native work audit revision gap');
            const delta=outcomeCount(e.progressMs)-outcomeCount(prior?.progressMs??0);
            outcomeCheck(delta>=0&&e.last.clock.clockId===scope.clockId&&e.last.clock.profileDigest===scope.clockProfileDigest,'Native credit/profile regressed');
            if(prior&&delta>0){const a=outcomeTime(prior.last.clock.simulationTime),b=outcomeTime(e.last.clock.simulationTime);
                outcomeCheck(delta<=b-a&&e.last.valid&&prior.last.valid&&e.last.sessionId===prior.last.sessionId,'Native credited work interval differs');
                const clipped=Math.max(0,Math.min(to,b)-Math.max(from,a));
                if(clipped)credits.push({operationId:e.operationId,workerAgentId:job.intent.owner.actorId,from:new Date(Math.max(from,a)).toISOString(),
                    to:new Date(Math.min(to,b)).toISOString(),creditedMs:clipped===b-a?String(delta):delta===b-a?String(clipped):null});
            }previous.set(e.operationId,e);
        }
        for(const job of jobs){if(!identity(job.intent.owner)||job.phase!=='completed')continue;
            const proof=events.get(`work:${job.intent.operationId}`);
            outcomeCheck(proof&&nativeToolDigest(proof.intent)===job.intentDigest&&nativeToolDigest(proof.result)===nativeToolDigest(job.result)
                &&proof.workSimulationMs===job.progressMs,'Completed native work lacks its committed effect');
            outcomeCheck(proof.clock.clockId===scope.clockId&&proof.clock.profileDigest===scope.clockProfileDigest
                &&proof.clock.simulationTime===job.last.clock.simulationTime,'Native work effect clock differs');
            if(!included(proof.clock.simulationTime))continue;
            const elapsed=outcomeTime(proof.clock.simulationTime)-outcomeTime(job.started.simulationTime);
            outcomeCheck(elapsed>=job.progressMs,'Native elapsed work is shorter than credit');
            rows.push({id:`tool-work:${job.intent.operationId}`,workerAgentId:job.intent.owner.actorId,stage:job.intent.kind,
                simulationTime:proof.clock.simulationTime,outputItems:job.result!.outputItems.map(i=>({itemId:i.id,quantity:outcomeCount(i.count)})),
                serviceCapacityAfter:job.result!.tool?.durability??null,creditedSimulationMs:String(job.progressMs),elapsedSimulationMs:String(elapsed),
                noncreditedElapsedSimulationMs:String(elapsed-job.progressMs),relatedRunId:null,relatedBatchId:null});
        }
    }
    for(const[id,event]of events){if(event.kind!=='mined'||!identity(event.source.owner)||!included(event.source.clock.simulationTime))continue;
        outcomeCheck(event.source.clock.clockId===scope.clockId&&event.source.clock.profileDigest===scope.clockProfileDigest
            &&outcomeCount(event.source.outputQuantity)===1,'Native Mining output/clock differs');
        rows.push({id:`mining:${id}`,workerAgentId:event.source.owner.actorId,stage:'mining',simulationTime:event.source.clock.simulationTime,
            outputItems:[{itemId:event.source.outputItemId,quantity:1}],serviceCapacityAfter:null,creditedSimulationMs:null,elapsedSimulationMs:null,
            noncreditedElapsedSimulationMs:null,relatedRunId:null,relatedBatchId:null});
    }
    if(channel.food){assertFoodProductionSchema(db);
        for(const a of outcomeRows(db,'native_food_production_actions')){const receipt=readFoodProductionReceipt(db,a.action_id);if(!receipt)continue;
            if(!identity(receipt.action)||!included(receipt.clock.simulationTime))continue;
            outcomeCheck(receipt.clock.clockId===scope.clockId&&receipt.clock.profileDigest===scope.clockProfileDigest,'Native food worker clock differs');
            rows.push({id:`food-production:${a.action_id}`,workerAgentId:receipt.action.actorId,stage:`food-${receipt.action.kind}`,
                simulationTime:receipt.clock.simulationTime,outputItems:receipt.outputs.map(i=>({itemId:i.itemId,quantity:outcomeCount(i.quantity)})),
                serviceCapacityAfter:null,creditedSimulationMs:null,elapsedSimulationMs:null,noncreditedElapsedSimulationMs:null,
                relatedRunId:receipt.action.runId,relatedBatchId:receipt.action.batchId});
        }
    }
    outcomeCheck(new Set(rows.map(r=>r.id)).size===rows.length,'Duplicate native worker output');
    return{channels:channel,rows,credits,completeWorkerCoverage:false,
        timing:'Completion rows carry whole-job timing; person-time credits are clipped to the selected window. Receipt timestamps alone do not prove duration. Noncredited elapsed time is not automatically queue waiting.'};
}

export function laborProjection(actors:readonly string[],work:ReturnType<typeof readNativeWorkerEvidence>){
    return actors.map(workerAgentId=>{const credits=work.credits.filter(c=>c.workerAgentId===workerAgentId),known=credits.every(c=>c.creditedMs!==null);
        const ordered=[...credits].sort((a,b)=>outcomeTime(a.from)-outcomeTime(b.from));
        outcomeCheck(ordered.every((c,i)=>i===0||outcomeTime(c.from)>=outcomeTime(ordered[i-1]!.to)),'Overlapping native worker credits');
        return{workerAgentId,recordedCreditedSimulationMs:known?String(credits.reduce((n,c)=>n+BigInt(c.creditedMs!),0n)):null,
            availableAndWillingPersonMs:null,unemployedPersonMs:null,unemploymentRate:null,status:'inconclusive',
            reason:'Complete available-and-willing demand/exposure is absent; offline, skill-idle and uncredited time are not unemployment.'};});
}
