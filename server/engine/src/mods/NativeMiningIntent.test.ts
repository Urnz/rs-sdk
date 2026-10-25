import { beforeAll,afterEach,expect,test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import World from '../engine/World.js';
import ScriptState from '../engine/script/ScriptState.js';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { NativeMiningIntentTracker,type NativeMiningIntentPorts } from './NativeMiningIntent.js';
import { NativeMiningIntentStore } from '../../../../item-lifecycle/native-mining-intent.js';
import { NativeToolWorkExecutor } from './NativeToolWork.js';
import { nativeToolWorkPolicy,TOOL_WORK_SKILLS } from '../../../../production-workflow/native-tool-work-policy.js';
import { readNativeMiningIntentIntervals } from '../../../../society-metrics/tool-demand-intervals.js';
import { loadSocietyMinimumPolicy } from '../../../../society-minimum/policy.js';
import { fixture,closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { expandedFixture,put } from '../../../../society-experiments/test/expanded-fixture.js';
import { captureSocietyArchive,restoreSocietyArchive } from '../../../../society-experiments/archive.js';
beforeAll(loadPackedContent);afterEach(closeNativeMiningFixtures);
const policy=loadSocietyMinimumPolicy(join(import.meta.dir,'../../../../config/society-minimum-policy.json'));
function harness(){
    const f=fixture(),initial=f.p.identity;let offset=0,wallOffset=0;
    f.p.identity=(name,id,slot,tick)=>{const c=initial(name,id,slot,tick)!;return{...c,clock:{...c.clock,
        simulationTime:new Date(Date.UTC(2001,0,1)+tick*600+offset).toISOString(),
        wallTime:new Date(Date.UTC(2026,9,25)+tick*600+wallOffset).toISOString()}};};
    const p:NativeMiningIntentPorts={...f.p,identity:f.p.identity,clock:()=>f.p.identity(f.miner.username,'clock',0,World.currentTick)!.clock,
        authorizeStart:()=>({authorityDigest:'a'.repeat(64)})};
    let tracker=new NativeMiningIntentTracker(p);
    const command=()=>({demandId:randomUUID(),username:f.miner.username,outputItemId:436 as const,contextDigest:'c'.repeat(64),maximumWallMilliseconds:300000});
    const step=(delta=600000,player:typeof f.miner|null=f.miner,wallMs=600,jump=1)=>{
        World.currentTick+=jump;offset+=delta-jump*600;wallOffset+=wallMs-jump*600;
        return tracker.observe(tracker.store.pending()[0]!.intent.demandId,player);
    };
    const read=()=>readNativeMiningIntentIntervals(f.market.db,{clockId:'si-c02-clock',clockProfileDigest:'b'.repeat(64),
        actorAgentIds:[`actor-${f.miner.username}`],fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:p.clock().simulationTime},
        'si-c02-fixture',[{agentId:`actor-${f.miner.username}`,username:f.miner.username,lifecycleId:`life-${f.miner.username}`}],policy);
    const breakTool=()=>{const item=f.store.lifecycle.get(`tool-${f.miner.username}`)!;
        f.store.lifecycle.use(randomUUID(),item.itemInstanceId,item.revision,item.durability,'e'.repeat(64),p.clock().simulationTime);};
    return{...f,p,command,step,read,breakTool,tracker:()=>tracker,restart(){tracker=new NativeMiningIntentTracker(p,randomUUID());}};
}

test('SI-C07 standing request survives rejected packed Mining and proves over-one-hour unusable lower bound',()=>{
    const f=harness();f.breakTool();expect(f.mine().execution).toBe(ScriptState.ABORTED);
    const command=f.command(),opened=f.tracker().start(command,f.miner);
    expect(f.tracker().start(command,f.miner)).toEqual(opened);
    expect(()=>f.tracker().start({...command,outputItemId:438},f.miner)).toThrow('conflict');
    for(let i=0;i<7;i++)f.step();
    const report=f.read();expect(report.longestConfirmedUnusableSimulationMs).toBe(4200000);expect(report.verdict).toBe('fail');
    expect(f.tracker().store.get(command.demandId)!.phase).toBe('pending');
    f.tracker().cancel(command.demandId,f.miner);expect(f.read().verdict).toBe('fail');
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(0);
});

test('SI-C07 native repair and subsequent packed Mining fulfill the same standing request using a real output receipt',()=>{
    const f=harness();f.mine();f.breakTool();f.miner.setLevel(PlayerStat.SMITHING,99);f.miner.invAdd(InvType.INV,2349,1);
    const source=nativeToolWorkPolicy.repair.source;
    const loc=new Loc(source.level,source.x,source.z,1,1,EntityLifeCycle.FOREVER,LocType.getId(source.debugName),10,0);
    f.miner.x=loc.x-1;f.miner.z=loc.z;f.miner.level=loc.level;
    const command=f.command();f.tracker().start(command,f.miner);
    const repair=new NativeToolWorkExecutor({...f.p,source:()=>loc,authorize:()=>({digest:'a'.repeat(64),
        skill:{...TOOL_WORK_SKILLS.repair,checksum:'b'.repeat(64)},facility:{providerId:nativeToolWorkPolicy.repair.facilityId,
            grantId:'fixture-grant',sourceEvidenceDigest:'d'.repeat(64)}})});
    const id=randomUUID();repair.start({operationId:id,kind:'repair',username:f.miner.username,businessId:'fixture-workshop',contextDigest:'d'.repeat(64)},f.miner);
    for(let i=0;i<3;i++){f.step(200000);repair.advance(id,f.miner);}
    expect(repair.work.get(id)!.phase).toBe('completed');expect(f.miner.getInventory(InvType.INV)!.getItemCount(2349)).toBe(0);
    const mining=f.mine();expect(mining.execution).not.toBe(ScriptState.ABORTED);
    const row=f.tracker().store.get(command.demandId)!;
    expect(row.phase).toBe('fulfilled');expect(row.completionEventId).toBe(mining.nativeMiningActionId);
    expect(f.read().longestConfirmedUnusableSimulationMs).toBe(600000);expect(f.read().verdict).toBe('inconclusive');
    const before=NativeMiningIntentStore.read(f.market.db);f.mine(4096,f.miner,mining.nativeMiningActionId!);
    expect(NativeMiningIntentStore.read(f.market.db)).toEqual(before);
});

test('SI-C07 offline, restart, skipped tick and long observer wall gap never become measured zero or joined demand time',()=>{
    const f=harness();f.breakTool();f.tracker().start(f.command(),f.miner);f.step();
    f.step(600000,null);f.step();f.restart();f.step();f.step();
    f.step(600000,f.miner,600,2);f.step(600000,f.miner,6000);f.step();
    const report=f.read();expect(report.longestConfirmedUnusableSimulationMs).toBe(600000);expect(report.verdict).toBe('inconclusive');
    expect(report.requests[0]!.intervals.filter(i=>i.status==='other-or-unobserved').length).toBeGreaterThanOrEqual(5);
    expect(report.completeDemandCoverage).toBeFalse();
});

test('SI-C07 standing request and interval audit reopen from a separate archive without borrowing later observations',()=>{
    const f=harness(),a=expandedFixture();f.breakTool();const command=f.command();f.tracker().start(command,f.miner);f.step();
    const before=NativeMiningIntentStore.read(f.market.db);put(a.root,a.checkpoint,f.market.db.serialize());
    captureSocietyArchive({root:a.root,output:a.bundle,kind:'baseline',plan:a.plan,assertOffline:()=>{}});f.step();
    restoreSocietyArchive(a.bundle,a.output);const db=new Database(join(a.output,'workspace',a.checkpoint),{readonly:true});
    try{expect(NativeMiningIntentStore.read(db)).toEqual(before);expect(new Set(before.entries.map(e=>e.record.intent.demandId))).toEqual(new Set([command.demandId]));}
    finally{db.close(true);}
});

test('SI-C07 failed output observation rolls back standing-request fulfillment as well as native ore and wear',()=>{
    const f=harness(),command=f.command();f.tracker().start(command,f.miner);
    f.market.db.exec(`CREATE TRIGGER reject_intent_fulfillment BEFORE INSERT ON native_mining_intent_audit
        WHEN json_extract(NEW.payload,'$.phase')='fulfilled' BEGIN SELECT RAISE(ABORT,'injected intent failure'); END;`);
    const mining=f.mine();expect(mining.execution).toBe(ScriptState.ABORTED);
    expect(f.tracker().store.get(command.demandId)!.phase).toBe('pending');expect(f.store.event(mining.nativeMiningActionId!)).toBeNull();
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
});

test('SI-C07 source admission is mandatory and a lost client cannot retain demand beyond its native expiry',()=>{
    const f=harness(),command=f.command(),authorize=f.p.authorizeStart;
    f.p.authorizeStart=()=>{throw Error('No admitted invocation');};
    expect(()=>f.tracker().start(command,f.miner)).toThrow('No admitted invocation');expect(f.tracker().store.pending()).toHaveLength(0);
    f.p.authorizeStart=authorize;f.breakTool();f.tracker().start({...command,maximumWallMilliseconds:1000},f.miner);
    f.step(600000,f.miner,600);const expired=f.step(600000,f.miner,600);
    expect(expired.phase).toBe('expired');expect(f.read().longestConfirmedUnusableSimulationMs).toBe(600000);
    expect(f.tracker().store.pending()).toHaveLength(0);
});
