import { randomUUID } from 'node:crypto';
import { validateMiningInteractionRequest,type MiningInteractionRequest,type NativeMiningInteractionCommand } from '../../../sdk/mining-interaction.js';
import { miningOwner } from '../../../agent-skills/mining-demand-source.js';
import { persistMiningInteractionSource } from '../../../agent-skills/mining-interaction-source.js';
import { NativeMiningDispatchStore } from '../../../item-lifecycle/native-mining-dispatch.js';
import { nativeToolDigest as hash } from '../../../item-lifecycle/native-tool.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { assertNativeFoodPath } from '../../../food-loop/native-source.js';
import { localMiningDemandOptions,readMiningDemandProof,type MiningDemandOptions } from './native-mining-demand.js';
import type { ActionResult } from '../../../sdk/types.js';
export interface MiningInteractionOptions extends Omit<MiningDemandOptions,'dispatch'> {dispatch(command:NativeMiningInteractionCommand):Promise<unknown>}
export async function executeMiningInteractionRequest(o:MiningInteractionOptions,username:string,raw:MiningInteractionRequest):Promise<ActionResult>{
    const request=validateMiningInteractionRequest(raw),owner=miningOwner(o.binding(username));
    if(owner.username!==username||owner.worldId!==o.worldId)throw Error('Mining interaction selected owner differs');
    const source=persistMiningInteractionSource(o.workspace,owner,request),intent=readMiningDemandProof(o,owner,request.demand);
    if(intent?.phase!=='pending')throw Error('Mining interaction requires its pending native request');
    let dispatched=true;try{await o.dispatch({dispatchId:source.id,username});}catch{dispatched=false;}
    assertNativeFoodPath(o);const db=new OwnedDatabase(o.checkpointPath,{readonly:true,strict:true});
    try{const record=new NativeMiningDispatchStore(db).get(source.id);
        if(record&&(record.sourceDigest!==source.digest||hash(record.owner)!==hash(owner)||hash(record.request)!==hash(request)))throw Error('Mining dispatch proof differs');
        return{success:!!record,message:record?'Native Mining interaction admitted':'Mining interaction uncertain; reconcile this dispatch',
            reason:record?'mining-interaction-admitted':'mining-interaction-uncertain',phase:'observation',data:{dispatchId:source.id,dispatched,
                admissionDigest:record?hash(record):null,demandId:intent.intent.demandId}};
    }finally{db.close(true);}
}
export function executeLocalMiningInteraction(username:string,request:MiningInteractionRequest){
    return executeMiningInteractionRequest({...localMiningDemandOptions(),dispatch:async command=>{
        const token=process.env.ENGINE_ADMIN_TOKEN?.trim();if(!token)throw Error('Native Mining engine unavailable');
        const url=new URL('/api/internal/admin/native-mining-interaction',process.env.ENGINE_ADMIN_URL??'http://localhost:8888');
        if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Mining interaction requires private engine');
        const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':token},
            body:JSON.stringify({commandId:randomUUID(),...command}),signal:AbortSignal.timeout(8000)});
        const result=await response.json() as {ok?:boolean};if(!response.ok||result.ok!==true)throw Error('Native Mining interaction rejected');return result;
    }},username,request);
}
