import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,rmSync,readFileSync,cpSync,mkdirSync,copyFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { WorldGenesisRunStore } from '../../world-genesis/run-store.js';
import { SocietyIntegrityStore } from '../../society-integrity/store.js';
import { buildWorldGenesisResult } from '../../world-genesis/result.js';
import { loadWorldGenesisProfileCatalog } from '../../world-genesis/config.js';
import { resolvePopulationGenesis } from '../../population-lifecycle/genesis.js';
import { loadPopulationLifecyclePolicyCatalog,loadPopulationWorldProfileBindingCatalog } from '../../population-lifecycle/config.js';
import { createPopulationDeathEvidence } from '../../population-lifecycle/death.js';
import { loadPopulationAgePolicy } from '../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy } from '../../population-lifecycle/mortality.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { reportNativeOutcomes,type NativeOutcomeOptions } from '../native-outcomes.js';
import { projectNativeMinimumAssessment } from '../minimum-assessment.js';
import { reportSocietyEvaluation } from '../evaluation-report.js';
import { nativeIntegrationOptions,readWealthBoundary } from '../integration-sources.js';
import { FoodNeedsPersistence } from '../../food-loop/needs-persistence.js';
import { populationNeedsBinding } from '../../needs/population-binding.js';
import { loadFoodLoopCatalog } from '../../food-loop/catalog.js';
import { NativeFoodConsumptionStore,foodDigest,FOOD_POLICY } from '../../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore,type FoodProductionAction } from '../../server/engine/src/mods/NativeFoodProductionStore.js';
import { NativeFoodSource } from '../../food-loop/native-source.js';
import { ProductionWorkInProgressStore,loadDefaultProductionWorkflowCatalog } from '../../production-workflow/index.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { closeFoodDeliveryTick } from '../../server/engine/src/mods/NativeFoodDeliveryStore.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { BusinessAssetStore } from '../../business-assets/store.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { PlayerInventoryEscrowStore } from '../../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { createSaveData } from '../../sdk/test/utils/save-generator.js';
import {readNativeFoodBoundary,type NativeFoodBoundaryPaths} from '../food-boundaries.js';
import { PropertyStore } from '../../server/engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { NativeRentCoordinator } from '../../housing/native-rent-runtime.js';
import { nativeHousingCatalogs,initializeRentJournal,writeRentJournal,rentIds } from '../../housing/native-rent.js';
import { readHousingAccessPoint,type NativeHousingBoundaryPaths } from '../housing-access.js';
import { NativeToolStore,nativeToolDigest,nativeToolCatalog,nativeToolCycles } from '../../item-lifecycle/native-tool.js';
import { ItemRepairService,loadItemRepairPolicyCatalog } from '../../item-lifecycle/repair-policy.js';
import { validateCompetenceSnapshot } from '../../character-attributes/index.js';
import { readNativeToolCapacityBoundary } from '../tool-capacity.js';
import { NativeMortalityCoverageStore,nativeMortalityActor,type MortalityCoverageSelection } from '../../population-lifecycle/native-coverage.js';
import { recordNativeMortalityPass } from '../../population-lifecycle/native-observer.js';
import { admitNaturalPopulationDeaths } from '../../server/engine/src/mods/PopulationDeathRuntime.js';
import { readNativeMortalityCoverage } from '../mortality-coverage.js';
import { NativeLifecycleAttemptStore,type LifecycleAttemptEvent } from '../../population-lifecycle/native-attempts.js';
import { readNativeLifecycleAttempts } from '../lifecycle-attempts.js';
import { NativeLifecycleWatermarkStore,type LifecycleWatermarkSample } from '../../population-lifecycle/native-watermarks.js';
import { readNativeLifecycleWatermarks } from '../lifecycle-watermarks.js';
import { NativeLifecyclePolicyStore,type LifecyclePolicySample } from '../../population-lifecycle/native-policy.js';
import { lifecycleRouteManifest,lifecyclePolicyFiles } from '../../population-lifecycle/native-policy-manifest.js';
import { readNativeLifecyclePolicy } from '../lifecycle-policy.js';
import { PolicyMutationStore } from '../../population-lifecycle/policy-mutations.js';
import { pinPolicyEnvironment } from '../../population-lifecycle/policy-environment.js';
import { withPolicyMutationObservation,beginPolicyMutation,policyMutationJournalPath } from '../../population-lifecycle/policy-mutation-observer.js';
import { readNativePolicyMutations } from '../policy-mutations.js';
import { updateWorldDirectorConfig } from '../../server/gateway/admin/world-director-runtime.js';
import {WorldPolicyRuntimeStore,createWorldPolicyRuntimeContract,captureWorldPolicyRuntime,observeWorldPackedReload,recordWorldPolicyRuntime} from '../../population-lifecycle/world-policy-runtime.js';
import {readNativeWorldPolicy} from '../world-policy.js';
import {readNativeLifecycleEnforcement} from '../lifecycle-enforcement.js';
import {policyProcessSessionId} from '../../population-lifecycle/policy-process.js';
import {integrityCoverageCursor} from '../../society-integrity/coverage.js';
import {withSocietyValueMutation} from '../../society-integrity/runtime.js';
import {readNativeAdministrativeValue} from '../administrative-value.js';
import {readNativeFounderBaseline} from '../population-outcomes.js';
import {bindSocietyInternalPayment} from '../../server/gateway/admin/society-integrity.js';
import {PlayerRewardStore} from '../../server/engine/src/mods/PlayerRewardStore.js';

const directories:string[]=[],configDirectory=join(import.meta.dir,'../../config'),initial='2001-01-01T00:00:00.000Z',wall='2030-01-01T00:00:00.000Z';
const contract=loadSocietyMinimumContract(configDirectory),age=loadPopulationAgePolicy(join(configDirectory,'population-age-policy.json')),
    mortality=loadPopulationMortalityPolicy(join(configDirectory,'population-mortality-policy.json'));
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function mutate(path:string,sql:string){const db=new OwnedDatabase(path);try{db.run(sql);}finally{db.close(true);}}
function fixture(fullPolicy=false){
    const root=mkdtempSync(join(tmpdir(),'native-founders-'));directories.push(root);
    const agentPath=join(root,'agents.sqlite'),clockPath=join(root,'clock.sqlite'),genesisPath=join(root,'genesis.sqlite'),
        integrityPath=join(root,'integrity.sqlite'),healthPath=join(root,'health.sqlite');
    const clock=new SimulationClockStore(clockPath),created=clock.create({clockId:'world',
        profile:{schemaVersion:1,profileId:'population-fixture',version:'1.0.0',seed:'population',rate:{simulationMilliseconds:fullPolicy?3600000:1,wallMilliseconds:fullPolicy?600:1}},wallTime:wall,simulationTime:initial});
    const profile=loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json')).profiles.find(p=>p.profileId==='mature-society')!;
    const founders=['ada','bea','cora','dora'].map(agentId=>({agentId,playerUsername:agentId}));
    const result=buildWorldGenesisResult({schemaVersion:1,seed:'population',profile:{profileId:profile.profileId,version:profile.version,digest:profile.digest},
        worldBuild:'local-private-fixture',simulationClock:{clockId:'world',profileDigest:created.profileDigest,initialSimulationTime:initial},parameters:{}},
        {assets:[],populationMembers:founders},wall);
    const genesis=new WorldGenesisRunStore(genesisPath);try{const begun=genesis.begin(result,{},wall);genesis.finishApply(result.resultId,begun.revision,{fixture:true},wall);}finally{genesis.close();}
    const integrity=new SocietyIntegrityStore(integrityPath);try{integrity.begin(result,true);integrity.finishBootstrap(result.resultId);}finally{integrity.close();}
    const resolved=resolvePopulationGenesis(result,loadWorldGenesisProfileCatalog(join(configDirectory,'world-genesis-profiles.json')),
        loadPopulationLifecyclePolicyCatalog(join(configDirectory,'population-lifecycle-policies.json')),loadPopulationWorldProfileBindingCatalog(join(configDirectory,'population-world-profile-bindings.json')));
    const agents=new AgentStateStore(agentPath,{store:clock,clockId:'world'}),health=new PlayerHealthEvidenceStore(healthPath);
    try{for(const founder of founders){agents.createIdentity({...founder,displayName:founder.agentId,background:'Local native founder fixture',personalityTraits:['steady']},wall);
        const member=agents.bindPopulationMember({...founder,worldProfile:result.profile,
            lifecyclePolicy:{policyId:resolved.policy!.policyId,version:resolved.policy!.version,digest:resolved.policy!.digest,kind:'finite'},
            simulationClock:{clockId:'world',profileDigest:created.profileDigest},joinedAtSimulationTime:initial,sourceResultId:result.resultId,sourceResultDigest:result.resultDigest},wall);
        health.bindFiniteAvatar(member);
    }}finally{health.close();agents.close();clock.close();}
    const scope={clockId:'world',clockProfileDigest:created.profileDigest,actorAgentIds:founders.map(f=>f.agentId),
        fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
    const options:NativeOutcomeOptions={workspace:root,worldId:'fixture',agentPath,clockPath,allowedActorAgentIds:scope.actorAgentIds,allowedObserverAgentIds:[],
        population:{genesisPath,integrityPath,healthPath,configDirectory,genesisResultId:result.resultId,genesisResultDigest:result.resultDigest}};
    const kill=(at:string,project=false)=>{
        const clock=new SimulationClockStore(clockPath),agents=new AgentStateStore(agentPath,{store:clock,clockId:'world'}),health=new PlayerHealthEvidenceStore(healthPath);
        try{const observation=clock.observe('world',new Date(Date.parse(wall)+Date.parse(at)-Date.parse(initial)).toISOString(),42),id='10000000-0000-4000-8000-000000000001';
            const event=createPopulationDeathEvidence(agents.getPopulationMember('ada')!,observation,age,mortality,{damageEventId:id,sessionId:'session',engineTick:42});
            health.record({username:'ada',sessionId:'session',engineTick:42,occurredAt:observation.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},id,event);
            if(project){const reader=new PlayerHealthEvidenceStore(healthPath,true);try{agents.consumePopulationDeath(reader,event.eventId,age,mortality);}finally{reader.close();}}
        }finally{health.close();agents.close();clock.close();}
    };
    const outcomes=()=>reportNativeOutcomes(scope,options),report=()=>projectNativeMinimumAssessment(contract,scope,outcomes());
    const hashes=()=>[agentPath,clockPath,genesisPath,integrityPath,healthPath].map(p=>createHash('sha256').update(readFileSync(p)).digest('hex'));
    return{root,scope,options,agentPath,healthPath,genesisPath,integrityPath,clockPath,kill,outcomes,report,hashes};
}
const rule=(r:ReturnType<typeof projectNativeMinimumAssessment>,id:string)=>r.assessment!.requirements.find(v=>v.requirementId===id)!;
const expectOnlyFrozenRosterGate=(r:ReturnType<typeof projectNativeMinimumAssessment>)=>expect(r.integrity.map(g=>({gateId:g.gateId,verdict:g.verdict})))
    .toEqual(contract.policy.integrityGates.map(gateId=>({gateId,verdict:gateId==='frozen-founder-roster'?'pass':'inconclusive'})));

function mortalityFixture(fullPolicy=false){
    const f=fixture(fullPolicy),checkpointPath=join(f.root,'server/engine/data/mortality.sqlite');mkdirSync(join(f.root,'server/engine/data'),{recursive:true});
    f.options.checkpointPath=checkpointPath;const db=new OwnedDatabase(checkpointPath),health=new PlayerHealthEvidenceStore(f.healthPath),
        clock=new SimulationClockStore(f.clockPath),agents=new AgentStateStore(f.agentPath,{store:clock,clockId:'world'});
    for(const m of agents.listPopulationMembers())agents.setCharacterBirth(m.agentId,m.characterLifecycle.revision,initial,'born',wall);
    const members=agents.listPopulationMembers(),
        actors=members.map(nativeMortalityActor),scope=fullPolicy?f.scope:{...f.scope,fromSimulationTime:initial,toSimulationTime:'2001-01-01T00:00:01.200Z'},
        selection:MortalityCoverageSelection={schemaVersion:1,selectionId:randomUUID(),worldId:'fixture',clockId:'world',clockProfileDigest:f.scope.clockProfileDigest,
            fromSimulationTime:initial,toSimulationTime:scope.toSimulationTime,maximumSimulationGapMs:fullPolicy?3600000:1200,maximumWallGapMs:1200,agePolicyDigest:age.digest,
            mortalityPolicyDigest:mortality.digest,survivalSelectionDigest:null,actors,openingHealthHeads:health.coverageHeads()},store=new NativeMortalityCoverageStore(db,selection);
    const sample=(n:number,session='fixture-session',subset=members)=>{const c=clock.observe('world',new Date(Date.parse(wall)+n*600).toISOString(),n);
        admitNaturalPopulationDeaths(agents,c,health,age,mortality);recordNativeMortalityPass(db,'fixture',session,c,subset,health,age.digest,mortality.digest,null);};
    return{...f,db,health,agents,clock,store,actors,scope,sample,selection,read:()=>readNativeMortalityCoverage(db,scope,f.options,initial,actors),
        close(){agents.close();health.close();clock.close();db.close(true);}};
}
test('prospective mortality observes all original offline members through actual native passes and rereads a frozen checkpoint without writes',()=>{
    const f=mortalityFixture();try{f.sample(0);f.sample(1);f.sample(2);const before=f.db.serialize(),r=f.read();
        expect(r.completeMortalityTickCoverage).toBeTrue();expect(r.completeLifecycleEnforcement).toBeFalse();expect(r.sampleCount).toBe(3);expect(r.gaps).toEqual([]);
        expect(f.db.serialize()).toEqual(before);const path=join(f.root,'server/engine/data/mortality-offline.sqlite');writeFileSync(path,before);
        const offline=new OwnedDatabase(path,{readonly:true});try{expect(readNativeMortalityCoverage(offline,f.scope,f.options,initial,f.actors)).toEqual(r);}finally{offline.close(true);}
        const outcomes=reportNativeOutcomes(f.scope,f.options);expect(outcomes.sources.mortalityCoverage.status).toBe('available');
        if(outcomes.sources.mortalityCoverage.status==='available')expect(outcomes.sources.mortalityCoverage.value.completeMortalityTickCoverage).toBeTrue();
        expectOnlyFrozenRosterGate(f.report());
    }finally{f.close();}
});
test('prospective mortality never bridges missing ticks, restart, lost roster, failed writes or a mismatched original cohort',()=>{
    for(const variant of ['missing','restart','roster','write','cohort','birth']){const f=mortalityFixture();try{
        f.sample(0);
        if(variant==='write')f.db.run("CREATE TRIGGER fail_mortality BEFORE INSERT ON native_mortality_event BEGIN SELECT RAISE(ABORT,'injected');END");
        const noBirth=f.agents.listPopulationMembers().map(m=>({...m,characterLifecycle:{...m.characterLifecycle,birthAtSimulationTime:null}}));
        if(variant!=='missing')f.sample(1,variant==='restart'?'other':'fixture-session',variant==='roster'?[]:variant==='birth'?noBirth:undefined);
        if(variant==='write')f.db.run('DROP TRIGGER fail_mortality');f.sample(2);
        const r=variant==='cohort'?readNativeMortalityCoverage(f.db,f.scope,f.options,initial,[{...f.actors[0]!,lifecycleId:'f'.repeat(64)},...f.actors.slice(1)]):f.read();
        expect(r.completeMortalityTickCoverage).toBeFalse();expect(r.completeLifecycleEnforcement).toBeFalse();expect(r.gaps.length).toBeGreaterThan(0);
    }finally{f.close();}}
});

test('prospective mortality own schema/selection/audit reopen and rollback stay independent of shared user_version; gaps never erase a native founder death',()=>{
    const f=mortalityFixture();try{f.db.run('PRAGMA user_version=42');f.sample(0);f.sample(1);f.sample(2);
        new NativeMortalityCoverageStore(f.db,f.selection);expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});
        const before=f.db.serialize(),entry=f.store.read().entries.at(-1)!.sample;
        expect(()=>f.db.transaction(()=>{f.store.append({...entry,clock:{...entry.clock,engineTick:3}});throw Error('rollback');}).immediate()).toThrow('rollback');
        expect(f.db.serialize()).toEqual(before);expect(()=>new NativeMortalityCoverageStore(f.db,{...f.selection,worldId:'other'})).toThrow('differs');
        expect(()=>f.db.run('DELETE FROM native_mortality_event WHERE sequence=2')).toThrow('immutable');
        f.db.run('DROP TRIGGER mortality_event_no_delete');f.db.run('DELETE FROM native_mortality_event WHERE sequence=2');expect(f.read).toThrow('chain');
        f.kill('2001-01-03T00:00:00.000Z');expect(f.report().verdict).toBe('fail');
        expectOnlyFrozenRosterGate(f.report());
    }finally{f.close();}
});

