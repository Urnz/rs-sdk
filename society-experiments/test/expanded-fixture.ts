import { afterEach } from 'bun:test';
import { mkdirSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { tmpdir } from 'node:os';
import { OwnedDatabase as Database } from '../../server/engine/src/io/OwnedDatabase.js';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { NativeToolStore } from '../../item-lifecycle/native-tool.js';
import { NativeToolWorkStore } from '../../production-workflow/native-tool-work.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { BusinessWorkStore } from '../../business-work/work.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { NeedsStore } from '../../needs/store.js';
import { loadNeedsPolicyCatalog,loadNeedsDynamicsPolicyCatalog } from '../../needs/config.js';
import type { LongExperimentPlan } from '../plan.js';
import type { ExpandedSelection } from '../expanded-baseline.js';
const directories:string[]=[];
afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
export const put=(root:string,path:string,value:string|Uint8Array)=>{const full=join(root,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,value);};
export const git=(root:string,...args:string[])=>{const r=Bun.spawnSync(['git','-C',root,'-c','core.autocrlf=false','-c','commit.gpgsign=false',...args],{stdout:'pipe',stderr:'pipe'});
    if(r.exitCode)throw Error(r.stderr.toString());return r.stdout.toString();};
export const expandedPlan:LongExperimentPlan={schemaVersion:1,sessionId:'si-c06-fixture',label:'Expanded archive',summary:'Mechanical evidence replay, not autonomous performance.',
    genesisResultId:'genesis.test',genesisResultDigest:'a'.repeat(64),parameterProfileId:'baseline',parameterProfileVersion:'1.0.0',parameterProfileDigest:'b'.repeat(64),
    attributeBudgetPolicyId:'default-npc-attributes',attributeAllocationPolicyId:'default-npc-allocation',expectedConditionDigest:'c'.repeat(64),expectedInitialStateDigest:'d'.repeat(64),
    warmupSimulationMilliseconds:0,evaluationSimulationMilliseconds:86400000,bucketSimulationMilliseconds:3600000,cadenceSimulationMilliseconds:1800000,
    maximumGapSimulationMilliseconds:3600000,maximumWaveWallMilliseconds:60000,maximumWallMilliseconds:172800000};
export function expandedFixture(){
    const directory=mkdtempSync(join(tmpdir(),'si-c06-'));directories.push(directory);const root=join(directory,'source');mkdirSync(root);
    put(root,'.gitignore','.local/\nserver/engine/data/\n.env\n');put(root,'package.json','{"name":"expanded-fixture"}');
    put(root,'config/simulation-clock.json','{}');put(root,'config/llm-runtime.json','{"provider":"mock","model":"fixture"}');put(root,'source.ts','export const fixture = 1;');
    git(root,'init','-q');git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    put(root,'server/engine/data/pack/server/script.dat','fixture cache');put(root,'server/engine/data/players/main/worker.sav',new Uint8Array([1,2,3]));
    const agentPath='.local/agent-state/agents.sqlite',clockPath='.local/simulation/simulation-clock.sqlite',checkpoint='server/engine/data/player-checkpoints.sqlite';
    const agents=new AgentStateStore(join(root,agentPath));agents.createIdentity({agentId:'worker',playerUsername:'worker',displayName:'Worker',background:'Fixture',personalityTraits:['steady']});agents.close();
    const clock=new SimulationClockStore(join(root,clockPath)),created=clock.create({clockId:'world',profile:{schemaVersion:1,profileId:'fixture',version:'1.0.0',seed:'fixture',rate:{simulationMilliseconds:1,wallMilliseconds:1}},
        wallTime:'2026-10-24T10:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z'});try{clock.pause('world',created.revision,'2026-10-24T10:00:00.000Z');}finally{clock.close();}
    const memberClock=new SimulationClockStore(join(root,clockPath)),population=new AgentStateStore(join(root,agentPath),{store:memberClock,clockId:'world'});try{population.bindPopulationMember({agentId:'worker',playerUsername:'worker',
        worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',digest:'b'.repeat(64),kind:'finite'},
        simulationClock:{clockId:'world',profileDigest:created.profileDigest},joinedAtSimulationTime:'2001-01-01T00:00:00.000Z',
        sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)},'2026-10-24T10:00:00.000Z');}finally{population.close();memberClock.close();}
    const manager=new BusinessManagerStore(join(root,'.local/economy/businesses.sqlite'));manager.close();new BusinessWorkStore(join(root,'.local/economy/businesses.sqlite')).close();
    new InstitutionTreasuryStore(join(root,'.local/economy/institution-treasury.sqlite')).close();
    const policy=loadNeedsPolicyCatalog(join(import.meta.dir,'../../config/needs-policies.json')).policies[0]!;
    const dynamics=loadNeedsDynamicsPolicyCatalog(join(import.meta.dir,'../../config/needs-dynamics-policies.json'),policy).policies[0]!;
    new NeedsStore(join(root,'.local/simulation/food-needs.sqlite'),policy,dynamics).close();
    const db=new Database(join(root,checkpoint),{create:true});new NativeToolStore(db);new NativeToolWorkStore(db);db.close();
    for(const path of ['.local/simulation/world-genesis-runs.sqlite','.local/simulation/society-integrity.sqlite','.local/admin/experiment-parameters.sqlite']){
        mkdirSync(dirname(join(root,path)),{recursive:true});const db=new Database(join(root,path),{create:true});db.run('CREATE TABLE fixture(value TEXT)');db.close();}
    put(root,'.local/society-metrics/finance-boundaries/opening.json','{"fixtureObservation":"preserved"}');
    const selected:ExpandedSelection={worldId:'fixture',clockId:'world',clockProfileDigest:created.profileDigest,seed:'fixture',runId:expandedPlan.sessionId,
        provider:{provider:'mock',model:'fixture',reasoningEffort:null},reportVersion:'si-c05.v1',stores:[
            {role:'agent',path:agentPath,requiredTables:['agent_population_member','character_attribute_binding']},
            {role:'clock',path:clockPath,requiredTables:['simulation_clock']},
            {role:'needs',path:'.local/simulation/food-needs.sqlite',requiredTables:['needs_state','needs_event']},
            {role:'checkpoint',path:checkpoint,requiredTables:['native_tool_binding','native_tool_work']},
            {role:'business',path:'.local/economy/businesses.sqlite',requiredTables:['business','business_work_binding']},
            {role:'treasury',path:'.local/economy/institution-treasury.sqlite',requiredTables:['institution_treasury']} ]};
    return{root,directory,checkpoint,selected,plan:expandedPlan,bundle:join(directory,'baseline'),output:join(directory,'restored')};
}
