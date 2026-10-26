import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMiningDemandRequest,type MiningDemandRequest } from '../sdk/mining-demand.js';
import { recordMiningExecutorAdmission } from './mining-request-source.js';
export const miningAdmissionDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function miningDemandId(raw:MiningDemandRequest){
    const {context:c}=validateMiningDemandRequest(raw),h=miningAdmissionDigest(['native-mining-demand',c.runId,c.stepId,c.operationSequence]);
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function miningOperationAdmissionPath(root:string,raw:MiningDemandRequest){
    const r=validateMiningDemandRequest(raw);return join(root,'.local/agent-skills/runs',`${r.context.runId}.mining-${r.context.operationSequence}.admission.json`);
}
/** Executor-owned step instance, written and awaited before runtime/network dispatch. No completion claim. */
export function persistMiningOperationAdmission(root:string,username:string,checksum:string,raw:MiningDemandRequest,now=Date.now()){
    const {args,context}=validateMiningDemandRequest(raw);
    if(!/^[a-z0-9]{1,12}$/.test(username)||!/^[a-f0-9]{64}$/.test(checksum))throw Error('Invalid Mining executor admission');
    const body={schemaVersion:1 as const,username,checksum,args,context,admittedAt:new Date(now).toISOString(),expiresAtWallTime:new Date(now+args.timeoutMs).toISOString()};
    const value={...body,digest:miningAdmissionDigest(body)},path=miningOperationAdmissionPath(root,raw);
    mkdirSync(join(root,'.local/agent-skills/runs'),{recursive:true});
    recordMiningExecutorAdmission(root,value,'requested');
    writeFileSync(path,JSON.stringify(value),{encoding:'utf8',flag:'wx'});return value;
}
export function readMiningOperationAdmission(root:string,request:MiningDemandRequest){
    const value=JSON.parse(readFileSync(miningOperationAdmissionPath(root,request),'utf8')) as ReturnType<typeof persistMiningOperationAdmission>;
    const {digest,...body}=value;
    if(value.schemaVersion!==1||digest!==miningAdmissionDigest(body)||miningAdmissionDigest(value.context)!==miningAdmissionDigest(request.context)
        ||miningAdmissionDigest(value.args)!==miningAdmissionDigest(request.args)
        ||Date.parse(value.expiresAtWallTime)-Date.parse(value.admittedAt)!==request.args.timeoutMs)throw Error('Mining operation admission differs');
    return value;
}
export function sealMiningOperationAdmission(root:string,request:MiningDemandRequest){
    const admission=readMiningOperationAdmission(root,request),body={schemaVersion:1,admissionDigest:admission.digest};
    const path=miningOperationAdmissionPath(root,request).replace(/\.json$/,'.closed.json'),payload=JSON.stringify({...body,digest:miningAdmissionDigest(body)});
    try{writeFileSync(path,payload,{encoding:'utf8',flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(readFileSync(path,'utf8')!==payload)throw Error('Mining operation seal conflict');
    recordMiningExecutorAdmission(root,admission,'closed');
}