test('native lifecycle parsing and terminal rejections remain observations; actual post-death admission yields a scoped integrity FAIL',()=>{
    const f=mortalityFixture();try{
        const store=new NativeLifecycleAttemptStore(f.db,true);f.sample(0);f.kill('2001-01-01T00:00:00.600Z');
        const c=f.clock.observe('world',new Date(Date.parse(wall)+600).toISOString(),42),actor=f.actors.find(a=>a.actorId==='ada')!,
            authority={actor,clock:c,healthHeads:f.health.coverageHeads(),deathEventId:f.health.deathFor('ada')!.eventId,restricted:true},
            emit=(kind:LifecycleAttemptEvent['kind'],outcome:NonNullable<LifecycleAttemptEvent['outcome']>,context:LifecycleAttemptEvent['authority']=authority)=>{
                const begin:LifecycleAttemptEvent={attemptId:randomUUID(),sessionId:'native',username:'ada',kind,phase:'begin',wallTime:c.wallTime,authority:context,
                    vitals:{hitpoints:10,terminal:false,finite:true},scriptName:null,outcome:null,scriptState:null};
                store.append(begin);store.append({...begin,phase:'result',outcome});return begin;};
        emit('load','parsed');emit('login-guard','blocked-restricted');
        const read=()=>readNativeLifecycleAttempts(f.db,f.scope,f.options,initial,f.actors);
        expect(read().violations).toEqual([]);expect(read().completeLifecycleEnforcement).toBeFalse();
        const admitted=emit('world-admission','admitted');store.fault();expect(read().violations[0]).toMatchObject({attemptId:admitted.attemptId,reason:'native-terminal-avatar-admitted-or-respawned'});
        const result=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));
        expect(result.verdict).toBe('fail');expect(result.integrity.find(g=>g.gateId==='finite-lifecycle-no-respawn')!.verdict).toBe('fail');
        expect(result.qualifiesMinimum).toBeFalse();
        const frozen=join(f.root,'server/engine/data/lifecycle-offline.sqlite');writeFileSync(frozen,f.db.serialize());const offline=new OwnedDatabase(frozen,{readonly:true});
        try{expect(readNativeLifecycleAttempts(offline,f.scope,f.options,initial,f.actors)).toEqual(read());}finally{offline.close(true);}
        const foreign={...f.scope,clockId:'foreign'},mismatch=projectNativeMinimumAssessment(contract,foreign,reportNativeOutcomes(f.scope,f.options));
        expect(mismatch.lifecycleIntegrityViolations).toEqual([]);
    }finally{f.close();}
});

test('native lifecycle missing results, unknown or stale authority and altered identities never become confirmed admissions; own audit stays immutable',()=>{
    const f=mortalityFixture();try{const store=new NativeLifecycleAttemptStore(f.db,true);f.db.run('PRAGMA user_version=42');f.sample(0);
        const begin:LifecycleAttemptEvent={attemptId:randomUUID(),sessionId:'native',username:'ada',kind:'load',phase:'begin',wallTime:wall,
            authority:null,vitals:null,scriptName:null,outcome:null,scriptState:null};store.append(begin);
        expect(()=>store.append({...begin,attemptId:randomUUID(),phase:'result',outcome:'parsed'})).toThrow('lacks begin');
        expect(()=>f.db.transaction(()=>{store.append({...begin,attemptId:randomUUID()});throw Error('rollback');}).immediate()).toThrow('rollback');
        const read=()=>readNativeLifecycleAttempts(f.db,f.scope,f.options,initial,f.actors);
        expect(read().attempts[0]!.status).toBe('unproven');expect(read().violations).toEqual([]);
        store.append({...begin,phase:'result',outcome:'parsed'});expect(read().attempts[0]!.status).toBe('unproven');
        expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});
        const c=f.store.read().entries[0]!.sample.clock;
        for(const variant of ['foreign','stale']){const e={...begin,attemptId:randomUUID(),kind:'world-admission' as const,
            wallTime:variant==='stale'?new Date(Date.parse(wall)+5000).toISOString():wall,
            authority:{actor:variant==='foreign'?{...f.actors[0]!,lifecycleId:'f'.repeat(64)}:f.actors[0]!,clock:c,healthHeads:f.health.coverageHeads(),deathEventId:null,restricted:false}};
            store.append(e);store.append({...e,phase:'result',outcome:'admitted'});}
        expect(read().attempts.every(a=>a.status==='unproven')).toBeTrue();expect(read().violations).toEqual([]);
        expect(()=>f.db.run('DELETE FROM native_lifecycle_event WHERE sequence=1')).toThrow('immutable');
        f.db.run('DROP TRIGGER lifecycle_event_no_delete');f.db.run('DELETE FROM native_lifecycle_event WHERE sequence=1');expect(read).toThrow('chain');
        f.kill('2001-01-03T00:00:00.000Z');expect(f.report().verdict).toBe('fail');
    }finally{f.close();}
});

function watermarkFixture(fullPolicy=false){const f=mortalityFixture(fullPolicy),attempts=new NativeLifecycleAttemptStore(f.db,true),store=new NativeLifecycleWatermarkStore(f.db,true);
    const frame=(stage:LifecycleWatermarkSample['stage'],change:Partial<LifecycleWatermarkSample>={})=>{
        const row=f.db.query('SELECT payload FROM native_mortality_event ORDER BY sequence DESC LIMIT 1').get() as {payload:string},
            c=JSON.parse(row.payload).clock as LifecycleWatermarkSample['clock'],mortalityHead=f.db.query('SELECT sequence,digest FROM native_mortality_head WHERE singleton=1').get() as LifecycleWatermarkSample['mortalityHead'],cursor=attempts.cursor();
        const sample:LifecycleWatermarkSample={sessionId:'watermark-session',clock:c,wallTime:c.wallTime,stage,mortalityHead,
            attemptHead:cursor.head,attemptFaultCount:cursor.faultCount,actors:f.actors.map(actor=>({username:actor.username,
                authority:{actor,clock:c,healthHeads:f.health.coverageHeads(),deathEventId:f.health.deathFor(actor.username)?.eventId??null,restricted:!!f.health.deathFor(actor.username)}})),avatars:[],...change};
        store.append(sample);return sample;};
    const attempt=(sample:LifecycleWatermarkSample,finish=true,authority=sample.actors[0]!.authority)=>{const e:LifecycleAttemptEvent={
        attemptId:randomUUID(),sessionId:sample.sessionId,username:'ada',kind:'load',phase:'begin',wallTime:sample.wallTime,authority,vitals:null,scriptName:null,outcome:null,scriptState:null};
        attempts.append(e);if(finish)attempts.append({...e,phase:'result',outcome:'parsed'});return e;};
    return{...f,attempts,watermarks:store,frame,attempt,readWatermarks:()=>readNativeLifecycleWatermarks(f.db,f.scope,f.options,initial,f.actors)};
}

function policyFixture(fullPolicy=false){const f=watermarkFixture(fullPolicy),root=join(import.meta.dir,'../..'),manifest=lifecycleRouteManifest(root),
    snapshot=()=>({clock:f.clock.get('world')!,effective:{agePolicyDigest:age.digest,mortalityPolicyDigest:mortality.digest,bindingsDigest:'a'.repeat(64),
        survivalDigest:null,modsDigest:'b'.repeat(64)},sources:manifest.sources,files:lifecyclePolicyFiles(root)}),
    pin={manifest,opening:snapshot()},store=new NativeLifecyclePolicyStore(f.db,pin);
    const emit=(stage:LifecyclePolicySample['stage'],changes:Partial<LifecyclePolicySample>={},withCensus=true,census:Partial<LifecycleWatermarkSample>={})=>{
        if(withCensus)f.frame(stage,{...changes.sessionId?{sessionId:changes.sessionId}:{},...census});
        const row=f.db.query('SELECT payload FROM native_mortality_event ORDER BY sequence DESC LIMIT 1').get() as {payload:string},position=JSON.parse(row.payload).clock as LifecyclePolicySample['position'],
            mortalityHead=f.db.query('SELECT sequence,digest FROM native_mortality_head WHERE singleton=1').get() as LifecyclePolicySample['mortalityHead'],
            watermarkHead=f.db.query('SELECT sequence,digest FROM native_lifecycle_watermark_head WHERE singleton=1').get() as LifecyclePolicySample['watermarkHead'];
        const sample:LifecyclePolicySample={sessionId:'watermark-session',worldId:'fixture',position,wallTime:position.wallTime,stage,mortalityHead,
            watermarkHead,bootManifest:manifest,snapshot:snapshot(),...changes};store.append(sample);return sample;};
    return{...f,policyStore:store,pin,snapshot,emit,readPolicy:()=>readNativeLifecyclePolicy(f.db,f.scope,f.options,initial,f.actors)};
}

function mutationFixture(strict=false,fullPolicy=false,roles:Array<'engine'|'gateway'>=['engine','gateway']){const f=policyFixture(fullPolicy),path=policyMutationJournalPath(f.root);mkdirSync(join(f.root,'.local/society-metrics'),{recursive:true});
    const db=new OwnedDatabase(path),pkg=readFileSync(join(import.meta.dir,'../../package.json')),
        sourceFiles=[...new Set(['package.json',...f.pin.manifest.sources.map(p=>p.path),...strict?['bun.lock','server/engine/bun.lock','server/gateway/bun.lock']:[]])],
        files=strict?[...sourceFiles,...f.pin.opening.files.filter(p=>p.sha256!==null).map(p=>p.path)].map(path=>{
            const bytes=readFileSync(join(import.meta.dir,'../..',path)),target=join(f.root,path);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,bytes);
            return{path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}):[
            ...f.pin.manifest.sources.map(p=>({path:p.path,size:p.bytes!,sha256:p.sha256!})),{path:'package.json',size:pkg.length,sha256:createHash('sha256').update(pkg).digest('hex')},
            ],pack=join(f.root,'server/engine/data/pack/server/script.dat');
    if(strict){mkdirSync(join(pack,'..'),{recursive:true});writeFileSync(pack,new Uint8Array([0]));}
    const environment=pinPolicyEnvironment({sourceFiles,files:[...files,{path:'server/engine/data/pack/server/script.dat',size:1,sha256:strict?createHash('sha256').update(new Uint8Array([0])).digest('hex'):'a'.repeat(64)}]},
            {bunVersion:Bun.version,platform:process.platform},strict),runtimeContract=strict?createWorldPolicyRuntimeContract(environment,{engine:{},gateway:{}}):undefined,
        store=new PolicyMutationStore(db,{schemaVersion:1,worldId:'fixture',clockId:f.scope.clockId,clockProfileDigest:f.scope.clockProfileDigest,fromSimulationTime:initial,
            toSimulationTime:f.scope.toSimulationTime,maximumWallGapMs:1200,policySelectionDigest:nativeToolDigest(f.policyStore.selection().selection),environment,
            ...(runtimeContract?{worldPolicyRuntimeContractDigest:nativeToolDigest(runtimeContract)}:{})});
    const runtime=runtimeContract?new WorldPolicyRuntimeStore(db,runtimeContract):null;
    const boot=(role:'engine'|'gateway',env:Record<string,string|undefined>={})=>{const c=f.clock.get('world')!;
        const witness=captureWorldPolicyRuntime(f.root,role,db,{worldId:'fixture',sessionId:role==='engine'?policyProcessSessionId:'gateway-fixture-session',clock:{clockId:c.clockId,profileDigest:c.profileDigest,status:c.status,
            simulationTime:c.lastSimulationTime,wallTime:c.lastObservedWallTime,revision:c.revision,engineTick:null},wallTime:c.lastObservedWallTime,env,bunVersion:Bun.version,platform:process.platform});runtime!.append(witness);return witness;};
    if(strict)for(const role of roles)boot(role);
    f.options.policyMutationsPath=path;
    const ports={db,worldId:'fixture',clock:()=>f.store.read().entries.at(-1)!.sample.clock,wallTime:()=>f.store.read().entries.at(-1)!.sample.clock.wallTime},
        emit=(stage:LifecyclePolicySample['stage'],change:Partial<LifecyclePolicySample>={},census:Partial<LifecycleWatermarkSample>={})=>f.emit(stage,{...strict?{sessionId:policyProcessSessionId}:{},mutationCursor:store.cursor(),...change},true,census);
    return{...f,mutationDb:db,mutations:store,mutationPath:path,mutationPorts:ports,emitMutationFrame:emit,runtime,runtimeContract,boot,
        readWorldPolicy:()=>readNativeWorldPolicy(f.db,f.scope,f.options,initial,f.actors),
        readMutations:()=>readNativePolicyMutations(f.db,f.scope,f.options,initial,f.actors),close(){db.close(true);f.close();}};
}

