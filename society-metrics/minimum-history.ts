import type {SocietyMinimumContract} from '../society-minimum/contract.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {NativeFounderBaseline,readNativeFounderDeaths} from './population-outcomes.js';
import type {NativeIntegrationSources,NativeObservation} from './integration-sources.js';
import type {EvaluationScope} from './evaluation.js';
import type {FoodActorContext} from './food-minimum.js';
import {projectNativeNeedsExposure} from './needs-exposure.js';
import {projectHousingMinimum} from './housing-minimum.js';
import type {MortalityActor} from '../population-lifecycle/native-coverage.js';

const time=(at:string)=>Date.parse(at);
/** Required historical observations and replay denominators, never economic success or caller-supplied coverage. */
export function projectNativeMinimumHistory(contract:SocietyMinimumContract,scope:EvaluationScope,baseline:NativeFounderBaseline,bindings:MortalityActor[],sources:NativeIntegrationSources){
    const from=baseline.genesisAppliedAtSimulationTime,to=scope.toSimulationTime,fullScope={...scope,fromSimulationTime:from},
        founders=baseline.founders,ids=founders.map(f=>f.agentId).sort(),worldId=baseline.worldId;
    const original=(a:FoodActorContext)=>!!a.binding&&a.binding.worldId===worldId&&a.binding.clockId===scope.clockId
        &&a.binding.clockProfileDigest===scope.clockProfileDigest&&a.binding.worldProfileDigest===baseline.worldProfile.digest
        &&a.binding.lifecyclePolicyDigest===baseline.lifecyclePolicy.digest&&a.initializedAt===from
        &&a.admission?.kind==='genesis'&&a.admission.evidenceId===baseline.genesisResultId&&a.admission.evidenceDigest===baseline.genesisResultDigest
        &&founders.some(f=>f.agentId===a.binding!.actorId&&f.playerUsername===a.binding!.playerId)
        &&bindings.some(b=>b.actorId===a.binding!.actorId&&b.username===a.binding!.playerId&&b.lifecycleId===a.binding!.lifecycleId);
    const cohort=(rows:FoodActorContext[])=>rows.length===ids.length&&rows.every(original)
        &&digest(rows.map(r=>r.binding!.actorId).sort())===digest(ids);
    const bound=baseline.clockId===scope.clockId&&baseline.clockProfileDigest===scope.clockProfileDigest&&from<=scope.fromSimulationTime
        &&digest([...scope.actorAgentIds].sort())===digest(ids)&&digest(bindings.map(b=>b.actorId).sort())===digest(ids)
        &&contract.dependencies.worlds.some(w=>w.profile.digest===baseline.worldProfile.digest&&w.lifecyclePolicy.digest===baseline.lifecyclePolicy.digest);
    const covers=(intervals:Array<{from:number;to:number}>)=>{
        let end=time(from);for(const i of [...intervals].sort((a,b)=>a.from-b.from||a.to-b.to)){
            if(i.from!==end||i.to<=i.from||i.to>time(to))return false;end=i.to;
        }return end===time(to);
    };
    const exposure=projectNativeNeedsExposure(fullScope,worldId,sources),housing=projectHousingMinimum(fullScope,worldId,sources.housingAccess);
    const physiology=bound&&exposure.policyDigest===contract.dependencies.needs.digest&&exposure.dynamicsDigest===contract.dependencies.dynamics.digest
        &&exposure.actors.length===ids.length&&exposure.actors.every(a=>original(a)&&a.channels.length===2
            &&a.channels.every(c=>c.reason===null&&covers(c.intervals)));
    const housingComplete=bound&&housing.contractDigest===contract.digest&&housing.gaps.length===0&&ids.every(id=>covers(housing.intervals.filter(i=>{
        const actor=i.cohort.find(a=>a.binding.actorId===id);return actor&&original(actor);
    })));
    const foods=sources.foodBoundaries.status==='available'?sources.foodBoundaries.value.boundaries:[],
        tools=sources.toolBoundaries.status==='available'?sources.toolBoundaries.value.boundaries:[],
        houses=sources.housingAccess.status==='available'?sources.housingAccess.value.points:[],
        wealth=sources.wealthBoundaries.status==='available'?sources.wealthBoundaries.value.boundaries:[];
    const times=[...new Set([from,scope.fromSimulationTime,to,...foods.map(b=>b.at),...tools.map(b=>b.at),...houses.map(b=>b.at)])].sort();
    const dense=times.length>=2&&times.length<=1000&&times[0]===from&&times.at(-1)===to
        &&times.every((t,i)=>Number.isSafeInteger(time(t))&&new Date(t).toISOString()===t
            &&(!i||time(t)>time(times[i-1]!)&&time(t)-time(times[i-1]!)<=contract.policy.window.maximumTraceGapSimulationMilliseconds));
    const boundary=(p:{at:string;worldId:string;clockId:string;clockProfileDigest:string;contractDigest:string;cohort:FoodActorContext[]},at:string)=>
        p.at===at&&p.worldId===worldId&&p.clockId===scope.clockId&&p.clockProfileDigest===scope.clockProfileDigest&&p.contractDigest===contract.digest&&cohort(p.cohort);
    const foodByAt=new Map(foods.map(b=>[b.at,b])),toolByAt=new Map(tools.map(b=>[b.at,b])),houseByAt=new Map(houses.map(b=>[b.at,b])),wealthByAt=new Map(wealth.map(b=>[b.at,b]));
    const physical=bound&&dense&&times.every(at=>{
        const f=foodByAt.get(at),t=toolByAt.get(at),h=houseByAt.get(at);
        return f?.source.status==='available'&&t?.source.status==='available'&&h?.source.status==='available'
            &&boundary(f.source.value,at)&&boundary(t.source.value,at)&&boundary(h.source.value,at)
            &&f.source.value.agentSnapshotDigest===t.source.value.sourceDigests[1]
            &&f.source.value.healthSnapshotDigest===t.source.value.sourceDigests[2]
            &&f.source.value.needsSnapshotDigest===t.source.value.sourceDigests[3];
    });
    const custodyBoundaries=physical&&times.every(at=>{const row=wealthByAt.get(at);if(row?.source.status!=='available')return false;
        const w=row.source.value,f=foodByAt.get(at)!;
        return w.simulationTime===at&&w.pendingEffects.length===0&&f.source.status==='available'
            &&digest(w.cohort.map(a=>a.binding).sort((a,b)=>a.actorId.localeCompare(b.actorId)))
                ===digest(f.source.value.cohort.map(a=>a.binding!).sort((a,b)=>a.actorId.localeCompare(b.actorId)));
    });
    const summaries=Object.fromEntries(Object.entries(sources).map(([name,s])=>[name,s.status==='available'?{status:s.status,digest:s.digest}:{status:s.status}]));
    const body={protocol:'native-minimum-history-v1',scope,fullScope,worldId,contractDigest:contract.digest,genesisResultId:baseline.genesisResultId,
        genesisResultDigest:baseline.genesisResultDigest,fromSimulationTime:from,toSimulationTime:to,founderAgentIds:ids,founderDigest:digest(bindings),
        completePhysiologyCoverage:physiology,completeHousingCoverage:housingComplete,completePhysicalBoundaries:physical,
        completeCustodyBoundaries:custodyBoundaries,boundaryTimes:times,sources:summaries,
        populationAtBoundaries:foods.flatMap(b=>b.source.status==='available'?[{at:b.at,terminalAgentIds:b.source.value.terminalAgentIds}]:[]),
        sourceDigest:digest(sources),exposureDigest:exposure.digest,housingDigest:housing.digest,
        gaps:[...(!physiology?['warmup-physiology-denominators-unproven']:[]),...(!housingComplete?['warmup-access-history-unproven']:[]),
            ...(!physical?['complete-native-boundary-inventory-unproven']:[]),...(!custodyBoundaries?['historical-custody-boundaries-unproven']:[])],
        meaning:'Original full-window replay and exact paused frozen observations. Custody also requires complete native flow/integrity histories; numeric minima and global PASS are separate.'};
    return{...body,digest:digest(body)};
}

