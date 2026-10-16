import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync,mkdirSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Database} from 'bun:sqlite';
import {AgentStateStore} from '../../agent-state/store.js';
import {SimulationClockStore} from '../../simulation-clock/store.js';
import {loadSimulationClockRuntimeConfig} from '../../simulation-clock/config.js';
import {WorldGenesisRunStore} from '../../world-genesis/run-store.js';
import {SocietyIntegrityStore} from '../../society-integrity/store.js';
import {buildWorldGenesisResult} from '../../world-genesis/result.js';
import {loadWorldGenesisProfileCatalog} from '../../world-genesis/config.js';
import {resolvePopulationGenesis} from '../../population-lifecycle/genesis.js';
import {loadPopulationLifecyclePolicyCatalog,loadPopulationWorldProfileBindingCatalog} from '../../population-lifecycle/config.js';
import {ExperimentParameterStore} from '../../server/gateway/admin/experiment-parameters.js';
import {EXPERIMENT_ADAPTERS} from '../../server/gateway/admin/experiment-applied-profile.js';
import {AgentReplanCoordinator} from '../../server/gateway/admin/replan-coordinator.js';
import {MultiAgentExperimentStore,startMultiAgentExperiment,previewMultiAgentExperiment,experimentInitialStateDigest,validateMultiAgentExperimentEnvironment} from '../../server/gateway/admin/multi-agent-experiments.js';
import type {MultiAgentExperimentEnvironment} from '../../server/gateway/admin/multi-agent-experiments.js';
import {reconcileMultiAgentExperimentSkillRun} from '../../server/gateway/admin/multi-agent-experiments.js';
import {digest} from '../../external-trade/policy.js';
import {DiminishingXpStore,parseDiminishingXpConfig} from '../../server/engine/src/mods/DiminishingXp.js';
import {XpExecutionStore} from '../../server/engine/src/mods/XpExecutionStore.js';
import {xpExecutionPolicyDigest,type XpExecutionArmRequest} from '../xp-execution.js';
import {readXpExecutionSource,readXpExecutionSources} from '../xp-execution-source.js';
import {readLongExperimentBinding} from '../source.js';
import {LongExperimentStore} from '../store.js';
import {prepareLongExperiment,startLongExperiment,stepLongExperiment,stopLongExperiment,reportLongExperiment,type LongExperimentDependencies} from '../controller.js';
import {validateLongExperimentPlan,type LongExperimentPlan} from '../plan.js';
import {localExperimentClient,readLongExperimentReport,nativeLongExperimentDependencies} from '../runtime.js';
import {readLongExperimentComparison} from '../runtime.js';
import {compareLongExperiments,LONG_COMPARISON_CAPABILITIES,validateLongComparisonRequest} from '../comparison.js';
import {captureSocietyArchive,restoreSocietyArchive,verifySocietyArchive} from '../archive.js';
import {readBenchmarkReport,validateBenchmarkBaseline} from '../benchmark-report.js';
import {transitionBenchmarkClock} from '../benchmark-clock.js';
import {defaultLongExperimentSources} from '../runtime.js';
import {readdirSync} from 'node:fs';

