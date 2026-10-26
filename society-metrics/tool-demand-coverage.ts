import type { Database } from 'bun:sqlite';
import { NativeMiningCoverageStore,miningRosterDigest,type MiningSourceHead,type NativeMiningCoverageSample } from '../item-lifecycle/native-mining-coverage.js';
import { NativeMiningDemandStore } from '../item-lifecycle/native-mining-demand.js';
import { NativeMiningIntentStore,type NativeMiningIntentRecord } from '../item-lifecycle/native-mining-intent.js';
import { nativeToolDigest as digest } from '../item-lifecycle/native-tool.js';
import type { EvaluationScope } from './evaluation.js';
import { outcomeCheck as check,outcomeTime as time,type OutcomeActor } from './outcome-work.js';
import { NativeMiningDispatchStore } from '../item-lifecycle/native-mining-dispatch.js';
import { miningRequestDigest } from '../agent-skills/mining-demand-source.js';
import { readMiningExecutorCoverage } from './tool-demand-executor.js';
import { readHousingSleep,type SleepWitness } from '../housing/native-sleep.js';
import { readRentJournal,type NativeRentReceipt } from '../housing/native-rent.js';
import { readNativeRentReceipt } from '../housing/native-rent-source.js';
import { outcomeRows } from './outcome-work.js';