/** A historical health file cannot omit a death already verified by the current original lifecycle authority. */
export function minimumHistoryDeathsMatch(history:ReturnType<typeof projectNativeMinimumHistory>,deaths:ReturnType<typeof readNativeFounderDeaths>['deaths']){
    const points=new Map(history.populationAtBoundaries.map(p=>[p.at,p.terminalAgentIds]));
    return history.boundaryTimes.every(at=>{const observed=points.get(at);return observed&&digest([...observed].sort())
        ===digest([...new Set(deaths.filter(d=>d.atSimulationTime<=at).map(d=>d.agentId))].sort());});
}

/** Histories remain full; boundary projections use only the requested evaluation, preserving warmup separately. */
export function selectIntegrationBoundaryScope(sources:NativeIntegrationSources,scope:EvaluationScope):NativeIntegrationSources{
    const selected=<T extends {at:string}>(s:NativeObservation<{boundaries:T[]}>)=>{
        if(s.status!=='available')return s;const value={boundaries:s.value.boundaries.filter(b=>b.at>=scope.fromSimulationTime&&b.at<=scope.toSimulationTime)};
        return{status:'available' as const,value,digest:digest(value)};
    };
    const housing=sources.housingAccess;
    const value=housing.status==='available'?{points:housing.value.points.filter(b=>b.at>=scope.fromSimulationTime&&b.at<=scope.toSimulationTime)}:null;
    return{...sources,foodBoundaries:selected(sources.foodBoundaries),toolBoundaries:selected(sources.toolBoundaries),wealthBoundaries:selected(sources.wealthBoundaries),
        housingAccess:value?{status:'available',value,digest:digest(value)}:housing};
}
