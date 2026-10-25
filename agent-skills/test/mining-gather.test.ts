import { afterEach,expect,test } from 'bun:test';
import { RsSdkSkillRuntime } from '../rs-sdk-runtime.js';
import { SkillExecutor } from '../executor.js';
import { miningSourceFixture } from './mining-demand-fixture.js';
import { miningDemandId,sealMiningOperationAdmission } from '../mining-admission.js';
import type { MiningDemandRequest } from '../../sdk/mining-demand.js';
const fixtures:ReturnType<typeof miningSourceFixture>[]=[];afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
function fixture(){const f=miningSourceFixture();fixtures.push(f);return f;}
function client(f:ReturnType<typeof fixture>,nativeFulfilled=true){
    const calls:MiningDemandRequest[]=[];let interactions=0,count=0;
    const sdk={getInventory:()=>count?[{id:436,name:'copper ore',count}]:[],getSkillXp:()=>0,
        waitForCondition:async()=>{if(interactions===1)throw Error('retarget');count=1;},
        sendMiningDemand:async(r:MiningDemandRequest)=>{calls.push(r);return{success:true,phase:r.operation==='close'&&nativeFulfilled?'completion':'observation',
            message:'fixture',data:{context:r.context,demandId:miningDemandId(r),state:r.operation==='open'?'pending':nativeFulfilled?'fulfilled':'cancelled',
                expiresAtWallTime:new Date(Date.now()+15000).toISOString(),nativeActionId:nativeFulfilled?'native-action':null,receiptDigest:'a'.repeat(64)}};}};
    const bot={interactLoc:async()=>{interactions++;return{success:true,message:'targeted'};}};
    return{sdk,bot,calls,interactions:()=>interactions};
}
test('bounded gather retargets inside one acknowledged demand and success requires native fulfillment',async()=>{
    const f=fixture(),c=client(f);const r=await new RsSdkSkillRuntime(c.bot as any,c.sdk as any).execute('gather-loc',f.request.args as any,new AbortController().signal,f.request.context);
    expect(r.success).toBeTrue();expect(c.interactions()).toBe(2);expect(c.calls.map(r=>r.operation)).toEqual(['open','close']);
    expect(miningDemandId(c.calls[0]!)).toBe(miningDemandId(c.calls[1]!));
    expect(r.data?.miningDemand).toMatchObject({state:'fulfilled',nativeActionId:'native-action'});
});
test('SDK inventory/XP progress without native fulfilled proof is uncertain and cannot be blindly retried',async()=>{
    const f=fixture(),c=client(f,false);const r=await new RsSdkSkillRuntime(c.bot as any,c.sdk as any).execute('gather-loc',f.request.args as any,new AbortController().signal,f.request.context);
    expect(r).toMatchObject({success:false,code:'mining-demand-uncertain',retryable:false});
});
test('abort while opening still sends close and never interacts, even if the open ACK arrives later',async()=>{
    const f=fixture(),c=client(f),controller=new AbortController(),send=c.sdk.sendMiningDemand;
    c.sdk.sendMiningDemand=async r=>{if(r.operation==='open'){c.calls.push(r);controller.abort();return await new Promise<any>(()=>{});}return send(r);};
    const r=await new RsSdkSkillRuntime(c.bot as any,c.sdk as any).execute('gather-loc',f.request.args as any,controller.signal,f.request.context);
    expect(r).toMatchObject({success:false,retryable:false});expect(c.interactions()).toBe(0);expect(c.calls.map(r=>r.operation)).toEqual(['open','close']);
});
test('rejected admission and disconnect do not dispatch Mining; cleanup uses a fresh signal',async()=>{
    const f=fixture(),c=client(f);c.sdk.sendMiningDemand=async r=>{c.calls.push(r);throw Error('socket closed');};
    const r=await new RsSdkSkillRuntime(c.bot as any,c.sdk as any).execute('gather-loc',f.request.args as any,new AbortController().signal,f.request.context);
    expect(r).toMatchObject({success:false,code:'mining-demand-uncertain',retryable:false});expect(c.interactions()).toBe(0);expect(c.calls).toHaveLength(2);
});
test('acknowledged goal cancellation after a gather timeout cannot blindly repeat already-dispatched client packets',async()=>{
    const f=fixture(),c=client(f,false);
    const r=await new RsSdkSkillRuntime(c.bot as any,c.sdk as any).execute('gather-loc',{...f.request.args,maxRetargets:1},new AbortController().signal,f.request.context);
    expect(r).toMatchObject({success:false,code:'gather-timeout',retryable:false});expect(c.interactions()).toBe(1);
    expect(c.calls.map(r=>r.operation)).toEqual(['open','close']);
});
test('executor awaits per-operation admission and seals each repeated step instance',async()=>{
    const f=fixture(),ids:string[]=[],closed:string[]=[];let work=0;
    const original=f.registered.definition,definition={...original,steps:[{kind:'repeat' as const,id:'repeat',maxIterations:2,
        until:{condition:'inventory-full' as const,arguments:{}},steps:original.steps}]};
    const result=await new SkillExecutor({test:async()=>work===2,execute:async()=>{expect(ids).toHaveLength(work+1);work++;return{success:true,message:'done'};}})
        .execute(definition,{runId:f.request.context.runId,onMiningAdmission:async r=>{f.admit(r);ids.push(miningDemandId(r));},
            onMiningClosed:async r=>{sealMiningOperationAdmission(f.root,r);closed.push(miningDemandId(r));}});
    expect(result.status).toBe('completed');expect(new Set(ids).size).toBe(2);expect(closed).toEqual(ids);
});
test('abort after admission but before dispatch still seals the executor operation',async()=>{
    const f=fixture(),controller=new AbortController();let called=false,closed=false;
    const result=await new SkillExecutor({test:async()=>true,execute:async()=>{called=true;return{success:true,message:'unexpected'};}})
        .execute(f.registered.definition,{runId:f.request.context.runId,signal:controller.signal,onMiningAdmission:async r=>{f.admit(r);controller.abort();},
            onMiningClosed:async r=>{sealMiningOperationAdmission(f.root,r);closed=true;}});
    expect(result.status).toBe('cancelled');expect(called).toBeFalse();expect(closed).toBeTrue();
});
