import type { Database } from 'bun:sqlite';
import { NativeLifecycleAttemptStore,type LifecycleAttemptEvent } from '../population-lifecycle/native-attempts.js';
import { mortalityRosterDigest,type MortalityActor } from '../population-lifecycle/native-coverage.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { readStableOutcomeStore } from './population-outcomes.js';
import { outcomeRows as rows,outcomeCheck as check } from './outcome-work.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { EvaluationScope } from './evaluation.js';
import type { NativeOutcomeOptions } from './native-outcomes.js';

/** Successful parsing is not admission. Positive native violations survive incomplete global attempt coverage. */
export function readNativeLifecycleAttempts(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[]){
    check(options.population,'Lifecycle authority not configured');
    if(!NativeLifecycleAttemptStore.present(db))throw Object.assign(Error('Lifecycle attempts not selected'),{code:'ENOENT'});
    const source=new NativeLifecycleAttemptStore(db).read(),s=source.mortality;
    check(s.worldId===options.worldId&&s.clockId===scope.clockId&&s.clockProfileDigest===scope.clockProfileDigest&&s.fromSimulationTime===genesisAt
        &&mortalityRosterDigest(s.actors)===mortalityRosterDigest(founders),'Lifecycle attempt original scope differs');
    const health=readStableOutcomeStore(options,options.population.healthPath,healthDb=>{
        for(const table of ['engine_health_damage','engine_population_death','engine_health_audit_tail'])rows(healthDb,table);
        const store=new PlayerHealthEvidenceStore(options.population!.healthPath,true);
        try{return{deaths:store.listDeaths(),heads:store.coverageHeads(),prefixes:{
            damage:new Map(rows(healthDb,'engine_health_damage').map(r=>[r.sequence,r.entry_hash as string])),
            death:new Map(rows(healthDb,'engine_population_death').map(r=>[r.sequence,r.entry_hash as string]))}};}finally{store.close();}
    });
    const byUsername=new Map(founders.map(a=>[a.username,a])),deaths=new Map(health.deaths.map(d=>[d.agentId,d]));
    const verify=(e:LifecycleAttemptEvent)=>{const a=e.authority,original=byUsername.get(e.username);
        if(!a||!original||digest(a.actor)!==digest(original)||a.clock.clockId!==scope.clockId||a.clock.profileDigest!==scope.clockProfileDigest
            ||a.clock.simulationTime<genesisAt||a.clock.simulationTime>scope.toSimulationTime||Date.parse(e.wallTime)-Date.parse(a.clock.wallTime)>s.maximumWallGapMs
            ||digest(a.healthHeads.binding)!==digest(health.heads.binding))return null;
        for(const d of ['damage','death'] as const){const h=a.healthHeads[d];if(h.digest!==(h.sequence===0?'0'.repeat(64):health.prefixes[d].get(h.sequence)))return null;}
        const death=deaths.get(original.actorId),known=death&&death.sequence<=a.healthHeads.death.sequence&&death.membershipDigest===original.membershipDigest
            &&death.atSimulationTime<=a.clock.simulationTime&&death.recordedAt<=e.wallTime?death:null;
        return{actorId:original.actorId,death:known};
    };
    const violations:Array<{attemptId:string;actorId:string;kind:string;atSimulationTime:string;reason:string;deathEventId:string|null}>=[],attempts:Array<{
        attemptId:string;username:string;kind:string;outcome:string|null;status:'observed'|'unproven';atSimulationTime:string|null}>=[];
    for(const [attemptId,pair] of source.attempts){const event=pair.result??pair.begin,
        clocks=[pair.begin.authority?.clock,pair.result?.authority?.clock].filter(c=>!!c);
        if(clocks.length===2&&(clocks.every(c=>c!.simulationTime<genesisAt)||clocks.every(c=>c!.simulationTime>scope.toSimulationTime)))continue;
        const proof=pair.result?verify(pair.result):null,before=verify(pair.begin),ordered=proof&&before
            &&pair.result!.authority!.clock.simulationTime>=pair.begin.authority!.clock.simulationTime
            &&Number(pair.result!.authority!.clock.engineTick)>=Number(pair.begin.authority!.clock.engineTick)
            &&pair.result!.authority!.clock.revision>=pair.begin.authority!.clock.revision;
        attempts.push({attemptId,username:event.username,kind:event.kind,outcome:pair.result?.outcome??null,status:ordered?'observed':'unproven',atSimulationTime:proof?event.authority!.clock.simulationTime:null});
        if(!proof||!pair.result)continue;
        const entering=(event.kind==='world-admission'&&event.outcome==='admitted')||(event.kind==='world-reconnect'&&event.outcome==='reconnected')
            ||(event.kind==='login-guard'&&event.outcome==='passed'),
            respawn=event.kind==='respawn-script'&&event.outcome==='returned'&&event.scriptState===1&&Number(event.vitals?.hitpoints)>0;
        if((entering&&(!!proof.death||event.vitals?.terminal===true||event.vitals?.hitpoints===0))||(respawn&&!!proof.death))
            violations.push({attemptId,actorId:proof.actorId,kind:event.kind,atSimulationTime:event.authority!.clock.simulationTime,
                reason:proof.death?'native-terminal-avatar-admitted-or-respawned':'native-terminal-or-zero-hp-admission',deathEventId:proof.death?.eventId??null});
    }
    const body={protocol:'native-lifecycle-attempt-observations-v1',scope,worldId:options.worldId,selectionDigest:digest(source.selection),sourceHead:source.head,
        healthSnapshotDigest:health.sourceSnapshotDigest,faultCount:source.faults,attempts,violations,positiveOpportunity:attempts.length>0,
        completeLifecycleEnforcement:false,coverage:'partial-attempt-observations',verdict:violations.length?'fail':'inconclusive',
        meaning:'Prospective parser, guard, world-entry and script observations. Missing result/authority stays unknown; no absence-of-attempt or full enforcement PASS.'};
    return{...body,digest:digest(body)};
}