function administrativeFixture(full=false,legacy=false){const f=mutationFixture(true,full),runId=f.options.population!.genesisResultId;
    if(legacy){const original=new SocietyIntegrityStore(f.options.population!.integrityPath,true),result=original.report(runId).run.result;original.close();
        f.options.population!.integrityPath=join(f.root,'.local/simulation/legacy-integrity.sqlite');const replacement=new SocietyIntegrityStore(f.options.population!.integrityPath);
        replacement.begin(result,true);replacement.recordCoverageGap(runId,{clockId:f.scope.clockId,profileDigest:f.scope.clockProfileDigest,simulationTime:initial,wallTime:wall});replacement.finishBootstrap(runId);replacement.close();}
    const path=f.options.population!.integrityPath,store=new SocietyIntegrityStore(path),
    cursor=()=>integrityCoverageCursor(store.coverageSnapshot(runId)),baseline=readNativeFounderBaseline(f.scope,{...f.options,population:f.options.population!}),
    emit=(stage:LifecyclePolicySample['stage'],change:Partial<LifecyclePolicySample>={})=>f.emitMutationFrame(stage,{administrativeValueCursor:cursor(),...change}),
    boundary={path,observe:()=>{const c=f.store.read().entries.at(-1)!.sample.clock;return{clockId:c.clockId,profileDigest:c.profileDigest,simulationTime:c.simulationTime,wallTime:c.wallTime};}},
    inject=(source:import('../../society-integrity/store.js').IntegritySource='engine.cheat-value',changed=true)=>withSocietyValueMutation({source,operationId:randomUUID(),actor:'player:ada',payload:{itemId:379,requestedCount:1}},()=>changed?1:0,boundary,r=>r>0);
    return{...f,integrity:store,runId,cursor,boundary,emitValue:emit,inject,readValue:()=>readNativeAdministrativeValue(f.db,f.scope,f.options,baseline,f.actors),close(){store.close();f.close();}};
}

test('administrative value original 1+7 native window reaches PASS with frozen read-only seals and no global minimum PASS',()=>{
    const f=administrativeFixture(true),start=performance.now();try{
        f.db.transaction(()=>{for(let n=0;n<=192;n++){f.sample(n);f.emitValue('after-terminal-guard');if(n===50)f.inject('engine.cheat-value',false);f.emitValue('end-of-tick');}}).immediate();
        console.error(`[AdminValueFullFrame] build ${Math.round(performance.now()-start)} ms`);
        const before=[f.db.serialize(),f.mutationDb.serialize(),f.hashes()],out=reportNativeOutcomes(f.scope,f.options),r=projectNativeMinimumAssessment(contract,f.scope,out);
        expect(out.sources.administrativeValue.status).toBe('available');expect(r.integrity.find(g=>g.gateId==='no-post-genesis-admin-or-fallback-value')!.verdict).toBe('pass');
        expect(r.sourceCoverage.rows.find(s=>s.sourceId==='administrative-value-history')!.status).toBe('complete');expect(r.qualifiesMinimum).toBeFalse();
        expect([f.db.serialize(),f.mutationDb.serialize(),f.hashes()]).toEqual(before);
        const path=join(f.root,'server/engine/data/admin-value-offline.sqlite');writeFileSync(path,f.db.serialize());const offline=new OwnedDatabase(path,{readonly:true});
        try{const baseline=readNativeFounderBaseline(f.scope,{...f.options,population:f.options.population!});expect(readNativeAdministrativeValue(offline,f.scope,f.options,baseline,f.actors)).toEqual(f.readValue());}finally{offline.close(true);}
        console.error(`[AdminValueFullFrame] total ${Math.round(performance.now()-start)} ms`);
    }finally{f.close();}
},15000);

test.each(['engine.cheat-value','engine.save-fallback','engine.offline-save','engine.player-reward','engine.debugproc','gateway.treasury-balance','gateway.treasury-genesis','gateway.business-stock-genesis'] as const)(
    'administrative value preserves a sealed native violation for %s even with unrelated policy evidence missing',source=>{
    const f=administrativeFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emitValue('after-terminal-guard');if(n===1)f.inject(source);f.emitValue('end-of-tick');}
        const r=f.readValue();expect(r.verdict).toBe('fail');expect(r.completeAdministrativeValueCoverage).toBeTrue();expect(r.violations[0]!.source).toBe(source);
        f.policyStore.fault();expect(f.readValue().verdict).toBe('fail');expect(f.readValue().completeAdministrativeValueCoverage).toBeFalse();
        const projected=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));expect(projected.integrity.find(g=>g.gateId==='no-post-genesis-admin-or-fallback-value')!.verdict).toBe('fail');
        expect(projectNativeMinimumAssessment(contract,{...f.scope,clockId:'foreign'},reportNativeOutcomes(f.scope,f.options)).administrativeIntegrityViolations).toEqual([]);
    }finally{f.close();}
});

test.each(['missing-cursor','foreign-run','prefix','pending','tail','legacy','missing-stage','regression','unproven-no-effect','future-wall-result'])(
    'administrative value leaves concrete native gaps unknown: %s',variant=>{
    const f=administrativeFixture(false,variant==='legacy');try{for(let n=0;n<3;n++){f.sample(n);const c=f.cursor();f.emitValue('after-terminal-guard');
        if(n===1&&variant==='pending')expect(()=>withSocietyValueMutation({source:'engine.save-fallback',operationId:'pending',actor:'player:ada',payload:{}},()=>{throw Error('crash');},f.boundary)).toThrow('crash');
        if(n===1&&variant==='unproven-no-effect')f.inject('engine.debugproc',false);
        if(n===1&&variant==='future-wall-result')withSocietyValueMutation({source:'engine.cheat-value',operationId:'future-wall',actor:'player:ada',payload:{}},()=>1,
            {...f.boundary,observe:()=>({...f.boundary.observe(),wallTime:new Date(Date.parse(wall)+10000).toISOString()})});
        if(n===1&&variant==='missing-stage')continue;
        f.emitValue('end-of-tick',n===1&&variant==='missing-cursor'?{administrativeValueCursor:null}:n===1&&variant==='foreign-run'?{administrativeValueCursor:{...c,runId:'foreign'}}:
            n===1&&variant==='prefix'?{administrativeValueCursor:{...c,head:{sequence:999,hash:'f'.repeat(64)}}}:n===2&&variant==='regression'?{administrativeValueCursor:{...c,head:{sequence:0,hash:'0'.repeat(64)}}}:{});
    }
        if(variant==='tail')f.inject();const r=f.readValue();expect(r.verdict).toBe('inconclusive');expect(r.completeAdministrativeValueCoverage).toBeFalse();expect(r.gaps.length).toBeGreaterThan(0);
    }finally{f.close();}
});

test.each(['complete','pending','missing-backing'])(
    'administrative value distinguishes native internal redistribution from an unclosed or missing debit/credit: %s',variant=>{
    const f=administrativeFixture(),path=join(f.root,'.local/economy/institution-treasury.sqlite'),treasury=new InstitutionTreasuryStore(path),
        reward=new PlayerRewardStore(':memory:',f.boundary,f.db),settlementId=randomUUID(),reservationId='native-wage';let coins=0;
    try{const account=treasury.ensure('business','forge',wall);treasury.setBalance('business','forge',account.revision,100,wall);
        f.options.administrativeValue={treasuryPath:path};
        for(let n=0;n<3;n++){f.sample(n);f.emitValue('after-terminal-guard');if(n===1){const now=f.boundary.observe().wallTime;
            treasury.reserve('business','forge',reservationId,10,now);treasury.bindSettlement(reservationId,settlementId,now);
            const input={settlementId,reservationId,username:'ada',amountGp:10,treasuryPath:path};bindSocietyInternalPayment(input,'reserve',f.boundary.path);
            reward.credit(settlementId,'ada',10,{balance:()=>coins,credit:n=>(coins+=n,n),remove:n=>(coins-=n,n)},now);
            if(variant!=='pending'){treasury.commit(reservationId,settlementId,now);bindSocietyInternalPayment(input,'commit',f.boundary.path);}
        }f.emitValue('end-of-tick');}
        if(variant==='missing-backing')f.options.administrativeValue=undefined;
        const r=f.readValue();expect(r.verdict).toBe(variant==='complete'?'pass':'inconclusive');expect(r.violations).toEqual([]);expect(coins).toBe(10);
    }finally{reward.close();treasury.close();f.close();}
});

test('world policy joins actual materialized startup inputs, two process roles and native closed cursors without writes',()=>{
    const f=mutationFixture(true);try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');f.emitMutationFrame('end-of-tick');}
        const before=[f.db.serialize(),f.mutationDb.serialize()],r=f.readWorldPolicy();expect(r.gaps).toEqual([]);expect(r.verdict).toBe('pass');expect(r.completeWorldPolicyCoverage).toBeTrue();
        expect(r.completeRuntimeDependencyUniverse).toBeFalse();expect(f.readWorldPolicy().digest).toBe(r.digest);expect([f.db.serialize(),f.mutationDb.serialize()]).toEqual(before);
        expect(reportNativeOutcomes(f.scope,f.options).sources.worldPolicy.status).toBe('available');
        // A short reader fixture is not the original 1+7 assessment frame.
        expect(projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options)).integrity.find(g=>g.gateId==='unchanged-clock-and-world-policy')!.verdict).toBe('inconclusive');
    }finally{f.close();}
});

test('world policy original 1+7 frame reaches the positive native integrity gate and source coverage through frozen SQLite readers',()=>{
    const f=mutationFixture(true,true),started=performance.now();try{
        // One isolated fixture build; runtime append/rollback durability is exercised separately below.
        f.db.transaction(()=>{for(let n=0;n<=192;n++){f.sample(n);
            const avatar={username:'ada',slot:1,vitals:{hitpoints:10,finite:true,terminal:false,healthAudited:true}};
            f.emitMutationFrame('after-terminal-guard',{},n===100?{avatars:[avatar]}:{});
            if(n===100){const c=f.store.read().entries.at(-1)!.sample.clock,id=randomUUID(),death=createPopulationDeathEvidence(f.agents.getPopulationMember('ada')!,c,age,mortality,
                {damageEventId:id,sessionId:'client',engineTick:n});
                f.health.record({username:'ada',sessionId:'client',engineTick:n,occurredAt:c.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},id,death);
                f.emitMutationFrame('end-of-tick',{}, {avatars:[{...avatar,vitals:{...avatar.vitals,hitpoints:0,terminal:true}}]});
            }else f.emitMutationFrame('end-of-tick');}}).immediate();
        console.error(`[WorldPolicyFullFrame] build ${Math.round(performance.now()-started)} ms`);
        const r=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));
        expect(r.bindingStatus).toBe('bound');expect(r.integrity.find(g=>g.gateId==='unchanged-clock-and-world-policy')!.verdict).toBe('pass');
        expect(r.sourceCoverage.rows.find(s=>s.sourceId==='clock-world-policy')!.status).toBe('complete');expect(r.qualifiesMinimum).toBeFalse();
        expect(r.integrity.find(g=>g.gateId==='finite-lifecycle-no-respawn')!.verdict).toBe('pass');
        expect(r.sourceCoverage.rows.filter(s=>['native-health-deaths','login-respawn-enforcement'].includes(s.sourceId)).map(s=>s.status)).toEqual(['complete','complete']);
        expect(rule(r,'founder-survival').verdict).toBe('fail'); // Correct finite death is not a survival success.
        const frozen=join(f.root,'.local/society-metrics/world-policy-frozen.sqlite');writeFileSync(frozen,f.mutationDb.serialize());
        const replay=readNativeWorldPolicy(f.db,f.scope,{...f.options,policyMutationsPath:frozen},initial,f.actors);expect(replay.verdict).toBe('pass');
        const checkpoint=join(f.root,'server/engine/data/lifecycle-full-frozen.sqlite');writeFileSync(checkpoint,f.db.serialize());
        const offline=new OwnedDatabase(checkpoint,{readonly:true}),live=readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors);
        try{expect(readNativeLifecycleEnforcement(offline,f.scope,{...f.options,policyMutationsPath:frozen},initial,f.actors)).toEqual(live);}finally{offline.close(true);}
        console.error(`[WorldPolicyFullFrame] total ${Math.round(performance.now()-started)} ms`);
    }finally{f.close();}
},15000);

test('finite lifecycle joins existing sealed sources for every original offline founder and rereads frozen SQLite without writes',()=>{
    const f=mutationFixture(true);try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');f.emitMutationFrame('end-of-tick');}
        const before=[f.db.serialize(),f.mutationDb.serialize(),f.hashes()],read=()=>readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors),r=read();
        expect(r.gaps).toEqual([]);expect(r.verdict).toBe('pass');expect(r.completeNativeHealthCoverage).toBeTrue();expect(r.completeLifecycleEnforcement).toBeTrue();
        expect(read()).toEqual(r);expect([f.db.serialize(),f.mutationDb.serialize(),f.hashes()]).toEqual(before);
        const path=join(f.root,'server/engine/data/lifecycle-frozen.sqlite');writeFileSync(path,f.db.serialize());const offline=new OwnedDatabase(path,{readonly:true});
        try{expect(readNativeLifecycleEnforcement(offline,f.scope,f.options,initial,f.actors)).toEqual(r);}finally{offline.close(true);}
        // The short source fixture does not satisfy the original minimum run frame or positive living/survival bounds.
        expect(projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options)).integrity.find(g=>g.gateId==='finite-lifecycle-no-respawn')!.verdict).toBe('inconclusive');
    }finally{f.close();}
});

test.each(['legacy-runtime','unaudited-avatar','pending-attempt','guard-source','stale-death-latch','write-fault','missing-stage','health-tail'])(
    'finite lifecycle never certifies a missing native guarantee: %s',variant=>{
    const f=mutationFixture(variant!=='legacy-runtime');try{for(let n=0;n<3;n++){f.sample(n);
        f.emitMutationFrame('after-terminal-guard',{},variant==='unaudited-avatar'&&n===1?
            {avatars:[{username:'ada',slot:1,vitals:{hitpoints:10,finite:true,terminal:false}}]}:{});
        if(n===1&&variant==='pending-attempt')f.attempt(f.watermarks.read().entries.at(-1)!.sample,false);
        if(n===1&&variant==='guard-source'){const e=f.attempt(f.watermarks.read().entries.at(-1)!.sample,false);
            // A completed parser result is not a guard source failure; create an actual guard route pair.
            f.attempts.append({...e,phase:'result',outcome:'parsed'});const id=randomUUID();
            f.attempts.append({...e,attemptId:id,kind:'login-guard'});f.attempts.append({...e,attemptId:id,kind:'login-guard',phase:'result',outcome:'source-unavailable'});}
        if(n===1&&variant==='write-fault')f.watermarks.fault();
        if(n===1&&variant==='missing-stage')continue;
        const actors=variant==='stale-death-latch'&&n===1?f.watermarks.read().entries.at(-1)!.sample.actors.map(a=>({...a,authority:{...a.authority!,deathEventId:'fabricated'}})):undefined;
        f.emitMutationFrame('end-of-tick',{},actors?{actors}:{});
    }
        if(variant==='health-tail')f.health.record({username:'ada',sessionId:'client',engineTick:2,occurredAt:new Date(Date.parse(wall)+1200).toISOString(),hpBefore:10,hpAfter:9,maxHp:10,damageType:1});
        const r=readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors);expect(r.completeLifecycleEnforcement).toBeFalse();expect(r.verdict).toBe('inconclusive');expect(r.gaps.length).toBeGreaterThan(0);
    }finally{f.close();}
});

