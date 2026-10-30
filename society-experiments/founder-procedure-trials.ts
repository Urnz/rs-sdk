import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentStateStore} from '../agent-state/store.js';
import {CapabilityGapStore} from '../agent-skills/capability-gaps.js';
import {SkillTrialStore} from '../agent-skills/trials.js';
import {SkillLibrary} from '../agent-skills/library.js';
import {SkillRegistry} from '../agent-skills/registry.js';
import {FileSkillStore} from '../agent-skills/store.js';
import {resolveSkillParameters} from '../agent-skills/validation.js';
import {draftTrialAuthorization} from '../agent-skills/food-trials.js';
import {assertNativeFoodDomainPath} from '../food-loop/native-source.js';
import {FOOD_TRIAL_STATE,INTEGRATION_STATE} from '../society-integration/state-paths.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';

export const FOUNDER_TRIAL_PROCEDURES=[{id:'procedure.mining.gather-tin',kind:'tin'},
    {id:'procedure.metallurgy.smelt-bronze',kind:'smelt'},{id:'procedure.tools.repair-bronze-pickaxe',kind:'repair'}] as const;
export function founderTrialSource(workspace:string){
    const root=resolve(workspace);
    if(!existsSync(join(root,FOOD_TRIAL_STATE))||existsSync(join(root,INTEGRATION_STATE)))throw Error('Founder procedure trials require a separate disposable trial workspace');
    const marker=JSON.parse(readFileSync(join(root,FOOD_TRIAL_STATE),'utf8'));
    if(marker.schemaVersion!==1||marker.acceptance!=='draft-trial-only'||typeof marker.worldId!=='string'||!/^[a-f0-9]{64}$/.test(marker.fixtureDigest))
        throw Error('Disposable trial source binding differs');
    assertNativeFoodDomainPath({workspace:root,worldId:marker.worldId,checkpointPath:join(root,FOOD_TRIAL_STATE)});
    return{workspace:root,worldId:marker.worldId as string,checkpointPath:join(root,'server/engine/data/player-checkpoints.sqlite')};
}
/** Creates only capability gaps and ready trial records. No items, grants, runs, skills or live world are created. */
export async function prepareFounderProcedureTrials(workspace:string,username:string,businessId:string){
    const source=founderTrialSource(workspace),root=source.workspace;
    if(!/^[a-z0-9]{1,12}$/.test(username)||!/^[a-z0-9][a-z0-9.-]{0,95}$/.test(businessId))throw Error('Invalid founder trial subject or workshop');
    const agentsPath=join(root,'.local/agent-state/agents.sqlite');assertNativeFoodDomainPath({...source,checkpointPath:agentsPath});
    const agents=new AgentStateStore(agentsPath,undefined,true);
    let agentId:string;
    try{const members=agents.listPopulationMembers().filter(m=>m.playerUsername===username&&m.status==='active'&&m.characterLifecycle.status==='active');
        if(members.length!==1)throw Error('Founder trial requires one active population subject');
        agentId=members[0]!.agentId;const control=agents.getControlProfile(agentId);
        if(control?.role!=='player'||control.subjectKind!=='player'||control.subjectId!==username)throw Error('Founder trial requires current player control');
    }finally{agents.close();}
    const local=join(root,'.local/agent-skills'),library=new SkillLibrary(new SkillRegistry(),new FileSkillStore(local));
    await library.loadReviewedCatalog(join(root,'agent-skills/catalog'));await library.loadAgentDrafts('admin-trial-runner');
    const definitions=FOUNDER_TRIAL_PROCEDURES.map(ref=>{
        const registered=library.registry.get({id:ref.id,version:'0.1.0'},'admin-trial-runner');
        if(!registered||registered.definition.status!=='draft'||registered.definition.provenance.authorKind!=='agent'||registered.definition.sharing.visibility!=='shared'
            ||!draftTrialAuthorization(registered.definition))throw Error(`Exact founder trial draft unavailable: ${ref.id}`);
        return{...ref,registered,parameters:resolveSkillParameters(registered.definition,ref.kind==='repair'?{'business-id':businessId}:{})};
    });
    const gaps=new CapabilityGapStore(join(local,'capability-gaps.json')),trials=new SkillTrialStore(join(local,'trials.json')),prepared=[];
    for(const d of definitions){
        const draft=d.registered.definition;
        let {gap}=await gaps.report({agentId,goalId:`si-c07-trial-${d.kind}`,anchorGoalId:`si-c07-trial-${d.kind}`,
            title:`Founder native ${d.kind} procedure`,description:'Two independent normal SkillExecutor runs, persisted canonical review and separate human publication approval.',
            tags:['society','native',d.kind],worldVersion:'lostcity-local-v1'});
        if(gap.status==='open')gap=await gaps.transition(gap.gapId,gap.revision,'assigned',{assignedWorkerId:draft.provenance.authorId});
        if(gap.status==='assigned'&&gap.assignedWorkerId===draft.provenance.authorId)gap=await gaps.transition(gap.gapId,gap.revision,'draft',{draftSkill:{id:draft.id,version:draft.version}});
        if(!['draft','validating','live-trial'].includes(gap.status)||gap.draftSkill?.id!==draft.id||gap.draftSkill.version!==draft.version
            ||gap.assignedWorkerId!==draft.provenance.authorId)throw Error('Conflicting founder capability gap');
        let trial=(await trials.list()).find(t=>t.gapId===gap.gapId&&!['cancelled','published'].includes(t.status));
        if(trial&&(trial.testBotUsername!==username||trial.draft.id!==draft.id||trial.draft.version!==draft.version||trial.targetVersion!=='1.0.0'
            ||hash(trial.parameters)!==hash(d.parameters)))throw Error('Conflicting active founder trial');
        trial??=await trials.create({gapId:gap.gapId,draft:{id:draft.id,version:draft.version},targetVersion:'1.0.0',testBotUsername:username,parameters:d.parameters});
        if(gap.status==='draft')gap=await gaps.transition(gap.gapId,gap.revision,'validating');
        if(gap.status==='validating')await gaps.transition(gap.gapId,gap.revision,'live-trial');
        prepared.push({kind:d.kind,trialId:trial.trialId,draft:trial.draft,checksum:d.registered.checksum,status:trial.status,parameters:trial.parameters});
    }
    return{protocol:'si-c07-founder-procedure-trials-v1',scope:'ready-trial-records-only',worldId:source.worldId,prepared,
        executionStarted:false,publicationAuthorized:false,providerCalls:0};
}
