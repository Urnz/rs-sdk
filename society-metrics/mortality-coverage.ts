import type { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { NativeMortalityCoverageStore,mortalityRosterDigest,type MortalityActor } from '../population-lifecycle/native-coverage.js';
import { PlayerHealthEvidenceStore } from '../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { readStableOutcomeStore } from './population-outcomes.js';
import { outcomeCheck as check,outcomeRows as rows } from './outcome-work.js';
import type { EvaluationScope } from './evaluation.js';
import type { NativeOutcomeOptions } from './native-outcomes.js';
import { loadPopulationAgePolicy } from '../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy } from '../population-lifecycle/mortality.js';
import { loadSurvivalProfile } from '../needs/survival.js';
import { loadSocietyMinimumPolicy,societyMinimumDigest as digest } from '../society-minimum/policy.js';

/** Tick-pass coverage is separate from survival, HP observation and complete login/respawn enforcement. */
export function readNativeMortalityCoverage(db:Database,scope:EvaluationScope,options:NativeOutcomeOptions,genesisAt:string,founders:MortalityActor[]){
    check(options.population,'Mortality population authority not configured');
    if(!NativeMortalityCoverageStore.present(db))throw Object.assign(Error('Mortality coverage not selected'),{code:'ENOENT'});
    const source=new NativeMortalityCoverageStore(db).read(),s=source.selection,config=options.population.configDirectory,
        age=loadPopulationAgePolicy(join(config,'population-age-policy.json')),mortality=loadPopulationMortalityPolicy(join(config,'population-mortality-policy.json')),
        survival=loadSurvivalProfile(options.workspace),policy=loadSocietyMinimumPolicy(join(config,'society-minimum-policy.json'));
    const health=readStableOutcomeStore(options,options.population.healthPath,healthDb=>{
        for(const t of ['engine_health_damage','engine_population_death','engine_health_audit_tail','engine_population_binding'])rows(healthDb,t);
        const store=new PlayerHealthEvidenceStore(options.population!.healthPath,true);
        try{return{deaths:store.listDeaths(),heads:store.coverageHeads(),prefixes:{
            damage:new Map(rows(healthDb,'engine_health_damage').map(r=>[r.sequence,r.entry_hash as string])),
            death:new Map(rows(healthDb,'engine_population_death').map(r=>[r.sequence,r.entry_hash as string]))}};}finally{store.close();}
    });
    const gaps=new Set<string>(),from=Date.parse(genesisAt),to=Date.parse(scope.toSimulationTime),expected=mortalityRosterDigest(founders);
    if(s.worldId!==options.worldId||s.clockId!==scope.clockId||s.clockProfileDigest!==scope.clockProfileDigest
        ||s.fromSimulationTime!==genesisAt||s.toSimulationTime<scope.toSimulationTime||mortalityRosterDigest(s.actors)!==expected)gaps.add('selection-or-original-cohort');
    if(s.agePolicyDigest!==age.digest||s.mortalityPolicyDigest!==mortality.digest||s.survivalSelectionDigest!==(survival?.selection.digest??null)
        ||s.maximumSimulationGapMs>policy.window.maximumTraceGapSimulationMilliseconds)gaps.add('policy-binding');
    const prefix=(domain:'damage'|'death',head:{sequence:number;digest:string})=>head.digest===(head.sequence===0?'0'.repeat(64):health.prefixes[domain].get(head.sequence));
    for(const domain of ['damage','death'] as const)if(!prefix(domain,s.openingHealthHeads[domain]))gaps.add('opening-health-prefix');
    if(digest(s.openingHealthHeads.binding)!==digest(health.heads.binding))gaps.add('finite-binding-history');
    const deathsByActor=new Map(health.deaths.map(d=>[d.agentId,d]));
    const selected=source.entries.filter(e=>Date.parse(e.sample.clock.simulationTime)>=from-s.maximumSimulationGapMs
        &&Date.parse(e.sample.clock.simulationTime)<=to+s.maximumSimulationGapMs);
    let prior:typeof selected[number]|undefined;
    for(const entry of selected){const e=entry.sample,c=e.clock;
        if(e.priorWriteFailed)gaps.add('observer-write-failure');
        if(e.rosterDigest!==expected||mortalityRosterDigest(e.actors)!==expected)gaps.add('roster-history');
        if(e.agePolicyDigest!==s.agePolicyDigest||e.mortalityPolicyDigest!==s.mortalityPolicyDigest||e.survivalSelectionDigest!==s.survivalSelectionDigest)gaps.add('policy-history');
        for(const domain of ['damage','death'] as const)if(!prefix(domain,e.healthHeads[domain])||e.healthHeads[domain].sequence<s.openingHealthHeads[domain].sequence
            ||prior&&e.healthHeads[domain].sequence<prior.sample.healthHeads[domain].sequence)gaps.add('health-prefix');
        if(digest(e.healthHeads.binding)!==digest(s.openingHealthHeads.binding))gaps.add('finite-binding-history');
        for(const a of e.actors){const d=deathsByActor.get(a.actorId),native=d&&d.sequence<=e.healthHeads.death.sequence?d:null;
            if(d&&d.cause.kind!=='engine-hp-zero'&&d.atSimulationTime<=c.simulationTime&&!native)gaps.add('missed-due-mortality');
            if(a.state==='unavailable'||native&&(a.state!=='terminal'||a.deathEventId!==native.eventId||native.membershipDigest!==a.membershipDigest
                ||native.atSimulationTime>c.simulationTime||native.recordedAt>c.wallTime)||!native&&a.state!=='active')gaps.add('actor-death-binding');}
        if(prior){const p=prior.sample,simulationMs=Date.parse(c.simulationTime)-Date.parse(p.clock.simulationTime),wallMs=Date.parse(c.wallTime)-Date.parse(p.clock.wallTime);
            if(e.sessionId!==p.sessionId||c.engineTick!==Number(p.clock.engineTick)+1||c.revision<p.clock.revision
                ||simulationMs<0||simulationMs>s.maximumSimulationGapMs||wallMs<=0||wallMs>s.maximumWallGapMs)gaps.add('tick-session-clock-gap');}
        prior=entry;
    }
    if(!selected.length||Date.parse(selected[0]!.sample.clock.simulationTime)>from||Date.parse(selected.at(-1)!.sample.clock.simulationTime)<to)gaps.add('window-boundaries');
    const body={protocol:'native-mortality-tick-coverage-v1',scope,worldId:options.worldId,fromSimulationTime:genesisAt,toSimulationTime:scope.toSimulationTime,
        selectionDigest:digest(s),sourceHead:source.head,healthSnapshotDigest:health.sourceSnapshotDigest,sampleCount:selected.length,
        completeMortalityTickCoverage:gaps.size===0,completeLifecycleEnforcement:false,gaps:[...gaps].sort(),
        meaning:'Completed configured native mortality passes over the original roster, offline included; starvation only when selected. No continuous HP, login/respawn enforcement, survival or minimum-integrity PASS.'};
    return{...body,digest:digest(body)};
}
