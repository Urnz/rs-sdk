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
import { NativeMiningCoverageStore,miningCoverageSourceHeads } from '../../../../item-lifecycle/native-mining-coverage.js';
import { readNativeMiningCohortCoverage } from '../../../../society-metrics/tool-demand-coverage.js';
import { executeMiningInteractionRequest,type MiningInteractionOptions } from '../../../gateway/admin/native-mining-interaction.js';
import { miningDispatchId,persistMiningInteractionSource } from '../../../../agent-skills/mining-interaction-source.js';
import { applyNativeMiningInteraction } from './NativeMiningInteraction.js';
import type { MiningInteractionRequest,NativeMiningInteractionCommand } from '../../../../sdk/mining-interaction.js';
import LocType from '../cache/config/LocType.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import JavaRandom from '../util/JavaRandom.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import { NativeMiningDispatchStore } from '../../../../item-lifecycle/native-mining-dispatch.js';
beforeAll(loadPackedContent);
const sources:ReturnType<typeof miningSourceFixture>[]=[],token=process.env.ENGINE_ADMIN_TOKEN;
let rockSequence=0;
afterEach(()=>{closeNativeMiningFixtures();for(const f of sources.splice(0))f.close();
    if(token===undefined)delete process.env.ENGINE_ADMIN_TOKEN;else process.env.ENGINE_ADMIN_TOKEN=token;});
function harness(){
    const s=miningSourceFixture();sources.push(s);process.env.ENGINE_ADMIN_TOKEN='native-mining-fixture-token';
    const checkpointPath=join(s.root,'server/engine/data/player-checkpoints.sqlite');mkdirSync(join(s.root,'server/engine/data'),{recursive:true});
    const f=fixture(undefined,{username:'worker',checkpointPath,identity:(username,actionId,slot,tick)=>username!==s.owner.username?null:
        {action:{...s.owner,actionId,itemId:379,quantity:1,slot,policyDigest:'a'.repeat(64)},clock:s.clock.observeNow(s.owner.clockId,tick)}});
    f.p.intentFulfillmentAllowed=r=>miningIntentFulfillmentAllowed(s.root,r.intent);
    const tracker=new NativeMiningIntentTracker({...f.p,requireDispatchProof:true,clock:()=>s.clock.observeNow(s.owner.clockId,World.currentTick),
        authorizeStart:(command,owner)=>authorizeMiningDemandCommand(s.root,command,owner)});
    let online=true;
    const local:NativeMiningDemandRuntime={workspace:s.root,tracker,player:name=>online&&name===s.owner.username?f.miner:null};
    local.interaction={workspace:s.root,ports:f.p,player:local.player};
    async function dispatch(command:NativeMiningDemandCommand){
        const url=new URL('http://localhost/api/internal/admin/native-mining-demand');
        const pending=handleInternalAdminRequest(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!},
            body:JSON.stringify({commandId:randomUUID(),...command})}),url);
        for(let i=0;i<2;i++){await new Promise(resolve=>setTimeout(resolve,0));tickNativeMiningIntents(local);}
        const response=await pending;if(!response||response.status!==200)throw Error('Native HTTP command rejected');return response.json();
    }
    const options:MiningDemandOptions={workspace:s.root,worldId:s.owner.worldId,checkpointPath,binding:()=>({...s.owner,worldProfileDigest:'extra-ignored'} as any),dispatch};
    const interactionOptions:MiningInteractionOptions={...options,dispatch:async command=>{
        const url=new URL('http://localhost/api/internal/admin/native-mining-interaction');
        JavaRandom.setSeed(4096);
        const pending=handleInternalAdminRequest(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!},
            body:JSON.stringify({commandId:randomUUID(),...command})}),url);
        for(let i=0;i<2;i++){await new Promise(resolve=>setTimeout(resolve,0));tickNativeMiningIntents(local);}
        const response=await pending;if(!response||response.status!==200){console.info('[native-mining-interaction-rejection]',await response?.text());throw Error('Native Mining interaction HTTP rejected');}
        if(f.miner.activeScript){World.currentTick++;f.miner.delayed=false;f.miner.executeScript(f.miner.activeScript,true,true);}
        return response.json();
    }};
    function interactionRequest(sequence=1):MiningInteractionRequest{
        World.currentTick+=5;f.miner.setVar(VarPlayerType.getId('action_delay'),World.currentTick);f.miner.delayed=false;
        const rock=new Loc(0,3500+(rockSequence++*2),3149,1,1,EntityLifeCycle.DESPAWN,LocType.getId('copperrock1'),10,0);
        World.addLoc(rock,-1);f.miner.x=rock.x-1;f.miner.z=rock.z;
        return{demand:s.request,dispatchSequence:sequence,target:{x:rock.x,z:rock.z,locId:rock.type,optionIndex:1}};
    }
    return{...f,s,tracker,local,options,interactionOptions,interactionRequest,
        perform:(sequence=1)=>executeMiningInteractionRequest(interactionOptions,'worker',interactionRequest(sequence)),offline(){online=false;}};
}