test.each(['latched','missing-latch','damage-after-death-blocked'])(
    'finite lifecycle orders native lethal HP and the permanent latch within a tick: %s',variant=>{
    const f=mutationFixture(true);try{for(let n=0;n<3;n++){f.sample(n);const avatar={username:'ada',slot:1,vitals:{hitpoints:10,finite:true,terminal:false,healthAudited:true}};
        f.emitMutationFrame('after-terminal-guard',{},n===1?{avatars:[avatar]}:{});
        if(n===1){const c=f.store.read().entries.at(-1)!.sample.clock,damageEventId=randomUUID(),event=createPopulationDeathEvidence(f.agents.getPopulationMember('ada')!,c,age,mortality,
            {damageEventId,sessionId:'client',engineTick:1});
            f.health.record({username:'ada',sessionId:'client',engineTick:1,occurredAt:c.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},damageEventId,event);
            if(variant==='damage-after-death-blocked')expect(()=>f.health.record({username:'ada',sessionId:'client',engineTick:1,occurredAt:c.wallTime,hpBefore:10,hpAfter:9,maxHp:10,damageType:1})).toThrow('Terminal avatar');
            f.emitMutationFrame('end-of-tick',{}, {avatars:[{...avatar,vitals:{...avatar.vitals,hitpoints:0,terminal:variant!=='missing-latch'}}]});
        }else f.emitMutationFrame('end-of-tick');
    }
        const r=readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors);expect(r.gaps).toEqual([]);
        expect(r.verdict).toBe(variant==='missing-latch'?'fail':'pass');expect(r.completeLifecycleEnforcement).toBeTrue();
        if(variant==='missing-latch'){f.watermarks.fault();const partial=readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors);
            expect(partial.verdict).toBe('fail');expect(partial.completeLifecycleEnforcement).toBeFalse();expect(partial.violations).not.toEqual([]);
            const projected=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));
            expect(projected.integrity.find(g=>g.gateId==='finite-lifecycle-no-respawn')!.verdict).toBe('fail');
            const foreign=projectNativeMinimumAssessment(contract,{...f.scope,clockId:'foreign'},reportNativeOutcomes(f.scope,f.options));expect(foreign.lifecycleIntegrityViolations).toEqual([]);}
    }finally{f.close();}
});

test('finite lifecycle rejects stale attempt health heads even when their audit prefixes and paired results are individually valid',()=>{
    const f=mutationFixture(true);try{for(let n=0;n<3;n++){f.sample(n);const avatar={username:'ada',slot:1,vitals:{hitpoints:n===0?10:9,finite:true,terminal:false,healthAudited:true}};
        const frame=f.emitMutationFrame('after-terminal-guard',{}, {avatars:[avatar]});
        if(n===0)f.health.record({username:'ada',sessionId:'client',engineTick:0,occurredAt:frame.wallTime,hpBefore:10,hpAfter:9,maxHp:10,damageType:1});
        if(n===1){const sample=f.watermarks.read().entries.at(-1)!.sample,a=sample.actors[0]!.authority!;
            f.attempt(sample,true,{...a,healthHeads:{...a.healthHeads,damage:f.selection.openingHealthHeads.damage}});}
        f.emitMutationFrame('end-of-tick',{}, {avatars:[{...avatar,vitals:{...avatar.vitals,hitpoints:9}}]});
    }
        expect(f.readWatermarks().completeRecordedAttemptWindow).toBeTrue();const r=readNativeLifecycleEnforcement(f.db,f.scope,f.options,initial,f.actors);
        expect(r.verdict).toBe('inconclusive');expect(r.gaps).toContain('attempt-health-before-native-pass');expect(r.gaps).toContain('attempt-health-census-order');
    }finally{f.close();}
});

test.each(['missing-gateway','bad-input','missing-frame','cursor','restart','wrong-session'])(
    'world policy coverage stays unknown at a concrete runtime boundary: %s',variant=>{
    const f=mutationFixture(true,false,variant==='missing-gateway'?['engine']:variant==='bad-input'?[]:['engine','gateway']);try{
        if(variant==='bad-input'){f.boot('engine',{NODE_XPRATE:'different'});f.boot('gateway');}
        if(variant==='wrong-session')f.runtime!.append({...f.runtime!.read().entries[0]!.witness,sessionId:'foreign-engine-session'});
        for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');
            if(n===1&&variant==='restart')f.boot('engine');if(n===1&&variant==='missing-frame')continue;
            f.emitMutationFrame('end-of-tick',variant==='cursor'&&n===1?{mutationCursor:{...f.mutations.cursor(),runtimeHead:{sequence:999,digest:'f'.repeat(64)}}}:{});}
        const r=f.readWorldPolicy();expect(r.verdict).toBe('inconclusive');expect(r.completeWorldPolicyCoverage).toBeFalse();expect(r.gaps.length).toBeGreaterThan(0);
    }finally{f.close();}
});

test('world policy preserves bounded normal signals/no-ops and excludes runtime changes after its closing cursor',()=>{
    const f=mutationFixture(true);try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');if(n===1){
        withPolicyMutationObservation(f.mutationPorts,()=>{beginPolicyMutation('director-event-accept',null)?.finish('a'.repeat(64),'applied');observeWorldPackedReload(f.root,()=>{});});
        withPolicyMutationObservation({...f.mutationPorts,sessionId:'gateway-fixture-session'},()=>beginPolicyMutation('director-configure','b'.repeat(64))?.finish('b'.repeat(64),'no-op'));
    }f.emitMutationFrame('end-of-tick');}
        expect(f.readWorldPolicy().verdict).toBe('pass');f.boot('engine',{NODE_XPRATE:'changed-after-window'});expect(f.readWorldPolicy().verdict).toBe('pass');
    }finally{f.close();}
});

test('world policy observes loaded packed identity changes, preserves thrown errors and detects round-trip configuration despite other gaps',()=>{
    const f=mutationFixture(true);try{const pack=join(f.root,'server/engine/data/pack/server/script.dat');
        for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');if(n===1)withPolicyMutationObservation(f.mutationPorts,()=>{
            observeWorldPackedReload(f.root,()=>{});writeFileSync(pack,new Uint8Array([1]));observeWorldPackedReload(f.root,()=>{});
            writeFileSync(pack,new Uint8Array([0]));observeWorldPackedReload(f.root,()=>{});
            expect(()=>observeWorldPackedReload(f.root,()=>{throw Error('actual reload error');})).toThrow('actual reload error');});f.emitMutationFrame('end-of-tick');}
        const r=f.readWorldPolicy();expect(r.verdict).toBe('fail');expect(r.violations.filter(v=>v.reason==='post-genesis-world-policy-mutated')).toHaveLength(2);
        expect(r.gaps).toContain('policy-mutation-coverage');expect(f.readMutations().gaps).toContain('failed-configuration-mutation');
    }finally{f.close();}
});

test('world policy own schema is immutable, reopens readonly, rolls back and never changes shared user_version or exports secrets',()=>{
    const f=mutationFixture(true);try{f.mutationDb.run('PRAGMA user_version=42');new WorldPolicyRuntimeStore(f.mutationDb,f.runtimeContract!);
        const before=f.mutationDb.serialize(),w=f.runtime!.read().entries[0]!.witness;
        expect(()=>f.mutationDb.transaction(()=>{f.runtime!.append({...w,sessionId:randomUUID()});throw Error('rollback');}).immediate()).toThrow('rollback');expect(f.mutationDb.serialize()).toEqual(before);
        expect(()=>f.mutationDb.run('DELETE FROM world_policy_runtime_event WHERE sequence=1')).toThrow('immutable');
        expect(()=>new WorldPolicyRuntimeStore(f.mutationDb,{...f.runtimeContract!,inputs:{engine:'f'.repeat(64),gateway:'e'.repeat(64)}})).toThrow();
        const witness=f.boot('engine',{OPENAI_API_KEY:'PRIVATE API KEY'});expect(witness.gaps).toEqual([]);expect(JSON.stringify(witness)).not.toContain('PRIVATE API KEY');
        expect(f.mutationDb.query('PRAGMA user_version').get()).toEqual({user_version:42});
        f.mutationDb.run('UPDATE world_policy_runtime_head SET sequence=99');expect(()=>f.runtime!.read()).toThrow();
    }finally{f.close();}
});

test('world policy actual startup hook is inert for legacy selection and records a durable gap on selected write failure',()=>{
    const legacy=mutationFixture();try{const before=legacy.mutationDb.serialize();recordWorldPolicyRuntime('engine',legacy.root);expect(legacy.mutationDb.serialize()).toEqual(before);
        expect(()=>legacy.readWorldPolicy()).toThrow('absent');}finally{legacy.close();}
    const f=mutationFixture(true);try{const before=f.clock.get('world');f.mutationDb.run("CREATE TRIGGER fail_runtime BEFORE INSERT ON world_policy_runtime_event BEGIN SELECT RAISE(ABORT,'injected');END");
        expect(()=>recordWorldPolicyRuntime('engine',f.root)).not.toThrow();expect(f.mutations.read().faultCount).toBe(1);expect(f.clock.get('world')).toEqual(before);
    }finally{f.close();}
});

test('policy mutation paired native cursors preserve actual director round trips even when sampled policies end unchanged; frozen reread stays readonly',()=>{
    const f=mutationFixture();try{const path=join(f.root,'.local/admin/world-director.json'),config={schemaVersion:1,enabled:false,seed:'fixture',epoch:initial,intervalMinutes:30};
        updateWorldDirectorConfig(config,path);f.sample(0);f.emitMutationFrame('after-terminal-guard');f.emitMutationFrame('end-of-tick');
        f.sample(1);f.emitMutationFrame('after-terminal-guard');
        withPolicyMutationObservation(f.mutationPorts,()=>{updateWorldDirectorConfig({...config,enabled:true},path);updateWorldDirectorConfig(config,path);});
        f.emitMutationFrame('end-of-tick');f.sample(2);f.emitMutationFrame('after-terminal-guard');f.emitMutationFrame('end-of-tick');
        const before=f.mutationDb.serialize(),r=f.readMutations();expect(r.gaps).toEqual([]);expect(r.violations).toHaveLength(2);expect(r.verdict).toBe('fail');
        expect(r.completeRecordedMutationWindow).toBeTrue();expect(r.completeWorldPolicyEnforcement).toBeFalse();expect(f.readPolicy().violations).toEqual([]);
        const report=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));expect(report.integrity.find(g=>g.gateId==='unchanged-clock-and-world-policy')!.verdict).toBe('fail');
        expect(report.policyIntegrityViolations.filter(v=>'attemptId' in v)).toHaveLength(2);
        expect(report.qualifiesMinimum).toBeFalse();expect(f.mutationDb.serialize()).toEqual(before);
        const frozen=join(f.root,'.local/society-metrics/frozen-mutations.sqlite');writeFileSync(frozen,before);
        expect(readNativePolicyMutations(f.db,f.scope,{...f.options,policyMutationsPath:frozen},initial,f.actors)).toEqual(r);
        expect(projectNativeMinimumAssessment(contract,{...f.scope,clockId:'foreign'},reportNativeOutcomes(f.scope,f.options)).policyIntegrityViolations).toEqual([]);
    }finally{f.close();}
});

test('policy mutation normal director signals, unchanged reloads and mutations after the closing cursor never fabricate configuration failure',()=>{
    const f=mutationFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');
        if(n===1)withPolicyMutationObservation(f.mutationPorts,()=>{beginPolicyMutation('director-event-accept',null)?.finish('a'.repeat(64),'applied');
            beginPolicyMutation('mod-hot-reload','b'.repeat(64))?.finish('b'.repeat(64),'no-op');});f.emitMutationFrame('end-of-tick');}
        withPolicyMutationObservation(f.mutationPorts,()=>beginPolicyMutation('mod-configure','c'.repeat(64))?.finish('d'.repeat(64),'applied'));
        const r=f.readMutations();expect(r.attempts).toHaveLength(2);expect(r.violations).toEqual([]);expect(r.completeRecordedMutationWindow).toBeTrue();expect(r.verdict).toBe('inconclusive');
    }finally{f.close();}
});

test.each(['pending','unknown','foreign','stale','fault','cursor','missing-frame'])(
    'policy mutation coverage remains unknown at missing observation boundaries: %s',variant=>{
    const f=mutationFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');
        if(n===1){const ports=variant==='unknown'?{...f.mutationPorts,clock:()=>null}:variant==='foreign'?{...f.mutationPorts,worldId:'other'}
            :variant==='stale'?{...f.mutationPorts,wallTime:()=>new Date(Date.parse(wall)+6000).toISOString()}:f.mutationPorts;
            withPolicyMutationObservation(ports,()=>{const operation=beginPolicyMutation('director-event-accept',null);if(variant!=='pending')operation?.finish('a'.repeat(64),'applied');});
            if(variant==='fault')f.mutations.fault();if(variant==='missing-frame')continue;}
        const change=variant==='cursor'&&n===1?{mutationCursor:{...f.mutations.cursor(),head:{sequence:999,digest:'f'.repeat(64)}}}:{};f.emitMutationFrame('end-of-tick',change);}
        const r=f.readMutations();expect(r.completeRecordedMutationWindow,variant).toBeFalse();expect(r.gaps.length,variant).toBeGreaterThan(0);expect(r.violations).toEqual([]);
    }finally{f.close();}
});

test('policy mutation faults do not hide a separately completed original-scope configuration change',()=>{
    const f=mutationFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');if(n===1){
        withPolicyMutationObservation(f.mutationPorts,()=>beginPolicyMutation('mod-configure','a'.repeat(64))?.finish('b'.repeat(64),'applied'));f.mutations.fault();}
        f.emitMutationFrame('end-of-tick');}
        const r=f.readMutations();expect(r.completeRecordedMutationWindow).toBeFalse();expect(r.verdict).toBe('fail');expect(r.violations).toHaveLength(1);
    }finally{f.close();}
});

test('policy mutation earlier positive prefix remains a failure when the final frame is missing',()=>{
    const f=mutationFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emitMutationFrame('after-terminal-guard');if(n===1)
        withPolicyMutationObservation(f.mutationPorts,()=>beginPolicyMutation('mod-configure','a'.repeat(64))?.finish('b'.repeat(64),'applied'));
        if(n<2)f.emitMutationFrame('end-of-tick');}
        const r=f.readMutations();expect(r.gaps).toContain('mutation-window-boundaries');expect(r.verdict).toBe('fail');expect(r.violations).toHaveLength(1);
    }finally{f.close();}
});

test('lifecycle policy explicit manifest and paired effective clock snapshots are readonly and never imply full world-policy PASS',()=>{
    const f=policyFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emit('after-terminal-guard');f.emit('end-of-tick');}
        const before=f.db.serialize(),r=f.readPolicy();expect(r.gaps).toEqual([]);expect(r.violations).toEqual([]);expect(r.completePinnedPolicyObservations).toBeTrue();
        expect(r.completeWorldPolicyEnforcement).toBeFalse();expect(r.verdict).toBe('inconclusive');expect(f.db.serialize()).toEqual(before);
        const path=join(f.root,'server/engine/data/policy-frozen.sqlite');writeFileSync(path,before);const db=new OwnedDatabase(path,{readonly:true});
        try{expect(readNativeLifecyclePolicy(db,f.scope,f.options,initial,f.actors)).toEqual(r);}finally{db.close(true);}
        expect(reportNativeOutcomes(f.scope,f.options).sources.lifecyclePolicy.status).toBe('available');
        expect(projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options)).integrity.every(g=>g.verdict==='inconclusive')).toBeTrue();
    }finally{f.close();}
});

