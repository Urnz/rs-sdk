import { expect,test } from 'bun:test';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/index.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { PropertyStore } from '../../server/engine/src/mods/PropertyStore.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { nativeToolDigest } from '../../item-lifecycle/native-tool.js';
import { NativeToolWorkAccessSource } from '../native-tool-work-source.js';
import { TOOL_WORK_SKILLS } from '../native-tool-work-policy.js';
import { persistToolWorkInvocation,toolSkillOperationId } from '../native-tool-work-invocation.js';
import { toolTrialAuthorization } from '../../agent-skills/tool-trials.js';
import { SkillRegistry } from '../../agent-skills/registry.js';
import { randomUUID } from 'node:crypto';

test('SI-C03 access reopens actual learned procedure, active population, Business and native Property authorities',()=>{
    const directory=mkdtempSync(join(tmpdir(),'tool-access-')),workspace=resolve(import.meta.dir,'../..'),skillDirectory=join(directory,'skills');mkdirSync(skillDirectory);
    const clock=new SimulationClockStore(join(directory,'clock.sqlite'));
    const state=clock.create({clockId:'tool-world',profile:{schemaVersion:1,profileId:'normal',version:'1.0.0',seed:'tool-test',
        rate:{simulationMilliseconds:1,wallMilliseconds:1}},wallTime:'2026-10-24T00:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z'});
    const agentsPath=join(directory,'agents.sqlite'),businessPath=join(directory,'businesses.sqlite'),propertyPath=join(directory,'properties.sqlite');
    const agents=new AgentStateStore(agentsPath,{store:clock,clockId:'tool-world'}),business=new BusinessManagerStore(businessPath);
    const property=new PropertyStore(loadPropertyCatalog(join(workspace,'config/properties.json')),propertyPath);
    try{
        agents.createIdentity({agentId:'tool-worker',playerUsername:'worker',displayName:'Worker',background:'Native repair test.',personalityTraits:['steady']});
        const member=agents.bindPopulationMember({agentId:'tool-worker',playerUsername:'worker',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
            lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',digest:'b'.repeat(64),kind:'finite'},simulationClock:{clockId:'tool-world',profileDigest:state.profileDigest},
            joinedAtSimulationTime:'2001-01-01T00:00:00.000Z',sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)});
        const lifecycleId=nativeToolDigest({agentId:member.agentId,createdAt:member.characterLifecycle.createdAt,origin:member.characterLifecycle.origin,
            createdAtSimulationTime:member.characterLifecycle.createdAtSimulationTime,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest,
            worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,simulationClock:member.simulationClock});
        const owner={actorId:'tool-worker',username:'worker',lifecycleId,worldId:'fixture',clockId:'tool-world',clockProfileDigest:state.profileDigest};
        const observation={clockId:state.clockId,profileDigest:state.profileDigest,status:'running' as const,revision:1,engineTick:1,
            wallTime:'2026-10-24T00:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z'};
        const source=new NativeToolWorkAccessSource({workspace,agentsPath,businessPath,propertyPath,skillDirectory});
        for(const ref of Object.values(TOOL_WORK_SKILLS)){
            const draft=JSON.parse(readFileSync(join(workspace,'agent-skills/catalog',`${ref.id}@0.1.0.skill.json`),'utf8'));
            writeFileSync(join(skillDirectory,`${ref.id}@${ref.version}.skill.json`),JSON.stringify({...draft,version:ref.version,status:'verified',
                provenance:{...draft.provenance,authorKind:'system',authorId:'fixture-verifier'}}));
        }
        expect(()=>source.authorize(owner,'smelt',null,observation)).toThrow('learned');
        const draft=JSON.parse(readFileSync(join(workspace,'agent-skills/catalog/procedure.metallurgy.smelt-bronze@0.1.0.skill.json'),'utf8'));
        writeFileSync(join(skillDirectory,`${draft.id}@${draft.version}.skill.json`),JSON.stringify(draft));
        const registered=new SkillRegistry().register(draft),runId=randomUUID(),request={operation:'tool-smelt-bronze' as const,args:{timeoutMs:60000},
            context:{runId,skill:{id:draft.id,version:draft.version},stepId:'smelt',parametersDigest:nativeToolDigest([])}};
        persistToolWorkInvocation(directory,request,owner);
        const trialSource=new NativeToolWorkAccessSource({workspace:directory,agentsPath,businessPath,propertyPath,skillDirectory});
        const invocation={operationId:toolSkillOperationId(request),contextDigest:nativeToolDigest(request)};
        expect(()=>trialSource.authorize(owner,'smelt',null,observation,invocation)).toThrow();
        const markerDirectory=join(directory,'.local/admin/active-skills'),runs=join(directory,'.local/agent-skills/runs');
        mkdirSync(markerDirectory,{recursive:true});mkdirSync(runs,{recursive:true});
        const marker={username:owner.username,skillId:draft.id,version:draft.version,runId,heartbeatAt:new Date().toISOString(),
            nativeToolTrial:{checksum:registered.checksum,runtimeAuthorization:toolTrialAuthorization(registered.definition)}};
        writeFileSync(join(markerDirectory,'worker.json'),JSON.stringify(marker));
        writeFileSync(join(runs,`${runId}.admission.json`),JSON.stringify({schemaVersion:1,runId,username:owner.username,skill:request.context.skill,
            checksum:registered.checksum,parameters:{},parametersDigest:request.context.parametersDigest}));
        expect(trialSource.authorize(owner,'smelt',null,observation,invocation)).toMatchObject({trialRunId:runId,skill:{version:'0.1.0'}});
        writeFileSync(join(markerDirectory,'worker.json'),JSON.stringify({...marker,nativeToolTrial:null}));
        expect(()=>trialSource.authorize(owner,'smelt',null,observation,invocation)).toThrow('acknowledged');
        writeFileSync(join(markerDirectory,'worker.json'),JSON.stringify({...marker,heartbeatAt:'2001-01-01T00:00:00.000Z'}));
        expect(()=>trialSource.authorize(owner,'smelt',null,observation,invocation)).toThrow('acknowledged');
        for(const ref of Object.values(TOOL_WORK_SKILLS))agents.setSkillKnowledge(owner.actorId,ref,'known',null);
        expect(source.authorize(owner,'smelt',null,observation).facility).toBeNull();
        expect(()=>source.authorize(owner,'repair','tool-workshop',observation)).toThrow('Business');
        business.create({businessId:'tool-workshop',name:'Tool workshop',summary:'Native repair access fixture.',ownerAgentId:owner.actorId,propertyId:'varrock.east-workshop'});
        expect(()=>source.authorize(owner,'repair','tool-workshop',observation)).toThrow('Property');
        property.assignGenesis('tool-fixture','varrock.east-workshop',1,{kind:'business',id:'tool-workshop'});
        const access=source.authorize(owner,'repair','tool-workshop',observation);expect(access.facility!.providerId).toBe('varrock.east-workshop.forge');
        expect(source.authorize(owner,'repair','tool-workshop',{...observation,engineTick:2,simulationTime:'2001-01-01T00:01:00.000Z'}).digest).toBe(access.digest);
        expect(()=>source.authorize({...owner,lifecycleId:'e'.repeat(64)},'repair','tool-workshop',observation)).toThrow('population');
        agents.createIdentity({agentId:'tool-boss',playerUsername:'boss',displayName:'Boss',background:'Native workshop owner fixture.',personalityTraits:['steady']});
        business.create({businessId:'boss-workshop',name:'Boss workshop',summary:'Employment access fixture.',ownerAgentId:'tool-boss',propertyId:'varrock.east-workshop'});
        property.transferOwnership('fixture-transfer','varrock.east-workshop',2,{kind:'business',id:'tool-workshop'},{kind:'business',id:'boss-workshop'});
        expect(()=>source.authorize(owner,'repair','boss-workshop',observation)).toThrow('permission');
        const employment=business.hire('boss-workshop',{workerAgentId:owner.actorId,role:'worker',title:'Smith',wageGp:0});
        expect(source.authorize(owner,'repair','boss-workshop',observation).facility).not.toBeNull();
        business.endEmployment('boss-workshop',employment.employmentId,employment.revision);
        expect(()=>source.authorize(owner,'repair','boss-workshop',observation)).toThrow('permission');
        agents.setSkillKnowledge(owner.actorId,TOOL_WORK_SKILLS.repair,'blocked',1);
        expect(()=>source.authorize(owner,'repair','tool-workshop',observation)).toThrow('learned');
    }finally{agents.close();business.close();property.close();clock.close();rmSync(directory,{recursive:true,force:true});}
});
