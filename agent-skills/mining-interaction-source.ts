import { mkdirSync,readFileSync,writeFileSync,realpathSync,statSync } from 'node:fs';
import { join,relative,isAbsolute } from 'node:path';
import { miningAdmissionDigest as hash,miningDemandId } from './mining-admission.js';
import { authorizeMiningDemand,miningOwner,miningRequestDigest,readMiningDemandInvocation } from './mining-demand-source.js';
import type { NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { validateMiningInteractionRequest,type MiningInteractionRequest } from '../sdk/mining-interaction.js';
import { assertNativeFoodDomainPath } from '../food-loop/native-source.js';
export function miningDispatchId(raw:MiningInteractionRequest){
    const r=validateMiningInteractionRequest(raw),h=hash(['native-mining-dispatch',miningDemandId(r.demand),r.dispatchSequence]);
    return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
function path(root:string,id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('Invalid Mining dispatch id');
    return join(root,'.local/agent-skills/mining-dispatches',`${id}.json`);}
export function readMiningInteractionSource(root:string,id:string){
    const source=path(root,id),rel=relative(realpathSync(root),realpathSync(source));
    if(rel.startsWith('..')||isAbsolute(rel)||statSync(source).size>1048576)throw Error('Mining dispatch source escapes workspace');
    const value=JSON.parse(readFileSync(source,'utf8')),{digest,...body}=value;
    const request=validateMiningInteractionRequest(value.request),owner=miningOwner(value.owner);
    assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:source});
    if(value.schemaVersion!==1||digest!==hash(body)||miningDispatchId(request)!==id||hash(owner)!==hash(value.owner))throw Error('Mining dispatch source differs');
    return{request,owner,digest:digest as string};
}
export function persistMiningInteractionSource(root:string,rawOwner:NativeToolOwner,raw:MiningInteractionRequest){
    const request=validateMiningInteractionRequest(raw),owner=miningOwner(rawOwner),id=miningDispatchId(request);
    authorizeMiningDemand(root,owner,request.demand);
    const invocation=readMiningDemandInvocation(root,miningDemandId(request.demand),owner);
    if(invocation.contextDigest!==miningRequestDigest(request.demand))throw Error('Mining dispatch invocation differs');
    const body={schemaVersion:1,owner,request},source=path(root,id),payload=JSON.stringify({...body,digest:hash(body)});
    assertNativeFoodDomainPath({workspace:root,worldId:owner.worldId,checkpointPath:source});mkdirSync(join(root,'.local/agent-skills/mining-dispatches'),{recursive:true});
    try{writeFileSync(source,payload,{encoding:'utf8',flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    const prior=readMiningInteractionSource(root,id);if(prior.digest!==hash(body))throw Error('Mining dispatch sequence conflict');return{id,...prior};
}