test.each(['profile','pause-resume','away-and-back','effective','config','source','boot'])(
    'lifecycle policy drift remains a scoped integrity FAIL despite incomplete census: %s',variant=>{
    const f=policyFixture();try{f.sample(0);f.emit('after-terminal-guard');f.emit('end-of-tick');f.sample(1);f.emit('after-terminal-guard');
        const original=f.clock.get('world')!,at=original.lastObservedWallTime;
        if(variant==='profile'||variant==='away-and-back'){const changed=f.clock.reconfigure('world',original.revision,{...original.profile,seed:'changed'},at);
            if(variant==='away-and-back')f.clock.reconfigure('world',changed.revision,original.profile,at);}
        if(variant==='pause-resume'){const paused=f.clock.pause('world',original.revision,at);f.clock.resume('world',paused.revision,at);}
        const snapshot=structuredClone(f.snapshot()),boot=structuredClone(f.pin.manifest);
        if(variant==='effective')snapshot.effective.modsDigest='f'.repeat(64);
        if(variant==='config')snapshot.files.find(f=>f.sha256!==null)!.sha256='f'.repeat(64);
        if(variant==='source')snapshot.sources[0]!.sha256='f'.repeat(64);
        if(variant==='boot')boot.sources[0]!.sha256='f'.repeat(64);
        f.policyStore.fault();f.emit('end-of-tick',{snapshot,bootManifest:boot},false);
        const r=f.readPolicy();expect(r.verdict,variant).toBe('fail');expect(r.violations.length,variant).toBeGreaterThan(0);expect(r.completePinnedPolicyObservations).toBeFalse();
        const outcomes=reportNativeOutcomes(f.scope,f.options),report=projectNativeMinimumAssessment(contract,f.scope,outcomes);
        expect(report.integrity.find(g=>g.gateId==='unchanged-clock-and-world-policy')!.verdict).toBe('fail');expect(report.qualifiesMinimum).toBeFalse();
        expect(report.policyIntegrityViolations.every(v=>!('sampleSequence' in v)||typeof v.sampleSequence==='number')).toBeTrue();
        expect(projectNativeMinimumAssessment(contract,{...f.scope,clockId:'foreign'},outcomes).policyIntegrityViolations).toEqual([]);
        if(variant==='pause-resume'||variant==='away-and-back')expect(f.clock.get('world')!.profileDigest).toBe(original.profileDigest);
    }finally{f.close();}
});

test.each(['missing','session','null-policy','null-boot','foreign','prefix','fault'])(
    'lifecycle policy coverage cannot bridge missing or foreign evidence: %s',variant=>{
    const f=policyFixture();try{for(let n=0;n<3;n++){f.sample(n);f.emit('after-terminal-guard');if(n===1&&variant==='missing')continue;
        f.emit('end-of-tick',n!==1?{}:variant==='session'?{sessionId:'restart'}:variant==='null-policy'?{snapshot:null}:variant==='null-boot'?{bootManifest:null}
            :variant==='foreign'?{worldId:'other'}:variant==='prefix'?{mortalityHead:{sequence:1,digest:'f'.repeat(64)}}:{});}
        if(variant==='fault')f.policyStore.fault();const r=f.readPolicy();expect(r.completePinnedPolicyObservations,variant).toBeFalse();expect(r.violations).toEqual([]);
        expect(r.gaps.length,variant).toBeGreaterThan(0);
    }finally{f.close();}
});

test('lifecycle policy source faults and unknown boot cannot erase a separately bound actual clock violation',()=>{
    const f=policyFixture();try{f.sample(0);f.emit('after-terminal-guard');const c=f.clock.get('world')!;
        f.clock.reconfigure('world',c.revision,{...c.profile,seed:'changed'},c.lastObservedWallTime);
        f.db.run('UPDATE native_lifecycle_watermark_head SET sequence=999');
        f.policyStore.append({sessionId:'watermark-session',worldId:'fixture',position:f.store.read().entries.at(-1)!.sample.clock,wallTime:c.lastObservedWallTime,
            stage:'end-of-tick',mortalityHead:f.store.read().head,watermarkHead:{sequence:999,digest:'f'.repeat(64)},bootManifest:null,snapshot:f.snapshot()});
        expect(f.readPolicy().verdict).toBe('fail');
    }finally{f.close();}
});

test('lifecycle policy own schema selection, immutable audit, reopen and rollback leave shared user_version unchanged',()=>{
    const f=policyFixture();try{f.db.run('PRAGMA user_version=42');f.sample(0);const sample=f.emit('after-terminal-guard'),before=f.db.serialize();
        expect(()=>f.db.transaction(()=>{f.policyStore.append({...sample,sessionId:'rollback'});throw Error('rollback');}).immediate()).toThrow('rollback');
        expect(f.db.serialize()).toEqual(before);expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});new NativeLifecyclePolicyStore(f.db,f.pin);
        expect(()=>new NativeLifecyclePolicyStore(f.db,{...f.pin,opening:{...f.pin.opening,effective:{...f.pin.opening.effective,modsDigest:'f'.repeat(64)}}})).toThrow('differs');
        expect(()=>f.db.run('DELETE FROM native_lifecycle_policy_event WHERE sequence=1')).toThrow('immutable');
        f.db.run('UPDATE native_lifecycle_policy_head SET sequence=9');expect(f.readPolicy).toThrow('head');
        f.kill('2001-01-03T00:00:00.000Z');expect(f.report().verdict).toBe('fail');
    }finally{f.close();}
});

test('paired lifecycle tick watermarks cover actual offline census and recorded attempts without claiming full enforcement; frozen reread is byte stable',()=>{
    const f=watermarkFixture();try{for(let n=0;n<3;n++){f.sample(n);const sample=f.frame('after-terminal-guard');if(n===1)f.attempt(sample);f.frame('end-of-tick');}
        const before=f.db.serialize(),r=f.readWatermarks();expect(r.gaps).toEqual([]);expect(r.sampleCount).toBe(6);
        expect(r.completePostGuardCensusCoverage).toBeTrue();expect(r.completeRecordedAttemptWindow).toBeTrue();expect(r.completeLifecycleEnforcement).toBeFalse();
        expect(r.verdict).toBe('inconclusive');expect(f.db.serialize()).toEqual(before);
        const path=join(f.root,'server/engine/data/census-frozen.sqlite');writeFileSync(path,before);const offline=new OwnedDatabase(path,{readonly:true});
        try{expect(readNativeLifecycleWatermarks(offline,f.scope,f.options,initial,f.actors)).toEqual(r);}finally{offline.close(true);}
        const outcomes=reportNativeOutcomes(f.scope,f.options);expect(outcomes.sources.lifecycleWatermarks.status).toBe('available');
        expect(projectNativeMinimumAssessment(contract,f.scope,outcomes).integrity.every(g=>g.verdict==='inconclusive')).toBeTrue();
    }finally{f.close();}
});

test.each(['missing-tick','missing-seal','session','fault','attempt-fault','pending','unknown','foreign','prefix','late-tail','unknown-attempt'])(
    'lifecycle watermark gap remains unknown: %s',variant=>{
        const f=watermarkFixture();try{for(let n=0;n<3;n++){
            f.sample(n);if(variant==='missing-tick'&&n===1)continue;
            const sample=f.frame('after-terminal-guard',variant==='session'&&n===1?{sessionId:'restart'}:{});
            if(n===1){
                if(variant==='fault')f.watermarks.fault();if(variant==='attempt-fault')f.attempts.fault();
                if(variant==='pending'||variant==='unknown-attempt')f.attempt(sample,variant!=='pending',variant==='unknown-attempt'?null:undefined);
            }
            if(variant==='missing-seal'&&n===1)continue;
            f.frame('end-of-tick',n!==1?{}:variant==='unknown'?{actors:sample.actors.map((a,i)=>i? a:{...a,authority:null})}
                :variant==='foreign'?{actors:sample.actors.map((a,i)=>i?a:{...a,authority:{...a.authority!,actor:{...a.authority!.actor,lifecycleId:'f'.repeat(64)}}})}
                :variant==='prefix'?{mortalityHead:{sequence:1,digest:'f'.repeat(64)}}:{});
        }
            if(variant==='late-tail')f.attempt(f.watermarks.read().entries.at(-1)!.sample);
            const r=f.readWatermarks();expect(r.completePostGuardCensusCoverage,variant).toBeFalse();expect(r.completeRecordedAttemptWindow,variant).toBeFalse();
            expect(r.completeLifecycleEnforcement).toBeFalse();expect(r.gaps.length,variant).toBeGreaterThan(0);expect(r.violations).toEqual([]);
        }finally{f.close();}
});

test.each(['death','zero-hp','duplicate','finite'])(
    'post-guard original avatar yields a scoped failure despite other gaps: %s',variant=>{
    const f=watermarkFixture();try{
        f.sample(0);f.frame('after-terminal-guard');f.frame('end-of-tick');
        if(variant==='death')f.kill('2001-01-01T00:00:00.600Z');f.sample(1);
        const avatar={username:'ada',slot:1,vitals:{hitpoints:variant==='zero-hp'?0:10,terminal:false,finite:variant!=='finite'}};
        f.frame('after-terminal-guard',{avatars:variant==='duplicate'?[avatar,{...avatar,slot:2}]:[avatar]});f.watermarks.fault();f.frame('end-of-tick');
        const r=f.readWatermarks();expect(r.verdict,variant).toBe('fail');expect(r.violations).toHaveLength(1);expect(r.completePostGuardCensusCoverage).toBeFalse();
        const report=projectNativeMinimumAssessment(contract,f.scope,reportNativeOutcomes(f.scope,f.options));
        expect(report.integrity.find(g=>g.gateId==='finite-lifecycle-no-respawn')!.verdict).toBe('fail');expect(report.qualifiesMinimum).toBeFalse();
        const foreign=projectNativeMinimumAssessment(contract,{...f.scope,clockId:'foreign'},reportNativeOutcomes(f.scope,f.options));expect(foreign.lifecycleIntegrityViolations).toEqual([]);
    }finally{f.close();}
});

test('end-of-tick terminal HP can await the next guard without a false failed-eviction verdict',()=>{
    const f=watermarkFixture();try{f.sample(0);f.frame('after-terminal-guard');
        f.frame('end-of-tick',{avatars:[{username:'ada',slot:1,vitals:{hitpoints:0,terminal:true,finite:true}}]});
        expect(f.readWatermarks().violations).toEqual([]);
    }finally{f.close();}
});

test('lifecycle watermark native damage at an equal timestamp preserves prefix order instead of retroactively invalidating the earlier guard',()=>{
    const f=watermarkFixture();try{f.sample(0);const before=f.frame('after-terminal-guard'),c=before.clock,id=randomUUID(),
        event=createPopulationDeathEvidence(f.agents.getPopulationMember('ada')!,c,age,mortality,{damageEventId:id,sessionId:'native',engineTick:0});
        f.health.record({username:'ada',sessionId:'native',engineTick:0,occurredAt:c.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},id,event);
        f.frame('end-of-tick',{avatars:[{username:'ada',slot:1,vitals:{hitpoints:0,terminal:true,finite:true}}]});
        for(let n=1;n<3;n++){f.sample(n);f.frame('after-terminal-guard');f.frame('end-of-tick');}
        const r=f.readWatermarks();expect(r.gaps).toEqual([]);expect(r.violations).toEqual([]);expect(r.completePostGuardCensusCoverage).toBeTrue();
    }finally{f.close();}
});

test('lifecycle watermark attempt authority cannot regress to an earlier genuine native health prefix',()=>{
    const f=watermarkFixture();try{f.sample(0);const before=f.frame('after-terminal-guard'),c=before.clock;
        f.health.record({username:'ada',sessionId:'native',engineTick:0,occurredAt:c.wallTime,hpBefore:10,hpAfter:9,maxHp:10,damageType:1});
        const begin=f.attempt(before,false,{...before.actors[0]!.authority!,healthHeads:f.health.coverageHeads()});
        f.attempts.append({...begin,phase:'result',outcome:'parsed',authority:before.actors[0]!.authority});f.frame('end-of-tick');
        for(let n=1;n<3;n++){f.sample(n);f.frame('after-terminal-guard');f.frame('end-of-tick');}
        const r=f.readWatermarks();expect(r.gaps).toContain('attempt-health-prefix-regression');expect(r.completeRecordedAttemptWindow).toBeFalse();expect(r.violations).toEqual([]);
    }finally{f.close();}
});

test('lifecycle watermark selection, rollback and immutable source chains keep their own version; corrupted attempts do not hide a verified census violation',()=>{
    const f=watermarkFixture();try{f.db.run('PRAGMA user_version=42');f.sample(0);f.frame('after-terminal-guard',{avatars:[{username:'ada',slot:1,vitals:{hitpoints:0,terminal:false,finite:true}}]});
        const sample=f.frame('end-of-tick'),before=f.db.serialize();
        expect(()=>f.db.transaction(()=>{f.watermarks.append({...sample,sessionId:'rollback'});throw Error('rollback');}).immediate()).toThrow('rollback');
        expect(f.db.serialize()).toEqual(before);expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});
        expect(new NativeLifecycleWatermarkStore(f.db).read().entries).toHaveLength(2);
        expect(()=>f.db.run('DELETE FROM native_lifecycle_watermark_event WHERE sequence=1')).toThrow('immutable');
        expect(()=>f.db.run('UPDATE native_lifecycle_watermark_selection SET digest=\'bad\'')).toThrow('immutable');
        f.db.run('UPDATE native_lifecycle_head SET sequence=1');expect(f.readWatermarks().violations).toHaveLength(1);
        f.db.run('UPDATE native_lifecycle_watermark_head SET sequence=1');expect(f.readWatermarks).toThrow('head');
    }finally{f.close();}
});

