import { afterEach,beforeAll,expect,test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import World from '../engine/World.js';
import InvType from '../cache/config/InvType.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { fixture,closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
import { miningSourceFixture } from '../../../../agent-skills/test/mining-demand-fixture.js';
import { NativeMiningIntentTracker } from './NativeMiningIntent.js';
import { applyNativeMiningDemand,tickNativeMiningIntents,type NativeMiningDemandRuntime } from './NativeMiningIntentRuntime.js';
import { authorizeMiningDemandCommand,miningIntentFulfillmentAllowed,persistMiningDemandInvocation,miningRequestDigest } from '../../../../agent-skills/mining-demand-source.js';
import { miningDemandId,sealMiningOperationAdmission } from '../../../../agent-skills/mining-admission.js';
import { executeMiningDemandRequest,type MiningDemandOptions } from '../../../gateway/admin/native-mining-demand.js';
import { RsSdkSkillRuntime } from '../../../../agent-skills/rs-sdk-runtime.js';
import { SkillExecutor } from '../../../../agent-skills/executor.js';
import type { NativeMiningDemandCommand,MiningDemandRequest } from '../../../../sdk/mining-demand.js';
beforeAll(loadPackedContent);
const sources:ReturnType<typeof miningSourceFixture>[]=[],token=process.env.ENGINE_ADMIN_TOKEN;
afterEach(()=>{closeNativeMiningFixtures();for(const f of sources.splice(0))f.close();
    if(token===undefined)delete process.env.ENGINE_ADMIN_TOKEN;else process.env.ENGINE_ADMIN_TOKEN=token;});
function harness(){
    const s=miningSourceFixture();sources.push(s);process.env.ENGINE_ADMIN_TOKEN='native-mining-fixture-token';
    const checkpointPath=join(s.root,'server/engine/data/player-checkpoints.sqlite');mkdirSync(join(s.root,'server/engine/data'),{recursive:true});
    const f=fixture(undefined,{username:'worker',checkpointPath,identity:(username,actionId,slot,tick)=>username!==s.owner.username?null:
        {action:{...s.owner,actionId,itemId:379,quantity:1,slot,policyDigest:'a'.repeat(64)},clock:s.clock.observeNow(s.owner.clockId,tick)}});
    f.p.intentFulfillmentAllowed=r=>miningIntentFulfillmentAllowed(s.root,r.intent);
    const tracker=new NativeMiningIntentTracker({...f.p,clock:()=>s.clock.observeNow(s.owner.clockId,World.currentTick),
        authorizeStart:(command,owner)=>authorizeMiningDemandCommand(s.root,command,owner)});
    let online=true;
    const local:NativeMiningDemandRuntime={workspace:s.root,tracker,player:name=>online&&name===s.owner.username?f.miner:null};
    async function dispatch(command:NativeMiningDemandCommand){
        const url=new URL('http://localhost/api/internal/admin/native-mining-demand');
        const pending=handleInternalAdminRequest(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!},
            body:JSON.stringify({commandId:randomUUID(),...command})}),url);
        for(let i=0;i<2;i++){await new Promise(resolve=>setTimeout(resolve,0));tickNativeMiningIntents(local);}
        const response=await pending;if(!response||response.status!==200)throw Error('Native HTTP command rejected');return response.json();
    }
    const options:MiningDemandOptions={workspace:s.root,worldId:s.owner.worldId,checkpointPath,binding:()=>({...s.owner,worldProfileDigest:'extra-ignored'} as any),dispatch};
    return{...f,s,tracker,local,options,offline(){online=false;}};
}

test('SI-C07 admitted executor → SDK runtime → gateway proof → internal HTTP/tick → packed Mining → canonical fulfillment',async()=>{
    const f=harness();let nativeCalls=0;
    const sdk={sendMiningDemand:(r:MiningDemandRequest)=>executeMiningDemandRequest(f.options,'worker',r),
        getInventory:()=>{const count=f.miner.getInventory(InvType.INV)!.getItemCount(436);return count?[{id:436,name:'copper ore',count}]:[];},
        getSkillXp:()=>0,waitForCondition:async(check:()=>boolean)=>{if(!check())throw Error('No native progress');}};
    const runtime=new RsSdkSkillRuntime({interactLoc:async()=>{nativeCalls++;f.mine();return{success:true,message:'native-target'};}} as any,sdk as any);
    const result=await new SkillExecutor(runtime).execute(f.s.registered.definition,{runId:f.s.request.context.runId,
        onMiningAdmission:async r=>{f.s.admit(r);},onMiningClosed:async r=>sealMiningOperationAdmission(f.s.root,r)});
    expect(result.status).toBe('completed');expect(nativeCalls).toBe(1);
    const row=f.tracker.store.get(f.s.demandId)!;expect(row.phase).toBe('fulfilled');expect(row.completionEventId).not.toBeNull();
    expect(f.store.event(row.completionEventId!)!.kind).toBe('mined');expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(99);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(result.events.find(e=>e.type==='step.succeeded')?.data?.miningDemand).toMatchObject({state:'fulfilled',demandId:f.s.demandId});
});

