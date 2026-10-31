import { afterEach,beforeAll,expect,test } from 'bun:test';
import { cpSync,mkdirSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
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
import tinDraft from '../../../../agent-skills/catalog/procedure.mining.gather-tin@0.1.0.skill.json' with {type:'json'};
import {SkillRegistry} from '../../../../agent-skills/registry.js';
import {miningTrialAuthorization} from '../../../../agent-skills/mining-trials.js';
import {readMiningSkillRunEvidence,verifyMiningSkillRunSources} from '../../../gateway/admin/native-mining-skill-evidence.js';
import {verifyAndPromoteSkill} from '../../../../agent-skills/verifier.js';
import {miningOperationAdmissionPath} from '../../../../agent-skills/mining-admission.js';
import {PlayerStat} from '../engine/entity/PlayerStat.js';
import type {SkillDefinition,SkillRunResult} from '../../../../agent-skills/types.js';
import {nativeToolDigest as hash} from '../../../../item-lifecycle/native-tool.js';
import {Database} from 'bun:sqlite';
import ScriptState from '../engine/script/ScriptState.js';
import {Interaction} from '../engine/entity/Interaction.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import {FileSkillRunJournal} from '../../../../agent-skills/journal.js';
import {SkillTrialStore} from '../../../../agent-skills/trials.js';
import {reviewSkillTrial,readSkillTrialReview} from '../../../../agent-skills/trial-review.js';
import {tickNativeMiningCoverage} from './NativeMiningCoverage.js';
beforeAll(loadPackedContent);
const sources:ReturnType<typeof miningSourceFixture>[]=[],token=process.env.ENGINE_ADMIN_TOKEN;
let rockSequence=0;
afterEach(()=>{closeNativeMiningFixtures();for(const f of sources.splice(0))f.close();
    if(token===undefined)delete process.env.ENGINE_ADMIN_TOKEN;else process.env.ENGINE_ADMIN_TOKEN=token;});
function harness(draft?:SkillDefinition){
    const s=miningSourceFixture(draft);sources.push(s);process.env.ENGINE_ADMIN_TOKEN='native-mining-fixture-token';
    cpSync(resolve(import.meta.dir,'../../../../config'),join(s.root,'config'),{recursive:true});
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
        JavaRandom.setSeed(draft?1:4096); // Level-1 tin: native gem roll then success roll; no stat boost.
        const pending=handleInternalAdminRequest(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Admin-Token':process.env.ENGINE_ADMIN_TOKEN!},
            body:JSON.stringify({commandId:randomUUID(),...command})}),url);
        for(let i=0;i<2;i++){await new Promise(resolve=>setTimeout(resolve,0));tickNativeMiningIntents(local);}
        const response=await pending;if(!response||response.status!==200){console.info('[native-mining-interaction-rejection]',await response?.text());throw Error('Native Mining interaction HTTP rejected');}
        if(f.miner.activeScript){World.currentTick++;f.miner.delayed=false;f.miner.executeScript(f.miner.activeScript,true,true);}
        return response.json();
    }};
    function interactionRequest(sequence=1):MiningInteractionRequest{
        World.currentTick+=5;f.miner.setVar(VarPlayerType.getId('action_delay'),World.currentTick);f.miner.delayed=false;
        const rock=new Loc(0,3500+(rockSequence++*2),3149,1,1,EntityLifeCycle.DESPAWN,LocType.getId(draft?'tinrock1':'copperrock1'),10,0);
        World.addLoc(rock,-1);f.miner.x=rock.x-1;f.miner.z=rock.z;
        return{demand:s.request,dispatchSequence:sequence,target:{x:rock.x,z:rock.z,locId:rock.type,optionIndex:1}};
    }
    return{...f,s,tracker,local,options,interactionOptions,interactionRequest,
        perform:(sequence=1)=>executeMiningInteractionRequest(interactionOptions,'worker',interactionRequest(sequence)),offline(){online=false;}};
}