/** Cohort/window/prefix watermark. Observer completeness is distinct from all high-level demand. */
export function readNativeMiningCohortCoverage(db:Database,scope:EvaluationScope,worldId:string,actors:OutcomeActor[]){
    if(!NativeMiningCoverageStore.present(db))return{protocol:'native-mining-cohort-coverage-v1',status:'source-absent',
        observerCoverageComplete:false,completeDemandCoverage:false,selectionDigest:null,sourceHead:null,gaps:[{kind:'observer',reason:'coverage-source-absent'}]};
    const source=new NativeMiningCoverageStore(db).read(),s=source.selection,from=time(scope.fromSimulationTime),to=time(scope.toSimulationTime);
    check(s.worldId===worldId&&s.clockId===scope.clockId&&s.clockProfileDigest===scope.clockProfileDigest
        &&time(s.fromSimulationTime)===from&&time(s.toSimulationTime)===to&&actors.length===s.actors.length
        &&actors.length===scope.actorAgentIds.length&&new Set(scope.actorAgentIds).size===actors.length
        &&new Set(actors.map(a=>a.agentId)).size===actors.length&&actors.every(a=>scope.actorAgentIds.includes(a.agentId)
            &&s.actors.some(o=>o.actorId===a.agentId&&o.username===a.username&&o.lifecycleId===a.lifecycleId)),'Mining cohort coverage selection differs from export');
    const attempts=NativeMiningDemandStore.read(db),intents=NativeMiningIntentStore.read(db);
    const dispatches=NativeMiningDispatchStore.present(db)?new NativeMiningDispatchStore(db).read():[],byDispatchId=new Map(dispatches.map(r=>[r.dispatchId,r]));
    const prefixes={attempt:new Map([[0,null] as [number,string|null],...attempts.entries.map(e=>[e.sequence,e.digest] as [number,string|null])]),
        intent:new Map([[0,null] as [number,string|null],...intents.entries.map(e=>[e.sequence,e.digest] as [number,string|null])])};
    const prefix=(kind:'attempt'|'intent',h:MiningSourceHead)=>check(prefixes[kind].has(h.sequence)&&prefixes[kind].get(h.sequence)===h.digest,
        'Mining coverage pinned source prefix differs');
    prefix('attempt',s.openingHeads.attempt);prefix('intent',s.openingHeads.intent);
    const gaps:Array<{kind:'observer'|'ingress';reason:string;actorId?:string;sequence?:number;from?:string;to?:string}>=[];
    const add=(kind:'observer'|'ingress',reason:string,sequence?:number,actorId?:string)=>gaps.push({kind,reason,sequence,actorId});
    let previousHeads=s.openingHeads,lastEvent:typeof source.entries[number]['event']|undefined,previousSample:NativeMiningCoverageSample|undefined,previousSampleSequence:number|undefined;
    const rosterDigest=miningRosterDigest(s.actors),latestIntents=new Map<string,NativeMiningIntentRecord>(),pendingByUsername=new Map<string,NativeMiningIntentRecord>();let intentIndex=0;
    const selected=new Map(s.actors.map(a=>[a.username,a])),ingresses=new Set<string>(),firstAttempts=new Map<string,number>();
    for(const a of attempts.entries)if(!firstAttempts.has(a.observation.requestId))firstAttempts.set(a.observation.requestId,a.sequence);
    let selectedIngresses=0,compatibleIntentIngresses=0,sourceBoundIngresses=0;
    let sleepWitnesses:Map<string,SleepWitness>|undefined;const paid=new Map<string,NativeRentReceipt>(),sleepingSamples=new Set<string>();
    const sleepProof=(e:NativeMiningCoverageSample,actor:NativeMiningCoverageSample['actors'][number])=>{
        const p=actor.sleep!,owner=s.actors.find(o=>o.actorId===actor.actorId)!;
        if(!sleepWitnesses){outcomeRows(db,'native_housing_sleep');sleepWitnesses=new Map(readHousingSleep(db).map(w=>[w.id,w]));}
        const w=sleepWitnesses.get(p.witnessId);check(w&&digest(w)===p.witnessDigest&&w.bindingDigest===p.bindingDigest&&w.username===owner.username
            &&w.lifecycleId===owner.lifecycleId&&w.clock.clockId===s.clockId&&w.clock.profileDigest===s.clockProfileDigest
            &&time(w.clock.simulationTime)<=time(e.clock.simulationTime),'Sleep coverage witness differs');
        if(!paid.has(w.operationId)){outcomeRows(db,'native_rent_audit');outcomeRows(db,'native_rent_operation');
            const receipt=readRentJournal<NativeRentReceipt>(db,'native_rent').find(r=>r.binding.intent.operationId===w.operationId);
            check(receipt,'Sleep coverage native payment absent');const verified=readNativeRentReceipt(db,receipt.binding);check(verified?.phase==='paid','Sleep coverage payment differs');paid.set(w.operationId,verified);}
        const receipt=paid.get(w.operationId)!,i=receipt.binding.intent,bed=i.catalogs.native.beds.find(b=>b.bedSlotId===i.bedSlotId);
        check(receipt.binding.digest===w.bindingDigest&&i.worldId===worldId&&i.clockId===s.clockId&&i.clockProfileDigest===s.clockProfileDigest
            &&i.tenant.agentId===owner.actorId&&i.tenant.username===owner.username&&i.tenant.lifecycleId===owner.lifecycleId
            &&p.validUntilSimulationTime===i.endsAt&&time(i.startsAt)<=time(w.clock.simulationTime)&&time(receipt.clock.simulationTime)<=time(w.clock.simulationTime)
            &&time(e.clock.simulationTime)<time(i.endsAt)&&bed&&bed.level===w.level&&Math.max(Math.abs(w.x-bed.x),Math.abs(w.z-bed.z))<=1,'Sleep coverage lease/identity differs');
    };
    const sampleGaps=(e:NativeMiningCoverageSample,sequence:number|undefined)=>{
        if(e.rosterDigest!==rosterDigest)add('observer','roster-source-differs-or-unavailable',sequence);
        if(e.ingressWriteFailed)add('observer','ingress-write-failed',sequence);
        for(const actor of e.actors)if(actor.status==='observed-sleeping'){sleepProof(e,actor);sleepingSamples.add(`${sequence}:${actor.actorId}`);}
            else if(actor.status!=='observed')add('observer',actor.status,sequence,actor.actorId);
    };
    for(const entry of source.entries){
        const e=entry.event,c=e.clock,at=time(c.simulationTime);
        for(const kind of ['attempt','intent'] as const){prefix(kind,e.heads[kind]);
            check(e.heads[kind].sequence>=previousHeads[kind].sequence,'Mining coverage source head regressed');}
        previousHeads=e.heads;
        if(lastEvent){check(at>=time(lastEvent.clock.simulationTime)&&time(c.wallTime)>=time(lastEvent.clock.wallTime)
            &&c.revision>=lastEvent.clock.revision,'Mining coverage clock regressed');
            if(e.sessionId===lastEvent.sessionId)check(c.engineTick!>=lastEvent.clock.engineTick!,'Mining coverage tick regressed');}
        lastEvent=e;
        while(intentIndex<intents.entries.length&&intents.entries[intentIndex]!.sequence<=e.heads.intent.sequence){
            const r=intents.entries[intentIndex++]!.record;latestIntents.set(r.intent.demandId,r);
            if(r.phase==='pending'){
                const prior=pendingByUsername.get(r.intent.owner.username);
                check(!prior||prior.intent.demandId===r.intent.demandId,'Overlapping standing Mining source requests');
                pendingByUsername.set(r.intent.owner.username,r);
            }else if(pendingByUsername.get(r.intent.owner.username)?.intent.demandId===r.intent.demandId)pendingByUsername.delete(r.intent.owner.username);
        }
        if(e.kind==='ingress'){
            ingresses.add(e.nativeActionId);
            if(e.reason==='compatible-request'||e.reason==='source-bound-request'){
                const r=latestIntents.get(e.demandId!);
                check(r?.phase==='pending'&&miningRosterDigest([r.intent.owner])===miningRosterDigest([selected.get(e.username)!])
                    &&r.intent.attemptSequenceAtAdmission!==undefined&&r.intent.attemptSequenceAtAdmission<=e.heads.attempt.sequence,
                    'Mining coverage ingress lacks its pinned standing admission');
                const old=firstAttempts.get(e.nativeActionId);
                check(old===undefined||old>r.intent.attemptSequenceAtAdmission,'Mining coverage borrowed pre-admission action');
                if(e.reason==='source-bound-request'){
                    const dispatch=byDispatchId.get(e.dispatchId!);
                    check(dispatch&&dispatch.dispatchId===e.nativeActionId&&dispatch.demandId===r.intent.demandId
                        &&miningRosterDigest([dispatch.owner])===miningRosterDigest([r.intent.owner])
                        &&miningRequestDigest(dispatch.request.demand)===r.intent.contextDigest,'Mining coverage dispatch source differs');
                }
            }
            if(at>=from&&at<=to){selectedIngresses++;if(e.reason==='source-bound-request')sourceBoundIngresses++;
                else if(e.reason==='compatible-request'){compatibleIntentIngresses++;add('ingress','compatible-request-without-executor-provenance',entry.sequence,selected.get(e.username)!.actorId);}
                else add('ingress',e.reason,entry.sequence,selected.get(e.username)!.actorId);}
            continue;
        }
        const touches=at>=from&&at<=to||previousSample&&time(previousSample.clock.simulationTime)<to&&at>from;
        if(touches){
            sampleGaps(e,entry.sequence);
            if(previousSample&&time(previousSample.clock.simulationTime)<from)sampleGaps(previousSample,previousSampleSequence);
            for(const actor of e.actors){
                const owner=s.actors.find(o=>o.actorId===actor.actorId)!;
                const pending=pendingByUsername.get(owner.username);
                check((pending?.intent.demandId??null)===actor.demandId,'Mining coverage sample omitted or changed a standing request');
                if(pending)check(miningRosterDigest([pending.intent.owner])===miningRosterDigest([owner]),'Mining coverage sample request owner differs');
            }
        }
        if(!previousSample){if(at>from)gaps.push({kind:'observer',reason:'unobserved-window-start',from:scope.fromSimulationTime,to:new Date(Math.min(to,at)).toISOString()});}
        else{
            const a=previousSample,elapsed=at-time(a.clock.simulationTime),wall=time(c.wallTime)-time(a.clock.wallTime);
            if(at>from&&time(a.clock.simulationTime)<to&&(e.sessionId!==a.sessionId||c.engineTick!==a.clock.engineTick!+1
                ||elapsed>s.maximumSimulationGapMs||wall>s.maximumWallGapMs))gaps.push({kind:'observer',reason:e.sessionId!==a.sessionId?'observer-session-gap':'observer-tick-or-clock-gap',
                    from:new Date(Math.max(from,time(a.clock.simulationTime))).toISOString(),to:new Date(Math.min(to,at)).toISOString()});
        }
        previousSample=e;previousSampleSequence=entry.sequence;
    }
    if(!previousSample||time(previousSample.clock.simulationTime)<to)gaps.push({kind:'observer',reason:'unobserved-window-tail',
        from:previousSample?previousSample.clock.simulationTime:scope.fromSimulationTime,to:scope.toSimulationTime});
    for(const a of attempts.entries){const o=a.observation,owner=s.actors.find(actor=>actor.actorId===o.owner.actorId);if(!owner)continue;
        check(miningRosterDigest([o.owner])===miningRosterDigest([owner]),'Mining coverage attempt owner differs');
        if(time(o.clock.simulationTime)>=from&&time(o.clock.simulationTime)<=to&&!ingresses.has(o.requestId))add('ingress','native-attempt-without-ingress',a.sequence,o.owner.actorId);
    }
    for(const d of dispatches){const owner=s.actors.find(a=>a.actorId===d.owner.actorId);if(!owner)continue;
        check(miningRosterDigest([d.owner])===miningRosterDigest([owner]),'Mining dispatch belongs to another cohort lifecycle/world/clock');
        if(time(d.clock.simulationTime)>=from&&time(d.clock.simulationTime)<=to&&!ingresses.has(d.dispatchId))add('ingress','native-dispatch-without-ingress',undefined,d.owner.actorId);
    }
    const executorCoverage=readMiningExecutorCoverage(db,scope,source,intents.entries,gaps.length===0);
    const body={protocol:'native-mining-cohort-coverage-v1',status:gaps.length?'gaps':'observed-window',scope,worldId,
        selectionDigest:digest(s),rosterDigest,sourceHead:source.head,sourceHeads:{attempt:attempts.head,intent:intents.head},
        maximumSimulationGapMs:s.maximumSimulationGapMs,maximumWallGapMs:s.maximumWallGapMs,
        observerCoverageComplete:!gaps.some(g=>g.kind==='observer'),completeDemandCoverage:executorCoverage.completeDemandCoverage,executorCoverage,selectedIngresses,compatibleIntentIngresses,sourceBoundIngresses,
        observedSleepingSamples:sleepingSamples.size,
        dispatchSourceDigest:digest(dispatches),gaps,
        limitation:'Prospective executor selection and native prefix watermarks are required for requested-use coverage. Legacy, offline/observer gaps and an empty queue cannot establish zero demand or a minimum PASS. Broader planner/queue waiting and run-wide integrity remain separate.'};
    return{...body,digest:digest(body)};
}
