import { afterEach,beforeAll,expect,test } from 'bun:test';
import InvType from '../cache/config/InvType.js';
import ScriptState from '../engine/script/ScriptState.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { fixture,closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
import { NativeMiningDemandStore } from '../../../../item-lifecycle/native-mining-demand.js';
import { readNativeToolDemandObservations } from '../../../../society-metrics/tool-demand.js';

beforeAll(loadPackedContent);afterEach(closeNativeMiningFixtures);

test('SI-C07 actual packed Mining records admission/output and replay creates no new request or wear',()=>{
    const f=fixture();expect(NativeMiningDemandStore.read(f.market.db)).toEqual({entries:[],head:{sequence:0,digest:null}});
    const schema=f.market.db.query("SELECT name,sql FROM sqlite_master WHERE name LIKE 'native_mining_demand_%' ORDER BY name").all();
    const s=f.mine(),before=NativeMiningDemandStore.read(f.market.db);
    expect(f.market.db.query("SELECT name,sql FROM sqlite_master WHERE name LIKE 'native_mining_demand_%' ORDER BY name").all()).toEqual(schema);
    expect(s.execution).not.toBe(ScriptState.ABORTED);
    const rows=before.entries.filter(e=>e.observation.requestId===s.nativeMiningActionId);
    expect(rows.map(e=>e.observation.phase)).toEqual(['admitted','admitted','committed']);
    expect(rows[0]!.observation.item!.durability).toBe(100);expect(rows[2]!.observation.item!.durability).toBe(99);
    expect(rows[0]!.observation.owner).toEqual(f.store.binding(f.miner.username)!.owner);
    f.mine(4096,f.miner,s.nativeMiningActionId!);
    expect(NativeMiningDemandStore.read(f.market.db)).toEqual(before);
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(99);
    const report=readNativeToolDemandObservations(f.market.db,{clockId:'si-c02-clock',clockProfileDigest:'b'.repeat(64),
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2002-01-01T00:00:00.000Z',actorAgentIds:[`actor-${f.miner.username}`]},
        'si-c02-fixture',[{agentId:`actor-${f.miner.username}`,username:f.miner.username,lifecycleId:`life-${f.miner.username}`}]);
    expect(report.actors[0]).toMatchObject({attemptedRequests:1,admittedRequests:1,committedRequests:1});
    expect(report.unusableDemandSimulationMilliseconds).toBeNull();expect(report.minimumVerdict).toBe('inconclusive');
});

test('SI-C07 actual broken and banked tool rejections survive native Player reopen with precise reasons',()=>{
    const f=fixture(),id=`tool-${f.miner.username}`;
    f.store.lifecycle.use('controlled-breakage',id,1,100,'a'.repeat(64),'2001-01-01T00:00:00.000Z');
    const broken=f.mine();expect(broken.execution).toBe(ScriptState.ABORTED);
    const event=NativeMiningDemandStore.read(f.market.db).entries[0]!.observation;
    expect(event).toMatchObject({requestId:broken.nativeMiningActionId,phase:'blocked',reason:'unusable-tool',item:{durability:0,status:'broken'}});
    f.move(f.miner,InvType.INV,InvType.getId('bank'),f.miner.getInventory(InvType.INV)!.getItemIndex(1265));f.p.checkpoint([f.miner]);
    const unavailable=f.mine(4096,f.reload());expect(unavailable.execution).toBe(ScriptState.ABORTED);
    expect(NativeMiningDemandStore.read(f.market.db).entries.at(-1)!.observation).toMatchObject({phase:'blocked',reason:'unavailable-position'});
    expect(f.store.event(broken.nativeMiningActionId!)).toBeNull();expect(f.store.lifecycle.get(id)!.durability).toBe(0);
});

test('SI-C07 actual full inventory records admission without inventing a successful use or persistent waiting',()=>{
    const f=fixture(),inv=f.miner.getInventory(InvType.INV)!;while(inv.freeSlotCount)inv.add(436,1);
    const s=f.mine();expect(s.execution).not.toBe(ScriptState.ABORTED);
    const rows=NativeMiningDemandStore.read(f.market.db).entries;
    expect(rows.length).toBeGreaterThan(0);expect(rows.every(e=>e.observation.phase==='admitted')).toBeTrue();
    expect(f.store.event(s.nativeMiningActionId!)).toBeNull();expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
});

test('SI-C07 output transaction failure retains request evidence and rolls back completion, ore and wear',()=>{
    const f=fixture(),save=f.market.saved(f.miner.username)!;f.fail(true);const s=f.mine();
    expect(s.execution).toBe(ScriptState.ABORTED);
    expect(NativeMiningDemandStore.read(f.market.db).entries.every(e=>e.observation.phase==='admitted')).toBeTrue();
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);expect(f.store.event(s.nativeMiningActionId!)).toBeNull();
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);expect(f.market.saved(f.miner.username)).toEqual(save);
    f.fail(false);expect(f.mine().execution).not.toBe(ScriptState.ABORTED);
    expect(NativeMiningDemandStore.read(f.market.db).entries.filter(e=>e.observation.phase==='committed')).toHaveLength(1);
});

test('SI-C07 demand-write failure cannot commit a native output without its observation',()=>{
    const f=fixture();new NativeMiningDemandStore(f.market.db);
    f.market.db.exec(`CREATE TRIGGER fail_demand_completion BEFORE INSERT ON native_mining_demand_event
        WHEN json_extract(NEW.payload,'$.phase')='committed' BEGIN SELECT RAISE(ABORT,'injected demand write failure'); END;`);
    const s=f.mine();expect(s.execution).toBe(ScriptState.ABORTED);
    expect(f.store.event(s.nativeMiningActionId!)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
    expect(NativeMiningDemandStore.read(f.market.db).entries.filter(e=>e.observation.phase==='committed')).toHaveLength(0);
});
