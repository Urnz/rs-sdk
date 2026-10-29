import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {NativeLifecycleWatermarkStore} from '../population-lifecycle/native-watermarks.js';
import {loadSocietyMinimumContract} from '../society-minimum/contract.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {NativeFounderBaseline,readNativeFounderDeaths} from './population-outcomes.js';
import type {readNativeLifecycleEnforcement} from './lifecycle-enforcement.js';

type Enforcement=ReturnType<typeof readNativeLifecycleEnforcement>&{sourceSnapshotDigest:string};
/** Closing original survivors also bound earlier living counts from below, because the verified finite cohort cannot respawn. */
export function readNativePopulationBounds(db:Database,scope:EvaluationScope,worldId:string,configDirectory:string,baseline:NativeFounderBaseline,
    deaths:ReturnType<typeof readNativeFounderDeaths>,enforcement:Enforcement){
    const gaps=new Set<string>(),contract=loadSocietyMinimumContract(configDirectory),from=baseline.genesisAppliedAtSimulationTime,
        roster=deaths.founderBindings,count=baseline.founders.length,checkpointSnapshotDigest=createHash('sha256').update(db.serialize()).digest('hex');
    if(enforcement.sourceSnapshotDigest!==checkpointSnapshotDigest)gaps.add('enforcement-checkpoint-changed');
    if(enforcement.worldId!==worldId||baseline.worldId!==worldId||baseline.clockId!==scope.clockId||baseline.clockProfileDigest!==scope.clockProfileDigest
        ||scope.fromSimulationTime<from||scope.toSimulationTime<=scope.fromSimulationTime
        ||digest([...scope.actorAgentIds].sort())!==digest(baseline.founders.map(f=>f.agentId).sort())
        ||digest(enforcement.scope)!==digest(scope)||enforcement.fromSimulationTime!==from||enforcement.toSimulationTime!==scope.toSimulationTime
        ||enforcement.founderDigest!==digest(roster)||enforcement.healthSnapshotDigest!==deaths.healthSnapshotDigest)gaps.add('population-proof-binding');
    if(!count||roster.length!==count||new Set(roster.map(a=>a.actorId)).size!==count||new Set(roster.map(a=>a.username)).size!==count
        ||!baseline.founders.every(f=>roster.some(a=>a.actorId===f.agentId&&a.username===f.playerUsername)))gaps.add('original-population-denominator');
    if(!enforcement.completeNativeHealthCoverage||!enforcement.completeLifecycleEnforcement||enforcement.verdict!=='pass')gaps.add('incomplete-finite-health-window');
    let census:ReturnType<NativeLifecycleWatermarkStore['read']>|null=null;
    if(!gaps.size)try{const n=(db.query('SELECT COUNT(*) n FROM native_lifecycle_watermark_event').get() as {n:number}).n;
        if(n>100000)throw Error('Row budget');census=new NativeLifecycleWatermarkStore(db).read();
    }catch{gaps.add('population-census-unavailable');}
    const ends=census?.entries.filter(e=>e.sample.stage==='end-of-tick'&&e.sample.clock.simulationTime>=from&&e.sample.clock.simulationTime<=scope.toSimulationTime)??[],
        closing=ends.at(-1)?.sample;
    if(!census||digest(census.head)!==digest(enforcement.censusHead)||!closing||closing.clock.simulationTime!==scope.toSimulationTime)gaps.add('closing-population-seal');
    const knownDead=new Set(deaths.deaths.filter(d=>d.atSimulationTime<=scope.toSimulationTime).map(d=>d.agentId)),survivors=roster.filter(a=>!knownDead.has(a.actorId)).map(a=>a.actorId).sort();
    if(closing){const authorities=closing.actors.map(a=>a.authority);
        if(authorities.length!==count||authorities.some(a=>!a)||digest(authorities.map(a=>a!.actor).sort((a,b)=>a.actorId.localeCompare(b.actorId)))
            !==digest([...roster].sort((a,b)=>a.actorId.localeCompare(b.actorId))))gaps.add('closing-original-roster');
        for(const a of authorities){if(!a)continue;const death=deaths.deaths.find(d=>d.agentId===a.actor.actorId&&d.atSimulationTime<=scope.toSimulationTime);
            if(a.restricted!==!!death||a.deathEventId!==(death?.eventId??null))gaps.add('closing-terminal-state');}
    }
    const times=[...new Set([scope.fromSimulationTime,...ends.map(e=>e.sample.clock.simulationTime).filter(t=>t>=scope.fromSimulationTime),scope.toSimulationTime])].sort();
    if(times.length<2||times.length>10000||times.some((t,i)=>i>0&&Date.parse(t)-Date.parse(times[i-1]!)>contract.policy.window.maximumTraceGapSimulationMilliseconds))gaps.add('population-boundary-density');
    const complete=gaps.size===0,body={protocol:'native-original-population-bounds-v1',scope,worldId,contractDigest:contract.digest,
        genesisResultId:baseline.genesisResultId,genesisResultDigest:baseline.genesisResultDigest,fromSimulationTime:from,toSimulationTime:scope.toSimulationTime,
        founderCount:count,founderDigest:digest(roster),healthSnapshotDigest:deaths.healthSnapshotDigest,checkpointSnapshotDigest,enforcementDigest:enforcement.digest,
        completePopulationBounds:complete,closingSurvivorAgentIds:complete?survivors:[],minimumLivingLower:complete?survivors.length:null,
        closingSurvivalLower:complete?{numerator:String(survivors.length*10000),denominator:String(count)}:null,
        boundaries:{times:complete?times:[],complete,sourceDigest:digest({head:census?.head??null,scope,founders:roster,enforcement:enforcement.digest})},
        gaps:[...gaps].sort(),meaning:'Verified finite original survivors at closing give a monotone lower bound at every earlier population boundary. Physical boundaries and numeric/global minimum PASS remain separate.'};
    return{...body,digest:digest(body)};
}
