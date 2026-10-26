import { existsSync,mkdirSync,readFileSync,writeFileSync,statSync,realpathSync } from 'node:fs';
import { join,relative,isAbsolute } from 'node:path';
import { AgentStateStore } from '../agent-state/store.js';
import { SkillRegistry } from './registry.js';
import { resolveSkillParameters } from './validation.js';
import { assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { nativeToolDigest,type NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { validateMiningDemandRequest,type MiningDemandRequest } from '../sdk/mining-demand.js';
import { miningAdmissionDigest as hash,miningDemandId,readMiningOperationAdmission,miningOperationAdmissionPath } from './mining-admission.js';
import { requireMiningExecutorAdmission } from './mining-request-source.js';

const idCheck=(id:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('Invalid Mining demand identity');};
function file(root:string,owner:NativeToolOwner,path:string){
    if(path.startsWith(join(root,'.local')))assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:path});
    const rel=relative(realpathSync(root),realpathSync(path));
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||statSync(path).size>1048576)throw Error('Mining source escapes selected workspace or size limit');
    return JSON.parse(readFileSync(path,'utf8'));
}
const invocationPath=(root:string,id:string)=>{idCheck(id);return join(root,'.local/agent-skills/mining-demands',`${id}.json`);};
const cancelPath=(root:string,id:string)=>{idCheck(id);return join(root,'.local/agent-skills/mining-demands',`${id}.cancel.json`);};
const content=(r:MiningDemandRequest)=>({args:r.args,context:r.context});
export function miningOwner(value:NativeToolOwner):NativeToolOwner{
    const{actorId,username,lifecycleId,worldId,clockId,clockProfileDigest}=value;return{actorId,username,lifecycleId,worldId,clockId,clockProfileDigest};
}
export const miningRequestDigest=(r:MiningDemandRequest)=>hash(content(validateMiningDemandRequest(r)));
export function miningOperationSealed(root:string,owner:NativeToolOwner,request:MiningDemandRequest){
    const path=miningOperationAdmissionPath(root,request).replace(/\.json$/,'.closed.json');if(!existsSync(path))return false;
    file(root,owner,miningOperationAdmissionPath(root,request));
    const admission=readMiningOperationAdmission(root,request),value=file(root,owner,path),{digest,...body}=value;
    if(value.schemaVersion!==1||value.admissionDigest!==admission.digest||digest!==hash(body))throw Error('Mining executor seal differs');return true;
}

