import { advanceNeedsFromClock } from '../needs/dynamics.js';
import type { DurableNeedsState } from '../needs/store.js';
import type { NeedsPolicy,NeedsDynamicsPolicy } from '../needs/types.js';
import type { PlayerTimeHistoryEntry,SimulationClockObservation } from '../simulation-clock/types.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import type { MinimumCell } from '../society-minimum/assessment.js';
import type { NativeIntegrationSources } from './integration-sources.js';
import type { EvaluationScope } from './evaluation.js';

const HOUR=3600000n;
const check=(v:unknown)=>{if(!v)throw Error('Needs exposure history does not replay');};
const time=(s:string)=>{const n=Date.parse(s);check(Number.isSafeInteger(n)&&new Date(n).toISOString()===s);return n;};
interface ExposureInterval {from:number;to:number;critical:boolean}
/** Integer-millisecond threshold crossings use the same truncation/remainder semantics as native needs. */
export function criticalOffset(value:number,remainder:number,threshold:number,rate:number,duration:number){
    const critical=value>=threshold;
    if(rate===0||critical&&rate>0||!critical&&rate<0)return{critical,crossing:duration};
    const amount=critical?BigInt(value-threshold+1)*HOUR+BigInt(remainder):BigInt(threshold-value)*HOUR-BigInt(remainder);
    const speed=BigInt(Math.abs(rate)),offset=(amount+speed-1n)/speed;
    return{critical,crossing:Math.max(0,Math.min(duration,Number(offset)))};
}
function replay(history:DurableNeedsState[],modes:PlayerTimeHistoryEntry[],policy:NeedsPolicy,dynamics:NeedsDynamicsPolicy,
    needId:'hunger'|'fatigue',scope:EvaluationScope,applications:NativeIntegrationSources['nutrition']){
    const intervals:ExposureInterval[]=[],first=history[0]!;
    const foodById=new Map(applications.status==='available'?applications.value.applications!.map(a=>[a.actionId,a]):[]);
    const append=(from:number,to:number,critical:boolean)=>{
        from=Math.max(from,time(scope.fromSimulationTime));to=Math.min(to,time(scope.toSimulationTime));if(to<=from)return;
        const last=intervals.at(-1);check(!last||last.to<=from);
        if(last&&last.to===from&&last.critical===critical)last.to=to;else intervals.push({from,to,critical});
    };
    let reason:string|null=null;
    try{
        check(first.revision===1&&!first.terminal&&first.state.characterAgentId===first.binding.actorId&&first.state.clockId===first.binding.clockId);
        check(first.state.values.every(v=>v.value===policy.needs.find(n=>n.needId===v.needId)?.initialValue&&v.remainderNumerator===0));
        const mode=first.playerTimeRevision?modes.find(m=>m.state.revision===first.playerTimeRevision&&m.digest===first.playerTimeDigest):null;
        let modeIndex=mode?modes.indexOf(mode)+1:0;
        check(first.playerTimeRevision===0?first.playerTimeDigest===null:!!mode);
        check(first.presence===(mode?.state.presence??'offline')&&first.rest===(mode?.state.rest??'awake')
            &&first.sleepUntil===(mode?.state.sleepContext?.access.validUntilSimulationTime??null)
            &&(first.sleepRecoveryBasisPoints??10000)===(mode?.state.sleepContext?.fatigueRecoveryMultiplierBasisPoints??10000));
        check(!modes[modeIndex]||time(modes[modeIndex]!.state.updatedAt)>=time(first.state.observedAtSimulationTime));
        if(needId==='hunger')check(applications.status==='available'&&applications.value.pending===0&&applications.value.through
            &&applications.value.through.clockId===scope.clockId&&applications.value.through.profileDigest===scope.clockProfileDigest
            &&time(applications.value.through.simulationTime)>=time(scope.toSimulationTime));
        for(let i=1;i<history.length;i++){
            const previous=history[i-1]!,next=history[i]!;
            if(time(previous.state.observedAtSimulationTime)>=time(scope.toSimulationTime))break;
            check(next.revision===previous.revision+1&&!previous.terminal&&time(next.state.observedAtSimulationTime)>=time(previous.state.observedAtSimulationTime));
            const expected=structuredClone(previous),segments:ExposureInterval[]=[];
            const changedFood=digest(previous.lastFoodReceipt??null)!==digest(next.lastFoodReceipt??null);
            if(changedFood){
                check(next.state.observedAtSimulationTime===previous.state.observedAtSimulationTime);
                if(needId==='hunger'){
                    check(applications.status==='available');
                    const app=foodById.get(next.lastFoodReceipt?.actionId??'');
                    check(app&&app.quantity===1&&app.needsRevision===next.revision&&digest(app.binding)===digest(next.binding)
                        &&app.clock.simulationTime===next.state.observedAtSimulationTime&&digest(app.needsBefore)===digest(previous.state)
                        &&digest(app.needsAfter)===digest(next.state)&&app.sourceId===next.lastFoodReceipt?.sourceId
                        &&app.sourceSequence===next.lastFoodReceipt?.sequence&&app.sourceDigest===next.lastFoodReceipt?.sourceDigest);
                    expected.state=next.state;
                }
                expected.lastFoodReceipt=next.lastFoodReceipt;
            }else{
                const target=time(next.state.observedAtSimulationTime);
                if(next.terminal){check(time(next.terminal.at)===target);expected.terminal=next.terminal;}
                const advance=(to:number)=>{
                    while(time(expected.state.observedAtSimulationTime)<to){
                        const from=time(expected.state.observedAtSimulationTime);
                        let end=Math.min(to,from+366*86400000);
                        if(expected.rest==='sleeping'&&expected.sleepUntil&&time(expected.sleepUntil)>from)end=Math.min(end,time(expected.sleepUntil));
                        const rest=expected.rest==='sleeping'&&expected.sleepUntil&&time(expected.sleepUntil)<=from?'awake':expected.rest;
                        const observation:SimulationClockObservation={clockId:scope.clockId,profileDigest:scope.clockProfileDigest,status:'running',revision:1,
                            engineTick:null,wallTime:new Date(end).toISOString(),simulationTime:new Date(end).toISOString()};
                        const transition=advanceNeedsFromClock(expected.state,observation,expected.presence,rest,policy,dynamics,expected.sleepRecoveryBasisPoints??10000);
                        const value=expected.state.values.find(v=>v.needId===needId)!,definition=policy.needs.find(n=>n.needId===needId)!,
                            rate=transition.deltas.find(d=>d.needId===needId)!.ratePerSimulationHour;
                        const {critical,crossing}=criticalOffset(value.value,value.remainderNumerator,definition.criticalThreshold,rate,end-from);
                        segments.push({from,to:from+crossing,critical},{from:from+crossing,to:end,critical:!critical});expected.state=transition.state;
                    }
                };
                // A later mode write can share this snapshot's timestamp. Its persisted cursor determines ordering.
                while(modes[modeIndex]&&modes[modeIndex]!.state.revision<=next.playerTimeRevision){
                    const entry=modes[modeIndex++]!;
                    check(entry.profileDigest===scope.clockProfileDigest&&entry.state.revision===expected.playerTimeRevision+1
                        &&time(entry.state.updatedAt)>=time(expected.state.observedAtSimulationTime)&&time(entry.state.updatedAt)<=target);
                    advance(time(entry.state.updatedAt));expected.presence=entry.state.presence;expected.rest=entry.state.rest;
                    expected.sleepUntil=entry.state.sleepContext?.access.validUntilSimulationTime??null;
                    expected.sleepRecoveryBasisPoints=entry.state.sleepContext?.fatigueRecoveryMultiplierBasisPoints??10000;
                    expected.playerTimeRevision=entry.state.revision;expected.playerTimeDigest=entry.digest;
                }
                check(!modes[modeIndex]||time(modes[modeIndex]!.state.updatedAt)>=target);
                advance(target);
            }
            expected.revision++;
            const comparable=(s:DurableNeedsState)=>({...s,state:{...s.state,digest:undefined,values:s.state.values.filter(v=>v.needId===needId)}});
            check(digest(comparable(expected))===digest(comparable(next)));
            for(const segment of segments)append(segment.from,segment.to,segment.critical);
        }
    }catch{reason='Missing authority or non-replayable needs/mode/mutation history; unverified time remains unknown.';}
    return{needId,intervals,reason};
}
/** Internal projection of already audited SQLite sources. No uploaded observations or current-state interpolation. */
export function projectNativeNeedsExposure(scope:EvaluationScope,worldId:string,sources:NativeIntegrationSources){
    const needs=sources.needs,modes=sources.modes,clockHead=modes.status==='available'?modes.value.clock.last_simulation_ms:null;
    const body={protocol:'native-needs-exposure-v1',scope,worldId,policyDigest:needs.status==='available'?needs.value.policy.digest:null,
        dynamicsDigest:needs.status==='available'?needs.value.dynamics.digest:null,
        actors:scope.actorAgentIds.map(actorAgentId=>{
            const matches=needs.status==='available'?needs.value.histories.filter(h=>h.binding.actorId===actorAgentId&&h.binding.worldId===worldId
                &&h.binding.clockId===scope.clockId&&h.binding.clockProfileDigest===scope.clockProfileDigest):[];
            const history=matches.length===1?matches[0]:null;
            const mode=modes.status==='available'&&history?modes.value.histories.find(m=>m.playerId===history.binding.playerId)?.history??[]:null;
            const clockCovers=clockHead!==null&&history?.history.every(s=>time(s.state.observedAtSimulationTime)<=clockHead);
            return{actorAgentId,binding:history?.binding??null,admission:history?.history[0]?.admission??null,
                initializedAt:history?.history[0]?.state.observedAtSimulationTime??null,
                channels:history&&mode&&clockCovers&&needs.status==='available'?(['hunger','fatigue'] as const).map(id=>replay(history.history,mode,needs.value.policy,needs.value.dynamics,id,scope,sources.nutrition)):[]};
        }),sourceDigests:[needs,modes,sources.nutrition].flatMap(s=>s.status==='available'?[s.digest]:[]),
        meaning:'Verified integer-millisecond physiology segments only; gaps and unprocessed native meals never become satisfied time.'};
    return{...body,digest:digest(body)};
}
export type NativeNeedsExposure=ReturnType<typeof projectNativeNeedsExposure>;
export function needsExposureCells(contract:SocietyMinimumContract,exposure:NativeNeedsExposure):MinimumCell[]{
    const cells:MinimumCell[]=[],start=time(exposure.scope.fromSimulationTime),window=contract.policy.window.evaluationSimulationMilliseconds,
        bucket=contract.policy.window.bucketSimulationMilliseconds;
    for(const actor of exposure.actors)for(const channel of actor.channels){
        const intervals=channel.intervals,observed=intervals.reduce((n,s)=>n+s.to-s.from,0);
        if(!observed)continue;
        for(let index=0;index<window/bucket;index++){
            const from=start+index*bucket,to=from+bucket;
            const overlap=(s:ExposureInterval)=>Math.max(0,Math.min(to,s.to)-Math.max(from,s.from));
            const satisfied=intervals.filter(s=>!s.critical).reduce((n,s)=>n+overlap(s),0),critical=intervals.filter(s=>s.critical).reduce((n,s)=>n+overlap(s),0);
            if(satisfied+critical)cells.push({requirementId:`${channel.needId}-satisfied-time`,subject:{actorAgentId:actor.actorAgentId,bucket:index},opportunity:'positive',
                lower:{numerator:String(satisfied*10000),denominator:String(bucket)},upper:{numerator:String((bucket-critical)*10000),denominator:String(bucket)},evidenceDigests:[exposure.digest]});
        }
        const longest=intervals.filter(s=>s.critical).reduce((n,s)=>Math.max(n,s.to-s.from),0);
        cells.push({requirementId:`${channel.needId}-continuous-critical-time`,subject:{actorAgentId:actor.actorAgentId},opportunity:'positive',
            lower:{numerator:String(longest),denominator:'1'},upper:{numerator:String(observed===window?longest:window),denominator:'1'},evidenceDigests:[exposure.digest]});
    }
    return cells;
}
