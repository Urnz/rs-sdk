import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import NpcType from '../cache/config/NpcType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import VarNpcType from '../cache/config/VarNpcType.js';
import VarBitType from '../cache/config/VarBitType.js';
import ParamType from '../cache/config/ParamType.js';
import EnumType from '../cache/config/EnumType.js';
import StructType from '../cache/config/StructType.js';
import SeqType from '../cache/config/SeqType.js';
import Player from '../engine/entity/Player.js';
import Npc from '../engine/entity/Npc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import { BlockWalk } from '../engine/entity/BlockWalk.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptPointer from '../engine/script/ScriptPointer.js';
import { ScriptOpcode } from '../engine/script/ScriptOpcode.js';
import InvOps from '../engine/script/handlers/InvOps.js';
import { foodDigest, FOOD_POLICY } from './NativeFoodConsumptionStore.js';
import { readNativeTravelFares, NativeTravelFareStore } from './NativeTravelFareStore.js';
import type { NativeTravelFarePorts } from './NativeTravelFare.js';

const pack = resolve(import.meta.dir, '../../data/pack'), roots: string[] = [], stores: MarketStore[] = [];
beforeAll(() => {
    for (const type of [InvType, ObjType, NpcType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType]) type.load(pack);
    ScriptProvider.load(pack);
});
afterEach(() => { for (const s of stores.splice(0)) s.db.close(true); for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture(returning = false) {
    const root = mkdtempSync(join(tmpdir(), 'native-fare-')); roots.push(root);
    const path = join(root, 'checkpoint.sqlite'), market = new MarketStore(path); stores.push(market);
    const player = new Player('faretest', 2n, 2n); player.levels.fill(1); player.baseLevels.fill(1); player.levels[PlayerStat.HITPOINTS] = 10;
    player.x = returning ? 2954 : 3027; player.z = returning ? 3147 : 3218;
    const npc = new Npc(0, player.x, player.z, 1, 1, EntityLifeCycle.FOREVER, 1,
        NpcType.getId(returning ? 'customs_officer' : 'captain_tobias'), BlockWalk.NONE);
    player.invAdd(InvType.INV, 995, 100); market.checkpoint(player.username, player.save(false), true);
    World.currentTick = 100;
    const ports: NativeTravelFarePorts = { market, identity: (username, actionId, slot, tick) => ({
        action: { actionId, username, actorId: 'actor-faretest', worldId: 'fare-world', lifecycleId: 'fare-life',
            itemId: 379, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY), clockId: 'world', clockProfileDigest: 'a'.repeat(64) },
        clock: { clockId: 'world', profileDigest: 'a'.repeat(64), wallTime: '2026-10-22T09:00:00.000Z',
            simulationTime: '2001-01-01T01:00:00.000Z', status: 'running', revision: 1, engineTick: tick }
    }), checkpoint: () => {} };
    const script = ScriptProvider.getByName(returning ? '[label,customs_pay]' : '[label,karamja_sailor_dialogue]');
    if (!script) throw new Error('Actual packed fare label missing');
    const state = ScriptRunner.init(script, player, npc); state.nativeTravelFarePorts = ports;
    Object.defineProperty(state, 'intOperand', { get: () => 0 });
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    const charge = (amount = 30) => { state.pushInt(InvType.INV); state.pushInt(995); state.pushInt(amount); InvOps[ScriptOpcode.INV_DEL]!(state); };
    return { root, path, market, player, npc, state, ports, charge, gp: () => player.getInventory(InvType.INV)!.getItemCount(995) };
}
test('real protected fare opcode checkpoints a 30 GP sink and survives reopen without charging again', () => {
    const f = fixture(); f.charge();
    const receipt = readNativeTravelFares(f.market.db)[0]!;
    expect(f.gp()).toBe(70); expect(receipt.route).toBe('port-sarim-to-karamja');
    expect(receipt.checkpointDigest).toBe(foodDigest([...f.market.saved('faretest')!]));
    f.market.db.close(true); stores.splice(stores.indexOf(f.market), 1);
    const reopened = new MarketStore(f.path); stores.push(reopened); f.ports.market = reopened;
    expect(readNativeTravelFares(reopened.db)).toEqual([receipt]); f.charge();
    expect(f.gp()).toBe(70); expect(readNativeTravelFares(reopened.db)).toHaveLength(1); expect(f.state.execution).toBe(1);
});
test('the actual return customs label records its distinct route', () => {
    const f = fixture(true); f.charge(); expect(readNativeTravelFares(f.market.db)[0]!.route).toBe('karamja-to-port-sarim');
});
test('checkpoint failure rolls back inventory, persisted save and fare journal together', () => {
    const f = fixture(), before = [...f.market.saved('faretest')!];
    f.ports.checkpoint = save => { f.market.checkpoint('faretest', save, true); throw new Error('checkpoint crash'); };
    expect(() => f.charge()).toThrow('checkpoint crash'); expect(f.gp()).toBe(100);
    expect([...f.market.saved('faretest')!]).toEqual(before); expect(readNativeTravelFares(f.market.db)).toEqual([]);
    f.ports.checkpoint = () => {}; f.charge(); expect(f.gp()).toBe(70); expect(readNativeTravelFares(f.market.db)).toHaveLength(1);
});
test('wrong amount, missing funds and out-of-range native source cannot create a fare', () => {
    const f = fixture(); expect(() => f.charge(31)).toThrow('authority'); expect(f.gp()).toBe(100);
    f.npc.x += 10; expect(() => f.charge()).toThrow('authority'); f.npc.x -= 10;
    f.player.invDel(InvType.INV, 995, 80); expect(() => f.charge()).toThrow('receipt'); expect(f.gp()).toBe(20);
    expect(readNativeTravelFares(f.market.db)).toEqual([]);
});
test('the protected opcode gate still precedes the fare hook', () => {
    const f = fixture(); f.state.pointerRemove(ScriptPointer.ProtectedActivePlayer);
    const type = InvType.get(InvType.INV), previous = type.protect;
    try { type.protect = true; expect(() => f.charge()).toThrow('protected'); expect(f.gp()).toBe(100); }
    finally { type.protect = previous; }
});
test('a changed lifecycle cannot replay or complete a charged native operation', () => {
    const f = fixture(); f.charge(); const identity = f.ports.identity;
    f.ports.identity = (...args) => { const value = identity(...args)!; value.action.lifecycleId = 'different-life'; return value; };
    expect(() => f.charge()).toThrow('binding'); expect(f.gp()).toBe(70);
});
test('modified or truncated fare history fails the readonly audit', () => {
    const f = fixture(); f.charge();
    f.market.db.run("UPDATE native_travel_fare SET json=json_set(json,'$.amountGp',29)");
    expect(() => readNativeTravelFares(f.market.db)).toThrow('receipt');
    f.market.db.run('DELETE FROM native_travel_fare'); expect(() => readNativeTravelFares(f.market.db)).toThrow('head');
});
test('partial schema fails closed; vanilla actors retain their existing charge without a society receipt', () => {
    const f = fixture(); f.ports.identity = () => null; f.charge(); expect(f.gp()).toBe(70);
    expect(f.market.db.query("SELECT 1 FROM sqlite_master WHERE name='native_travel_fare'").get()).toBeNull();
    f.market.db.run('CREATE TABLE native_travel_fare_schema(version INTEGER)');
    expect(() => new NativeTravelFareStore(f.market.db)).toThrow('Partial');
});