/** Re-read live identity/control/knowledge, exact reviewed checksum, run and current executor step admission. */
export function authorizeMiningDemand(root:string,owner:NativeToolOwner,raw:MiningDemandRequest,now=Date.now()){
    owner=miningOwner(owner);
    const request=validateMiningDemandRequest(raw),c=request.context;
    if(!/^[a-z0-9]{1,12}$/.test(owner.username)||!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(owner.actorId))throw Error('Invalid Mining source owner');
    const agentPath=join(root,'.local/agent-state/agents.sqlite');
    assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:agentPath});
    const agents=new AgentStateStore(agentPath,undefined,true);
    try{
        const identity=agents.getIdentity(owner.actorId),member=agents.getPopulationMember(owner.actorId),control=agents.getControlProfile(owner.actorId);
        if(identity?.playerUsername!==owner.username||!member||member.status!=='active'||member.characterLifecycle.status!=='active'
            ||control?.role!=='player'||control.subjectKind!=='player'||control.subjectId!==owner.username
            ||member.simulationClock.clockId!==owner.clockId||member.simulationClock.profileDigest!==owner.clockProfileDigest
            ||nativeToolDigest({agentId:member.agentId,createdAt:member.characterLifecycle.createdAt,origin:member.characterLifecycle.origin,
                createdAtSimulationTime:member.characterLifecycle.createdAtSimulationTime,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest,
                worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,simulationClock:member.simulationClock})!==owner.lifecycleId)
            throw Error('Mining demand requires exact active population control');
        const filename=`${c.skill.id}@${c.skill.version}.skill.json`;
        const skillPath=[join(root,'.local/agent-skills/private',owner.actorId,filename),join(root,'.local/agent-skills/shared',filename),join(root,'agent-skills/catalog',filename)].find(existsSync);
        if(!skillPath)throw Error('Mining procedure missing');
        const registered=new SkillRegistry().register(file(root,owner,skillPath),{trusted:true});
        const known=agents.listSkillKnowledge(owner.actorId).find(k=>k.skill.id===c.skill.id&&k.skill.version===c.skill.version);
        if(registered.definition.status!=='verified'||!known||known.status==='blocked'
            ||registered.definition.sharing.visibility==='private'&&registered.definition.sharing.ownerAgentId!==owner.actorId)throw Error('Mining procedure is not learned and verified');
        const run=file(root,owner,join(root,'.local/agent-skills/runs',`${c.runId}.admission.json`));
        file(root,owner,miningOperationAdmissionPath(root,request)); // Path/size validation before the typed parser.
        const step=readMiningOperationAdmission(root,request);
        requireMiningExecutorAdmission(root,owner,step);
        const marker=file(root,owner,join(root,'.local/admin/active-skills',`${owner.username}.json`));
        if(run.schemaVersion!==1||run.runId!==c.runId||run.username!==owner.username||hash(run.skill)!==hash(c.skill)
            ||run.checksum!==registered.checksum||run.parametersDigest!==c.parametersDigest
            ||hash(Object.entries(resolveSkillParameters(registered.definition,run.parameters)).sort(([a],[b])=>a.localeCompare(b)))!==c.parametersDigest
            ||step.username!==owner.username||step.checksum!==registered.checksum||!Number.isFinite(Date.parse(step.admittedAt))
            ||Date.parse(step.admittedAt)>now+1000||Date.parse(step.expiresAtWallTime)<=now
            ||marker.username?.toLowerCase()!==owner.username||marker.runId!==c.runId||marker.skillId!==c.skill.id||marker.version!==c.skill.version
            ||marker.miningOperationSequence!==c.operationSequence||marker.miningAdmissionDigest!==step.digest
            ||!Number.isFinite(Date.parse(marker.heartbeatAt))||now-Date.parse(marker.heartbeatAt)>15000||Date.parse(marker.heartbeatAt)>now+1000)
            throw Error('Mining demand lacks its current exact executor admission');
        if(existsSync(cancelPath(root,miningDemandId(request)))||miningOperationSealed(root,owner,request))throw Error('Mining demand was cancelled or sealed');
        return{authorityDigest:hash({owner,requestDigest:miningRequestDigest(request),checksum:registered.checksum,stepAdmissionDigest:step.digest}),
            expiresAtWallTime:step.expiresAtWallTime};
    }finally{agents.close();}
}
export function readMiningDemandInvocation(root:string,id:string,owner:NativeToolOwner){
    owner=miningOwner(owner);
    const value=file(root,owner,invocationPath(root,id));const {digest,...body}=value;
    const request=validateMiningDemandRequest({...value.request,operation:'open'});
    if(value.schemaVersion!==1||digest!==hash(body)||miningDemandId(request)!==id||hash(miningOwner(value.owner))!==hash(owner)
        ||hash(content(request))!==value.contextDigest)throw Error('Mining demand invocation differs');
    return{request,contextDigest:value.contextDigest as string,digest:digest as string};
}
export function persistMiningDemandInvocation(root:string,owner:NativeToolOwner,request:MiningDemandRequest){
    owner=miningOwner(owner);
    const id=miningDemandId(request),path=invocationPath(root,id),body={schemaVersion:1,owner,request:content(request),contextDigest:miningRequestDigest(request)};
    assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:path});
    mkdirSync(join(root,'.local/agent-skills/mining-demands'),{recursive:true});
    try{writeFileSync(path,JSON.stringify({...body,digest:hash(body)}),{encoding:'utf8',flag:'wx'});}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    const prior=readMiningDemandInvocation(root,id,owner);if(prior.contextDigest!==body.contextDigest)throw Error('Mining demand invocation conflict');return prior;
}
export function cancelMiningDemandInvocation(root:string,id:string,owner:NativeToolOwner){
    owner=miningOwner(owner);
    const invocation=readMiningDemandInvocation(root,id,owner),path=cancelPath(root,id);
    const body={schemaVersion:1,demandId:id,invocationDigest:invocation.digest,contextDigest:invocation.contextDigest,ownerDigest:hash(owner)};
    assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:path});
    const payload=JSON.stringify({...body,digest:hash(body)});
    try{writeFileSync(path,payload,{encoding:'utf8',flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(hash(file(root,owner,path))!==hash(JSON.parse(payload)))throw Error('Mining cancellation conflicts');
}
export function miningDemandCancellation(root:string,id:string,owner:NativeToolOwner){
    owner=miningOwner(owner);
    if(!existsSync(cancelPath(root,id)))return false;
    const invocation=readMiningDemandInvocation(root,id,owner),value=file(root,owner,cancelPath(root,id)),{digest,...body}=value;
    if(digest!==hash(body)||value.schemaVersion!==1||value.demandId!==id||value.invocationDigest!==invocation.digest
        ||value.contextDigest!==invocation.contextDigest||value.ownerDigest!==hash(owner))throw Error('Mining cancellation source differs');
    return true;
}
export function authorizeMiningDemandCommand(root:string,command:{demandId:string;contextDigest:string;outputItemId:436|438;maximumWallMilliseconds:number},owner:NativeToolOwner){
    const invocation=readMiningDemandInvocation(root,command.demandId,owner),r=invocation.request;
    if(invocation.contextDigest!==command.contextDigest||command.outputItemId!==(r.args.item==='copper ore'?436:438)
        ||command.maximumWallMilliseconds!==r.args.timeoutMs)throw Error('Native Mining invocation differs');
    return authorizeMiningDemand(root,owner,r);
}
export function miningIntentFulfillmentAllowed(root:string,i:{demandId:string;owner:NativeToolOwner;contextDigest:string;authorityDigest:string}){
    try{const invocation=readMiningDemandInvocation(root,i.demandId,i.owner);
        if(invocation.contextDigest!==i.contextDigest||miningDemandCancellation(root,i.demandId,i.owner)||miningOperationSealed(root,i.owner,invocation.request))return false;
        return authorizeMiningDemand(root,i.owner,invocation.request).authorityDigest===i.authorityDigest;
    }catch{return false;}
}
