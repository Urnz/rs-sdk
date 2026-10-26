import type { Database } from 'bun:sqlite';
import { NativeMiningRequestStore } from '../item-lifecycle/native-mining-requests.js';
import type { NativeMiningCoverageStore } from '../item-lifecycle/native-mining-coverage.js';
import { miningRosterDigest } from '../item-lifecycle/native-mining-coverage.js';
import type { NativeMiningIntentEntry } from '../item-lifecycle/native-mining-intent.js';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import type { EvaluationScope } from './evaluation.js';
import { outcomeCheck as check,outcomeTime as time } from './outcome-work.js';

/** Producer admission precedes transport. Native watermarks bracket executor lifetime without interpolating wall→simulation time. */
export function readMiningExecutorCoverage(db:Database,scope:EvaluationScope,coverage:ReturnType<NativeMiningCoverageStore['read']>,intents:NativeMiningIntentEntry[],nativeComplete:boolean){
    const s=coverage.selection,gaps:string[]=[];
    if(!s.executorSelectionDigest||!NativeMiningRequestStore.present(db))return{status:'unselected',completeDemandCoverage:false,positiveOpportunity:false,
        longestOutstandingUpperSimulationMs:null,requests:[],gaps:['Prospective executor source is not selected.']};
    const source=new NativeMiningRequestStore(db).read(),selected=source.selection;
    check(hash(selected)===s.executorSelectionDigest&&selected.worldId===s.worldId&&selected.clockId===s.clockId&&selected.clockProfileDigest===s.clockProfileDigest
        &&selected.fromSimulationTime===s.fromSimulationTime&&selected.toSimulationTime===s.toSimulationTime&&miningRosterDigest(selected.actors)===miningRosterDigest(s.actors),'Executor request selection differs from native observer');
    const prefixes=new Map([[0,null] as [number,string|null],...source.entries.map(e=>[e.sequence,e.digest] as [number,string|null])]);
    const opening=s.openingHeads.executor;check(opening&&prefixes.has(opening.sequence)&&prefixes.get(opening.sequence)===opening.digest,'Executor opening prefix differs');
    if(opening.sequence!==0)gaps.push('Executor producer was not empty at observer selection.');
    let lastHead=opening.sequence;
    for(const entry of coverage.entries){const h=entry.event.heads.executor;
        check(h&&prefixes.has(h.sequence)&&prefixes.get(h.sequence)===h.digest&&h.sequence>=lastHead,'Executor watermark prefix regressed or differs');lastHead=h.sequence;}
    const samples=coverage.entries.flatMap(e=>e.event.kind==='sample'?[e.event]:[]),first=samples[0],last=samples.at(-1),from=time(scope.fromSimulationTime),to=time(scope.toSimulationTime);
    if(samples.some(s=>s.executorSourceAvailable!==true))gaps.push('Executor producer descriptor/source is unavailable.');
    const openings=source.entries.filter(e=>e.record.phase==='requested'),closed=new Map(source.entries.filter(e=>e.record.phase==='closed').map(e=>[e.record.demandId,e])),
        byId=new Map(openings.map(e=>[e.record.demandId,e])),nativeIds=new Set(intents.map(e=>e.record.intent.demandId));
    const firstIndex=(predicate:(sample:typeof samples[number])=>boolean)=>{let left=0,right=samples.length;
        while(left<right){const middle=(left+right)>>>1;if(predicate(samples[middle]!))right=middle;else left=middle+1;}return left;};
    for(const e of intents){const r=e.record;if(!s.actors.some(a=>a.actorId===r.intent.owner.actorId))continue;
        const producer=byId.get(r.intent.demandId)?.record,a=producer?.admission;
        check(producer&&a&&miningRosterDigest([producer.owner])===miningRosterDigest([r.intent.owner])&&hash({args:a.args,context:a.context})===r.intent.contextDigest
            &&r.intent.outputItemId===(a.args.item==='copper ore'?436:438)&&r.intent.expiresAtWallTime===a.expiresAtWallTime
            &&r.intent.maximumWallMilliseconds<=a.args.timeoutMs&&r.intent.nativeDispatchRequired===true,'Native intent has no exact executor request');
    }
    const requests=openings.flatMap(e=>{
        const r=e.record,a=r.admission,admitted=time(a.admittedAt),index=firstIndex(sample=>sample.heads.executor!.sequence>=e.sequence),seen=samples[index],close=closed.get(r.demandId),
            ended=close?samples[firstIndex(sample=>sample.heads.executor!.sequence>=close.sequence)]:null;
        if(!first||!last){gaps.push('Executor request has no native observation window.');return[];}
        if(!seen){if(admitted<=time(last.clock.wallTime))gaps.push('Executor request is missing from the native tail watermark.');return[];}
        if(admitted>time(seen.clock.wallTime)){gaps.push('Executor admission clock is ahead of its native watermark.');return[];}
        const precedingHead=samples[index-1],precedingWall=samples[firstIndex(sample=>time(sample.clock.wallTime)>=admitted)-1];
        const lowerStart=Math.max(from,Math.min(precedingHead?time(precedingHead.clock.simulationTime):from,precedingWall?time(precedingWall.clock.simulationTime):from)),
            upperEnd=Math.min(to,ended?time(ended.clock.simulationTime):to),upper=Math.max(0,upperEnd-lowerStart);
        if(upper<=0)return[];
        return[{demandId:r.demandId,actorAgentId:r.owner.actorId,phase:close?'closed':'requested',nativeIntentObserved:nativeIds.has(r.demandId),
            outstandingUpperSimulationMs:upper,fromSimulationTime:new Date(lowerStart).toISOString(),toSimulationTime:new Date(upperEnd).toISOString()}];
    });
    const complete=nativeComplete&&gaps.length===0;
    // Overlapping/adjacent requests by the same actor cannot reset a possible continuous wait.
    let longest=0;for(const actor of s.actors){let end=-Infinity,length=0;
        for(const r of requests.filter(r=>r.actorAgentId===actor.actorId).sort((a,b)=>time(a.fromSimulationTime)-time(b.fromSimulationTime))){
            const a=time(r.fromSimulationTime),b=time(r.toSimulationTime);length=a<=end?length+Math.max(0,b-end):b-a;end=Math.max(end,b);longest=Math.max(longest,length);
        }
    }
    return{status:complete?'covered':'gaps',selectionDigest:hash(selected),sourceHead:source.head,completeDemandCoverage:complete,positiveOpportunity:requests.length>0,
        longestOutstandingUpperSimulationMs:complete&&requests.length?longest:null,requests,gaps,
        meaning:'Every selected producer request is counted, including failures before native admission. Whole outstanding lifetime is a conservative unusable-time upper bound; no zero-opportunity PASS or availability inference.'};
}