const directories:string[]=[],base=Date.parse('2030-01-01T00:00:00.000Z'),wall=(minute:number)=>new Date(base+minute*60000).toISOString();
const held:Array<{close():void}>=[];
const track=<T extends {close():void}>(store:T):T=>{held.push(store);return store;};
afterEach(()=>{for(const store of held.splice(0))store.close();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function mutate(path:string,sql:string){const db=new Database(path);try{db.run(sql);}finally{(db as Database&{clearQueryCache():void}).clearQueryCache();db.close(true);}}
async function fixture(options:{sessionId?:string;diminishingXp?:boolean;xpPerMinute?:number;xpSnapshot?:boolean;xpExecution?:boolean}={}){
    const directory=mkdtempSync(join(tmpdir(),'society-long-'));directories.push(directory);
    const configDirectory=join(directory,'config');mkdirSync(configDirectory);
    // Keep the native domain dependencies and one unrelated policy to exercise whole-directory pinning, without copying other domains' fixtures.
    for(const name of ['world-genesis-profiles.json','population-lifecycle-policies.json','population-world-profile-bindings.json',
        'attribute-budget-policies.json','attribute-allocation-policies.json','simulation-clock.json','needs-policies.json'])
        copyFileSync(join(import.meta.dir,'../../config',name),join(configDirectory,name));
    const paths={configDirectory,genesisPath:join(directory,'genesis.sqlite'),agentPath:join(directory,'agents.sqlite'),
        parameterPath:join(directory,'profiles.sqlite'),clockPath:join(directory,'clock.sqlite'),integrityPath:join(directory,'integrity.sqlite')};
    // Keep real, restartable on-disk databases and FULL synchronization. WAL avoids rollback-journal
    // file creation/deletion on every native clock/receipt write (hundreds in a day-pair fixture).
    mutate(paths.clockPath,'PRAGMA journal_mode=WAL');
    const clock=track(new SimulationClockStore(paths.clockPath)),config=loadSimulationClockRuntimeConfig(join(configDirectory,'simulation-clock.json'));
    const clockState=clock.create({clockId:'world',profile:config.profile,wallTime:wall(0),simulationTime:config.initialSimulationTime});
    const profile=loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json')).profiles.find(row=>row.profileId==='mature-society')!;
    const roster=['ada','bea','cora','dora'].map(agentId=>({agentId,playerUsername:agentId}));
    const result=buildWorldGenesisResult({schemaVersion:1,seed:'long-native-seed',profile:{profileId:profile.profileId,version:profile.version,digest:profile.digest},
        worldBuild:'lostcity-native-fixture',simulationClock:{clockId:'world',profileDigest:clockState.profileDigest,initialSimulationTime:config.initialSimulationTime},parameters:{}},
        {assets:[],populationMembers:roster},wall(0));
    const genesis=new WorldGenesisRunStore(paths.genesisPath);
    try{const begun=genesis.begin(result,{},wall(0));genesis.finishApply(result.resultId,begun.revision,{fixture:true},wall(0));}finally{genesis.close();}
    const integrity=new SocietyIntegrityStore(paths.integrityPath);try{integrity.begin(result,true);integrity.finishBootstrap(result.resultId);}finally{integrity.close();}
    const resolved=resolvePopulationGenesis(result,loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json')),
        loadPopulationLifecyclePolicyCatalog(join(configDirectory,'population-lifecycle-policies.json')),loadPopulationWorldProfileBindingCatalog(join(configDirectory,'population-world-profile-bindings.json')));
    const agents=new AgentStateStore(paths.agentPath,{store:clock,clockId:'world'});
    try{for(const member of roster){agents.createIdentity({...member,displayName:member.agentId,background:'Native long experiment fixture.',personalityTraits:['steady']},wall(0));
        agents.bindPopulationMember({...member,worldProfile:result.profile,lifecyclePolicy:{policyId:resolved.policy!.policyId,version:resolved.policy!.version,
            digest:resolved.policy!.digest,kind:'finite'},simulationClock:{clockId:'world',profileDigest:clockState.profileDigest},joinedAtSimulationTime:config.initialSimulationTime,
            sourceResultId:result.resultId,sourceResultDigest:result.resultDigest},wall(0));}}finally{agents.close();}
    const parameters=new ExperimentParameterStore(paths.parameterPath);let parameterProfile;
    try{parameterProfile=parameters.create({profileId:'long.baseline',version:'1.0.0',label:'Long baseline',origin:'manual',parameters:{respawns:[],
        xpRewards:[{activityKey:'skill:mining',multiplier:1}],marketPrices:[],finishedProducts:[]}},wall(0));}finally{parameters.close();}
    let minute=0,submitted=0,failResponse=false,environmentDrift=false,baselineDrift=false;
    const experimentPath=join(directory,'phase12.sqlite'),journalPath=join(directory,'long.sqlite');
    mutate(experimentPath,'PRAGMA journal_mode=WAL');mutate(journalPath,'PRAGMA journal_mode=WAL');
    const phase12=track(new MultiAgentExperimentStore(experimentPath));
    const candidates=roster.map(row=>({agentId:row.agentId,role:'player',subjectKind:'player',identityPlayerUsername:row.playerUsername,avatarPlayerUsername:row.playerUsername,
        onlineFresh:true,avatarBaseline:{username:row.playerUsername,position:{x:3200,z:3400,level:0},hitpoints:{current:10,maximum:10},runEnergy:10000,
            inventory:[],equipment:[],bankKnown:true,bank:[],skills:Array.from({length:19},(_,index)=>({name:`Skill ${index}`,level:10,baseLevel:10,experience:1154}))}}));
    const environment:MultiAgentExperimentEnvironment={schemaVersion:1 as const,activeRevision:1,capturedAt:wall(0),mods:[...EXPERIMENT_ADAPTERS.filter(adapter=>parameterProfile.parameters[adapter.category].length>0).map(adapter=>({id:adapter.id,version:'1.0.0',
        dataSchemaVersion:1,...adapter.build(parameterProfile)}))].map(mod=>({...mod,enabled:mod.id==='experiment.xp-calibration'}))};
    const xpConfig={affectedSkills:'MINING',regionSize:64,recoveryMinutes:60,tier2At:3,tier3At:5,tier4At:7,tier5At:9,
        multiplier2:0.9,multiplier3:0.7,multiplier4:0.4,multiplier5:0.15};
    const xpStore=options.xpSnapshot?new DiminishingXpStore(join(directory,'xp-state.json')):undefined;
    const executionPath=join(directory,'xp-execution.sqlite'),executionStore=options.xpExecution?track(new XpExecutionStore(executionPath,false,()=>wall(minute))):undefined;
    if(options.diminishingXp!==undefined)environment.mods.push({id:'economy.diminishing-xp',version:options.xpExecution?'1.2.0':'1.0.0',dataSchemaVersion:options.xpExecution?2:1,
        enabled:options.diminishingXp,config:options.xpSnapshot?xpConfig:{}});
    const executionPolicy=()=>xpExecutionPolicyDigest(environment.mods.find(mod=>mod.id==='economy.diminishing-xp')!,environment.mods.find(mod=>mod.id==='experiment.xp-calibration')??null);
    const executionPort=executionStore?{arm:async(request:XpExecutionArmRequest)=>executionStore.arm(request,xpStore!.snapshot(request.cohort,xpConfig,base+minute*60000),executionPolicy()),
        seal:async(id:string)=>executionStore.seal(id,wall(minute))}:undefined;
    const environmentDigest=validateMultiAgentExperimentEnvironment(environment).digest;
    const goals=Object.fromEntries(roster.map(row=>[row.agentId,[]]));
    const coordinator=new AgentReplanCoordinator({resolveAgentId:async username=>username,listAgentIds:async()=>roster.map(row=>row.agentId),
        plan:async(agentId,event)=>{submitted++;
            if(executionStore){const context={script:'mining',targetKind:'loc' as const,targetId:2090,x:3200,z:3400,level:0};
                executionStore.observe(agentId,'MINING',context,100,executionPolicy(),()=>xpStore!.snapshot([agentId],xpConfig,base+minute*60000),
                    ()=>options.diminishingXp?xpStore!.award(agentId,'MINING',context,100,parseDiminishingXpConfig(xpConfig),base+minute*60000).grantedXp:100);}
            return {runId:`skill-${event.eventId}`,status:'executing',reason:'Native fixture dispatch'};},append:()=>{}});
    const economy=()=>({timestamp:wall(minute),bots:4,online:4,totalCoins:0,totalXp:minute*(options.xpPerMinute??0),
        sessionXpGained:minute*(options.xpPerMinute??0),totalXpPerHour:0,averageTotalLevel:10,itemStock:[]});
    const phaseDeps={store:phase12,coordinator,listCandidates:async()=>candidates,economySnapshot:async()=>economy(),worldModEnvironment:async()=>environment,
        ...(xpStore?{xpSnapshot:async(cohort:string[])=>xpStore.snapshot(cohort,xpConfig,base+minute*60000)}:{}),
        ...(executionPort?{xpExecution:executionPort}:{}),
        parameterProfile:async()=>parameterProfile,goalSnapshots:async()=>goals,goalEvents:async()=>Object.fromEntries(roster.map(row=>[row.agentId,[]]))};
    const deps:LongExperimentDependencies={binding:plan=>readLongExperimentBinding(plan,paths),
        preflight:async input=>{const preview=await previewMultiAgentExperiment(input,phaseDeps);return {initialStateDigest:baselineDrift?'f'.repeat(64):experimentInitialStateDigest(preview.candidates,preview.baselineGoals),
            environmentDigest,parameterProfileDigest:parameterProfile.digest,...(preview.xpInitialState?{xpInitialState:preview.xpInitialState}:{})};},
        environmentDigest:async()=>environmentDrift?'f'.repeat(64):environmentDigest,
        getWave:id=>phase12.get(id),
        ...(executionStore?{verifyXpExecution:(report:ReturnType<XpExecutionStore['seal']>)=>{expect(executionStore.get(report.binding.request.experimentId)!.digest).toBe(report.digest);}}:{}),
        startWave:async(claim,definition)=>{const started=await startMultiAgentExperiment(claim.input,phaseDeps,wall(minute),{experimentId:claim.experimentId,
            expectedInitialStateDigest:claim.expectedInitialStateDigest,expectedEnvironmentDigest:definition.environmentDigest,expectedParameterProfileDigest:parameterProfile.digest,
            expectedXpCohortDigest:claim.index===0?definition.xpInitialState?.cohortDigest:undefined});
            await started.completion;if(failResponse)throw new Error('Ambiguous response after native commit');return started.run;},
        observe:()=>clock.observe('world',wall(minute)),
        bind:(sourceId,event)=>clock.bindEvent({clockId:'world',domain:'society-long-run',sourceId,sourceDigest:digest({...event,stamp:null}),wallTime:event.wallTime}).stamp,
        verifyStamp:stamp=>{expect(clock.getBoundEvent('world',stamp.domain,stamp.sourceId)).toEqual(stamp);},wallNow:()=>wall(minute)};
    const raw:LongExperimentPlan={schemaVersion:1,sessionId:options.sessionId??'long-test',label:'Controlled native long test',summary:'Repeated Phase 12 waves without invented economic qualification.',
        genesisResultId:result.resultId,genesisResultDigest:result.resultDigest,parameterProfileId:parameterProfile.profileId,parameterProfileVersion:parameterProfile.version,
        parameterProfileDigest:parameterProfile.digest,attributeBudgetPolicyId:'default-npc-attributes',attributeAllocationPolicyId:'default-npc-allocation',
        expectedConditionDigest:'0'.repeat(64),expectedInitialStateDigest:'0'.repeat(64),warmupSimulationMilliseconds:0,evaluationSimulationMilliseconds:86400000,
        bucketSimulationMilliseconds:3600000,cadenceSimulationMilliseconds:1800000,maximumGapSimulationMilliseconds:3600000,maximumWaveWallMilliseconds:3600000,maximumWallMilliseconds:172800000};
    const prepared=await prepareLongExperiment(raw,deps),store=track(new LongExperimentStore(journalPath));
    const plan=prepared.plan;
    function finish(){const active=store.get(plan.sessionId)!.active!;
        for(const row of phase12.get(active.experimentId)!.participants)phase12.recordSkillRun(row.runId!,{runId:row.runId!,username:row.avatarPlayerUsername,
            skill:{id:'test.native-production',version:'1.0.0'},status:'completed',reason:'Native fixture terminal',message:'',operations:1,durationMs:1000,
            startedAt:wall(minute-1),finishedAt:wall(minute),events:[]},true,'Native fixture terminal',wall(minute));
        phase12.finish(active.experimentId,economy(),goals,Object.fromEntries(roster.map(row=>[row.agentId,[]])),wall(minute),executionStore?.seal(active.experimentId,wall(minute)));}
    return {directory,paths,plan,store,deps,phase12,candidates,phaseDeps,journalPath,experimentPath,result,xpStore,xpConfig,executionStore,executionPath,
        at:(value:number)=>{minute=value;},submitted:()=>submitted,ambiguous:()=>{failResponse=true;},driftEnvironment:()=>{environmentDrift=true;},driftBaseline:()=>{baselineDrift=true;},finish,
        close:()=>{for(const source of [store,phase12,clock,...(executionStore?[executionStore]:[])]){source.close();held.splice(held.indexOf(source),1);}}};
}

async function completeFixture(f:Awaited<ReturnType<typeof fixture>>,extraFirstBucket=false){
    await startLongExperiment(f.plan,f.store,f.deps);
    for(let hour=0;hour<24;hour++){
        f.at(hour*60);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        f.at(hour*60+1);f.finish();await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        if(hour===0 && extraFirstBucket){
            f.at(30);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
            f.at(31);f.finish();await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        }
    }
    f.at(1440);return stepLongExperiment(f.plan.sessionId,f.store,f.deps);
}

test('benchmark result restores native Phase12, clock and XP evidence into an isolated workspace',async()=>{
    const f=await fixture({xpSnapshot:true,xpExecution:true,diminishingXp:false});
    await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
    f.at(1);f.finish();await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
    stopLongExperiment(f.plan.sessionId,f.store,f.deps,'Finite technical export test.');f.close();
    const root=join(f.directory,'workspace'),bundle=join(f.directory,'bundle'),restored=join(f.directory,'restored');mkdirSync(root);
    const put=(path:string,content:string)=>{const target=join(root,path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,content);};
    put('package.json','{"name":"native-benchmark-fixture"}');put('.gitignore','.local/\nserver/engine/data/\n');
    put('server/engine/data/players/main/ada.sav','technical fixture');put('server/engine/data/pack/server/script.dat','technical cache');
    mkdirSync(join(root,'config'));for(const name of readdirSync(join(import.meta.dir,'../../config')).filter(name=>name.endsWith('.json')))
        copyFileSync(join(import.meta.dir,'../../config',name),join(root,'config',name));
    const files:Record<string,string>={ [f.paths.agentPath]:'.local/agent-state/agents.sqlite',[f.paths.clockPath]:'.local/simulation/simulation-clock.sqlite',
        [f.paths.genesisPath]:'.local/simulation/world-genesis-runs.sqlite',[f.paths.integrityPath]:'.local/simulation/society-integrity.sqlite',
        [f.paths.parameterPath]:'.local/admin/experiment-parameters.sqlite',[f.journalPath]:'.local/admin/long-experiments.sqlite',
        [f.experimentPath]:'.local/admin/multi-agent-experiments.sqlite',[f.executionPath]:'.local/admin/xp-execution.sqlite'};
    for(const [source,target] of Object.entries(files)){put(target,'');copyFileSync(source,join(root,target));
        for(const suffix of ['-wal','-shm'])if(existsSync(source+suffix))copyFileSync(source+suffix,join(root,target+suffix));}
    for(const args of [['init','-q'],['add','.'],['-c','user.name=Benchmark Test','-c','user.email=benchmark@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture']]){
        const result=Bun.spawnSync(['git','-C',root,...args],{stdout:'pipe',stderr:'pipe'});expect(result.exitCode).toBe(0);
    }
    const freshPlan={...f.plan,sessionId:'fresh-baseline',expectedConditionDigest:readLongExperimentBinding(f.plan,defaultLongExperimentSources(root)).conditionDigest};
    expect(()=>validateBenchmarkBaseline(root,freshPlan)).toThrow('Pause');
    transitionBenchmarkClock(root,'pause',wall(2));
    expect(validateBenchmarkBaseline(root,freshPlan).conditionDigest).toBe(freshPlan.expectedConditionDigest);
    expect(()=>validateBenchmarkBaseline(root,{...freshPlan,sessionId:f.plan.sessionId})).toThrow('already used');
    const original=readBenchmarkReport(root,f.plan);
    expect(original.execution.status).toBe('stopped');expect(original.execution.settledWaves).toHaveLength(1);
    expect(original.execution.provesSelfSufficiency).toBe(false);
    const manifest=captureSocietyArchive({root,output:bundle,kind:'result',plan:f.plan,assertOffline:()=>{},readReport:base=>readBenchmarkReport(base,f.plan)});
    restoreSocietyArchive(bundle,restored);
    expect(readBenchmarkReport(join(restored,'workspace'),f.plan)).toEqual(original);
    expect(verifySocietyArchive(bundle).digest).toBe(manifest.digest);
    mutate(join(restored,'workspace/.local/admin/xp-execution.sqlite'),"DELETE FROM xp_execution_event WHERE sequence=2");
    expect(()=>readBenchmarkReport(join(restored,'workspace'),f.plan)).toThrow();
});
test('native bindings fix seed, finite founders, generated attribute inputs, all policies and exact starting avatar/goals',async()=>{
    const f=await fixture();try{const state=await startLongExperiment(f.plan,f.store,f.deps);
        expect(state.definition.binding.genesis.seed).toBe('long-native-seed');expect(state.definition.binding.attributeInputs).toHaveLength(4);
        expect(state.definition.binding.conditionDigest).toBe(f.plan.expectedConditionDigest);expect(f.submitted()).toBe(0);
        expect((await startLongExperiment(f.plan,f.store,f.deps)).sequence).toBe(1);
        await expect(startLongExperiment({...f.plan,label:'Conflicting plan'},f.store,f.deps)).rejects.toThrow('already bound');
    }finally{f.close();}
});
test('native completed day pairs yield bounded, traceable descriptive XP comparisons and reject confounded evidence',async()=>{
    const c=await fixture({sessionId:'xp-control',diminishingXp:false,xpPerMinute:2,xpSnapshot:true,xpExecution:true}),
        t=await fixture({sessionId:'xp-treatment',diminishingXp:true,xpPerMinute:1,xpSnapshot:true,xpExecution:true});
    const request={schemaVersion:1 as const,axis:'diminishing-xp' as const,controlSessionId:c.plan.sessionId,treatmentSessionId:t.plan.sessionId};
    const options={controlJournalPath:c.journalPath,treatmentJournalPath:t.journalPath,controlDependencies:c.deps,treatmentDependencies:t.deps};
    try{
        await startLongExperiment(c.plan,c.store,c.deps);await startLongExperiment(t.plan,t.store,t.deps);
        expect(()=>readLongExperimentComparison(request,options)).toThrow('completed');
        const cs=await completeFixture(c),ts=await completeFixture(t),report=readLongExperimentComparison(request,options);
        expect(report.status).toBe('descriptive-comparison');
        if(!('buckets' in report)||!report.buckets||!report.totals)throw new Error('Missing comparison');
        expect(report.buckets).toHaveLength(24);expect(c.submitted()+t.submitted()).toBe(192);
        expect(report.totals.treatmentMinusControl!.totalXpDelta).toBe(-24);
        expect(report.buckets[0]!.treatmentMinusControl!.totalXpDelta).toBe(-1);
        expect(report.buckets[0]!.control.evidence[0]!.terminalRunIds).toHaveLength(4);
        const {digest:reportDigest,...artifact}=report;expect(reportDigest).toBe(digest(artifact));
        expect(readLongExperimentComparison(request,options)).toEqual(report);
        expect(report.causalEffectEstablished).toBeFalse();expect(report.provesSelfSufficiency).toBeFalse();
        expect(report.engineRandomStreamSeeded).toBeFalse();
        expect(report.xpRepetitionState.status).toBe('matching-empty-native-snapshots');
        expect(report.xpRepetitionState.attestsExactDispatchState).toBeFalse();
        expect(report.xpCalculationState.status).toBe('matching-empty-first-native-calculations');
        expect(report.xpCalculationState.attestsExactFirstCalculationState).toBeTrue();expect(report.xpCalculationState.attestsPlayerStatCommit).toBeFalse();
        expect(cs.definition.xpInitialState!.cohortDigest).toBe(report.xpRepetitionState.control!.cohortDigest);
        const pair=(state=ts,deps=t.deps)=>compareLongExperiments(request,{state:cs,deps:c.deps},{state,deps});
        const protocol=structuredClone(ts);protocol.definition.plan.cadenceSimulationMilliseconds=60000;
        expect(()=>pair(protocol)).toThrow('observation protocol');
        const condition=structuredClone(ts);condition.definition.binding.conditionDigest='f'.repeat(64);
        expect(()=>pair(condition)).toThrow('same exact genesis');
        const initial=structuredClone(ts);initial.definition.initialStateDigest='f'.repeat(64);
        expect(()=>pair(initial)).toThrow('initial avatar');
        const overflow=structuredClone(ts);overflow.definition.environmentDigest='f'.repeat(64);
        expect(()=>pair(overflow)).toThrow('wave binding');
        const tampered={...t.deps,getWave:(id:string)=>{const wave=t.deps.getWave(id);if(wave)wave.metrics!.totalXpDelta=999;return wave;}};
        expect(()=>pair(ts,tampered)).toThrow('backing');
        // An otherwise valid journal with unequal sampling cannot yield an overall treatment delta.
        const unequal=structuredClone(ts);unequal.settled.push(unequal.settled[0]!);
        expect(()=>pair(unequal)).toThrow('reuses terminal');
        // Alter a real source after a valid report: uploaded/saved report JSON cannot override native backing.
        const proofId=ts.settled[0]!.claim.experimentId;
        mutate(t.executionPath,`DELETE FROM xp_execution_event WHERE run_id='${proofId}' AND sequence=3`);
        expect(()=>readLongExperimentComparison(request,options)).toThrow();
        mutate(t.experimentPath,"UPDATE multi_agent_experiment SET seed='forged' WHERE experiment_id=(SELECT experiment_id FROM multi_agent_experiment LIMIT 1)");
        expect(()=>readLongExperimentComparison(request,options)).toThrow('backing');
    }finally{c.close();t.close();}
},15000);
test('unequal native bucket sampling stays inconclusive and withholds overall deltas',async()=>{
    const c=await fixture({sessionId:'unequal-control',diminishingXp:false}),t=await fixture({sessionId:'unequal-treatment',diminishingXp:true});
    try{
        await completeFixture(c);await completeFixture(t,true);
        const report=readLongExperimentComparison({schemaVersion:1,axis:'diminishing-xp',controlSessionId:c.plan.sessionId,treatmentSessionId:t.plan.sessionId},
            {controlJournalPath:c.journalPath,treatmentJournalPath:t.journalPath,controlDependencies:c.deps,treatmentDependencies:t.deps});
        expect(report.status).toBe('inconclusive');if(!('buckets' in report)||!report.buckets||!report.totals)throw new Error('Missing comparison');
        expect(report.buckets[0]!.status).toBe('unequal-wave-count');expect(report.buckets[0]!.control.waveCount).toBe(1);
        expect(report.buckets[0]!.treatment.waveCount).toBe(2);expect(report.buckets[0]!.treatmentMinusControl).toBeNull();
        expect(report.totals.treatmentMinusControl).toBeNull();expect(report.buckets[1]!.treatmentMinusControl).not.toBeNull();
        expect(report.xpRepetitionState.status).toBe('legacy-unattested');
    }finally{c.close();t.close();}
},15000);
test('native XP history drift between long start and first wave prevents all skill dispatch',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true});try{
        await startLongExperiment(f.plan,f.store,f.deps);
        f.xpStore!.award('ada','MINING',{script:'mining',targetKind:'loc',targetId:2090,x:3200,z:3400,level:0},40,parseDiminishingXpConfig(f.xpConfig),base);
        await expect(stepLongExperiment(f.plan.sessionId,f.store,f.deps)).rejects.toThrow('binding changed');expect(f.submitted()).toBe(0);
        const state=f.store.get(f.plan.sessionId)!;expect(state.active).not.toBeNull();expect(f.phase12.get(state.active!.experimentId)).toBeNull();
    }finally{f.close();}
});
test('native arm rejection prevents coordinator dispatch and makes the long wave fail closed',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true,xpExecution:true});try{
        f.phaseDeps.xpExecution={...f.phaseDeps.xpExecution!,arm:async()=>{throw new Error('Native arm rejected');}};
        await startLongExperiment(f.plan,f.store,f.deps);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        expect(f.submitted()).toBe(0);expect(f.phase12.get(claimed.active!.experimentId)!.status).toBe('failed');
        f.at(1);expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');
    }finally{f.close();}
});
test('terminal skill reconciliation seals native XP evidence before finalizing the experiment',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true,xpExecution:true});try{
        await startLongExperiment(f.plan,f.store,f.deps);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);
        const id=claimed.active!.experimentId;
        for(const row of f.phase12.get(id)!.participants)await reconcileMultiAgentExperimentSkillRun(row.runId!,{
            runId:row.runId!,username:row.avatarPlayerUsername,skill:{id:'test.native-production',version:'1.0.0'},status:'completed',reason:'Native terminal',message:'',
            operations:1,durationMs:1000,startedAt:wall(0),finishedAt:wall(1),events:[]},true,'Native terminal',f.phaseDeps,wall(1));
        const native=f.phase12.get(id)!;expect(native.status).toBe('completed');expect(native.xpExecution!.complete).toBeTrue();
        expect(f.executionStore!.get(id)!.sealed).toBeTrue();expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).settled).toHaveLength(1);
    }finally{f.close();}
});
test('an already consumed native arm cannot be reused as a fresh experiment start',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true,xpExecution:true});try{
        const original=f.phaseDeps.xpExecution!;
        f.phaseDeps.xpExecution={...original,arm:async request=>{await original.arm(request);
            f.executionStore!.observe('ada','MINING',{script:'mining',targetKind:'loc',targetId:2090,x:3200,z:3400,level:0},100,request.expectedPolicyDigest,
                ()=>f.xpStore!.snapshot(['ada'],f.xpConfig,base),()=>100);
            return f.executionStore!.get(request.experimentId)!;}};
        await startLongExperiment(f.plan,f.store,f.deps);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        expect(f.submitted()).toBe(0);expect(f.phase12.get(claimed.active!.experimentId)!.status).toBe('failed');
        expect(f.executionStore!.get(claimed.active!.experimentId)!.sealed).toBeTrue();
    }finally{f.close();}
});
test('a rejected first native calculation cannot be promoted by successful skill journals',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true,xpExecution:true});try{
        const original=f.phaseDeps.xpExecution!;
        f.phaseDeps.xpExecution={...original,arm:async request=>{const report=await original.arm(request);
            f.xpStore!.award('ada','MINING',{script:'mining',targetKind:'loc',targetId:2090,x:3200,z:3400,level:0},40,parseDiminishingXpConfig(f.xpConfig),base);return report;}};
        await startLongExperiment(f.plan,f.store,f.deps);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        const native=f.phase12.get(claimed.active!.experimentId)!;expect(native.status).toBe('failed');
        expect(native.xpExecution!.members.find(row=>row.username==='ada')!.status).toBe('rejected');
        expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');
    }finally{f.close();}
});
test('native execution proof requires its source journal, with readonly batch verification and no missing-file creation',async()=>{
    const f=await fixture({diminishingXp:true,xpSnapshot:true,xpExecution:true});try{
        await startLongExperiment(f.plan,f.store,f.deps);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        await stepLongExperiment(f.plan.sessionId,f.store,f.deps);const id=claimed.active!.experimentId,proof=f.phase12.get(id)!.xpExecution!;
        expect(readXpExecutionSource(id,f.executionPath)!.digest).toBe(proof.digest);
        expect(readXpExecutionSources([id],f.executionPath).get(id)!.digest).toBe(proof.digest);
        expect(()=>readLongExperimentReport(f.plan.sessionId,f.journalPath,{...f.deps,verifyXpExecution:undefined})).toThrow('verifier unavailable');
        const missing=join(f.directory,'missing-execution.sqlite');expect(readXpExecutionSource(id,missing)).toBeNull();expect(existsSync(missing)).toBeFalse();
    }finally{f.close();}
});
test('legacy Phase 12 sources without the optional XP column keep their exact historical run shape',async()=>{
    const f=await fixture();try{
        await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        const state=await stepLongExperiment(f.plan.sessionId,f.store,f.deps),id=state.settled[0]!.claim.experimentId,before=f.phase12.get(id);
        mutate(f.experimentPath,'ALTER TABLE multi_agent_experiment DROP COLUMN xp_initial_state_json');
        const source=new MultiAgentExperimentStore(f.experimentPath,true);try{expect(source.get(id)).toEqual(before);expect(Object.hasOwn(source.get(id)!,'xpInitialState')).toBeFalse();}finally{source.close();}
        expect(readLongExperimentReport(f.plan.sessionId,f.journalPath,f.deps)).toMatchObject({status:'running'});
    }finally{f.close();}
});
test('the six treatment axes expose unsupported evidence without fabricating measured effects',async()=>{
    expect(LONG_COMPARISON_CAPABILITIES).toHaveLength(6);
    expect(LONG_COMPARISON_CAPABILITIES.filter(item=>item.supported).map(item=>item.axis)).toEqual(['diminishing-xp']);
    const f=await fixture();try{
        const state=await startLongExperiment(f.plan,f.store,f.deps),other=structuredClone(state);other.definition.plan.sessionId='other';
        for(const capability of LONG_COMPARISON_CAPABILITIES.filter(item=>!item.supported)){
            const report=compareLongExperiments({schemaVersion:1,axis:capability.axis,controlSessionId:f.plan.sessionId,treatmentSessionId:'other'},
                {state,deps:f.deps},{state:other,deps:f.deps});
            expect(report.status).toBe('unsupported');expect(report.totals).toBeNull();expect(report.buckets).toBeNull();
        }
    }finally{f.close();}
});
test('comparison request validation and absent readonly sources never create journals',()=>{
    const request={schemaVersion:1,axis:'diminishing-xp',controlSessionId:'c',treatmentSessionId:'t'};
    for(const bad of [{...request,schemaVersion:2},{...request,axis:'invented'},{...request,treatmentSessionId:'c'},
        {...request,controlSessionId:'../escape'},{...request,report:{}},{...request,controlSessionId:null}])
        expect(()=>validateLongComparisonRequest(bad)).toThrow();
    const directory=mkdtempSync(join(tmpdir(),'comparison-missing-'));directories.push(directory);const path=join(directory,'absent.sqlite');
    expect(readLongExperimentComparison(request,{controlJournalPath:path}).status).toBe('unavailable');expect(existsSync(path)).toBeFalse();
});
test('a controlled one-day program completes only after real native terminal waves cover all hourly buckets',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);
        for(let hour=0;hour<24;hour++){f.at(hour*60);const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(claimed.active).not.toBeNull();
            f.at(hour*60+1);f.finish();const settled=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(settled.settled).toHaveLength(hour+1);}
        f.at(1440);const completed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps),report=reportLongExperiment(completed);
        expect(completed.status).toBe('completed');expect(f.submitted()).toBe(96);expect(report.buckets.every(row=>row.observedCompleteCohortWave)).toBeTrue();
        expect(report.provesSelfSufficiency).toBeFalse();expect(report.engineRandomStreamSeeded).toBeFalse();expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).sequence).toBe(completed.sequence);
    }finally{f.close();}