test('only prospective internal maintenance with the original founder/genesis and exact scope earns a cycle lower bound',()=>{
    const f=fixture(),base=f.outcomes(),candidate={operationId:'repair-ada',cycleId:'bronze-pickaxe-mining',actorAgentId:'ada',at:'2001-01-03T00:00:00.000Z',
        qualifiesMinimum:true,mechanicalCycleComplete:true,materialConsumption:'verified',inputOrigin:'internal',originFromSimulationTime:'2001-01-01T12:00:00.000Z'},
        value={contractDigest:contract.digest,scope:f.scope,worldId:base.worldId,candidates:[candidate]};
    const project=(v:any=value,population=base.sources.populationBaseline)=>projectNativeMinimumAssessment(contract,f.scope,{...base,sources:{...base.sources,
        populationBaseline:population,toolMaintenance:{status:'available',digest:'e'.repeat(64),value:v}}} as any);
    expect(rule(project(),'tool-maintenance-cycles').verdict).toBe('pass');expect(project().qualifiesMinimum).toBeFalse();
    for(const c of [{...candidate,inputOrigin:'unproven'},{...candidate,mechanicalCycleComplete:false},{...candidate,qualifiesMinimum:false},
        {...candidate,originFromSimulationTime:'2000-01-01T00:00:00.000Z'},{...candidate,actorAgentId:'foreign'}])
        expect(rule(project({...value,candidates:[c]}),'tool-maintenance-cycles').verdict).toBe('inconclusive');
    for(const v of [{...value,worldId:'foreign'},{...value,scope:{...f.scope,clockId:'foreign'}},{...value,candidates:[]}])
        expect(rule(project(v),'tool-maintenance-cycles').verdict).toBe('inconclusive');
    expect(project(value,{status:'unavailable'} as any).assessment).toBeNull();
});

test('positive prospective executor lifetime upper reaches the minimum only with bound cohort/policy coverage; zero and conflicting proofs never hide failure',()=>{
    const f=fixture(),base=f.outcomes(),covered={completeDemandCoverage:true,maximumSimulationGapMs:600,maximumWallGapMs:1000,
        executorCoverage:{positiveOpportunity:true,longestOutstandingUpperSimulationMs:1200}};
    const project=(coverage:any,lower:number|null=null)=>projectNativeMinimumAssessment(contract,f.scope,{...base,sources:{...base.sources,toolDemand:{status:'available',digest:'e'.repeat(64),
        value:{cycleId:'bronze-pickaxe-mining',minimumVerdict:lower&&lower>3600000?'fail':'inconclusive',cohortCoverage:coverage,
            standingRequests:{cycleId:'bronze-pickaxe-mining',longestConfirmedUnusableSimulationMs:lower}}}}} as any);
    expect(rule(project(covered),'tool-unusable-demand-time').verdict).toBe('pass');
    for(const coverage of [{...covered,completeDemandCoverage:false},{...covered,maximumSimulationGapMs:3600001},
        {...covered,executorCoverage:{...covered.executorCoverage,positiveOpportunity:false}}])expect(rule(project(coverage),'tool-unusable-demand-time').verdict).toBe('inconclusive');
    const merged=project(covered,600);expect(merged.bindingStatus).toBe('bound');expect(rule(merged,'tool-unusable-demand-time').verdict).toBe('pass');
    const fail=project(covered,3600001);expect(fail.verdict).toBe('fail');expect(rule(fail,'tool-unusable-demand-time').verdict).toBe('fail');expect(fail.qualifiesMinimum).toBeFalse();
});

test('native lifecycle repair and frozen physical checkpoints assess comparable founder tool capacity and reopen offline',()=>{
    const f=fixture();cpSync(configDirectory,join(f.root,'config'),{recursive:true});mkdirSync(join(f.root,'server/engine/data'),{recursive:true});
    const integration={...nativeIntegrationOptions(f.root),worldId:'fixture',clockPath:f.clockPath},checkpoint=join(f.root,'server/engine/data/capacity.sqlite');integration.nativeFoodCheckpointPath=checkpoint;
    new BusinessManagerStore(integration.businessPath).close();new BusinessAssetStore(integration.businessPath).close();new InstitutionTreasuryStore(integration.treasuryPath).close();
    new ProductionWorkInProgressStore(integration.businessPath,loadDefaultProductionWorkflowCatalog(),undefined,false).close();
    const clock=new SimulationClockStore(f.clockPath),agents=new AgentStateStore(f.agentPath,{store:clock,clockId:'world'}),db=new OwnedDatabase(checkpoint),
        persistence=new FoodNeedsPersistence(integration.databasePath,contract.dependencies.needs,contract.dependencies.dynamics,loadFoodLoopCatalog(join(configDirectory,'food-loops.json'))),
        snapshots:Array<{at:string;paths:NativeFoodBoundaryPaths}>=[];
    try{
        new NativeFoodConsumptionStore({db});new PlayerInventoryEscrowStore({db,checkpoint:()=>{}});db.run('CREATE TABLE accounts(owner TEXT PRIMARY KEY,save BLOB NOT NULL)');
        const bindings=f.scope.actorAgentIds.map(id=>{agents.setCharacterBirth(id,agents.getCharacterLifecycle(id)!.revision,initial,'born',wall);
            db.run('INSERT INTO accounts VALUES(?1,?2)',[id,createSaveData({inventory:id==='ada'?[{id:1265,count:1}]:[],bank:[]})]);return populationNeedsBinding('fixture',agents.getPopulationMember(id)!);});
        const admitted=clock.observe('world',wall,1);for(const binding of bindings)persistence.needs.initialize({binding,clock:admitted,history:[],playerTime:null,
            admission:{kind:'genesis',evidenceId:f.options.population!.genesisResultId,evidenceDigest:f.options.population!.genesisResultDigest}});
        const tool=new NativeToolStore(db),item=tool.lifecycle.create({itemInstanceId:'capacity-pick',lifecycleTypeId:'bronze-pickaxe',ownerActorId:'ada',qualityBasisPoints:10000,
            provenanceDigest:'a'.repeat(64),atSimulationTime:initial}),b=bindings[0]!,owner={actorId:b.actorId,username:b.playerId,lifecycleId:b.lifecycleId,worldId:b.worldId,clockId:b.clockId,clockProfileDigest:b.clockProfileDigest};
        tool.append(`opening:${item.itemInstanceId}`,{kind:'explicit-opening',itemInstanceId:item.itemInstanceId,item,owner,evidenceDigest:'b'.repeat(64)});
        for(const [index,elapsed] of [86400000,8*86400000].entries()){
            if(index===1){
                const start='2001-01-04T00:00:00.000Z',finish='2001-01-04T00:10:00.000Z';
                tool.lifecycle.use('capacity-wear',item.itemInstanceId,1,100,'c'.repeat(64),start);
                const competence=validateCompetenceSnapshot({schemaVersion:1,snapshotId:'capacity-repair',characterAgentId:'ada',observedAtSimulationTime:start,
                    personalSkills:[{kind:'personal-rs-skill',characterAgentId:'ada',skillId:'smithing',level:1}],learnedProcedures:[],
                    providedCapabilities:[{kind:'provided-capability',characterAgentId:'ada',capabilityId:'work-surface',provider:{kind:'facility',providerId:'workshop'},grantId:'grant'}]});
                new ItemRepairService(tool.lifecycle,loadItemRepairPolicyCatalog(join(configDirectory,'item-repair-policies.json'),nativeToolCatalog)).repair({operationId:'capacity-repair',
                    policyId:'bronze-pickaxe-workshop-repair',itemInstanceId:item.itemInstanceId,actorId:'ada',expectedRevision:2,startedAtSimulationTime:start,finishedAtSimulationTime:finish,
                    competenceSnapshot:competence,materialReceipt:{receiptId:'capacity-material',actorId:'ada',itemInstanceId:item.itemInstanceId,consumedItems:[{itemId:2349,quantity:1}],
                        consumedAtSimulationTime:start,sourceEvidenceDigest:'d'.repeat(64)},facilityReceipt:{receiptId:'capacity-facility',actorId:'ada',capabilityId:'work-surface',providerId:'workshop',grantId:'grant',
                        validFromSimulationTime:start,validUntilSimulationTime:finish,sourceEvidenceDigest:'e'.repeat(64)}});
            }
            const at=new Date(Date.parse(initial)+elapsed).toISOString(),wallAt=new Date(Date.parse(wall)+elapsed).toISOString(),observed=clock.observe('world',wallAt,index+2);
            closeFoodDeliveryTick(db,observed);for(const binding of bindings)persistence.needs.advance({binding,clock:observed,history:[],playerTime:null,expectedRevision:persistence.needs.get(binding)!.revision});
            const save=(db.query('SELECT save FROM accounts WHERE owner=?').get('ada') as {save:Uint8Array}).save;
            tool.put({schemaVersion:1,itemInstanceId:item.itemInstanceId,owner,position:{inventory:93,slot:0},status:'bound',reason:null,
                catalogDigest:nativeToolCatalog.digest,cycleDigest:nativeToolCycles.digest,checkpointDigest:nativeToolDigest([...save])});
            clock.pause('world',clock.get('world')!.revision,wallAt);const directory=join(f.root,'.local/capacity',String(index));mkdirSync(directory,{recursive:true});
            const sources:NativeFoodBoundaryPaths={checkpointPath:checkpoint,needsPath:integration.databasePath,clockPath:f.clockPath,businessPath:integration.businessPath,treasuryPath:integration.treasuryPath,agentPath:f.agentPath,healthPath:f.healthPath};
            const paths=Object.fromEntries(Object.entries(sources).map(([key,path])=>{const connection=new OwnedDatabase(path);connection.run('PRAGMA wal_checkpoint(TRUNCATE)');connection.close(true);
                const target=join(directory,`${key}.sqlite`);copyFileSync(path,target);return[key,target];})) as unknown as NativeFoodBoundaryPaths;snapshots.push({at,paths});
            if(index===0)clock.resume('world',clock.get('world')!.revision,wallAt);
        }
    }finally{persistence.close();db.close(true);agents.close();clock.close();}
    const options={configDirectory:join(f.root,'config'),nativeOutcomes:f.options,nativeIntegration:{...integration,toolBoundaries:snapshots},
        dependencies:{agentPath:f.agentPath,clockPath:f.clockPath,productionPath:integration.businessPath,enginePath:join(f.root,'absent-trades.sqlite')}};
    const points=snapshots.map(s=>readNativeToolCapacityBoundary(f.scope,integration,s.paths,readWealthBoundary(f.scope,integration,s.paths,s.at)));
    expect(points.map(p=>[p.cycles[0]!.lower,p.cycles[0]!.upper])).toEqual([['100','100'],['50','50']]);
    const read=()=>reportSocietyEvaluation(f.scope,options),good=read(),retention=()=>read().minimumAssessment.requirements.find(r=>r.requirementId==='tool-service-capacity-retention')!.verdict;
    expect(retention()).toBe('fail');expect(good.minimumAssessment.sources.toolCapacity.status).toBe('available');expect(good.minimumAssessment.qualifiesMinimum).toBeFalse();
    const clone=join(f.root,'.local/capacity-copy');cpSync(join(f.root,'.local/capacity'),clone,{recursive:true});
    const copied=snapshots.map((s,i)=>({at:s.at,paths:Object.fromEntries(Object.keys(s.paths).map(key=>[key,join(clone,String(i),`${key}.sqlite`)])) as unknown as NativeFoodBoundaryPaths}));
    expect(reportSocietyEvaluation(f.scope,{...options,nativeIntegration:{...integration,toolBoundaries:copied}}).nativeIntegration!.minimumToolCapacity).toEqual(good.nativeIntegration!.minimumToolCapacity);
    const copyDb=new OwnedDatabase(copied[1]!.paths.checkpointPath);
    try{
        const row=copyDb.query('SELECT payload FROM native_tool_binding').get() as {payload:string},binding=JSON.parse(row.payload);
        const source=(inventory:{id:number;count:number}[],bank:{id:number;count:number}[],position:number,stale=false)=>{
            const save=createSaveData({inventory,bank});binding.position={inventory:position,slot:0};binding.checkpointDigest=stale?'f'.repeat(64):nativeToolDigest([...save]);
            copyDb.run('UPDATE accounts SET save=? WHERE owner=?',[save,'ada']);copyDb.run('UPDATE native_tool_binding SET payload=?,digest=?',[JSON.stringify(binding),nativeToolDigest(binding)]);
            return readNativeToolCapacityBoundary(f.scope,integration,copied[1]!.paths,readWealthBoundary(f.scope,integration,copied[1]!.paths,copied[1]!.at)).cycles[0]!;
        };
        expect(source([],[{id:1265,count:1}],95)).toMatchObject({lower:'0',upper:'50'});
        expect(source([{id:1265,count:1},{id:1265,count:1}],[],93)).toMatchObject({lower:'0',upper:'250'});
        expect(source([{id:1265,count:1}],[],93,true)).toMatchObject({lower:'0',upper:'150'});
    }finally{copyDb.close(true);}
    const changed=new OwnedDatabase(snapshots[1]!.paths.checkpointPath);
    try{const row=changed.query('SELECT payload FROM native_tool_binding').get() as {payload:string},binding=JSON.parse(row.payload);binding.status='quarantined';binding.reason='unwitnessed';
        changed.run('UPDATE native_tool_binding SET payload=?,digest=?',[JSON.stringify(binding),nativeToolDigest(binding)]);
    }finally{changed.close(true);}
    expect(retention()).toBe('inconclusive');mutate(snapshots[1]!.paths.checkpointPath,'UPDATE item_instance SET durability=100');
    expect(retention()).toBe('inconclusive');
},20000);

