import World from '../engine/World.js';
import { beforeAll,afterEach,expect,test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { executeToolSkillRequest,verifyToolSkillRunSources } from '../../../gateway/admin/native-tool-skills.js';
import { nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import type { SkillRunResult } from '../../../../agent-skills/types.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { NativeToolWorkStore } from '../../../../production-workflow/native-tool-work.js';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import { fixture,closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { NativeToolWorkExecutor,type NativeToolWorkPorts,type NativeToolWorkCommand } from './NativeToolWork.js';
import { nativeToolWorkPolicy,TOOL_WORK_SKILLS } from '../../../../production-workflow/native-tool-work-policy.js';
import type { NativeToolWorkKind,NativeToolWorkRecord } from '../../../../production-workflow/native-tool-work.js';
beforeAll(loadPackedContent);afterEach(closeNativeMiningFixtures);
function harness(){
    const f=fixture(),originalIdentity=f.p.identity;let offset=0;
    f.p.identity=(name,id,slot,tick)=>{const current=originalIdentity(name,id,slot,tick)!;
        return{...current,clock:{...current.clock,wallTime:new Date(Date.UTC(2026,9,24,13)+tick*600).toISOString(),
            simulationTime:new Date(Date.UTC(2001,0,1)+tick*600+offset).toISOString()}};};
    const sources=Object.fromEntries((['smelt','repair'] as const).map(kind=>{const s=nativeToolWorkPolicy[kind].source;
        return[kind,new Loc(s.level,s.x,s.z,1,1,EntityLifeCycle.FOREVER,LocType.getId(s.debugName),10,0)];})) as Record<NativeToolWorkKind,Loc>;
    const p:NativeToolWorkPorts={...f.p,identity:f.p.identity,clock:()=>f.p.identity(f.miner.username,'clock',0,World.currentTick)!.clock,
        source:kind=>sources[kind],authorize:(_player,kind)=>({digest:'a'.repeat(64),skill:{...TOOL_WORK_SKILLS[kind],checksum:'b'.repeat(64)},
            facility:kind==='repair'?{providerId:nativeToolWorkPolicy.repair.facilityId,grantId:'fixture-grant',sourceEvidenceDigest:'c'.repeat(64)}:null})};
    let executor=new NativeToolWorkExecutor(p);
    const command=(kind:NativeToolWorkKind):NativeToolWorkCommand=>({operationId:randomUUID(),kind,username:f.miner.username,
        businessId:kind==='repair'?'fixture-workshop':null,contextDigest:'d'.repeat(64)});
    const place=(kind:NativeToolWorkKind)=>{const s=sources[kind];f.miner.x=s.x-1;f.miner.z=s.z;f.miner.level=s.level;};
    const tick=(id:string,deltaMs=150000)=>{World.currentTick++;offset+=deltaMs-600;return executor.advance(id,f.miner);};
    return{...f,p,sources,command,place,tick,executor:()=>executor,restart(){executor=new NativeToolWorkExecutor(p);},
        jumpWall(){const old=p.clock;p.clock=()=>{const c=old();return{...c,wallTime:new Date(Date.parse(c.wallTime)+60000).toISOString()};};}};
}
test('SI-C03 packed bronze smelting holds exact native ores and commits one actual bar',()=>{
    const f=harness();f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);f.place('smelt');
    const command=f.command('smelt');const pending=f.executor().start(command,f.miner);
    expect(pending.phase).toBe('working');expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.tick(command.operationId).phase).toBe('working');expect(f.tick(command.operationId).phase).toBe('working');
    const done=f.tick(command.operationId);expect(done.phase).toBe('completed');
    expect(done.result!.script).toBe('[queue,smelting_ore]');expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(1);
});
test('SI-C03 complete100 native use chain procures copper and tin, smelts, repairs and reuses the exact instance',()=>{
    const f=harness(),id=`tool-${f.miner.username}`,bank=InvType.getId('bank');
    for(let n=0;n<100;n++){
        const ore=n===99?438:436;
        expect(f.mine(4096,f.miner,undefined,undefined,n===99?'tinrock1':'copperrock1').execution).not.toBe(-1);
        expect(f.store.lifecycle.get(id)!.durability).toBe(99-n);
        if(n<98)f.move(f.miner,InvType.INV,bank,f.miner.getInventory(InvType.INV)!.getItemIndex(ore));
    }
    expect(f.store.lifecycle.get(id)!.status).toBe('broken');
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(438)).toBe(1);
    expect(f.mine().execution).toBe(-1);f.miner.delayed=false;f.miner.target=null;
    f.place('smelt');const smelt=f.command('smelt');f.executor().start(smelt,f.miner);
    for(let i=0;i<3;i++)f.tick(smelt.operationId,40000);
    expect(f.executor().work.get(smelt.operationId)!.phase).toBe('completed');
    f.place('repair');const repair=f.command('repair');f.executor().start(repair,f.miner);
    expect(f.tick(repair.operationId,599999).phase).toBe('working');
    expect(f.tick(repair.operationId,1).result!.tool!.durability).toBe(50);
    expect(f.mine().execution).not.toBe(-1);expect(f.store.lifecycle.get(id)!.durability).toBe(49);
    const tool=f.store.lifecycle.get(id)!;
    const mined=f.market.db.query<{event_id:string},[]>('SELECT event_id FROM native_tool_event WHERE json_extract(payload,\'$.kind\')=\'mined\' ORDER BY rowid').all();
    const bankedCopper=f.miner.getInventory(bank)!.getItemCount(436),auditValid=f.store.lifecycle.verifyAuditChain();
    expect(mined).toHaveLength(101);expect(bankedCopper).toBe(98);expect(auditValid).toBeTrue();
    console.log('SI-C03_ACCEPTANCE',JSON.stringify({instanceId:id,nativeMiningOutputs:mined.length,nativeMiningActionIds:mined.map(row=>row.event_id),bankedCopper,auditValid,
        smelt:f.executor().work.get(smelt.operationId),repair:f.executor().work.get(repair.operationId),afterUse:tool}));
});
test('SI-C03 no material, missing source, insufficient skill, missing procedure or access never starts free work',()=>{
    const f=harness();f.place('smelt');const command=f.command('smelt');
    expect(()=>f.executor().start(command,f.miner)).toThrow();expect(f.executor().work.list()).toHaveLength(0);
    f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);
    const source=f.p.source;f.p.source=()=>null;expect(()=>f.executor().start(command,f.miner)).toThrow('facility');f.p.source=source;
    f.miner.levels[PlayerStat.SMITHING]=0;expect(()=>f.executor().start(command,f.miner)).toThrow('skilled');f.miner.levels[PlayerStat.SMITHING]=1;
    f.p.authorize=()=>{throw new Error('no learned procedure/facility access');};expect(()=>f.executor().start(command,f.miner)).toThrow('procedure');
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);expect(f.executor().work.list()).toHaveLength(0);
});
test('SI-C03 restart and offline intervals preserve WIP and input without unearned progress or duplicate escrow',()=>{
    const f=harness(),id=`tool-${f.miner.username}`;f.store.lifecycle.use('fixture-break',id,1,100,'e'.repeat(64),'2001-01-01T00:00:00.000Z');
    f.miner.invAdd(InvType.INV,2349,1);f.place('repair');const command=f.command('repair');
    const opened=f.executor().start(command,f.miner);expect(f.tick(command.operationId,200000).progressMs).toBe(200000);
    f.restart();expect(f.tick(command.operationId,200000).progressMs).toBe(200000);
    World.currentTick++;expect(f.executor().advance(command.operationId,null).phase).toBe('paused');
    expect(f.tick(command.operationId,200000).progressMs).toBe(200000);
    expect(f.executor().start(command,f.miner).intent.escrowId).toBe(opened.intent.escrowId);
    const loaded=f.reload();loaded.x=f.miner.x;loaded.z=f.miner.z;
    World.currentTick++;expect(f.executor().advance(command.operationId,loaded).phase).toBe('working');
    World.currentTick++;const clock=f.p.clock;f.p.clock=()=>{const c=clock();return{...c,simulationTime:new Date(Date.parse(c.simulationTime)+400000).toISOString()};};
    expect(f.executor().advance(command.operationId,loaded).phase).toBe('completed');
    const reader=new Database(f.market.db.filename,{readonly:true});
    try{expect(NativeToolWorkStore.read(reader).find(row=>row.intent.operationId===command.operationId)!.phase).toBe('completed');}finally{reader.close();}
    expect(f.executor().advance(command.operationId,loaded).result!.tool!.durability).toBe(50);
});
test('SI-C03 access revocation and process stall pause credit; spent inputs cannot be discarded',()=>{
    const f=harness(),id=`tool-${f.miner.username}`;f.store.lifecycle.use('fixture-break',id,1,100,'e'.repeat(64),'2001-01-01T00:00:00.000Z');
    f.miner.invAdd(InvType.INV,2349,1);f.place('repair');const command=f.command('repair');f.executor().start(command,f.miner);
    const authorize=f.p.authorize;f.p.authorize=()=>{throw new Error('revoked');};
    expect(f.tick(command.operationId,600000)).toMatchObject({phase:'paused',progressMs:0});f.p.authorize=authorize;
    expect(f.tick(command.operationId,600000).progressMs).toBe(0);
    f.jumpWall();expect(f.tick(command.operationId,600000).progressMs).toBe(0);
    expect(f.store.lifecycle.get(id)!.durability).toBe(0);
    expect(()=>f.market.db.run('DELETE FROM native_tool_work')).toThrow('discarded');
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);
});
test('SI-C03 duplicate jobs, changed intent and failed native checkpoint cannot duplicate material or repair',()=>{
    const f=harness();f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);f.place('smelt');
    const command=f.command('smelt');f.fail(true);expect(()=>f.executor().start(command,f.miner)).toThrow('checkpoint');
    expect(f.executor().work.list()).toHaveLength(0);expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);f.fail(false);
    f.executor().start(command,f.miner);
    expect(()=>f.executor().start({...command,contextDigest:'0'.repeat(64)},f.miner)).toThrow('conflict');
    expect(()=>f.executor().start(f.command('smelt'),f.miner)).toThrow();
    f.tick(command.operationId);f.tick(command.operationId);f.fail(true);
    expect(()=>f.tick(command.operationId)).toThrow('checkpoint');expect(f.executor().work.get(command.operationId)!.phase).toBe('working');
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);f.fail(false);
    expect(f.executor().advance(command.operationId,f.miner).phase).toBe('completed');expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(1);
    expect(f.executor().start(command,f.miner).phase).toBe('completed');expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(1);
});
test('SI-C03 gateway and verifier reopen native source; transport success, wrong actor and copied receipt are rejected',async()=>{
    const f=harness();f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);f.place('smelt');
    const request={operation:'tool-smelt-bronze' as const,args:{timeoutMs:60000},context:{runId:randomUUID(),stepId:'smelt',
        skill:{id:'procedure.metallurgy.smelt-bronze',version:'0.1.0'},parametersDigest:nativeToolDigest([])}};
    const action=f.p.identity(f.miner.username,'proof',0,World.currentTick)!.action;
    const {actorId,username,lifecycleId,worldId,clockId,clockProfileDigest}=action;
    const owner={actorId,username,lifecycleId,worldId,clockId,clockProfileDigest};
    let dispatched=0;const options={workspace:dirname(f.market.db.filename),worldId,checkpointPath:f.market.db.filename,binding:()=>owner,
        dispatch:async(command:NativeToolWorkCommand)=>{dispatched++;return f.executor().start(command,f.miner);}};
    const waiting=await executeToolSkillRequest(options,username,request);expect(waiting.data!.status).toBe('waiting');
    const id=waiting.data!.operationId;for(let n=0;n<3;n++)f.tick(id);
    const done=await executeToolSkillRequest(options,username,request);expect(done.success).toBeTrue();expect(dispatched).toBe(1);
    const timestamp='2026-10-24T12:00:00.000Z',run:SkillRunResult={runId:request.context.runId,username,skill:request.context.skill,parameters:{},
        status:'completed',reason:'completed',message:'done',operations:1,durationMs:1,events:[{runId:request.context.runId,skill:request.context.skill,
            type:'step.succeeded',operation:request.operation,stepId:'smelt',timestamp,data:done.data}]};
    expect(verifyToolSkillRunSources(options.workspace,run,options)).toBeTrue();
    expect(verifyToolSkillRunSources(options.workspace,{...run,username:'impostor'},options)).toBeFalse();
    const forged=structuredClone(run);(forged.events[0]!.data!.receipt as NativeToolWorkRecord).progressMs++;
    expect(verifyToolSkillRunSources(options.workspace,forged,options)).toBeFalse();
    await expect(executeToolSkillRequest(options,username,{...request,args:{timeoutMs:50000}})).rejects.toThrow('binding');
    const other={...request,context:{...request.context,runId:randomUUID()}};
    expect(await executeToolSkillRequest({...options,dispatch:async()=>({ok:true,receipt:done.data!.receipt})},username,other))
        .toMatchObject({success:false,reason:'tool-uncertain'});
});
test('SI-C03 failed repair completion rolls back capacity, WIP, native event and checkpoint; same tick retry commits once',()=>{
    const f=harness(),id=`tool-${f.miner.username}`;f.store.lifecycle.use('fixture-break',id,1,100,'e'.repeat(64),'2001-01-01T00:00:00.000Z');
    f.miner.invAdd(InvType.INV,2349,1);f.place('repair');const command=f.command('repair');f.executor().start(command,f.miner);
    f.tick(command.operationId,300000);const saved=f.market.saved(f.miner.username);f.fail(true);
    expect(()=>f.tick(command.operationId,300000)).toThrow('checkpoint');expect(f.store.lifecycle.get(id)!.durability).toBe(0);
    expect(f.executor().work.get(command.operationId)!.progressMs).toBe(300000);expect(f.store.event(`work:${command.operationId}`)).toBeNull();
    expect(f.market.saved(f.miner.username)!).toEqual(saved!);f.fail(false);
    expect(f.executor().advance(command.operationId,f.miner).result!.tool!.durability).toBe(50);
    expect(f.executor().advance(command.operationId,f.miner).result!.tool!.durability).toBe(50);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);
});
test('SI-C03 active repair blocks other protected work and tool transfer, including after native Player reload',()=>{
    const f=harness(),id=`tool-${f.miner.username}`;f.store.lifecycle.use('fixture-break',id,1,100,'e'.repeat(64),'2001-01-01T00:00:00.000Z');
    f.miner.invAdd(InvType.INV,2349,1);f.place('repair');const command=f.command('repair');f.executor().start(command,f.miner);
    const loaded=f.reload();expect(loaded.nativeToolWorkOperationId).toBe(command.operationId);
    expect(f.mine().execution).toBe(-1);expect(f.store.lifecycle.get(id)!.durability).toBe(0);
    expect(()=>f.trade(f.player(undefined,false))).toThrow('reserved');
    expect(f.executor().work.get(command.operationId)!.phase).toBe('working');
});
test('SI-C03 absent facility, foreign clock and competing outer transaction cannot advance work',()=>{
    const f=harness();f.miner.invAdd(InvType.INV,436,1);f.miner.invAdd(InvType.INV,438,1);f.place('smelt');const command=f.command('smelt');
    expect(()=>f.market.db.transaction(()=>f.executor().start(command,f.miner)).immediate()).toThrow('commit boundary');
    f.executor().start(command,f.miner);const source=f.p.source;f.p.source=()=>null;
    expect(f.tick(command.operationId,600000)).toMatchObject({phase:'paused',progressMs:0});f.p.source=source;
    const clock=f.p.clock;f.p.clock=()=>({...clock(),clockId:'foreign-clock'});
    expect(f.tick(command.operationId,600000)).toMatchObject({phase:'paused',progressMs:0});f.p.clock=clock;
    expect(()=>f.market.db.transaction(()=>f.executor().advance(command.operationId,f.miner)).immediate()).toThrow('commit boundary');
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);
});
test('SI-C03 internal admin admits only authenticated exact typed tool work and never supplied material/time receipts',async()=>{
    const old=process.env.ENGINE_ADMIN_TOKEN;process.env.ENGINE_ADMIN_TOKEN='si-c03-native-test-token';
    try{
        const url=new URL('http://localhost/api/internal/admin/native-tool-work'),body={commandId:randomUUID(),operationId:randomUUID(),
            kind:'smelt',username:'worker',businessId:null,contextDigest:'a'.repeat(64)};
        const call=(value:unknown,token?:string)=>handleInternalAdminRequest(new Request(url,{method:'POST',
            headers:{'Content-Type':'application/json',...(token?{'X-Engine-Admin-Token':token}:{})},body:JSON.stringify(value)}),url);
        expect((await call(body))!.status).toBe(401);
        expect((await call({...body,receipt:{},workSimulationMs:600000},process.env.ENGINE_ADMIN_TOKEN))!.status).toBe(400);
        expect((await call({...body,operationId:'invalid'},process.env.ENGINE_ADMIN_TOKEN))!.status).toBe(409);
    }finally{if(old===undefined)delete process.env.ENGINE_ADMIN_TOKEN;else process.env.ENGINE_ADMIN_TOKEN=old;}
});
test('SI-C03 actual material plus600 simulation seconds restores existing service capacity once',()=>{
    const f=harness(),id=`tool-${f.miner.username}`;
    f.store.lifecycle.use('fixture-break',id,1,100,'e'.repeat(64),'2001-01-01T00:00:00.000Z');
    f.miner.invAdd(InvType.INV,2349,1);f.place('repair');const command=f.command('repair');
    f.executor().start(command,f.miner);expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);
    expect(f.tick(command.operationId,300000).phase).toBe('working');expect(f.store.lifecycle.get(id)!.durability).toBe(0);
    const done=f.tick(command.operationId,300000);expect(done.phase).toBe('completed');expect(done.result!.tool!.durability).toBe(50);
    expect(f.executor().start(command,f.miner)).toEqual(done);expect(f.store.lifecycle.get(id)!.durability).toBe(50);
    expect(f.mine().execution).not.toBe(-1);expect(f.store.lifecycle.get(id)!.durability).toBe(49);
});