// This is a native disk-backed protocol integration test, not a five-second performance budget.
},15000);
test('restart after an ambiguous POST keeps the deterministic wave id and never redispatches a committed Phase 12 wave',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);f.ambiguous();
        await expect(stepLongExperiment(f.plan.sessionId,f.store,f.deps)).rejects.toThrow('Ambiguous');const claimed=f.store.get(f.plan.sessionId)!;
        expect(f.submitted()).toBe(4);const reopened=new LongExperimentStore(f.journalPath);try{f.at(1);
            const waiting=await stepLongExperiment(f.plan.sessionId,reopened,f.deps);expect(waiting.active!.experimentId).toBe(claimed.active!.experimentId);expect(f.submitted()).toBe(4);
        }finally{reopened.close();}
    }finally{f.close();}
});
test('a first-wave baseline mismatch fails before any native skill dispatch',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);f.candidates[0]!.avatarBaseline.bank.push({id:995,name:'Coins',count:1} as never);
        await expect(stepLongExperiment(f.plan.sessionId,f.store,f.deps)).rejects.toThrow('binding changed');expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
for(const kind of ['policy','population','profile','environment'])test(`${kind} drift stops the program without replacing founders`,async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);
        if(kind==='policy')writeFileSync(join(f.paths.configDirectory,'operator-change.json'),'{}');
        if(kind==='population')mutate(f.paths.agentPath,"UPDATE agent_population_member SET source_result_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'");
        if(kind==='profile')mutate(f.paths.parameterPath,"UPDATE experiment_parameter_profile SET digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'");
        if(kind==='environment')f.driftEnvironment();
        expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
