import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import originalMiningDefinition from '../catalog/mining.varrock-east.copper-to-bank@1.0.0.skill.json';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { populationNeedsBinding } from '../../needs/population-binding.js';
import { SkillRegistry } from '../registry.js';
import { resolveSkillParameters } from '../validation.js';
import { miningAdmissionDigest as hash,persistMiningOperationAdmission,miningDemandId } from '../mining-admission.js';
import { miningGatherArgs,type MiningDemandRequest } from '../../sdk/mining-demand.js';
import { miningOwner } from '../mining-demand-source.js';
import type { NativeToolOwner } from '../../item-lifecycle/native-tool.js';
import type { SkillDefinition } from '../types.js';

export function miningSourceFixture(draft?:SkillDefinition){
    const root=mkdtempSync(join(tmpdir(),'si-c07-mining-source-'));
    const clock=new SimulationClockStore(join(root,'.local/simulation/clock.sqlite'));
    const created=clock.create({clockId:'mining-clock',profile:{schemaVersion:1,profileId:'mining-fixture',version:'1.0.0',seed:'fixture',
        rate:{simulationMilliseconds:288,wallMilliseconds:1}},wallTime:new Date().toISOString(),simulationTime:'2001-01-01T00:00:00.000Z'});
    const agents=new AgentStateStore(join(root,'.local/agent-state/agents.sqlite'),{store:clock,clockId:created.clockId});
    agents.createIdentity({agentId:'actor-worker',playerUsername:'worker',displayName:'Worker',background:'Explicit local mechanical admission fixture',personalityTraits:['steady']});
    const member=agents.bindPopulationMember({agentId:'actor-worker',playerUsername:'worker',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
        lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',digest:'b'.repeat(64),kind:'finite'},simulationClock:{clockId:created.clockId,profileDigest:created.profileDigest},
        joinedAtSimulationTime:'2001-01-01T00:00:00.000Z',sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)});
    const {playerId,...binding}=populationNeedsBinding('mining-world',member);
    const owner=miningOwner({...binding,username:playerId} as NativeToolOwner);
    const whole=new SkillRegistry().register(draft??originalMiningDefinition,{trusted:true});
    const repeat=whole.definition.steps.find(s=>s.kind==='repeat');
    const gather=(repeat?.kind==='repeat'?repeat.steps:whole.definition.steps).find(s=>s.kind==='operation'&&s.operation==='gather-loc');
    if(!gather||gather.kind!=='operation')throw Error('Mining fixture gather missing');
    const definition=draft?whole.definition:{...whole.definition,preconditions:[],steps:[gather]}; // Controlled reviewed-fixture subset, never published.
    const registered=new SkillRegistry().register(definition,{trusted:true}),ref={id:definition.id,version:definition.version};
    mkdirSync(join(root,'agent-skills/catalog'),{recursive:true});writeFileSync(join(root,'agent-skills/catalog',`${ref.id}@${ref.version}.skill.json`),JSON.stringify(definition));
    agents.setSkillKnowledge(owner.actorId,ref,'known',null);
    const parameters=resolveSkillParameters(registered.definition,{}),parametersDigest=hash(Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b)));
    const context={runId:randomUUID(),skill:ref,stepId:gather.id,parametersDigest,operationSequence:1};
    const request:MiningDemandRequest={operation:'open',args:miningGatherArgs(gather.arguments),context};
    const runs=join(root,'.local/agent-skills/runs'),markerPath=join(root,'.local/admin/active-skills/worker.json');
    mkdirSync(runs,{recursive:true});mkdirSync(join(root,'.local/admin/active-skills'),{recursive:true});
    writeFileSync(join(runs,`${context.runId}.admission.json`),JSON.stringify({schemaVersion:1,runId:context.runId,username:'worker',skill:ref,checksum:registered.checksum,parameters,parametersDigest}));
    function admit(r=request){const admitted=persistMiningOperationAdmission(root,'worker',registered.checksum,r);
        writeFileSync(markerPath,JSON.stringify({username:'worker',skillId:ref.id,version:ref.version,runId:r.context.runId,heartbeatAt:new Date().toISOString(),
            miningOperationSequence:r.context.operationSequence,miningAdmissionDigest:admitted.digest}));return admitted;}
    return{root,agents,clock,owner,request,registered,parameters,markerPath,admit,demandId:miningDemandId(request),
        close(){agents.close();clock.close();rmSync(root,{recursive:true,force:true});}};
}
