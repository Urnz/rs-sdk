import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { SkillRunResult } from '../../../agent-skills/types.js';
import { nativeToolDigest, type NativeToolOwner } from '../../../item-lifecycle/native-tool.js';
import { NativeToolWorkStore, type NativeToolWorkRecord } from '../../../production-workflow/native-tool-work.js';
import { nativeToolWorkPolicy } from '../../../production-workflow/native-tool-work-policy.js';
import { validateSocietyToolRequest, type SocietyToolRequest } from '../../../sdk/society-tools.js';
import type { ActionResult } from '../../../sdk/types.js';
import { assertNativeFoodPath } from '../../../food-loop/native-source.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { foodSkillCheckpointPath } from './native-food-skills.js';
import { populationNeedsBinding, populationNeedsOptions } from './needs-runtime.js';
import { toolSkillOperationId,persistToolWorkInvocation } from '../../../production-workflow/native-tool-work-invocation.js';
import { assertNativeFoodDomainPath } from '../../../food-loop/native-source.js';
export { toolSkillOperationId } from '../../../production-workflow/native-tool-work-invocation.js';

export interface NativeToolSkillOptions {
    workspace:string;worldId:string;checkpointPath:string;
    binding(username:string):NativeToolOwner;
    dispatch(command:{operationId:string;kind:'smelt'|'repair';username:string;businessId:string|null;contextDigest:string}):Promise<unknown>;
}
/** Read-only proof: transport success and caller-provided receipts are never completion evidence. */
function readProof(options:Pick<NativeToolSkillOptions,'workspace'|'worldId'|'checkpointPath'>,request:SocietyToolRequest,
    owner:NativeToolOwner):NativeToolWorkRecord|null {
    assertNativeFoodPath(options);
    const db=new OwnedDatabase(options.checkpointPath,{readonly:true,strict:true});
    try {let result:NativeToolWorkRecord|null=null;db.transaction(()=>{
        if(!NativeToolWorkStore.present(db))return;
        const row=NativeToolWorkStore.read(db).find(row=>row.intent.operationId===toolSkillOperationId(request));
        if(!row)return;
        const intent=row.intent;
        if(Object.entries(owner).some(([key,value])=>intent.owner[key as keyof NativeToolOwner]!==value)
            ||intent.owner.worldId!==options.worldId||intent.contextDigest!==nativeToolDigest(request)
            ||intent.kind!==(request.operation==='tool-repair'?'repair':'smelt')
            ||intent.businessId!==(request.operation==='tool-repair'?request.args.businessId:null)
            ||intent.policyDigest!==nativeToolWorkPolicy.digest)throw new Error('Native tool run/actor/policy binding differs');
        if(row.phase==='completed'){
            const event=db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_tool_event WHERE event_id=?')
                .get(`work:${intent.operationId}`);
            const proof=event?JSON.parse(event.payload):null;
            if(!event||nativeToolDigest(proof)!==event.digest||nativeToolDigest(proof.intent)!==row.intentDigest
                ||nativeToolDigest(proof.result)!==nativeToolDigest(row.result)||!row.result
                ||proof.workSimulationMs!==row.progressMs||proof.nativeWorkTicks!==row.workTicks)
                throw new Error('Native tool completion lacks its committed effect');
        }
        result=row;
    }).deferred();return result;}finally{db.close(true);}
}
export async function executeToolSkillRequest(options:NativeToolSkillOptions,username:string,raw:SocietyToolRequest):Promise<ActionResult>{
    const request=validateSocietyToolRequest(raw),operationId=toolSkillOperationId(request);
    // Population bindings also carry profile/policy metadata. Native custody is
    // exactly these six fields, like the engine's committed intent and Mining.
    const {actorId,lifecycleId,worldId,clockId,clockProfileDigest,username:boundUsername}=options.binding(username),
        owner:NativeToolOwner={actorId,username:boundUsername,lifecycleId,worldId,clockId,clockProfileDigest};
    if(owner.username!==username||owner.worldId!==options.worldId)throw new Error('Native tool selected identity differs');
    assertNativeFoodDomainPath({...options,checkpointPath:join(options.workspace,'.local/agent-skills/tool-operations',`${operationId}.json`)});
    persistToolWorkInvocation(options.workspace,request,owner);
    let row=readProof(options,request,owner),dispatchError:string|undefined;
    if(!row)try{await options.dispatch({operationId,kind:request.operation==='tool-repair'?'repair':'smelt',username,
        businessId:request.operation==='tool-repair'?String(request.args.businessId):null,contextDigest:nativeToolDigest(request)});}
    catch(error){dispatchError=String(error).slice(0,300);}
    row=readProof(options,request,owner);
    const data={context:request.context,request,operationId};
    if(!row)return{success:false,message:'Native tool outcome uncertain; reconcile this same run',reason:'tool-uncertain',phase:'observation',
        data:{...data,status:'uncertain',dispatchError}};
    if(row.phase!=='completed')return{success:false,message:row.reason??'Native tool work is in progress',reason:'tool-waiting',phase:'observation',
        data:{...data,status:'waiting',progressMs:row.progressMs,workPhase:row.phase}};
    return{success:true,message:'Native tool work completed',reason:'tool-completed',phase:'completion',
        data:{...data,status:'terminal',receipt:row,receiptDigest:nativeToolDigest(row)}};
}
export function verifyToolSkillRunSources(workspace:string,run:SkillRunResult,
    selected?:{worldId:string;checkpointPath:string}):boolean {
    if(!run.username||!run.parameters)return false;
    const needs=populationNeedsOptions(workspace),options=selected??{worldId:needs.worldId,checkpointPath:foodSkillCheckpointPath(workspace,needs.worldId)};
    const events=run.events.filter(event=>event.type==='step.succeeded'&&event.operation?.startsWith('tool-'));
    if(!events.length)return false;
    const parametersDigest=nativeToolDigest(Object.entries(run.parameters).sort(([left],[right])=>left.localeCompare(right)));
    return events.every(event=>{
        const data=event.data,request=validateSocietyToolRequest(data?.request as SocietyToolRequest),context=request.context;
        if(context.runId!==run.runId||context.stepId!==event.stepId||context.parametersDigest!==parametersDigest
            ||nativeToolDigest(context.skill)!==nativeToolDigest(run.skill)||request.operation!==event.operation
            ||nativeToolDigest(context)!==nativeToolDigest(data?.context)||data?.operationId!==toolSkillOperationId(request))return false;
        const posted=data?.receipt as NativeToolWorkRecord|undefined;
        if(!posted||posted.intent.owner.username!==run.username||posted.intent.owner.worldId!==options.worldId)return false;
        const canonical=readProof({workspace,...options},request,posted.intent.owner);
        return canonical?.phase==='completed'&&nativeToolDigest(canonical)===nativeToolDigest(posted)
            &&nativeToolDigest(canonical)===data?.receiptDigest;
    });
}
export async function executeLocalToolSkill(username:string,request:SocietyToolRequest):Promise<ActionResult>{
    const workspace=resolve(import.meta.dir,'../../..'),needs=populationNeedsOptions(workspace);
    return executeToolSkillRequest({workspace,worldId:needs.worldId,checkpointPath:foodSkillCheckpointPath(workspace,needs.worldId),
        binding:username=>{
            const agents=new AgentStateStore(join(workspace,'.local/agent-state/agents.sqlite'),undefined,true);
            try{
                const members=agents.listPopulationMembers().filter(member=>member.playerUsername===username);
                if(members.length!==1||members[0]!.status!=='active'||members[0]!.characterLifecycle.status!=='active')throw new Error('Native tool active avatar missing');
                const {playerId,...binding}=populationNeedsBinding(needs.worldId,members[0]!);
                return{...binding,username:playerId};
            }finally{agents.close();}
        },dispatch:async command=>{
            const token=process.env.ENGINE_ADMIN_TOKEN?.trim();if(!token)throw new Error('Native tool engine channel unavailable');
            const url=new URL('/api/internal/admin/native-tool-work',process.env.ENGINE_ADMIN_URL??'http://localhost:8888');
            if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Native tools require local/private engine');
            const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':token},
                body:JSON.stringify({commandId:randomUUID(),...command}),signal:AbortSignal.timeout(8000)});
            const result=await response.json() as {ok?:boolean;error?:string};
            if(!response.ok||result.ok!==true)throw new Error(result.error??'Native tool dispatch failed');return result;
        }},username,request);
}