test('SI-C07 admitted executor → SDK runtime → gateway proof → internal HTTP/tick → packed Mining → canonical fulfillment',async()=>{
    const f=harness();let nativeCalls=0;
    const sdk={sendMiningDemand:(r:MiningDemandRequest)=>executeMiningDemandRequest(f.options,'worker',r),
        getInventory:()=>{const count=f.miner.getInventory(InvType.INV)!.getItemCount(436);return count?[{id:436,name:'copper ore',count}]:[];},
        getSkillXp:()=>0,waitForCondition:async(check:()=>boolean)=>{if(!check())throw Error('No native progress');}};
    const runtime=new RsSdkSkillRuntime({interactLoc:async(_target:unknown,_option:unknown,context:import('../../../../sdk/mining-interaction.js').MiningInteractionContext)=>{
        nativeCalls++;const request={...f.interactionRequest(context.dispatchSequence),demand:context.demand};
        return executeMiningInteractionRequest(f.interactionOptions,'worker',request);}} as any,sdk as any);
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

test('SI-C07 a Mining action admitted before the standing request cannot fulfill it when its suspended output arrives',async()=>{
    const f=harness();f.s.admit();persistMiningDemandInvocation(f.s.root,f.s.owner,f.s.request);
    const first=f.mine(4096,f.miner,undefined,()=>{
        expect(applyNativeMiningDemand(f.local,{operation:'open',demandId:f.s.demandId,username:'worker',contextDigest:miningRequestDigest(f.s.request)}).ok).toBeTrue();
    });
    expect(f.store.event(first.nativeMiningActionId!)!.kind).toBe('mined');expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');
    f.mine();expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');
    expect((await f.perform()).success).toBeTrue();expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('fulfilled');
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

test('SI-C07 source-backed admission links the real packed Mining ingress to its exact cohort and intent prefix',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    const clock=f.s.clock.observeNow(f.s.owner.clockId,World.currentTick);
    const store=new NativeMiningCoverageStore(f.market.db,{schemaVersion:1,selectionId:randomUUID(),worldId:f.s.owner.worldId,
        clockId:clock.clockId,clockProfileDigest:clock.profileDigest,fromSimulationTime:clock.simulationTime,
        toSimulationTime:new Date(Date.parse(clock.simulationTime)+86400000).toISOString(),maximumSimulationGapMs:3600000,maximumWallGapMs:5000,
        actors:[f.s.owner],openingHeads:miningCoverageSourceHeads(f.market.db)});
    f.p.miningCoverage={db:f.market.db,workspace:f.s.root,clock:()=>f.s.clock.observeNow(clock.clockId,World.currentTick),identity:f.p.identity,
        player:name=>name==='worker'?f.miner:null,roster:()=>[f.s.owner],admitted:r=>miningIntentFulfillmentAllowed(f.s.root,r.intent)};
    const result=await f.perform();const rows=store.read().entries.filter(e=>e.event.kind==='ingress');
    expect(rows.length).toBeGreaterThan(0);expect(rows[0]!.event).toMatchObject({kind:'ingress',reason:'source-bound-request',demandId:f.s.demandId});
    expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('fulfilled');
    expect(rows[0]!.event).toMatchObject({nativeActionId:result.data?.dispatchId,dispatchId:result.data?.dispatchId});
    expect(rows[0]!.event.heads.intent.sequence).toBeGreaterThanOrEqual(1);
    const s=store.selection(),report=readNativeMiningCohortCoverage(f.market.db,{clockId:s.clockId,clockProfileDigest:s.clockProfileDigest,
        fromSimulationTime:s.fromSimulationTime,toSimulationTime:s.toSimulationTime,actorAgentIds:[f.s.owner.actorId]},s.worldId,
        [{agentId:f.s.owner.actorId,username:f.s.owner.username,lifecycleId:f.s.owner.lifecycleId}]);
    expect(report).toMatchObject({sourceBoundIngresses:rows.length,compatibleIntentIngresses:0,completeDemandCoverage:false,observerCoverageComplete:false});
});

test('SI-C07 one native dispatch executes once, replay cannot mine twice or redirect the same sequence',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    const request=f.interactionRequest(),source=persistMiningInteractionSource(f.s.root,f.s.owner,request);
    expect((await executeMiningInteractionRequest(f.interactionOptions,'worker',request)).success).toBeTrue();
    const before=f.miner.getInventory(InvType.INV)!.getItemCount(436);
    expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'worker'}).ok).toBeTrue();
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(before);
    expect(()=>persistMiningInteractionSource(f.s.root,f.s.owner,{...request,target:{...request.target,x:request.target.x+2}})).toThrow('conflict');
    expect(new NativeMiningDispatchStore(f.market.db).read()).toHaveLength(1);
});