async function naturalMining(withCoverage=false){
    const f=harness();f.s.admit();await executeMiningDemandRequest(f.options,'worker',f.s.request);
    let coverage:NativeMiningCoverageStore|undefined;
    if(withCoverage){
        const clock=f.s.clock.observeNow(f.s.owner.clockId,World.currentTick);
        coverage=new NativeMiningCoverageStore(f.market.db,{schemaVersion:1,selectionId:randomUUID(),worldId:f.s.owner.worldId,
            clockId:clock.clockId,clockProfileDigest:clock.profileDigest,fromSimulationTime:clock.simulationTime,
            toSimulationTime:new Date(Date.parse(clock.simulationTime)+86400000).toISOString(),maximumSimulationGapMs:3600000,maximumWallGapMs:5000,
            actors:[f.s.owner],openingHeads:miningCoverageSourceHeads(f.market.db)});
        f.p.miningCoverage={db:f.market.db,workspace:f.s.root,clock:()=>f.s.clock.observeNow(clock.clockId,World.currentTick),identity:f.p.identity,
            player:name=>name==='worker'?f.miner:null,roster:()=>[f.s.owner],admitted:r=>miningIntentFulfillmentAllowed(f.s.root,r.intent)};
    }
    const request=f.interactionRequest(),source=persistMiningInteractionSource(f.s.root,f.s.owner,request);
    f.miner.setVar(VarPlayerType.getId('action_delay'),0);JavaRandom.setSeed(4096);
    expect(applyNativeMiningInteraction(f.local.interaction!,{dispatchId:source.id,username:'worker'}).ok).toBeTrue();
    // Production applies the typed command before processPlayers in the SAME tick.
    await Bun.sleep(2);f.miner.processInteraction();
    const tick=()=>{World.currentTick++;if(f.miner.delayed&&World.currentTick>=f.miner.delayedUntil)f.miner.delayed=false;
        if(!f.miner.delayed&&f.miner.activeScript?.execution===ScriptState.SUSPENDED)f.miner.executeScript(f.miner.activeScript,true,true);
        f.miner.processInteraction();};
    return{...f,source,tick,coverage};
}

test('SI-C07 continuation preserves one exact dispatch through natural packed p_oploc ticks and delayed output',async()=>{
    const f=await naturalMining(true);expect(f.miner.nativeMiningContinuation?.dispatchId).toBe(f.source.id);
    for(let i=0;i<40&&!f.store.event(f.source.id);i++)f.tick();
    expect(f.tracker.store.get(f.s.demandId)).toMatchObject({phase:'fulfilled',completionEventId:f.source.id});
    expect(f.store.event(f.source.id)).toMatchObject({kind:'mined',source:{nativeMiningDispatchId:f.source.id}});
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(99);
    for(let i=0;i<10;i++)f.tick();
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(new NativeMiningDispatchStore(f.market.db).read()).toHaveLength(1);
    tickNativeMiningCoverage(f.p.miningCoverage);
    const entries=f.coverage!.read().entries;
    expect(entries.filter(e=>e.event.kind==='ingress')).toHaveLength(1);
    expect(entries.at(-1)!.event).toMatchObject({kind:'sample',ingressWriteFailed:false});
});