test('native paid rent and frozen authority snapshots reach original-founder daily housing exposure and reopen offline',()=>{
    const f=fixture();cpSync(configDirectory,join(f.root,'config'),{recursive:true});mkdirSync(join(f.root,'server/engine/data'),{recursive:true});
    const integration={...nativeIntegrationOptions(f.root),worldId:'fixture',clockPath:f.clockPath},checkpoint=join(f.root,'server/engine/data/housing-checkpoints.sqlite');
    const native={workspace:f.root,worldId:'fixture',housingPath:integration.housingPath,propertyPath:join(f.root,'.local/admin/properties.sqlite'),checkpointPath:checkpoint};
    const title=new PropertyStore(loadPropertyCatalog(join(f.root,'config/properties.json')),native.propertyPath);
    try{title.assignGenesis('opening-house','falador.south-house',1,{kind:'player',id:'ada'},wall);}finally{title.close();}
    const clock=new SimulationClockStore(f.clockPath),agents=new AgentStateStore(f.agentPath,{store:clock,clockId:'world'}),db=new OwnedDatabase(checkpoint),
        persistence=new FoodNeedsPersistence(integration.databasePath,contract.dependencies.needs,contract.dependencies.dynamics,loadFoodLoopCatalog(join(configDirectory,'food-loops.json'))),
        rent=new NativeRentCoordinator(native),snapshots:Array<{at:string;paths:NativeHousingBoundaryPaths}>=[];
    try{
        const bindings=f.scope.actorAgentIds.map(id=>populationNeedsBinding('fixture',agents.getPopulationMember(id)!)),admitted=clock.observe('world',wall,1);
        for(const binding of bindings)persistence.needs.initialize({binding,clock:admitted,history:[],playerTime:null,
            admission:{kind:'genesis',evidenceId:f.options.population!.genesisResultId,evidenceDigest:f.options.population!.genesisResultDigest}});
        const paidAt=clock.observe('world',new Date(Date.parse(wall)+86400000).toISOString(),2),catalogs=nativeHousingCatalogs(f.root);
        const actor=(id:string)=>{const b=bindings.find(b=>b.actorId===id)!;return{agentId:id,username:id,lifecycleId:b.lifecycleId};};
        const order=rent.reserve({operationId:'housing-measurement-rent',worldId:'fixture',clockId:paidAt.clockId,clockProfileDigest:paidAt.profileDigest,
            tenant:actor('bea'),landlord:actor('ada'),housingUnitId:catalogs.native.housingUnitId,bedSlotId:catalogs.native.beds[0]!.bedSlotId,
            startsAt:paidAt.simulationTime,endsAt:'2001-01-03T00:00:00.000Z',expiresAt:new Date(Date.parse(paidAt.wallTime)+300000).toISOString(),amountGp:500,propertyVersion:2,catalogs},paidAt);
        initializeRentJournal(db,'native_rent');
        const escrow=new PlayerInventoryEscrowStore({db,checkpoint:()=>{}}),ids=rentIds(order.binding.intent.operationId);
        const wallet=(initial:number)=>{let gp=initial;return{count:()=>gp,remove:(_id:number,n:number)=>{gp-=n;return n;},add:(_id:number,n:number)=>{gp+=n;return n;}};};
        const tenant=wallet(1000),landlord=wallet(0),account=(id:string)=>({owner:id,save:()=>createSaveData({}),rollback:()=>{}});
        escrow.mutateWithCheckpoint({operation:'hold',escrowId:ids.escrowId,username:'bea',assets:{gp:500,items:[]}},tenant,account('bea'),paidAt.wallTime,order.binding.digest);
        escrow.mutateWithCheckpoint({operation:'commit',escrowId:ids.escrowId,username:'bea',payeeUsername:'ada'},landlord,account('ada'),paidAt.wallTime,order.binding.digest);
        const facts={binding:order.binding,phase:'paid' as const,clock:paidAt,before:{tenant:1000,landlord:0},after:{tenant:500,landlord:500},
            checkpoints:{tenant:'a'.repeat(64),landlord:'b'.repeat(64)}};
        db.transaction(()=>writeRentJournal(db,'native_rent',{...facts,digest:foodDigest(facts)})).immediate();rent.finalize(order.binding.intent.operationId);
        for(const hour of [0,1,2]){
            const wallAt=new Date(Date.parse(paidAt.wallTime)+hour*3600000).toISOString(),observed=clock.observe('world',wallAt,hour+3);
            for(const binding of bindings)persistence.needs.advance({binding,clock:observed,history:[],playerTime:null,expectedRevision:persistence.needs.get(binding)!.revision});
            clock.pause('world',clock.get('world')!.revision,wallAt);
            const directory=join(f.root,'.local/frozen-housing',String(hour));mkdirSync(directory,{recursive:true});
            const sources:NativeHousingBoundaryPaths={clockPath:f.clockPath,agentPath:f.agentPath,needsPath:integration.databasePath,
                housingPath:native.housingPath,propertyPath:native.propertyPath,checkpointPath:checkpoint};
            const paths=Object.fromEntries(Object.entries(sources).map(([key,path])=>{
                const connection=new OwnedDatabase(path);connection.run('PRAGMA wal_checkpoint(TRUNCATE)');connection.close(true);
                const target=join(directory,`${key}.sqlite`);copyFileSync(path,target);return[key,target];
            })) as unknown as NativeHousingBoundaryPaths;
            snapshots.push({at:observed.simulationTime,paths});if(hour<2)clock.resume('world',clock.get('world')!.revision,wallAt);
        }
    }finally{rent.close();persistence.close();db.close(true);agents.close();clock.close();}
    for(const p of snapshots){const point=readHousingAccessPoint(f.scope,integration,p.paths,p.at);expect(point.grants).toHaveLength(1);}
    const options={configDirectory:join(f.root,'config'),nativeOutcomes:f.options,nativeIntegration:{...integration,housingBoundaries:snapshots},
        dependencies:{agentPath:f.agentPath,clockPath:f.clockPath,productionPath:integration.businessPath,enginePath:join(f.root,'absent-trades.sqlite')}};
    const read=()=>reportSocietyEvaluation(f.scope,options),good=read(),housing=good.nativeIntegration!.minimumHousing;
    expect(housing.intervals).toHaveLength(2);expect(housing.intervals.every(i=>i.lowerActorIds.includes('bea'))).toBeTrue();
    expect(good.minimumAssessment.sources.housingAccess.status).toBe('available');
    const cell=good.minimumAssessment.assessment!.requirements.find(r=>r.requirementId==='legal-housing-access-time')!.cells.find(c=>c.subject.actorAgentId==='bea'&&c.subject.bucket===0)!;
    expect(cell.lower).toEqual({numerator:'72000000000',denominator:'86400000'});expect(cell.verdict).toBe('inconclusive');
    expect(good.minimumAssessment.qualifiesMinimum).toBeFalse();
    // Controlled adapter-boundary failures: verified uncovered time survives a partial run; a foreign original admission cannot donate time.
    const absent={...housing,intervals:housing.intervals.map(i=>({...i,lowerActorIds:[],upperActorIds:[]}))};
    const partialScope={...f.scope,toSimulationTime:snapshots[2]!.at},partialOutcomes=reportNativeOutcomes(partialScope,f.options);
    const early=projectNativeMinimumAssessment(contract,partialScope,partialOutcomes,undefined,{...good.nativeIntegration!,scope:partialScope,
        minimumHousing:{...absent,scope:partialScope}});
    expect(early.diagnosticViolations.some(v=>v.requirementId==='legal-housing-access-time')).toBeTrue();expect(early.verdict).toBe('fail');
    const foreign=projectNativeMinimumAssessment(contract,f.scope,f.outcomes(),undefined,{...good.nativeIntegration!,minimumHousing:{...absent,
        intervals:absent.intervals.map(i=>({...i,cohort:i.cohort.map(a=>({...a,admission:{kind:'genesis',evidenceId:'foreign',evidenceDigest:'f'.repeat(64)}}))}))}});
    expect(foreign.requirements.find(r=>r.requirementId==='legal-housing-access-time')!.verdict).toBe('inconclusive');
    const clone=join(f.root,'.local/housing-copy');cpSync(join(f.root,'.local/frozen-housing'),clone,{recursive:true});
    const copied=snapshots.map((s,i)=>({at:s.at,paths:Object.fromEntries(Object.keys(s.paths).map(key=>[key,join(clone,String(i),`${key}.sqlite`)])) as unknown as NativeHousingBoundaryPaths}));
    expect(reportSocietyEvaluation(f.scope,{...options,nativeIntegration:{...integration,housingBoundaries:copied}}).nativeIntegration!.minimumHousing).toEqual(housing);
    mutate(copied[1]!.paths.housingPath,"UPDATE housing_prepaid_period SET source_digest='PRIVATE BAD'");
    const badPayment=reportSocietyEvaluation(f.scope,{...options,nativeIntegration:{...integration,housingBoundaries:copied}});
    expect(badPayment.nativeIntegration!.minimumHousing.intervals).toHaveLength(0);
    expect(JSON.stringify(badPayment.nativeIntegration!.minimumHousing)).not.toContain('PRIVATE BAD');
    mutate(copied[0]!.paths.housingPath,'PRAGMA user_version=99');
    expect(()=>readHousingAccessPoint(f.scope,integration,copied[0]!.paths,copied[0]!.at)).toThrow();
    // A rejected middle point must break both adjacent intervals; it cannot be silently removed then bridged.
    mutate(snapshots[1]!.paths.housingPath,"UPDATE housing_tenancy SET arrears_gp=1");
    const corrupted=read();expect(corrupted.nativeIntegration!.minimumHousing.intervals).toHaveLength(0);
    expect(corrupted.minimumAssessment.requirements.find(r=>r.requirementId==='legal-housing-access-time')!.verdict).toBe('inconclusive');
    // Original admission is mandatory even when a point's owner/payment facts are otherwise native.
    const wrong={...options,nativeIntegration:{...integration,housingBoundaries:[{...snapshots[0]!,at:'PRIVATE BAD'}]}};
    const invalid=reportSocietyEvaluation(f.scope,wrong);expect(invalid.nativeIntegration!.minimumHousing.intervals).toHaveLength(0);
    expect(JSON.stringify(invalid.nativeIntegration!.minimumHousing)).not.toContain('PRIVATE BAD');
},20000);

test('native applied original roster binds automatically; offline members and empty verified death ledger never imply survival PASS',()=>{
    const f=fixture(),before=f.hashes(),r=f.report();expect(r.bindingStatus).toBe('bound');expect(rule(r,'founders-at-start').verdict).toBe('pass');
    expect(rule(r,'founder-survival').cells[0]!.upper).toEqual({numerator:'40000',denominator:'4'});
    expect(rule(r,'founder-survival').verdict).toBe('inconclusive');expect(rule(r,'minimum-living-founders').verdict).toBe('inconclusive');
    expectOnlyFrozenRosterGate(r);expect(r.verdict).toBe('inconclusive');expect(f.hashes()).toEqual(before);
    expect(f.report().digest).toBe(r.digest);
});

test('frozen founder roster gate retains the original dead and offline founders without donating survival or full minimum PASS',()=>{
    const f=fixture();f.kill('2001-01-04T00:00:00.000Z',true);const r=f.report();
    expectOnlyFrozenRosterGate(r);expect(r.assessment!.integrity.find(g=>g.gateId==='frozen-founder-roster')!.verdict).toBe('pass');
    expect(rule(r,'founder-survival').verdict).toBe('fail');expect(r.verdict).toBe('fail');expect(r.qualifiesMinimum).toBeFalse();
    expect(f.outcomes().sources.populationDeaths.status).toBe('available');
});