test('observation gaps are explicit failure, never backdated catch-up waves',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);f.at(61);const state=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        expect(state.status).toBe('failed');expect(state.history.at(-1)!.error).toContain('gap');expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
test('elapsed time without contained successful cohort waves cannot complete an evaluation',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);
        // Clock observations are not economic work. Persist only valid observation events, without dispatch.
        for(let hour=1;hour<=24;hour++){f.at(hour*60);const state=f.store.get(f.plan.sessionId)!,observation=f.deps.observe(),event={kind:'observed' as const,
            definitionDigest:state.definitionDigest,wallTime:observation.wallTime,stamp:null};f.store.append(f.plan.sessionId,state.sequence,{...event,stamp:f.deps.bind(`${f.plan.sessionId}:${state.sequence+1}`,event)});}
        const failed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(failed.status).toBe('failed');expect(failed.history.at(-1)!.error).toContain('bucket');
    }finally{f.close();}
});
test('failed or missing native terminal skill evidence never qualifies a cohort wave',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        mutate(f.experimentPath,"UPDATE multi_agent_experiment_participant SET skill_run_json=NULL WHERE agent_id='ada'");
        const state=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(state.status).toBe('failed');expect(state.settled).toHaveLength(0);
    }finally{f.close();}
});
test('settled Phase 12 and native clock tampering invalidate historical reports',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        mutate(f.experimentPath,"UPDATE multi_agent_experiment SET seed='forged'");
        expect(()=>readLongExperimentReport(f.plan.sessionId,f.journalPath,f.deps)).toThrow('backing');
    }finally{f.close();}
});
test('hash-chain tail deletion, stale concurrent transitions and future schemas are rejected',async()=>{
    const f=await fixture();try{const state=await startLongExperiment(f.plan,f.store,f.deps);f.at(1);stopLongExperiment(f.plan.sessionId,f.store,f.deps,'Explicit test stop');
        expect(()=>f.store.append(f.plan.sessionId,state.sequence,{kind:'stopped',definitionDigest:state.definitionDigest,wallTime:wall(1),stamp:null,error:'stale'})).toThrow('changed');
        mutate(f.journalPath,'DELETE FROM long_experiment_event WHERE sequence=2');expect(()=>f.store.get(f.plan.sessionId)).toThrow('tail');
        mutate(f.journalPath,'PRAGMA user_version=2');expect(()=>new LongExperimentStore(f.journalPath)).toThrow('schema');
    }finally{f.close();}
});
test('missing native sources and read-only missing reports create neither a world clock nor a journal',async()=>{
    const f=await fixture();try{const missing=join(f.directory,'absent.sqlite');expect(()=>readLongExperimentBinding(f.plan,{...f.paths,genesisPath:missing})).toThrow();
        expect(readLongExperimentReport('absent',missing,f.deps)).toMatchObject({status:'unavailable'});expect(existsSync(missing)).toBeFalse();
    }finally{f.close();}
});
test('finite plan validation rejects tiny evaluation windows, unbounded waves and invalid bucket/cadence/deadline settings',async()=>{
    const f=await fixture();try{for(const changes of [{evaluationSimulationMilliseconds:1000},{cadenceSimulationMilliseconds:1},{bucketSimulationMilliseconds:5000},
        {maximumWallMilliseconds:0},{sessionId:'bad_identifier'},{evaluationSimulationMilliseconds:365*86400000,cadenceSimulationMilliseconds:60000}])
            expect(()=>validateLongExperimentPlan({...f.plan,...changes})).toThrow();
    }finally{f.close();}
});
test('local experiment HTTP client refuses remote origins and never forwards credentials through redirects',async()=>{
    expect(()=>localExperimentClient('https://example.com','secret')).toThrow('local/private');expect(()=>localExperimentClient('http://localhost:7780/path','secret')).toThrow();
    let seen:RequestInit|undefined;const client=localExperimentClient('http://127.0.0.1:7780','token',async(_url,options)=>{seen=options;return Response.json({ok:true});});
    await client('/api/admin/multi-agent-experiments/environment');expect(seen!.redirect).toBe('error');expect((seen!.headers as Record<string,string>)['X-Admin-Token']).toBe('token');
});