test('SI-C07 queued dispatch after source cancellation is rejected before consuming an action or producing ore',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    const request=f.interactionRequest(),source=persistMiningInteractionSource(f.s.root,f.s.owner,request);
    await executeMiningDemandRequest(f.options,'worker',{...f.s.request,operation:'close'});
    expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'worker'}).ok).toBeFalse();
    expect(new NativeMiningDispatchStore(f.market.db).get(source.id)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
});

test('SI-C07 raw same-avatar Mining during an admitted operation cannot borrow its completion',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    f.mine();expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');expect(new NativeMiningDispatchStore(f.market.db).read()).toHaveLength(0);
    expect((await f.perform()).success).toBeTrue();const row=f.tracker.store.get(f.s.demandId)!;
    expect(row.phase).toBe('fulfilled');expect(new NativeMiningDispatchStore(f.market.db).get(row.completionEventId!)?.demandId).toBe(f.s.demandId);
});

test('SI-C07 untrusted target, offline avatar and posted command receipts never create native dispatch evidence',async()=>{
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    const request=f.interactionRequest(),source=persistMiningInteractionSource(f.s.root,f.s.owner,{...request,target:{...request.target,x:request.target.x+20}});
    expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'worker'}).ok).toBeFalse();
    expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'other'}).ok).toBeFalse();
    f.offline();expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'worker'}).ok).toBeFalse();
    const url=new URL('http://localhost/api/internal/admin/native-mining-interaction'),headers={'Content-Type':'application/json','X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!};
    expect((await handleInternalAdminRequest(new Request(url,{method:'POST'}),url))?.status).toBe(401);
    expect((await handleInternalAdminRequest(new Request(url,{headers}),url))?.status).toBe(405);
    expect((await handleInternalAdminRequest(new Request(url,{method:'POST',headers,body:JSON.stringify({commandId:randomUUID(),dispatchId:source.id,username:'worker',receipt:'forged'})}),url))?.status).toBe(400);
    expect(new NativeMiningDispatchStore(f.market.db).read()).toHaveLength(0);
});
