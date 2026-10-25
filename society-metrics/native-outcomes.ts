import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync,statSync } from 'node:fs';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { assertNativeFoodPath,assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { readNativeTrades } from '../external-trade/source.js';
import { readWorkBindings } from '../business-work/binding.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
import { readOutcomeAgents } from './outcome-agents.js';
import { providerOutcomes,type OutcomeWallWindow,type OutcomeQueueRow } from './outcome-provider.js';
import { outcomeCheck as check,outcomeRows as rows,outcomeTable as table,outcomeTime as time,readNativeWorkerEvidence,laborProjection } from './outcome-work.js';
import { validateEvaluationScope,type EvaluationScope } from './evaluation.js';
import { readNativeToolDemandObservations } from './tool-demand.js';

/** Backend-owned export capability. Query parameters cannot widen actors, observers or source paths. */
export interface NativeOutcomeOptions {
    workspace:string;worldId:string;agentPath:string;checkpointPath?:string;businessPath?:string;tradePath?:string;clockPath?:string;
    auditPath?:string;queuePath?:string;wallWindow?:OutcomeWallWindow;
    allowedActorAgentIds:readonly string[];allowedObserverAgentIds:readonly string[];
}
type Source<T>={status:'available';value:T;digest:string}|{status:'unavailable'|'invalid';reason:string};
function configured<T>(value:T,message:string):asserts value is NonNullable<T>{if(!value)throw Object.assign(new Error(message),{code:'ENOENT'});}
function capture<T>(read:()=>T):Source<T>{try{const value=read();return{status:'available',value,digest:digest(value)};}
    catch(e){const absent=(e as NodeJS.ErrnoException).code==='ENOENT';
        // Parser/dependency errors can quote private source payloads or out-of-scope IDs.
        return{status:absent?'unavailable':'invalid',reason:absent?'Outcome source absent or not configured':'Outcome source validation failed'};}}
function pathCheck(o:NativeOutcomeOptions,path:string){try{assertNativeFoodPath({...o,checkpointPath:path});}
    catch{assertNativeFoodDomainPath({...o,checkpointPath:path});}}
function database<T>(o:NativeOutcomeOptions,path:string|undefined,read:(db:Database)=>T){
    configured(path,'Outcome channel not configured');pathCheck(o,path);check(statSync(path).size<=256*1024*1024,'Outcome database exceeds256 MiB');
    const db=new OwnedDatabase(path,{readonly:true,strict:true});
    try{let result!:T&{sourceSnapshotDigest:string};db.transaction(()=>{result={...read(db),sourceSnapshotDigest:createHash('sha256').update(db.serialize()).digest('hex')};}).deferred();return result;}
    finally{db.close(true);}
}
export function reportNativeOutcomes(query:EvaluationScope,options:NativeOutcomeOptions){
    const scope=validateEvaluationScope(query);
    check(scope.actorAgentIds.every(id=>options.allowedActorAgentIds.includes(id)),'Outcome export exceeds backend actor scope');
    const observers=options.allowedObserverAgentIds.filter(id=>scope.actorAgentIds.includes(id));
    const agent=capture(()=>database(options,options.agentPath,db=>readOutcomeAgents(db,scope,observers)));
    const work=capture(()=>{check(agent.status==='available','Outcome actor source unavailable');
        return database(options,options.checkpointPath,db=>readNativeWorkerEvidence(db,scope,options.worldId,agent.value.actors));});
    const toolDemand=capture(()=>{check(agent.status==='available','Outcome actor source unavailable');
        return database(options,options.checkpointPath,db=>readNativeToolDemandObservations(db,scope,options.worldId,agent.value.actors));});
    const goalClock=capture(()=>database(options,options.clockPath,db=>{
        check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===SIMULATION_CLOCK_STORE_SCHEMA_VERSION,'Unsupported outcome clock schema');
        check(agent.status==='available','Outcome goal source unavailable');const stamps=rows(db,'simulation_event_stamp');
        return{transitions:agent.value.goals.transitions.flatMap(e=>{
            if(e.clockId!==scope.clockId||!e.simulationTime)return[];
            const stamp=stamps.find(s=>s.clock_id===scope.clockId&&s.domain==='agent-goal-event'&&s.source_id===e.sourceId);
            check(stamp&&stamp.source_digest===e.sourceDigest&&stamp.sequence===e.sequence&&stamp.simulation_time===e.simulationTime
                &&stamp.wall_time===e.wallTime&&stamp.profile_digest===scope.clockProfileDigest&&e.profileDigest===scope.clockProfileDigest,'Goal/native clock binding differs');
            return time(e.simulationTime)>time(scope.fromSimulationTime)&&time(e.simulationTime)<=time(scope.toSimulationTime)?[e]:[];
        }),meaning:'Native-clock-bound recorded goal completion; state predicate basis requires its stored observation. No current-state or enduring-strategy success claim.'};}));
    const business=capture(()=>database(options,options.businessPath,db=>{
        configured(table(db,'business_work_binding'),'Business work binding source unavailable');
        rows(db,'business_work_binding');const orders=rows(db,'business_work_order');
        return{rows:readWorkBindings(db).filter(b=>scope.actorAgentIds.includes(b.requesterAgentId)||scope.actorAgentIds.includes(b.request.assigneeAgentId))
            .map(b=>{const order=orders.find(r=>r.work_order_id===b.workOrderId);check(order,'Bound Business work order missing');
                check(order.worker_agent_id===b.request.assigneeAgentId,'Business worker binding differs');
                return{workOrderId:b.workOrderId,businessId:order.business_id as string,
                    registeredRequesterAgentId:scope.actorAgentIds.includes(b.requesterAgentId)?b.requesterAgentId:null,
                    assignedWorkerAgentId:scope.actorAgentIds.includes(b.request.assigneeAgentId)?b.request.assigneeAgentId:null,runId:b.runId,targetKind:b.target.kind,
                    batchId:b.target.kind==='cook'?b.target.batchId:null,kitchenRunId:b.target.kind==='cook'?b.target.kitchenRunId:null,
                    status:order.status as string,recordedActualMinutes:order.actual_minutes as number|null,recordedStartWall:null,recordedEndWall:null,
                    productiveSimulationMs:null,queueWaitingSimulationMs:null};})};}));
    const trades=capture(()=>{check(agent.status==='available','Observer actor source unavailable');configured(options.tradePath,'Observer native trade channel unavailable');configured(options.clockPath,'Observer native trade clock unavailable');
        pathCheck(options,options.tradePath);pathCheck(options,options.clockPath);
        for(const path of [options.tradePath,options.clockPath])check(statSync(path).size<=256*1024*1024,'Outcome trade source exceeds limit');
        const cohort=new Map(agent.value.actors.filter(a=>a.username).map(a=>[a.username!.toLowerCase(),a.agentId]));
        return readNativeTrades(options.tradePath,options.clockPath,scope.clockId).flatMap(t=>{
            const a=cohort.get(t.event.fromUsername),b=cohort.get(t.event.toUsername);if(!a||!b)return[];
            const authorized=[a,b].filter(id=>observers.includes(id));if(!authorized.length)return[];
            check(t.stamp&&t.stamp.profileDigest===scope.clockProfileDigest,'Selected native trade has no matching simulation stamp');
            if(time(t.stamp.simulationTime)<=time(scope.fromSimulationTime)||time(t.stamp.simulationTime)>time(scope.toSimulationTime))return[];
            return authorized.map(observerAgentId=>({observerAgentId,partnerAgentId:a===observerAgentId?b:a,kind:'native-trade',eventId:t.event.eventId,
                sequence:t.sequence,eventDigest:t.event.eventDigest,simulationTime:t.stamp!.simulationTime,trustChange:null}));});});
    const queue=capture(()=>database(options,options.queuePath,db=>{check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===1,'Unsupported outcome queue schema');
        return{rows:rows(db,'inference_queue_claim') as unknown as OutcomeQueueRow[]};}));
    const provider=capture(()=>{configured(options.auditPath,'Explicit provider audit path required');configured(options.wallWindow,'Independent provider wall window required');
        pathCheck(options,options.auditPath);check(statSync(options.auditPath).size<=32*1024*1024,'Outcome audit exceeds32 MiB');
        const text=readFileSync(options.auditPath,'utf8');return providerOutcomes(text,queue.status==='available'?queue.value.rows:null,scope.actorAgentIds,options.wallWindow);});
    const labor=work.status==='available'?laborProjection(scope.actorAgentIds,work.value):null;
    const physicalSpecialization=work.status==='available'?scope.actorAgentIds.map(workerAgentId=>{
        const counts=new Map<string,number>();for(const row of work.value.rows.filter(r=>r.workerAgentId===workerAgentId))counts.set(row.stage,(counts.get(row.stage)??0)+1);
        const stages=[...counts].map(([stage,count])=>({stage,count})),n=stages.reduce((sum,r)=>sum+r.count,0);
        return{workerAgentId,stages,receiptCount:n,hhi:n?stages.reduce((sum,r)=>sum+r.count*r.count,0)/(n*n):null};}):null;
    const roleBindings=work.status==='available'?work.value.rows.map(w=>({workerReceiptId:w.id,actualWorkerAgentId:w.workerAgentId,
        registeredWorkOrders:business.status==='available'?business.value.rows.filter(b=>b.targetKind==='cook'&&b.kitchenRunId===w.relatedRunId&&b.batchId===w.relatedBatchId)
            .map(b=>({workOrderId:b.workOrderId,registeredRequesterAgentId:b.registeredRequesterAgentId,assignedWorkerAgentId:b.assignedWorkerAgentId,
                physicalWorkerMatchesAssignment:b.assignedWorkerAgentId===w.workerAgentId})):[],
        interpretation:'Actual worker is bound by native receipt; registered requester and assigned worker remain separate.'})):null;
    const definition={schemaVersion:1,artifactKind:'native-society-outcome-report',scope,worldId:options.worldId,observerAgentIds:observers,
        sources:{agent,work,toolDemand,business,trades,provider,goalClock},labor,physicalSpecialization,roleBindings,
        registeredResponsibility:'Existing evaluation specialization remains registered recipe responsibility; physical-stage receipt HHI is separate.',
        availability:{status:'inconclusive',availableAndWillingPersonMs:null,unemploymentRate:null},
        limitations:['Read-only per-source snapshots; no cross-database atomicity or complete event coverage.',
            'Native work credit is a lower bound. Instant production receipts do not prove duration or waiting.',
            'Social beliefs/commitments and goal source-head status are not simulation-window population truth.',
            'No automatic cooperation/trust/strategy success from a trade or successful skill. No MVS verdict.']};
    return{...definition,digest:digest(definition)};
}