test('SI-C07 close-before-late-open persists cancellation and cannot manufacture pending demand or ore',async()=>{
    const f=harness();f.s.admit();let pending:NativeMiningDemandCommand|undefined,release=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    f.options.dispatch=async command=>{if(command.operation==='open'){pending=command;await gate;}const value=applyNativeMiningDemand(f.local,command);
        if(!value.ok)throw Error('source rejected');return value;};
    const opened=executeMiningDemandRequest(f.options,'worker',f.s.request);await Promise.resolve();
    expect(pending).toBeDefined();await executeMiningDemandRequest(f.options,'worker',{...f.s.request,operation:'close'});release();
    expect((await opened).success).toBeFalse();expect(f.tracker.store.pending()).toHaveLength(0);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
});

test('SI-C07 a Mining action admitted before the standing request cannot fulfill it when its suspended output arrives',()=>{
    const f=harness();f.s.admit();persistMiningDemandInvocation(f.s.root,f.s.owner,f.s.request);
    const first=f.mine(4096,f.miner,undefined,()=>{
        expect(applyNativeMiningDemand(f.local,{operation:'open',demandId:f.s.demandId,username:'worker',contextDigest:miningRequestDigest(f.s.request)}).ok).toBeTrue();
    });
    expect(f.store.event(first.nativeMiningActionId!)!.kind).toBe('mined');expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');
    const fresh=f.mine();expect(f.tracker.store.get(f.s.demandId)!.completionEventId).toBe(fresh.nativeMiningActionId);
});

test('SI-C07 lost close dispatch still cancels through durable source after disconnect',async()=>{
    const f=harness();f.s.admit();expect((await executeMiningDemandRequest(f.options,'worker',f.s.request)).success).toBeTrue();
    f.options.dispatch=async()=>{throw Error('engine transport lost');};
    expect((await executeMiningDemandRequest(f.options,'worker',{...f.s.request,operation:'close'})).success).toBeFalse();
    f.offline();World.currentTick++;tickNativeMiningIntents(f.local);
    expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('cancelled');expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(100);
});

test('SI-C07 revoked or sealed admission cannot borrow later native output; observer records unknown source coverage',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    f.s.agents.setSkillKnowledge(f.s.owner.actorId,f.s.request.context.skill,'blocked',1);
    World.currentTick++;tickNativeMiningIntents(f.local);
    expect(f.tracker.store.get(f.s.demandId)!.sample.availability).toBe('unknown');f.mine();
    expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');
    sealMiningOperationAdmission(f.s.root,f.s.request);World.currentTick++;tickNativeMiningIntents(f.local);
    expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('cancelled');
});

test('SI-C07 internal Mining command retains token/method/schema restrictions',async()=>{
    const f=harness(),url=new URL('http://localhost/api/internal/admin/native-mining-demand');
    expect((await handleInternalAdminRequest(new Request(url,{method:'POST'}),url))?.status).toBe(401);
    const headers={'X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!,'Content-Type':'application/json'};
    expect((await handleInternalAdminRequest(new Request(url,{headers}),url))?.status).toBe(405);
    expect((await handleInternalAdminRequest(new Request(url,{method:'POST',headers,body:JSON.stringify({commandId:randomUUID(),operation:'open',
        demandId:f.s.demandId,username:'worker',contextDigest:miningRequestDigest(f.s.request),receipt:{phase:'fulfilled'}})}),url))?.status).toBe(400);
    expect((await handleInternalAdminRequest(new Request(url,{method:'POST',headers,body:JSON.stringify({commandId:randomUUID(),operation:'invent-value',
        demandId:f.s.demandId,username:'worker',contextDigest:miningRequestDigest(f.s.request)})}),url))?.status).toBe(409);
});