test('a second long program cannot own the same world clock concurrently',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);
        await expect(startLongExperiment({...f.plan,sessionId:'competing-run'},f.store,f.deps)).rejects.toThrow('owns this world clock');
        expect(f.store.get('competing-run')).toBeNull();expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
test('Phase 12 replay reuses a committed cohort, while a different running cohort cannot share its agents',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);const state=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        await f.deps.startWave(state.active!,state.definition);expect(f.submitted()).toBe(4);
        await expect(startMultiAgentExperiment({...state.active!.input,label:'Overlapping manual cohort'},f.phaseDeps,wall(0))).rejects.toThrow('running cohort');
        expect(f.submitted()).toBe(4);
    }finally{f.close();}
});
test('a claimed wave without a native row can safely resume with the same identity, and unresolved waves have finite deadlines',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);const original=f.deps.startWave;f.deps.startWave=async()=>{throw new Error('Before POST');};
        await expect(stepLongExperiment(f.plan.sessionId,f.store,f.deps)).rejects.toThrow('Before POST');const claim=f.store.get(f.plan.sessionId)!.active!;
        expect(f.deps.getWave(claim.experimentId)).toBeNull();f.deps.startWave=original;f.at(1);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        expect(f.submitted()).toBe(4);expect(f.store.get(f.plan.sessionId)!.active!.experimentId).toBe(claim.experimentId);
        f.at(31);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(61);
        expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');expect(f.submitted()).toBe(4);
    }finally{f.close();}
});
test('removing native clock backing invalidates a report even if the local journal hash chain is intact',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);mutate(f.paths.clockPath,"DELETE FROM simulation_event_stamp WHERE domain='society-long-run'");
        expect(()=>readLongExperimentReport(f.plan.sessionId,f.journalPath,f.deps)).toThrow();
    }finally{f.close();}
});
test('an unresolved integrity operation withholds new dispatch, then native contamination fails the program',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);const binding=f.deps.binding;
        f.deps.binding=plan=>({...binding(plan),integrityResolved:false});f.at(10);
        const waiting=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(waiting.status).toBe('running');expect(waiting.history.at(-1)!.unresolvedIntegrity).toBeTrue();expect(f.submitted()).toBe(0);
        f.deps.binding=binding;mutate(f.paths.integrityPath,"UPDATE integrity_run SET invalidated=1");
        expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