test('SI-C07 continuation close clears queued packed work before any late ore or wear',async()=>{
    const f=await naturalMining();f.tick();
    expect(f.miner.nativeMiningContinuation).not.toBeNull();
    await executeMiningDemandRequest(f.options,'worker',{...f.s.request,operation:'close'});
    expect(f.miner.nativeMiningContinuation).toBeNull();expect(f.miner.target).toBeNull();
    for(let i=0;i<40;i++)f.tick();
    expect(f.store.event(f.source.id)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(100);
});

test('SI-C07 continuation suspended success cannot commit after acknowledged close',async()=>{
    const f=await naturalMining();
    for(let i=0;i<40&&!f.miner.activeScript;i++)f.tick();
    expect(f.miner.activeScript?.nativeMiningDispatchId).toBe(f.source.id);
    await executeMiningDemandRequest(f.options,'worker',{...f.s.request,operation:'close'});
    for(let i=0;i<10;i++)f.tick();
    expect(f.store.event(f.source.id)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(100);
});

test('SI-C07 continuation raw same-target replacement cannot inherit the executor dispatch',async()=>{
    const f=await naturalMining(),target=f.miner.target!;
    f.miner.setInteraction(Interaction.ENGINE,target,ServerTriggerType.APLOC1);
    expect(f.miner.nativeMiningContinuation).toBeNull();
    for(let i=0;i<40;i++)f.tick();
    expect(f.store.event(f.source.id)).toBeNull();expect(f.tracker.store.get(f.s.demandId)!.phase).toBe('pending');
});

test('SI-C07 continuation expiry stops delayed packed output without producing ore or wear',async()=>{
    const f=await naturalMining();
    for(let i=0;i<40&&!f.miner.activeScript;i++)f.tick();
    expect(f.miner.activeScript?.nativeMiningDispatchId).toBe(f.source.id);
    const identity=f.p.identity,expired=new Date(Date.parse(f.tracker.store.get(f.s.demandId)!.intent.expiresAtWallTime)+1).toISOString();
    f.p.identity=(...args)=>{const c=identity(...args);return c?{...c,clock:{...c.clock,wallTime:expired}}:c;};
    for(let i=0;i<10;i++)f.tick();
    expect(f.store.event(f.source.id)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(100);
});

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
    result.username='worker';
    expect(verifyMiningSkillRunSources(f.s.root,result,f.options)).toBeTrue();
});

test('SI-C07 exact tin draft needs two independent canonical native effects; source tampering invalidates review',async()=>{
    const started=performance.now(),phase=(name:string)=>console.info('[native-tin-review]',JSON.stringify({phase:name,elapsedMs:Math.round(performance.now()-started)}));
    const draft=new SkillRegistry().register(tinDraft,{trusted:true}).definition;
    const runs:SkillRunResult[]=[],roots=new Map<string,ReturnType<typeof harness>>();
    const f=harness(draft);f.miner.setLevel(PlayerStat.MINING,1);
    const trials=new SkillTrialStore(join(f.s.root,'.local/agent-skills/trials.json')),journal=new FileSkillRunJournal(join(f.s.root,'.local/agent-skills/runs'));
    let trial=await trials.create({gapId:'gap-'+'a'.repeat(20),draft:{id:draft.id,version:draft.version},targetVersion:'1.0.0',testBotUsername:'worker',parameters:{}},'2026-10-30T00:00:00.000Z');
    trial=await trials.transition(trial.trialId,trial.revision,'running');
    for(let i=0;i<2;i++){
        phase(`run-${i+1}-start`);
        // Controlled movement/loc placement tests the source join, not a packed-world route or baseline performance.
        const sdk={sendMiningDemand:(r:MiningDemandRequest)=>executeMiningDemandRequest(f.options,'worker',r),
            getInventory:()=>[{id:1265,name:'Bronze pickaxe',count:1},{id:438,name:'Tin ore',count:f.miner.getInventory(InvType.INV)!.getItemCount(438)}],
            getSkill:()=>({baseLevel:f.miner.baseLevels[PlayerStat.MINING]}),getSkillXp:()=>0,
            waitForCondition:async(check:()=>boolean)=>{if(!check())throw Error('No native progress');}};
        const runtime=new RsSdkSkillRuntime({walkTo:async()=>({success:true,message:'controlled fixture placement'}),
            interactLoc:async(_target:unknown,_option:unknown,context:import('../../../../sdk/mining-interaction.js').MiningInteractionContext)=>
                executeMiningInteractionRequest(f.interactionOptions,'worker',{...f.interactionRequest(context.dispatchSequence),demand:context.demand})} as any,sdk as any);
        const runId=i===0?f.s.request.context.runId:randomUUID();
        await journal.start({runId,username:'worker',skill:trial.draft,checksum:f.s.registered.checksum,parameters:{},parametersDigest:hash([])});
        const result=await new SkillExecutor(runtime).execute(draft,{allowDraft:true,runId,onMiningAdmission:async r=>{
            f.s.admit(r);const marker=JSON.parse(readFileSync(f.s.markerPath,'utf8'));
            writeFileSync(f.s.markerPath,JSON.stringify({...marker,nativeMiningTrial:{checksum:f.s.registered.checksum,runtimeAuthorization:miningTrialAuthorization(draft)}}));
        },onMiningClosed:async r=>sealMiningOperationAdmission(f.s.root,r)});
        result.username='worker';expect(result.status).toBe('completed');
        expect(f.miner.getInventory(InvType.INV)!.getItemCount(438)).toBe(i+1);
        expect(f.store.lifecycle.get('tool-worker')!.durability).toBe(99-i);
        // Throwing reader preserves a useful failure location; the public verifier itself fails closed.
        expect(readMiningSkillRunEvidence(f.s.root,result,f.options)).toHaveLength(1);
        roots.set(result.runId,f);runs.push(result);
        await journal.save(result);
        phase(`run-${i+1}-source-verified`);
    }
    const reviewOptions={workspace:f.s.root,trialId:trial.trialId,selected:f.options},review=await reviewSkillTrial(reviewOptions);
    expect(review.report.passed).toBeTrue();expect((await readSkillTrialReview(reviewOptions)).approval.digest).toBe(review.approval!.digest);
    const options={targetVersion:'1.0.0',verifyMiningEvidence:(run:SkillRunResult)=>{const f=roots.get(run.runId)!;return verifyMiningSkillRunSources(f.s.root,run,f.options);}};
    expect(verifyAndPromoteSkill(draft,runs,options).passed).toBeTrue(); // Report only; no catalog publication.
    const first=roots.get(runs[0]!.runId)!,event=runs[0]!.events.find(e=>e.type==='step.succeeded'&&e.operation==='gather-loc')!;
    const posted=event.data!.miningDemand as {request:MiningDemandRequest;receiptDigest:string;nativeActionId:string};
    const request=posted.request,path=miningOperationAdmissionPath(first.s.root,request).replace(/\.json$/,'.closed.json'),seal=readFileSync(path);
    unlinkSync(path);expect(verifyAndPromoteSkill(draft,runs,options).passed).toBeFalse();writeFileSync(path,seal);
    unlinkSync(path);await expect(readSkillTrialReview(reviewOptions)).rejects.toThrow('changed');writeFileSync(path,seal);
    const original=posted.receiptDigest;posted.receiptDigest='f'.repeat(64);
    expect(verifyAndPromoteSkill(draft,runs,options).passed).toBeFalse();posted.receiptDigest=original;
    expect(verifyMiningSkillRunSources(first.s.root,{...runs[0]!,username:'other'},first.options)).toBeFalse();
    expect(verifyMiningSkillRunSources(first.s.root,runs[0]!,{...first.options,worldId:'other-world'})).toBeFalse();
    const row=first.market.db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_tool_event WHERE event_id=?').get(posted.nativeActionId)!;
    const forged=JSON.parse(row.payload);forged.after.durability++;
    expect(()=>first.market.db.query('UPDATE native_tool_event SET payload=?,digest=? WHERE event_id=?').run(JSON.stringify(forged),hash(forged),posted.nativeActionId)).toThrow('immutable');
    // Deliberately corrupt a disposable copy, keeping the canonical fixture and its guards intact.
    const forgedPath=join(first.s.root,'server/engine/data/forged-checkpoints.sqlite');writeFileSync(forgedPath,first.market.db.serialize());
    const forgedDb=new Database(forgedPath);
    try{forgedDb.exec('DROP TRIGGER native_tool_event_no_update');
        forgedDb.query('UPDATE native_tool_event SET payload=?,digest=? WHERE event_id=?').run(JSON.stringify(forged),hash(forged),posted.nativeActionId);
    }finally{forgedDb.close(true);}
    expect(verifyMiningSkillRunSources(first.s.root,runs[0]!,{...first.options,checkpointPath:forgedPath})).toBeFalse();
    const snapshot=()=>createHash('sha256').update(first.market.db.serialize()).digest('hex'),before=snapshot();
    expect(verifyAndPromoteSkill(draft,runs,options).passed).toBeTrue();
    expect(snapshot()).toBe(before);phase('negative-and-readonly-complete');
},15000); // Two independent engine runs plus repeated readonly audit joins, not a one-operation 5s case.

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
