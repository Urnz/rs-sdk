import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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

const directories:string[]=[],configDirectory=join(import.meta.dir,'../../config'),initial='2001-01-01T00:00:00.000Z',wall='2030-01-01T00:00:00.000Z';
const contract=loadSocietyMinimumContract(configDirectory),age=loadPopulationAgePolicy(join(configDirectory,'population-age-policy.json')),
    mortality=loadPopulationMortalityPolicy(join(configDirectory,'population-mortality-policy.json'));
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function mutate(path:string,sql:string){const db=new OwnedDatabase(path);try{db.run(sql);}finally{db.close(true);}}
function fixture(){
    const root=mkdtempSync(join(tmpdir(),'native-founders-'));directories.push(root);
    const agentPath=join(root,'agents.sqlite'),clockPath=join(root,'clock.sqlite'),genesisPath=join(root,'genesis.sqlite'),
        integrityPath=join(root,'integrity.sqlite'),healthPath=join(root,'health.sqlite');
    const clock=new SimulationClockStore(clockPath),created=clock.create({clockId:'world',
        profile:{schemaVersion:1,profileId:'population-fixture',version:'1.0.0',seed:'population',rate:{simulationMilliseconds:1,wallMilliseconds:1}},wallTime:wall,simulationTime:initial});
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

test('native applied original roster binds automatically; offline members and empty verified death ledger never imply survival PASS',()=>{
    const f=fixture(),before=f.hashes(),r=f.report();expect(r.bindingStatus).toBe('bound');expect(rule(r,'founders-at-start').verdict).toBe('pass');
    expect(rule(r,'founder-survival').cells[0]!.upper).toEqual({numerator:'40000',denominator:'4'});
    expect(rule(r,'founder-survival').verdict).toBe('inconclusive');expect(rule(r,'minimum-living-founders').verdict).toBe('inconclusive');
    expect(r.integrity.every(g=>g.verdict==='inconclusive')).toBeTrue();expect(r.verdict).toBe('inconclusive');expect(f.hashes()).toEqual(before);
    expect(f.report().digest).toBe(r.digest);
});
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