test('journal insertion failure rolls back its head and claim, leaving no native execution from an orphan clock stamp',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);
        mutate(f.journalPath,"CREATE TRIGGER reject_claim BEFORE INSERT ON long_experiment_event WHEN NEW.sequence=2 BEGIN SELECT RAISE(ABORT,'forced journal failure'); END");
        await expect(stepLongExperiment(f.plan.sessionId,f.store,f.deps)).rejects.toThrow('forced journal failure');
        expect(f.store.get(f.plan.sessionId)!.sequence).toBe(1);expect(f.store.get(f.plan.sessionId)!.active).toBeNull();expect(f.submitted()).toBe(0);
    }finally{f.close();}
});
test('warmup terminal waves are retained but never counted as contained evaluation evidence',async()=>{
    const f=await fixture();try{await startLongExperiment({...f.plan,warmupSimulationMilliseconds:3600000},f.store,f.deps);
        await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();const state=await stepLongExperiment(f.plan.sessionId,f.store,f.deps),report=reportLongExperiment(state);
        expect(state.settled).toHaveLength(1);expect(report.buckets.every(row=>!row.observedCompleteCohortWave)).toBeTrue();
        expect(Date.parse(report.buckets[0]!.fromSimulationTime)-Date.parse(state.started.simulationTime)).toBe(3600000);
    }finally{f.close();}
});
test('a paused native clock starts no new wave and cannot evade the finite wall deadline',async()=>{
    const f=await fixture();try{await startLongExperiment({...f.plan,maximumWallMilliseconds:3600000},f.store,f.deps);
        const clock=new SimulationClockStore(f.paths.clockPath);try{clock.pause('world',clock.get('world')!.revision,wall(0));}finally{clock.close();}
        f.at(10);expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('running');expect(f.submitted()).toBe(0);
        f.at(61);const failed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(failed.status).toBe('failed');expect(failed.history.at(-1)!.error).toContain('wall deadline');
    }finally{f.close();}
});
test('a concurrent native clock observation uses the actual commit envelope rather than an earlier wall label',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);const bind=f.deps.bind;
        f.deps.bind=(id,event)=>{f.at(1);return bind(id,{...event,wallTime:wall(1)});};
        const claimed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(claimed.active!.stamp.wallTime).toBe(wall(1));
        expect(f.deps.getWave(claimed.active!.experimentId)!.startedAt).toBe(wall(1));expect(f.submitted()).toBe(4);
    }finally{f.close();}
});
test('the production runtime reads batched native clock and Phase 12 backing without migrating or redispatching',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();await stepLongExperiment(f.plan.sessionId,f.store,f.deps);
        let requests=0;const deps=nativeLongExperimentDependencies(f.paths,async()=>{requests++;throw new Error('Report must not contact the live gateway');},f.experimentPath);
        const report=readLongExperimentReport(f.plan.sessionId,f.journalPath,deps);
        expect(report).toMatchObject({status:'running',economicAssessment:'unassessed'});expect(requests).toBe(0);expect(f.submitted()).toBe(4);
        mutate(f.paths.clockPath,"UPDATE simulation_event_stamp SET source_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE domain='society-long-run' AND source_id='long-test:1'");
        expect(()=>readLongExperimentReport(f.plan.sessionId,f.journalPath,deps)).toThrow('clock backing');
    }finally{f.close();}
});
test('a terminal journal from another avatar cannot qualify the native founder wave',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        mutate(f.experimentPath,"UPDATE multi_agent_experiment_participant SET skill_run_json=json_set(skill_run_json,'$.username','other') WHERE agent_id='ada'");
        expect((await stepLongExperiment(f.plan.sessionId,f.store,f.deps)).status).toBe('failed');
    }finally{f.close();}
});
test('a native finish timestamp before wave start cannot become contained evaluation evidence',async()=>{
    const f=await fixture();try{await startLongExperiment(f.plan,f.store,f.deps);await stepLongExperiment(f.plan.sessionId,f.store,f.deps);f.at(1);f.finish();
        mutate(f.experimentPath,"UPDATE multi_agent_experiment SET finished_at='2029-12-31T23:59:00.000Z'");
        const failed=await stepLongExperiment(f.plan.sessionId,f.store,f.deps);expect(failed.status).toBe('failed');expect(failed.settled).toHaveLength(0);
    }finally{f.close();}
});