test('frozen founder roster gate rejects missing, duplicate, foreign or malformed bindings and requires a valid native run frame',()=>{
    const f=fixture(),base=f.outcomes();expect(base.sources.populationDeaths.status).toBe('available');
    if(base.sources.populationDeaths.status!=='available')throw Error('Fixture population unavailable');const original=base.sources.populationDeaths.value;
    for(const roster of [original.founderBindings.slice(1),[original.founderBindings[0],...original.founderBindings.slice(0,-1)],
        original.founderBindings.map((a,i)=>i?a:{...a,username:'foreign'}),original.founderBindings.map((a,i)=>i?a:{...a,lifecycleId:'bad'})]){
        const outcomes={...base,sources:{...base.sources,populationDeaths:{...base.sources.populationDeaths,value:{...original,founderBindings:roster}}}} as any;
        const r=projectNativeMinimumAssessment(contract,f.scope,outcomes);expect(r.integrity.find(g=>g.gateId==='frozen-founder-roster')!.verdict).toBe('inconclusive');
    }
    for(const status of ['invalid','unavailable'] as const){const outcomes={...base,sources:{...base.sources,populationDeaths:{status,reason:'Unavailable'}}} as any;
        expect(projectNativeMinimumAssessment(contract,f.scope,outcomes).integrity.find(g=>g.gateId==='frozen-founder-roster')!.verdict).toBe('inconclusive');}
    const foreign={...f.scope,clockId:'foreign'};expect(projectNativeMinimumAssessment(contract,foreign,base).integrity.find(g=>g.gateId==='frozen-founder-roster')!.verdict).toBe('inconclusive');
    const short={...f.scope,toSimulationTime:'2001-01-03T00:00:00.000Z'},partial=projectNativeMinimumAssessment(contract,short,reportNativeOutcomes(short,f.options));
    expect(partial.bindingStatus).toBe('invalid');expect(partial.integrity.find(g=>g.gateId==='frozen-founder-roster')!.verdict).toBe('inconclusive');
});
test('frozen physical food bounds reach reserve/retention rules, exclude inaccessible stock, retain scoped failures and reopen offline',()=>{
    const f=fixture();cpSync(configDirectory,join(f.root,'config'),{recursive:true});mkdirSync(join(f.root,'server/engine/data'),{recursive:true});mkdirSync(join(f.root,'.local/simulation'),{recursive:true});
    const integration={...nativeIntegrationOptions(f.root),worldId:'fixture',clockPath:f.clockPath},checkpoint=join(f.root,'server/engine/data/checkpoints.sqlite');
    integration.nativeFoodCheckpointPath=checkpoint;
    new BusinessManagerStore(integration.businessPath).close();new BusinessAssetStore(integration.businessPath).close();new InstitutionTreasuryStore(integration.treasuryPath).close();
    new ProductionWorkInProgressStore(integration.businessPath,loadDefaultProductionWorkflowCatalog(),undefined,false).close();
    const clock=new SimulationClockStore(f.clockPath),agents=new AgentStateStore(f.agentPath,{store:clock,clockId:'world'}),db=new OwnedDatabase(checkpoint),
        persistence=new FoodNeedsPersistence(integration.databasePath,contract.dependencies.needs,contract.dependencies.dynamics,loadFoodLoopCatalog(join(configDirectory,'food-loops.json')));
    const snapshots:Array<{at:string;paths:NativeFoodBoundaryPaths}>=[];
    try{
        new NativeFoodConsumptionStore({db});new PlayerInventoryEscrowStore({db,checkpoint:()=>{}});db.run('CREATE TABLE accounts(owner TEXT PRIMARY KEY,save BLOB NOT NULL)');
        const bindings=f.scope.actorAgentIds.map(id=>{
            agents.setCharacterBirth(id,agents.getCharacterLifecycle(id)!.revision,initial,'born',wall);
            db.run('INSERT INTO accounts VALUES(?1,?2)',[id,createSaveData({inventory:[{id:379,count:100}],bank:[]})]);
            return populationNeedsBinding('fixture',agents.getPopulationMember(id)!);
        });
        const admitted=clock.observe('world',wall,1);
        for(const binding of bindings)persistence.needs.initialize({binding,clock:admitted,history:[],playerTime:null,
            admission:{kind:'genesis',evidenceId:f.options.population!.genesisResultId,evidenceDigest:f.options.population!.genesisResultDigest}});
        for(const [index,elapsed] of [86400000,8*86400000].entries()){
            const at=new Date(Date.parse(initial)+elapsed).toISOString(),wallAt=new Date(Date.parse(wall)+elapsed).toISOString(),observed=clock.observe('world',wallAt,index+2);
            closeFoodDeliveryTick(db,observed);
            for(const binding of bindings)persistence.needs.advance({binding,clock:observed,history:[],playerTime:null,expectedRevision:persistence.needs.get(binding)!.revision});
            clock.pause('world',clock.get('world')!.revision,wallAt);
            const directory=join(f.root,'.local/frozen',String(index));mkdirSync(directory,{recursive:true});
            const sources:NativeFoodBoundaryPaths={checkpointPath:checkpoint,needsPath:integration.databasePath,clockPath:f.clockPath,businessPath:integration.businessPath,
                treasuryPath:integration.treasuryPath,agentPath:f.agentPath,healthPath:f.healthPath};
            const paths=Object.fromEntries(Object.entries(sources).map(([key,path])=>{
                const connection=new OwnedDatabase(path);connection.run('PRAGMA wal_checkpoint(TRUNCATE)');connection.close(true);
                const target=join(directory,`${key}.sqlite`);copyFileSync(path,target);return[key,target];
            })) as unknown as NativeFoodBoundaryPaths;snapshots.push({at,paths});
            if(index===0)clock.resume('world',clock.get('world')!.revision,wallAt);
        }
    }finally{persistence.close();db.close(true);agents.close();clock.close();}
    const options={configDirectory:join(f.root,'config'),nativeOutcomes:f.options,nativeIntegration:{...integration,foodBoundaries:snapshots},
        dependencies:{agentPath:f.agentPath,clockPath:f.clockPath,productionPath:integration.businessPath,enginePath:join(f.root,'absent-trades.sqlite')}};
    for(const s of snapshots)readNativeFoodBoundary(f.scope,options.nativeIntegration,s.paths,readWealthBoundary(f.scope,options.nativeIntegration,s.paths,s.at));
    const read=()=>reportSocietyEvaluation(f.scope,options),good=read();
    expect(good.nativeIntegration!.minimumFood.boundaries.every(b=>b.source.status==='available')).toBeTrue();
    expect(good.minimumAssessment.requirements.find(r=>r.requirementId==='food-stock-retention')!.verdict).toBe('pass');
    const reserve=good.minimumAssessment.assessment!.requirements.find(r=>r.requirementId==='food-reserve-coverage')!;
    expect(reserve.cells.every(c=>c.verdict==='pass')).toBeTrue();expect(reserve.verdict).toBe('inconclusive'); // Two endpoints are not every native boundary.
    const clone=join(f.root,'.local/frozen-copy');cpSync(join(f.root,'.local/frozen'),clone,{recursive:true});
    const cloned=snapshots.map((s,i)=>({at:s.at,paths:Object.fromEntries(Object.keys(s.paths).map(key=>[key,join(clone,String(i),`${key}.sqlite`)])) as unknown as NativeFoodBoundaryPaths}));
    expect(reportSocietyEvaluation(f.scope,{...options,nativeIntegration:{...integration,foodBoundaries:cloned}}).nativeIntegration!.minimumFood).toEqual(good.nativeIntegration!.minimumFood);
    const closing=new OwnedDatabase(snapshots[1]!.paths.checkpointPath);
    try{closing.run('UPDATE accounts SET save=?1',[createSaveData({inventory:[{id:377,count:100}],bank:[{id:379,count:100}]})]);}finally{closing.close(true);}
    expect(read().minimumAssessment.requirements.find(r=>r.requirementId==='food-stock-retention')!.verdict).toBe('inconclusive');
    const empty=new OwnedDatabase(snapshots[1]!.paths.checkpointPath);try{empty.run('UPDATE accounts SET save=?1',[createSaveData({inventory:[{id:377,count:100},{id:381,count:100}],bank:[]})]);}finally{empty.close(true);}
    const failed=read();expect(failed.minimumAssessment.requirements.find(r=>r.requirementId==='food-stock-retention')!.verdict).toBe('fail');
    expect(failed.minimumAssessment.requirements.find(r=>r.requirementId==='food-reserve-coverage')!.verdict).toBe('fail');
    expect(failed.minimumAssessment.qualifiesMinimum).toBeFalse();
    mutate(snapshots[0]!.paths.healthPath,"UPDATE engine_health_audit_tail SET entry_hash='PRIVATE BAD' WHERE domain='death'");
    const partial=read();expect(partial.minimumAssessment.requirements.find(r=>r.requirementId==='food-reserve-coverage')!.verdict).toBe('fail');
    expect(JSON.stringify(partial.nativeIntegration!.minimumFood)).not.toContain('PRIVATE BAD');
},20000);
test('engine death before delayed AgentState projection fails original four-founder survival; projecting it does not drop the founder',()=>{
    for(const project of [false,true]){const f=fixture();f.kill('2001-01-04T00:00:00.000Z',project);const r=f.report();
        expect(r.bindingStatus).toBe('bound');expect(r.assessment!.frame.founderAgentIds).toHaveLength(4);
        expect(rule(r,'founder-survival').cells[0]!.upper).toEqual({numerator:'30000',denominator:'4'});
        expect(rule(r,'founder-survival').verdict).toBe('fail');expect(rule(r,'minimum-living-founders').verdict).toBe('fail');expect(r.verdict).toBe('fail');
    }
});
test('deaths during warmup and at closing count; a death strictly after the evaluation cannot be backdated into it',()=>{
    for(const at of ['2001-01-01T12:00:00.000Z','2001-01-09T00:00:00.000Z','2001-01-09T00:00:00.001Z']){
        const f=fixture();f.kill(at);const r=f.report();expect(rule(r,'founder-survival').verdict).toBe(at.endsWith('.001Z')?'inconclusive':'fail');
        expect(rule(r,'minimum-living-founders').cells[0]!.verdict).toBe(at<'2001-01-02T00:00:00.000Z'?'fail':'inconclusive');
    }
});
test('selecting only remaining founders or a foreign clock cannot narrow the original population denominator',()=>{
    const f=fixture();f.kill('2001-01-04T00:00:00.000Z');
    for(const scope of [{...f.scope,actorAgentIds:['bea','cora','dora']},{...f.scope,clockProfileDigest:'f'.repeat(64)}]){
        const r=projectNativeMinimumAssessment(contract,scope,reportNativeOutcomes(scope,f.options));
        expect(r.bindingStatus).toBe('unbound');expect(r.sources.populationBaseline.status).toBe('invalid');expect(r.verdict).toBe('inconclusive');
    }
});
test('a terminal violation remains visible in an unfinished original evaluation without pretending the complete window was observed',()=>{
    const f=fixture();f.kill('2001-01-04T00:00:00.000Z');const scope={...f.scope,toSimulationTime:'2001-01-05T00:00:00.000Z'};
    const r=projectNativeMinimumAssessment(contract,scope,reportNativeOutcomes(scope,f.options));
    expect(r.bindingStatus).toBe('invalid');expect(r.assessment).toBeNull();expect(r.verdict).toBe('fail');expect(r.qualifiesMinimum).toBeFalse();
    expect(r.diagnosticViolations.map(v=>v.requirementId)).toEqual(['minimum-living-founders','founder-survival']);
    const foreign={...scope,fromSimulationTime:'2001-01-03T00:00:00.000Z'};
    expect(projectNativeMinimumAssessment(contract,foreign,reportNativeOutcomes(foreign,f.options)).diagnosticViolations).toHaveLength(0);
});
test('missing/corrupt death authority preserves native roster but never donates survival evidence or echoes private errors',()=>{
    for(const sql of ["UPDATE engine_health_audit_tail SET entry_hash='PRIVATE CORRUPT' WHERE domain='death'","DELETE FROM engine_population_binding WHERE username='ada'"]){
        const f=fixture();f.kill('2001-01-04T00:00:00.000Z');mutate(f.healthPath,sql);const r=f.report();
        expect(rule(r,'founders-at-start').verdict).toBe('pass');expect(rule(r,'founder-survival').verdict).toBe('inconclusive');
        expect(r.sources.populationDeaths.status).toBe('invalid');expect(JSON.stringify(f.outcomes())).not.toContain('PRIVATE CORRUPT');
    }
    const f=fixture();rmSync(f.healthPath);expect(f.report().sources.populationDeaths.status).toBe('unavailable');
});
test('replaced lifecycle identity and reset genesis reject native population proof instead of manufacturing a new cohort',()=>{
    const f=fixture();f.kill('2001-01-04T00:00:00.000Z');mutate(f.agentPath,"UPDATE agent_population_member SET created_at='2030-01-02T00:00:00.000Z' WHERE agent_id='ada'");
    expect(f.report().sources.populationDeaths.status).toBe('invalid');expect(f.report().verdict).toBe('inconclusive');
    mutate(f.genesisPath,"UPDATE world_genesis_application SET status='reset'");expect(f.report().bindingStatus).toBe('unbound');
});
test('native SQLite-to-evaluation facade retains population FAIL with unavailable work/food/finance channels',()=>{
    const f=fixture();f.kill('2001-01-04T00:00:00.000Z');const evaluation=reportSocietyEvaluation(f.scope,{configDirectory,nativeOutcomes:f.options,
        dependencies:{agentPath:f.agentPath,clockPath:f.clockPath,productionPath:join(f.root,'absent-business.sqlite'),enginePath:join(f.root,'absent-trades.sqlite')}});
    expect(evaluation.societyMinimumVerdict).toBe('fail');expect(evaluation.minimumAssessment.bindingStatus).toBe('bound');
    expect(evaluation.minimumAssessment.requirements.find(r=>r.requirementId==='founder-survival')!.verdict).toBe('fail');
});
test('native applied founders, physiology journals and food watermark reach all four minimum exposure rules in the real evaluation facade',()=>{
    const f=fixture();cpSync(configDirectory,join(f.root,'config'),{recursive:true});
    mkdirSync(join(f.root,'server/engine/data'),{recursive:true});mkdirSync(join(f.root,'.local/simulation'),{recursive:true});
    const checkpoint=join(f.root,'server/engine/data/checkpoints.sqlite'),path=join(f.root,'.local/simulation/food-needs.sqlite');
    const db=new OwnedDatabase(checkpoint),clock=new SimulationClockStore(f.clockPath),agents=new AgentStateStore(f.agentPath,undefined,true),
        persistence=new FoodNeedsPersistence(path,contract.dependencies.needs,contract.dependencies.dynamics,loadFoodLoopCatalog(join(configDirectory,'food-loops.json')));
    try{
        const consumption=new NativeFoodConsumptionStore({db}),production=new NativeFoodProductionStore(db);
        new TradeEvidenceStore(join(f.root,'server/engine/data/mods/trade-evidence.sqlite')).close();
        const bindings=f.scope.actorAgentIds.map(id=>populationNeedsBinding('fixture',agents.getPopulationMember(id)!)),opening=clock.observe('world',wall);
        for(const binding of bindings)persistence.needs.initialize({binding,clock:opening,history:[],playerTime:null,
            admission:{kind:'genesis',evidenceId:f.options.population!.genesisResultId,evidenceDigest:f.options.population!.genesisResultDigest}});
        const b=bindings[0]!,observe=(hours:number)=>clock.observe('world',new Date(Date.parse(wall)+hours*3600000).toISOString(),Math.round(hours*100));
        for(const [kind,hours] of [['gather',25],['cook',26]] as const){
            const action:FoodProductionAction=production.admit({actionId:crypto.randomUUID(),worldId:b.worldId,actorId:b.actorId,username:b.playerId,lifecycleId:b.lifecycleId,
                clockId:b.clockId,clockProfileDigest:b.clockProfileDigest,kind,runId:'native-food',batchId:'batch',policyDigest:'a'.repeat(64),catalogDigest:'b'.repeat(64),
                source:{kind:kind==='gather'?'npc':'loc',sourceId:'finite-source',typeId:1,x:3200,z:3200,level:0},recipeId:'food.cook-lobster',recipeVersion:'1.0.0'});
            db.transaction(()=>production.finish({schemaVersion:1,action,requestDigest:foodDigest(action),outcome:kind==='gather'?'raw-gained':'cooked',
                inputs:kind==='gather'?[]:[{itemId:377,quantity:1}],outputs:[{itemId:kind==='gather'?377:379,quantity:1}],before:{raw:kind==='gather'?0:1,cooked:0,burnt:0},
                after:{raw:kind==='gather'?1:0,cooked:kind==='cook'?1:0,burnt:0},quota:kind==='gather'?production.takeQuota(action,1):null,
                clock:observe(hours),checkpointId:`food-production:${action.actionId}`,checkpointDigest:'d'.repeat(64)})).immediate();
        }
        const action=consumption.admit({actionId:crypto.randomUUID(),worldId:b.worldId,actorId:b.actorId,username:b.playerId,lifecycleId:b.lifecycleId,
            clockId:b.clockId,clockProfileDigest:b.clockProfileDigest,itemId:379,quantity:1,slot:0,policyDigest:foodDigest(FOOD_POLICY)}),mealClock=observe(27);
        db.transaction(()=>consumption.finish({action,outcome:'consumed',receipt:{...action,schemaVersion:1,cause:'content:consume_effect_stat',before:1,after:0,hpBefore:10,hpAfter:10,
            clock:mealClock,checkpointId:`food:${action.actionId}`,checkpointDigest:'d'.repeat(64),requestDigest:foodDigest(action)}},mealClock)).immediate();closeFoodDeliveryTick(db,mealClock);
        const source=new NativeFoodSource({workspace:f.root,worldId:'fixture',checkpointPath:checkpoint});
        try{persistence.nativeFood.apply(source,1,{binding:b,clock:mealClock,history:[],playerTime:null,expectedRevision:1});}finally{source.close();}
        const closing=clock.observe('world',new Date(Date.parse(wall)+8*86400000).toISOString(),42);closeFoodDeliveryTick(db,closing);
        for(const binding of bindings)persistence.needs.advance({binding,clock:closing,history:[],playerTime:null,expectedRevision:persistence.needs.get(binding)!.revision});
    }finally{persistence.close();agents.close();clock.close();db.close(true);}
    const nativeIntegration={...nativeIntegrationOptions(f.root),worldId:'fixture',clockPath:f.clockPath,databasePath:path,nativeFoodCheckpointPath:checkpoint};
    const options={configDirectory:join(f.root,'config'),nativeOutcomes:f.options,nativeIntegration,
        dependencies:{agentPath:f.agentPath,clockPath:f.clockPath,productionPath:join(f.root,'absent-business.sqlite'),enginePath:join(f.root,'absent-trades.sqlite')}};
    const before=[...f.hashes(),readFileSync(path),readFileSync(checkpoint)],evaluation=reportSocietyEvaluation(f.scope,options),minimum=evaluation.minimumAssessment;
    expect(minimum.sources.needsExposure.status).toBe('available');expect(minimum.bindingStatus).toBe('bound');
    for(const id of ['hunger-satisfied-time','fatigue-satisfied-time','hunger-continuous-critical-time','fatigue-continuous-critical-time'])
        expect(minimum.requirements.find(r=>r.requirementId===id)!.verdict).toBe('fail');
    expect(minimum.assessment!.requirements.find(r=>r.requirementId==='fatigue-satisfied-time')!.cells).toHaveLength(28);
    expect(minimum.sources.foodMinimum.status).toBe('available');
    expect(minimum.assessment!.requirements.find(r=>r.requirementId==='internal-food-relief-share')!.cells[0]!.verdict).toBe('pass');
    expect(evaluation.societyMinimumVerdict).toBe('fail');expect(minimum.qualifiesMinimum).toBeFalse();
    expect([...f.hashes(),readFileSync(path),readFileSync(checkpoint)]).toEqual(before);
    const partial={...f.scope,toSimulationTime:'2001-01-04T00:00:00.000Z'};
    expect(reportSocietyEvaluation(partial,options).minimumAssessment.diagnosticViolations.some(r=>r.requirementId==='fatigue-continuous-critical-time')).toBeTrue();
    const invalid=projectNativeMinimumAssessment(contract,f.scope,f.outcomes(),undefined,
        {...evaluation.nativeIntegration!,scope:{...f.scope,clockProfileDigest:'f'.repeat(64)}});
    expect(invalid.sources.needsExposure.status).toBe('invalid');expect(invalid.verdict).toBe('inconclusive');
});
