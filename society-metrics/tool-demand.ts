import type { Database } from 'bun:sqlite';
import { NativeMiningDemandStore,type NativeMiningDemandObservation } from '../item-lifecycle/native-mining-demand.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import type { EvaluationScope } from './evaluation.js';
import { outcomeCheck,outcomeTime,type OutcomeActor } from './outcome-work.js';
import { NativeMiningIntentStore } from '../item-lifecycle/native-mining-intent.js';
import { readNativeMiningIntentIntervals } from './tool-demand-intervals.js';
import type { SocietyMinimumPolicy } from '../society-minimum/policy.js';

/** Native request observations, deliberately separate from an unproved continuous-demand denominator. */
export function readNativeToolDemandObservations(db:Database,scope:EvaluationScope,worldId:string,actors:OutcomeActor[],policy?:SocietyMinimumPolicy){
    const from=outcomeTime(scope.fromSimulationTime),to=outcomeTime(scope.toSimulationTime);
    outcomeCheck(to>from&&new Set(actors.map(a=>a.agentId)).size===actors.length&&actors.length===scope.actorAgentIds.length
        &&actors.every(a=>scope.actorAgentIds.includes(a.agentId)),'Invalid native tool demand scope/actors');
    const present=NativeMiningDemandStore.present(db),source=present?NativeMiningDemandStore.read(db):null;
    const selected=new Map(actors.map(a=>[a.agentId,a])),previous=new Map<string,{at:number;tick:number;revision:number}>();
    const included=(source?.entries??[]).filter(entry=>{
        const {owner,clock}=entry.observation,actor=selected.get(owner.actorId);
        if(!actor)return false;
        outcomeCheck(owner.worldId===worldId&&owner.clockId===scope.clockId&&owner.clockProfileDigest===scope.clockProfileDigest
            &&owner.username===actor.username&&owner.lifecycleId===actor.lifecycleId,'Native tool demand world/clock/lifecycle differs');
        const at=outcomeTime(clock.simulationTime),last=previous.get(owner.actorId),tick=clock.engineTick;
        outcomeCheck(tick!==null&&(!last||(at>=last.at&&tick>=last.tick&&clock.revision>=last.revision)),'Native tool demand clock regressed');
        previous.set(owner.actorId,{at,tick,revision:clock.revision});return at>from&&at<=to;
    });
    const observed=actors.map(actor=>{
        const rows=included.filter(e=>e.observation.owner.actorId===actor.agentId);
        const requests=(predicate:(value:NativeMiningDemandObservation)=>boolean)=>
            new Set(rows.filter(e=>predicate(e.observation)).map(e=>e.observation.requestId)).size;
        return{agentId:actor.agentId,attemptedRequests:requests(()=>true),admittedRequests:requests(o=>o.phase==='admitted'),
            committedRequests:requests(o=>o.phase==='committed'),blockedRequests:requests(o=>o.phase==='blocked'),
            unusableToolRequests:requests(o=>o.reason==='unusable-tool'),unavailablePositionRequests:requests(o=>o.reason==='unavailable-position'),
            invalidEvidenceRequests:requests(o=>o.reason==='invalid-evidence'),
            evidence:rows.map(e=>({sequence:e.sequence,digest:e.digest,requestId:e.observation.requestId,phase:e.observation.phase,
                reason:e.observation.reason,simulationTime:e.observation.clock.simulationTime,itemInstanceId:e.observation.item?.itemInstanceId??null}))};
    });
    const standingRequests=NativeMiningIntentStore.present(db)&&policy?readNativeMiningIntentIntervals(db,scope,worldId,actors,policy):null;
    const body={protocol:'native-tool-demand-observations-v1',scope,worldId,cycleId:'bronze-pickaxe-mining',standingRequests,
        coverage:present?'attempt-observations-only':'source-absent',sourceHead:source?.head??null,actors:observed,
        unusableDemandSimulationMilliseconds:null,minimumVerdict:standingRequests?.verdict==='fail'?'fail':'inconclusive',
        gaps:['Native script admission/rejection/output observations do not attest persistent requested-use intervals or all actor demand.',
            'Missing identity/unbound legacy requests, cancellation, downtime and pre-instrumentation history have no completeness watermark.',
            'Idle/offline time and the gap between rejected clicks must not be counted as requested unusable-tool time.']};
    return{...body,digest:nativeToolDigest(body)};
}
