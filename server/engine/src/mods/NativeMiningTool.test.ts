import World from '../engine/World.js';
import { beforeAll, afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Player from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import JavaRandom from '../util/JavaRandom.js';
import Packet from '../io/Packet.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { NativeToolStore, nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import { readNativeToolContext } from '../../../../item-lifecycle/native-tool.js';
import { bindNativeMiningTool, checkpointNativeMiningTool, hydrateNativeMiningTool, captureNativeToolTrade, commitNativeToolTrade, type NativeMiningPorts } from './NativeMiningTool.js';
import { checkpointNativeAttributeXp } from './NativeAttributeXp.js';
import InvOps from '../engine/script/handlers/InvOps.js';
import { ScriptOpcode } from '../engine/script/ScriptOpcode.js';
import ScriptPointer from '../engine/script/ScriptPointer.js';
import { TradeEvidenceStore, type EngineTradeEvidence } from './TradeEvidenceStore.js';
import { fixture, closeNativeMiningFixtures } from './native-mining-tool-fixture.js';
beforeAll(loadPackedContent);
afterEach(closeNativeMiningFixtures);

test('SI-C02 packed Mining output commits one actual ore, wear and native Player checkpoint',()=>{
    const f=fixture(),s=f.mine();
    expect(s.execution).not.toBe(ScriptState.ABORTED);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(99);
    expect(f.store.event(s.nativeMiningActionId!)!.kind).toBe('mined');
    expect(f.reload().getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
    expect(f.store.lifecycle.verifyAuditChain()).toBeTrue();
    console.info('[SI-C02 native]',JSON.stringify({script:s.script.name,actionId:s.nativeMiningActionId,
        eventDigest:nativeToolDigest(f.store.event(s.nativeMiningActionId!)),durability:99}));
});

test('SI-C02 unchanged 100-use native tool wears to broken and the next packed workload is blocked',()=>{
    const f=fixture(),ids:string[]=[];
    for(let i=0;i<100;i++){
        const s=f.mine();expect(s.execution).not.toBe(ScriptState.ABORTED);
        expect(f.store.event(s.nativeMiningActionId!)!.kind).toBe('mined');ids.push(s.nativeMiningActionId!);
        const slot=f.miner.getInventory(InvType.INV)!.getItemIndex(436);
        f.move(f.miner,InvType.INV,InvType.getId('bank'),slot);
    }
    f.p.checkpoint([f.miner]);
    const after=f.store.lifecycle.get(`tool-${f.miner.username}`)!;
    expect(after).toMatchObject({durability:0,status:'broken',revision:101});
    expect(new Set(ids).size).toBe(100);
    expect(f.miner.getInventory(InvType.getId('bank'))!.getItemCount(436)).toBe(100);
    expect(f.mine().execution).toBe(ScriptState.ABORTED);
    expect(f.mine(4096,f.miner,undefined,undefined,'ironrock1').execution).toBe(ScriptState.ABORTED);
    expect(f.store.lifecycle.get(after.itemInstanceId)).toEqual(after);
    expect(f.mine(4096,f.miner,ids[99]!).execution).not.toBe(ScriptState.ABORTED);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.reload().getInventory(InvType.getId('bank'))!.getItemCount(436)).toBe(100);
    console.info('[SI-C02 acceptance]',JSON.stringify({source:'packed Mining/INV_ADD + native bank moves + Player checkpoint',
        itemInstanceId:after.itemInstanceId,owner:f.store.binding(f.miner.username)!.owner,
        catalogDigest:f.store.binding(f.miner.username)!.catalogDigest,cycleDigest:f.store.binding(f.miner.username)!.cycleDigest,
        successfulNativeActions:ids.length,actionIds:ids,actualBankOre:100,after,
        checkpointDigest:nativeToolDigest([...f.market.saved(f.miner.username)!]),auditValid:f.store.lifecycle.verifyAuditChain(),nextAttempt:'blocked'}));
});

test('SI-C02 animation/failed roll and full inventory do not manufacture wear',()=>{
    const f=fixture();f.miner.setLevel(PlayerStat.MINING,1);let failed=false;
    for(let seed=1;seed<=32&&!failed;seed++){
        const before=f.store.lifecycle.get(`tool-${f.miner.username}`)!;
        const s=f.mine(seed);expect(s.execution).not.toBe(ScriptState.ABORTED);
        if(!f.store.event(s.nativeMiningActionId!)){failed=true;expect(f.store.lifecycle.get(before.itemInstanceId)).toEqual(before);}
    }
    expect(failed).toBeTrue();
    const inv=f.miner.getInventory(InvType.INV)!;while(inv.freeSlotCount)inv.add(436,1);
    const before=f.store.lifecycle.get(`tool-${f.miner.username}`)!;f.mine();
    expect(f.store.lifecycle.get(before.itemInstanceId)).toEqual(before);
});

test('SI-C02 native receipt replay, including after breakage, never grants ore or wear twice',()=>{
    const f=fixture(),s=f.mine(),before=f.store.lifecycle.get(`tool-${f.miner.username}`)!;
    const count=f.miner.getInventory(InvType.INV)!.getItemCount(436);
    f.mine(4096,f.miner,s.nativeMiningActionId!);
    expect(f.store.lifecycle.get(before.itemInstanceId)).toEqual(before);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(count);
});

test('SI-C02 native output/checkpoint failure rolls back ore, wear, receipt and actual save',()=>{
    const f=fixture(),save=f.market.saved(f.miner.username)!;f.fail(true);
    const s=f.mine();expect(s.execution).toBe(ScriptState.ABORTED);
    expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
    expect(f.store.event(s.nativeMiningActionId!)).toBeNull();expect(f.market.saved(f.miner.username)).toEqual(save);
    f.fail(false);expect(f.mine().execution).not.toBe(ScriptState.ABORTED);
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(99);
});

test('SI-C02 real native inventory moves preserve instance identity across bank/reopen',()=>{
    const f=fixture();f.mine();const binding=f.store.binding(f.miner.username)!;
    f.move(f.miner,InvType.INV,InvType.getId('bank'),f.miner.getInventory(InvType.INV)!.getItemIndex(1265));f.p.checkpoint([f.miner]);
    expect(f.store.binding(f.miner.username)!.position.inventory).toBe(InvType.getId('bank'));
    const reloaded=f.reload();expect(f.mine(4096,reloaded).execution).toBe(ScriptState.ABORTED);
    f.move(reloaded,InvType.getId('bank'),InvType.INV,reloaded.getInventory(InvType.getId('bank'))!.getItemIndex(1265));
    expect(f.mine(4096,reloaded).execution).not.toBe(ScriptState.ABORTED);
    expect(f.store.binding(reloaded.username)!.itemInstanceId).toBe(binding.itemInstanceId);
    expect(f.store.lifecycle.get(binding.itemInstanceId)!.durability).toBe(98);
});

test('SI-C02 actual BOTH_MOVEINV transfers the same worn instance and native source, replay stays idempotent',()=>{
    const f=fixture();f.mine();const item=f.store.lifecycle.get(`tool-${f.miner.username}`)!,to=f.player(undefined,false);
    const {witness,receipt}=f.trade(to);
    expect(f.store.binding(f.miner.username)).toBeNull();expect(f.store.binding(to.username)!.itemInstanceId).toBe(item.itemInstanceId);
    expect(f.store.lifecycle.get(item.itemInstanceId)).toMatchObject({ownerActorId:`actor-${to.username}`,durability:99,provenanceDigest:item.provenanceDigest});
    commitNativeToolTrade(witness,receipt);expect(()=>commitNativeToolTrade(witness,{...receipt,fromValue:999})).toThrow('conflict');
    const loaded=f.reload(to);expect(f.mine(4096,loaded).execution).not.toBe(ScriptState.ABORTED);
    expect(f.store.lifecycle.get(item.itemInstanceId)!.durability).toBe(98);
    expect(readNativeToolContext(f.market.db.filename!,`actor-${to.username}`,to.username)).toContain('durability 98/100');
    const longId='tool-'+ 'a'.repeat(123),long=fixture(longId),recipient=long.player(undefined,false);
    long.mine();long.trade(recipient);
    expect(long.store.lifecycle.get(longId)).toMatchObject({ownerActorId:`actor-${recipient.username}`,durability:99});
});

test('SI-C02 unknown replacement/duplicate native item is quarantined, never a fresh instance',()=>{
    const f=fixture(),inv=f.miner.getInventory(InvType.INV)!,slot=inv.getItemIndex(1265);
    inv.set(slot,{id:1265,count:1});f.p.checkpoint([f.miner]);
    expect(f.store.binding(f.miner.username)!.status).toBe('quarantined');
    expect(f.mine().execution).toBe(ScriptState.ABORTED);
    expect(()=>bindNativeMiningTool(f.miner,`tool-${f.miner.username}`,'d'.repeat(64),f.p)).toThrow('already bound');
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
    expect(f.mine(4096,f.reload()).execution).toBe(ScriptState.ABORTED);
    const duplicate=fixture();duplicate.miner.getInventory(InvType.INV)!.add(1265,1);
    expect(duplicate.mine().execution).toBe(ScriptState.ABORTED);duplicate.p.checkpoint([duplicate.miner]);
    expect(duplicate.store.binding(duplicate.miner.username)!.status).toBe('quarantined');
});

test('SI-C02 managed unbound bronze requires migration; an unmanaged legacy avatar remains vanilla',()=>{
    const f=fixture(),who=f.player(undefined,false);who.getInventory(InvType.INV)!.add(1265,1);
    expect(f.mine(4096,who).execution).toBe(ScriptState.ABORTED);
    expect(f.store.lifecycle.get(`tool-${who.username}`)).toBeNull();
    who.nativeMiningPorts={...f.p,identity:()=>null};
    expect(f.mine(4096,who).execution).not.toBe(ScriptState.ABORTED);
    expect(who.getInventory(InvType.INV)!.getItemCount(436)).toBe(1);
});

test('SI-C02 terminal owner cannot work or transfer and missing tool retains lifecycle custody',()=>{
    const f=fixture(),item=f.store.lifecycle.get(`tool-${f.miner.username}`)!;f.dead();
    expect(f.mine().execution).toBe(ScriptState.ABORTED);
    const to=f.player(undefined,false);expect(()=>f.trade(to)).toThrow('Terminal');
    f.miner.getInventory(InvType.getId('tradeoffer'))!.removeAll();f.p.checkpoint([f.miner]);
    expect(f.store.binding(f.miner.username)!.status).toBe('quarantined');
    expect(f.store.lifecycle.get(item.itemInstanceId)).toEqual(item);
});

test('SI-C02 suspended Mining binds the exact tool revision rather than charging a later replacement',()=>{
    const f=fixture(),id=`tool-${f.miner.username}`;let intervened=false;
    const s=f.mine(4096,f.miner,undefined,()=>{intervened=true;
        f.store.lifecycle.use('intervening-use',id,1,1,'e'.repeat(64),'2001-01-01T00:00:00.000Z');});
    expect(intervened).toBeTrue();expect(s.execution).toBe(ScriptState.ABORTED);
    expect(f.store.event(s.nativeMiningActionId!)).toBeNull();expect(f.miner.getInventory(InvType.INV)!.getItemCount(436)).toBe(0);
    expect(f.store.lifecycle.get(id)!.durability).toBe(99);
});

test('SI-C02 foreign clock/lifecycle and checkpoint authorities cannot attest native tool work',()=>{
    const f=fixture(),identity=f.p.identity;
    f.p.identity=(name,id,slot,tick)=>{const context=identity(name,id,slot,tick)!;
        return{...context,action:{...context.action,clockId:'foreign-clock'}};};
    expect(f.mine().execution).toBe(ScriptState.ABORTED);f.p.identity=identity;
    expect(()=>readNativeToolContext(f.market.db.filename!,`actor-${f.miner.username}`,f.miner.username,
        {...f.store.binding(f.miner.username)!.owner,lifecycleId:'foreign-life'})).toThrow('identity mismatch');
    const dir=mkdtempSync(join(tmpdir(),'mining-foreign-')),foreign=new MarketStore(join(dir,'foreign.sqlite'));
    try{expect(()=>checkpointNativeMiningTool(f.miner,f.miner.save(false),foreign.db)).toThrow('authority mismatch');}
    finally{foreign.db.close(true);rmSync(dir,{recursive:true,force:true});}
    expect(f.store.lifecycle.get(`tool-${f.miner.username}`)!.durability).toBe(100);
});

test('SI-C02 failed native trade checkpoint leaves no transfer receipt or reset and requires custody reconciliation',()=>{
    const f=fixture(),to=f.player(undefined,false),item=f.store.lifecycle.get(`tool-${f.miner.username}`)!;
    f.fail(true);expect(()=>f.trade(to)).toThrow('injected native checkpoint failure');f.fail(false);
    expect(f.store.lifecycle.get(item.itemInstanceId)).toEqual(item);
    expect(f.store.binding(to.username)).toBeNull();
    f.p.checkpoint([f.miner,to]);expect(f.store.binding(f.miner.username)!.status).toBe('quarantined');
    expect(f.market.db.query("SELECT count(*) n FROM native_tool_event WHERE json_extract(payload,'$.kind')='transfer'").get()).toEqual({n:0});
    expect(f.mine(4096,to).execution).toBe(ScriptState.ABORTED);
});
