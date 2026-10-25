import type { Database } from 'bun:sqlite';
import { NativeMiningIntentStore,type NativeMiningIntentRecord } from '../item-lifecycle/native-mining-intent.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';
import { societyMinimumRequirements,type SocietyMinimumPolicy } from '../society-minimum/policy.js';
import type { EvaluationScope } from './evaluation.js';
import { outcomeCheck as check,outcomeTime as time,type OutcomeActor } from './outcome-work.js';

/** Lower bound on the longest outstanding unusable request; never sums different actors or requests. */
export function readNativeMiningIntentIntervals(db:Database,scope:EvaluationScope,worldId:string,actors:OutcomeActor[],policy:SocietyMinimumPolicy){
    const requirement=societyMinimumRequirements(policy).find(r=>r.requirementId==='tool-unusable-demand-time')!;
    const from=time(scope.fromSimulationTime),to=time(scope.toSimulationTime),source=NativeMiningIntentStore.read(db);
    check(to>from&&actors.length===scope.actorAgentIds.length&&new Set(actors.map(a=>a.agentId)).size===actors.length
        &&actors.every(a=>scope.actorAgentIds.includes(a.agentId)),'Invalid native mining intent export scope');
    const cohort=new Map(actors.map(a=>[a.agentId,a])),requests=new Map<string,Array<{sequence:number;record:NativeMiningIntentRecord;digest:string}>>();
    for(const entry of source.entries){const {owner}=entry.record.intent,actor=cohort.get(owner.actorId);if(!actor)continue;
        check(owner.worldId===worldId&&owner.clockId===scope.clockId&&owner.clockProfileDigest===scope.clockProfileDigest
            &&owner.username===actor.username&&owner.lifecycleId===actor.lifecycleId,'Native mining intent world/clock/lifecycle differs');
        const r=entry.record;
        if(r.phase==='fulfilled'){
            const event=db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_tool_event WHERE event_id=?').get(r.completionEventId!);
            const proof=event?JSON.parse(event.payload):null;
            check(event&&nativeToolDigest(proof)===event.digest&&proof.kind==='mined'&&nativeToolDigest(proof.source.owner)===nativeToolDigest(owner)
                &&proof.source.outputItemId===r.intent.outputItemId&&proof.source.outputQuantity===1
                &&nativeToolDigest(proof.source.clock)===nativeToolDigest(r.sample.clock)&&proof.before.itemInstanceId===r.sample.itemInstanceId
                &&proof.before.revision===r.sample.itemRevision,'Native mining intent completion lacks its native output');
        }
        const values=requests.get(r.intent.demandId)??[];values.push(entry);requests.set(r.intent.demandId,values);
    }
    const rows=[...requests.values()].flatMap(events=>{
        const opening=events[0]!,closing=events.at(-1)!;
        if(time(opening.record.sample.clock.simulationTime)>=to||time(closing.record.sample.clock.simulationTime)<=from&&closing.record.phase!=='pending')return[];
        let longest=0,current=0;const intervals:Array<{from:string;to:string;milliseconds:number;status:string;fromSequence:number;toSequence:number|null}>=[];
        for(let index=1;index<events.length;index++){
            const a=events[index-1]!,b=events[index]!,left=a.record.sample,right=b.record.sample;
            const start=Math.max(from,time(left.clock.simulationTime)),end=Math.min(to,time(right.clock.simulationTime));if(end<=start)continue;
            const elapsed=time(right.clock.simulationTime)-time(left.clock.simulationTime),wall=time(right.clock.wallTime)-time(left.clock.wallTime);
            const confirmed=left.sessionId===right.sessionId&&right.clock.engineTick===left.clock.engineTick!+1&&wall>=0&&wall<=5000
                &&time(right.clock.wallTime)<time(b.record.intent.expiresAtWallTime)
                &&elapsed<=policy.window.maximumTraceGapSimulationMilliseconds&&left.availability==='unusable'&&right.availability==='unusable'
                &&left.itemInstanceId===right.itemInstanceId&&left.itemRevision===right.itemRevision;
            current=confirmed?current+end-start:0;longest=Math.max(longest,current);
            intervals.push({from:new Date(start).toISOString(),to:new Date(end).toISOString(),milliseconds:end-start,
                status:confirmed?'confirmed-unusable':'other-or-unobserved',fromSequence:a.sequence,toSequence:b.sequence});
        }
        const tail=Math.max(from,time(closing.record.sample.clock.simulationTime));
        if(closing.record.phase==='pending'&&tail<to)intervals.push({from:new Date(tail).toISOString(),to:scope.toSimulationTime,
            milliseconds:to-tail,status:'unobserved-open-tail',fromSequence:closing.sequence,toSequence:null});
        return[{demandId:opening.record.intent.demandId,actorAgentId:opening.record.intent.owner.actorId,phaseAtSourceHead:closing.record.phase,
            longestConfirmedUnusableSimulationMs:longest,openingSequence:opening.sequence,closingSequence:closing.sequence,
            completionEventId:closing.record.completionEventId,intervals}];
    });
    const maximum=rows.length?Math.max(...rows.map(r=>r.longestConfirmedUnusableSimulationMs)):null;
    const body={protocol:'native-mining-intent-intervals-v1',scope,worldId,cycleId:'bronze-pickaxe-mining',sourceHead:source.head,
        policyDigest:policy.digest,requirement,maximumObserverWallGapMs:5000,requests:rows,longestConfirmedUnusableSimulationMs:maximum,
        verdict:maximum!==null&&maximum>requirement.threshold?'fail':'inconclusive',completeDemandCoverage:false,
        limitation:'Explicit standing requests only. Gaps, restarts, offline, changed tool state and uninstrumented admissions cannot establish a zero or PASS.'};
    return{...body,digest:nativeToolDigest(body)};
}
