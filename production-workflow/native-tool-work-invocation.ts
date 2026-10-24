import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeToolDigest,type NativeToolOwner } from '../item-lifecycle/native-tool.js';
import { validateSocietyToolRequest,type SocietyToolRequest } from '../sdk/society-tools.js';
export function toolSkillOperationId(request:SocietyToolRequest):string {
    const hash=createHash('sha256').update(`native-tool:${request.context.runId}:${request.context.stepId}`).digest('hex');
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export function readToolWorkInvocation(workspace:string,id:string){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new Error('Invalid tool invocation identity');
    const value=JSON.parse(readFileSync(join(workspace,'.local/agent-skills/tool-operations',`${id}.json`),'utf8')) as {
        schemaVersion:1;request:SocietyToolRequest;owner:NativeToolOwner;digest:string};
    const{digest,...base}=value;validateSocietyToolRequest(value.request);
    if(value.schemaVersion!==1||digest!==nativeToolDigest(base)||toolSkillOperationId(value.request)!==id)throw new Error('Tool invocation source differs');
    return value;
}
/** Backend admission only; this is not a material, time or completion receipt. */
export function persistToolWorkInvocation(workspace:string,request:SocietyToolRequest,owner:NativeToolOwner):void {
    const directory=join(workspace,'.local/agent-skills/tool-operations'),id=toolSkillOperationId(request);
    const base={schemaVersion:1 as const,request,owner},value={...base,digest:nativeToolDigest(base)};
    mkdirSync(directory,{recursive:true});
    try{writeFileSync(join(directory,`${id}.json`),JSON.stringify(value),{encoding:'utf8',flag:'wx'});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const prior=readToolWorkInvocation(workspace,id);
    if(nativeToolDigest(prior.request)!==nativeToolDigest(request)||Object.entries(owner).some(([key,value])=>prior.owner[key as keyof NativeToolOwner]!==value))
        throw new Error('Native tool invocation binding differs');
}
