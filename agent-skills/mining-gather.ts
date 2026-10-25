import type { BotSDK } from '../sdk/index.js';
import type { SocietyFoodContext } from '../sdk/society-food.js';
import { miningGatherArgs,validateMiningDemandRequest,type MiningDemandContext } from '../sdk/mining-demand.js';
import type { MiningDemandRequest } from '../sdk/mining-demand.js';
import type { ActionResult } from '../sdk/types.js';
import type { SkillOperationResult } from './types.js';

async function bounded<T>(promise:Promise<T>,milliseconds:number,signal?:AbortSignal):Promise<T>{
    let timer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{};
    try{return await Promise.race([promise,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error('Mining demand acknowledgement timeout')),milliseconds);
        onAbort=()=>reject(Error('Mining cancelled'));if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
    })]);}finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
/** Demand ACK is not resource production. A successful gather also needs the native fulfilled receipt. */
export async function executeBoundMiningGather(sdk:Pick<BotSDK,'sendMiningDemand'>,args:Record<string,unknown>,
    context:SocietyFoodContext&{operationSequence?:number},signal:AbortSignal,gather:(deadline:number,demand:MiningDemandRequest)=>Promise<SkillOperationResult>):Promise<SkillOperationResult>{
    let request;
    try{request=validateMiningDemandRequest({operation:'open',args:miningGatherArgs(args),context:context as MiningDemandContext});}
    catch{return{success:false,code:'mining-demand-context-required',message:'Mining requires an admitted executor operation instance',retryable:false};}
    let result:SkillOperationResult={success:false,code:'mining-demand-uncertain',message:'Native Mining admission uncertain',retryable:false};
    let opened:ActionResult|undefined,closed:ActionResult|undefined;
    try{
        opened=await bounded(sdk.sendMiningDemand(request),10000,signal);
        if(opened.success&&opened.data?.state==='pending'&&JSON.stringify(opened.data.context)===JSON.stringify(request.context)
            &&typeof opened.data.demandId==='string'&&Number.isFinite(Date.parse(opened.data.expiresAtWallTime))){
            if(signal.aborted)result={success:false,code:'cancelled',message:'Skill cancelled',retryable:false};
            else if(Date.parse(opened.data.expiresAtWallTime)>Date.now())result=await bounded(gather(Date.parse(opened.data.expiresAtWallTime),request),
                Math.max(1,Date.parse(opened.data.expiresAtWallTime)-Date.now()),signal);
        }
    }catch{result={success:false,code:signal.aborted?'cancelled':'mining-demand-uncertain',message:'Mining interrupted; reconcile this same operation',retryable:false};}
    finally{
        // Fresh cleanup budget: the already-aborted work signal must not prevent the durable close.
        try{closed=await bounded(sdk.sendMiningDemand({...request,operation:'close'}),2000);}catch{}
    }
    const matched=closed?.success&&closed.data?.demandId===opened?.data?.demandId&&JSON.stringify(closed.data?.context)===JSON.stringify(request.context);
    if(result.success&&(!matched||closed!.phase!=='completion'||closed!.data?.state!=='fulfilled'
        ||typeof closed!.data.nativeActionId!=='string'||!/^[a-f0-9]{64}$/.test(closed!.data.receiptDigest)))
        return{success:false,code:'mining-demand-uncertain',message:'Gather progress lacks its native Mining fulfillment',retryable:false};
    // A closed goal is not a transport cancellation of already sent client packets. Reconcile failures before a new operation.
    return{...result,...(!result.success||!matched?{retryable:false}:{}),data:{...result.data,miningDemand:{request,demandId:opened?.data?.demandId??null,
        state:closed?.data?.state??'uncertain',nativeActionId:closed?.data?.nativeActionId??null,receiptDigest:closed?.data?.receiptDigest??null}}};
}
