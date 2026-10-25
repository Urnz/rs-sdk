import { existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import { NativeMiningIntentStore,type NativeMiningIntentRecord } from '../../../item-lifecycle/native-mining-intent.js';
import { NativeMiningDemandStore } from '../../../item-lifecycle/native-mining-demand.js';
import { nativeToolDigest as hash,type NativeToolOwner } from '../../../item-lifecycle/native-tool.js';
import { validateMiningDemandRequest,type MiningDemandRequest } from '../../../sdk/mining-demand.js';
import { miningDemandId,readMiningOperationAdmission } from '../../../agent-skills/mining-admission.js';
import { authorizeMiningDemand,readMiningDemandInvocation,persistMiningDemandInvocation,cancelMiningDemandInvocation,miningRequestDigest,miningOwner } from '../../../agent-skills/mining-demand-source.js';
import { assertNativeFoodPath } from '../../../food-loop/native-source.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import type { NativeMiningDemandCommand } from '../../../sdk/mining-demand.js';
import type { ActionResult } from '../../../sdk/types.js';
import { foodSkillCheckpointPath } from './native-food-skills.js';
import { requireNativeMiningDispatchProof } from '../../../item-lifecycle/native-mining-dispatch.js';
import { populationNeedsBinding,populationNeedsOptions } from './needs-runtime.js';

export interface MiningDemandOptions {workspace:string;worldId:string;checkpointPath:string;
    binding(username:string):NativeToolOwner;dispatch(command:NativeMiningDemandCommand):Promise<unknown>}
/** Re-read native state and actual output, never a transport ACK or uploaded receipt. */
export function readMiningDemandProof(o:Pick<MiningDemandOptions,'workspace'|'worldId'|'checkpointPath'>,owner:NativeToolOwner,request:MiningDemandRequest):NativeMiningIntentRecord|null{
    owner=miningOwner(owner);
    assertNativeFoodPath(o);if(!existsSync(o.checkpointPath))return null;
    const db=new OwnedDatabase(o.checkpointPath,{readonly:true,strict:true});let result:NativeMiningIntentRecord|null=null;
    try{db.transaction(()=>{
        if(!NativeMiningIntentStore.present(db))return;
        const row=NativeMiningIntentStore.read(db).entries.filter(e=>e.record.intent.demandId===miningDemandId(request)).at(-1)?.record;if(!row)return;
        const admission=readMiningOperationAdmission(o.workspace,request),i=row.intent;
        if(hash(miningOwner(i.owner))!==hash(owner)||owner.worldId!==o.worldId||i.contextDigest!==miningRequestDigest(request)
            ||i.outputItemId!==(request.args.item==='copper ore'?436:438)||i.maximumWallMilliseconds>request.args.timeoutMs
            ||i.expiresAtWallTime!==admission.expiresAtWallTime||i.attemptSequenceAtAdmission===undefined)throw Error('Native Mining request binding differs');
        if(row.phase==='fulfilled'){
            const source=db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_tool_event WHERE event_id=?').get(row.completionEventId!);
            const proof=source?JSON.parse(source.payload):null;
            const first=NativeMiningDemandStore.read(db).entries.find(e=>e.observation.requestId===row.completionEventId&&e.observation.phase==='admitted');
            if(!source||hash(proof)!==source.digest||proof.kind!=='mined'||hash(proof.source.owner)!==hash(owner)
                ||proof.source.outputItemId!==i.outputItemId||proof.source.outputQuantity!==1||hash(proof.source.clock)!==hash(row.sample.clock)
                ||proof.before.itemInstanceId!==row.sample.itemInstanceId||proof.before.revision!==row.sample.itemRevision
                ||!first||first.sequence<=i.attemptSequenceAtAdmission)throw Error('Native Mining completion source differs');
            if(i.nativeDispatchRequired)requireNativeMiningDispatchProof(db,i,row.completionEventId!,proof.source);
        }
        result=row;
    }).deferred();return result;}finally{db.close(true);}
}
export async function executeMiningDemandRequest(o:MiningDemandOptions,username:string,raw:MiningDemandRequest):Promise<ActionResult>{
    const request=validateMiningDemandRequest(raw),owner=miningOwner(o.binding(username)),demandId=miningDemandId(request);
    if(owner.username!==username||owner.worldId!==o.worldId)throw Error('Mining request selected owner differs');
    if(request.operation==='open'){
        authorizeMiningDemand(o.workspace,owner,request);persistMiningDemandInvocation(o.workspace,owner,request);
    }else{
        // Closing can narrow an admitted request after its marker/permission has ended.
        try{const prior=readMiningDemandInvocation(o.workspace,demandId,owner);if(prior.contextDigest!==miningRequestDigest(request))throw Error('Mining close differs');}
        catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
            authorizeMiningDemand(o.workspace,owner,request);persistMiningDemandInvocation(o.workspace,owner,request);}
        cancelMiningDemandInvocation(o.workspace,demandId,owner);
    }
    let dispatched=true;try{await o.dispatch({operation:request.operation,demandId,username,contextDigest:miningRequestDigest(request)});}catch{dispatched=false;}
    const row=readMiningDemandProof(o,owner,request),data={demandId,context:request.context,request,state:row?.phase??'absent',
        expiresAtWallTime:row?.intent.expiresAtWallTime??null,nativeActionId:row?.completionEventId??null,receiptDigest:row?hash(row):null};
    const acknowledged=request.operation==='open'?row?.phase==='pending':row&&row.phase!=='pending';
    return{success:!!acknowledged,message:acknowledged?'Native Mining demand acknowledged':'Native Mining demand uncertain; reconcile this same operation',
        reason:acknowledged?'mining-demand-acknowledged':'mining-demand-uncertain',phase:row?.phase==='fulfilled'?'completion':'observation',
        data:{...data,dispatched}};
}
export function localMiningDemandOptions():MiningDemandOptions{
    const workspace=resolve(import.meta.dir,'../../..'),needs=populationNeedsOptions(workspace);
    return{workspace,worldId:needs.worldId,checkpointPath:foodSkillCheckpointPath(workspace,needs.worldId),
        binding:who=>{const agents=new AgentStateStore(join(workspace,'.local/agent-state/agents.sqlite'),undefined,true);
            try{const members=agents.listPopulationMembers().filter(m=>m.playerUsername===who);if(members.length!==1)throw Error('Mining population binding missing');
                const {playerId,...binding}=populationNeedsBinding(needs.worldId,members[0]!);return{...binding,username:playerId};}finally{agents.close();}},
        dispatch:async command=>{
            const token=process.env.ENGINE_ADMIN_TOKEN?.trim();if(!token)throw Error('Native Mining engine unavailable');
            const url=new URL('/api/internal/admin/native-mining-demand',process.env.ENGINE_ADMIN_URL??'http://localhost:8888');
            if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Mining demand requires local/private engine');
            const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':token},
                body:JSON.stringify({commandId:randomUUID(),...command}),signal:AbortSignal.timeout(8000)});
            const result=await response.json() as {ok?:boolean};if(!response.ok||result.ok!==true)throw Error('Native Mining dispatch unavailable');return result;
        }};
}
export async function executeLocalMiningDemand(username:string,request:MiningDemandRequest){return executeMiningDemandRequest(localMiningDemandOptions(),username,request);}
