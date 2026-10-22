import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import NpcType from '../cache/config/NpcType.js';
import LocType from '../cache/config/LocType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import VarNpcType from '../cache/config/VarNpcType.js';
import VarBitType from '../cache/config/VarBitType.js';
import ParamType from '../cache/config/ParamType.js';
import EnumType from '../cache/config/EnumType.js';
import StructType from '../cache/config/StructType.js';
import SeqType from '../cache/config/SeqType.js';
import DbRowType from '../cache/config/DbRowType.js';
import DbTableType from '../cache/config/DbTableType.js';
import DbTableIndex from '../cache/config/DbTableIndex.js';
import FontType from '../cache/config/FontType.js';
import Player from '../engine/entity/Player.js';
import Npc from '../engine/entity/Npc.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import { BlockWalk } from '../engine/entity/BlockWalk.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import Packet from '../io/Packet.js';
import JavaRandom from '../util/JavaRandom.js';
import { foodDigest, FOOD_POLICY, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore, LOBSTER, validateFoodProductionAction } from './NativeFoodProductionStore.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import type { NativeFoodProductionPorts } from './NativeFoodProduction.js';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { readNativeFoodProductionSource } from '../../../gateway/admin/native-food-production-source.js';
import { readNativeFoodTransformation } from '../../../../item-transformation/native-food.js';

const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], stores: MarketStore[] = [];
function loadPackedContent() {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
}
beforeAll(loadPackedContent);
afterEach(() => { for (const store of stores.splice(0)) store.db.close(true); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(quantity = 2, databasePath?: string) {
    const dir = databasePath ? dirname(databasePath) : mkdtempSync(join(tmpdir(), 'native-production-')); dirs.push(dir);
    const path = databasePath ?? join(dir, 'checkpoints.sqlite'), market = new MarketStore(path); stores.push(market);
    const player = new Player('prodtest', 2n, 2n); player.x = 2925; player.z = 3180;
    player.levels.fill(1); player.baseLevels.fill(1); player.levels[PlayerStat.HITPOINTS] = player.baseLevels[PlayerStat.HITPOINTS] = 20;
    player.setLevel(PlayerStat.FISHING, 99); player.setLevel(PlayerStat.COOKING, 40);
    // Use the real base XP method, isolated from the host world's optional XP-mod journal.
    const addXp = player.addXp.bind(player); player.addXp = (stat, xp) => addXp(stat, xp, false);
    const inv = player.getInventory(InvType.INV)!; inv.add(ObjType.getId('lobster_pot'), 1);
    const npc = new Npc(0, 2926, 3180, 1, 1, EntityLifeCycle.FOREVER, 1, NpcType.getId('0_45_49_rarefish'), BlockWalk.NONE);
    const heat = new Loc(0, 2926, 3180, 1, 1, EntityLifeCycle.FOREVER, LocType.getId('loc_2729'), 10, 0);
    const policy = loadNativeFoodProductionPolicy(root), { digest: _digest, catalogDigest, ...raw } = policy;
    const definition = { ...raw, runId: 'isolated-native-food-v1', sources: [{ ...raw.sources[0]!, quantity }] };
    World.currentTick = 100;
    const identity: NativeFoodProductionPorts['identity'] = (username, actionId, slot, tick) => ({
        action: { actionId, worldId: 'fixture-world', actorId: 'actor-prodtest', username, lifecycleId: 'fixture-lifecycle',
            itemId: 379, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY), clockId: 'fixture-clock', clockProfileDigest: 'a'.repeat(64) },
        clock: { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), wallTime: '2026-10-18T12:00:00.000Z',
            simulationTime: '2001-01-01T00:00:01.000Z', status: 'running', revision: 1, engineTick: tick }
    });
    const ports: NativeFoodProductionPorts = { market, policy: { ...definition, digest: foodDigest(definition), catalogDigest }, identity,
        checkpoint: save => market.checkpoint(player.username, save, true) };
    market.checkpoint(player.username, player.save(false), true);
    const receipt = (state: ScriptState) => new NativeFoodProductionStore(market.db).get(state.nativeFoodProductionActionId!);
    function gather(seed = 4096, actionId?: string) {
        player.setVar(VarPlayerType.getId('action_delay'), World.currentTick); player.delayed = false;
        JavaRandom.setSeed(seed);
        const script = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC4, npc.type, NpcType.get(npc.type).category)!;
        const state = ScriptRunner.init(script, player, npc); state.nativeFoodProductionPorts = ports;
        if (actionId) state.nativeFoodProductionActionId = actionId;
        state.execution = player.runScript(state, true); return state;
    }
    function cook(seed = 4096, actionId?: string, resume = true) {
        player.lastUseItem = LOBSTER.raw; player.delayed = false; JavaRandom.setSeed(seed);
        const script = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, heat.type, LocType.get(heat.type).category)!;
        const state = ScriptRunner.init(script, player, heat); state.nativeFoodProductionPorts = ports;
        if (actionId) state.nativeFoodProductionActionId = actionId;
        state.execution = player.runScript(state, true);
        if (resume && state.execution === ScriptState.SUSPENDED) { World.currentTick += 2; player.delayed = false; state.execution = player.runScript(state, true); }
        return state;
    }
    return { dir, path, market, player, inv, npc, heat, ports, identity, receipt, gather, cook };
}

if (process.env.NATIVE_PRODUCTION_CRASH_PHASE) {
    loadPackedContent();
    const f = fixture(2, process.env.NATIVE_PRODUCTION_CRASH_DATABASE!);
    f.inv.add(LOBSTER.raw, 1); f.market.checkpoint('prodtest', f.player.save(false), true);
    const boundary = () => { process.stdout.write('NATIVE_PRODUCTION_CRASH_BOUNDARY\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    f.ports.checkpoint = save => {
        f.market.checkpoint('prodtest', save, true);
        if (process.env.NATIVE_PRODUCTION_CRASH_PHASE === 'before-commit') boundary();
    };
    f.cook(4096, process.env.NATIVE_PRODUCTION_CRASH_ACTION!); boundary();
}

test('native fishing gains raw lobster with durable source quota and exact retry', () => {
    const f = fixture(), state = f.gather(), receipt = f.receipt(state)!;
    expect(state.execution).toBe(ScriptState.FINISHED);
    expect(receipt).toMatchObject({ outcome: 'raw-gained', before: { raw: 0 }, after: { raw: 1 }, quota: { before: 2, after: 1 } });
    expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
    expect(f.receipt(f.gather(4096, state.nativeFoodProductionActionId!))).toEqual(receipt);
    expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
    expect(readNativeFoodProductionSource(f.path, receipt.action)).toEqual({ status: 'completed', receipt });
});
test('finite harvest quota stays exhausted after reopen; a new source policy cannot silently reset it', () => {
    const f = fixture(1), first = f.gather(); expect(f.receipt(first)!.quota!.after).toBe(0);
    expect(f.gather().execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
    const reopened = new MarketStore(f.path); stores.push(reopened); f.ports.market = reopened;
    f.ports.checkpoint = save => reopened.checkpoint('prodtest', save, true);
    expect(f.gather().execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
    f.ports.policy = { ...f.ports.policy, digest: 'b'.repeat(64), sources: [{ ...f.ports.policy.sources[0]!, quantity: 99 }] };
    expect(f.gather().execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
});
test('native cooking follows its delay and records successful and burnt outcomes separately', () => {
    const f = fixture(); f.inv.add(LOBSTER.raw, 2);
    const cooked = f.receipt(f.cook(4096))!, burnt = f.receipt(f.cook(0))!;
    expect(cooked.outcome).toBe('cooked'); expect(burnt.outcome).toBe('burnt');
    expect(f.inv.getItemCount(LOBSTER.raw)).toBe(0); expect(f.inv.getItemCount(LOBSTER.cooked)).toBe(1); expect(f.inv.getItemCount(LOBSTER.burnt)).toBe(1);
    const projection = readNativeFoodTransformation(f.path, burnt.action, join(root, 'config/production-workflows.json'));
    expect(projection).toMatchObject({ status: 'completed', successfulRecipeOutput: false, exactAssetLineage: 'unavailable' });
});
test('interrupted delayed cooking spends no raw input and creates no receipt', () => {
    const f = fixture(); f.inv.add(LOBSTER.raw, 1);
    const state = f.cook(4096, undefined, false);
    expect(state.execution).toBe(ScriptState.SUSPENDED); expect(state.nativeFoodProductionActionId).toBeNull();
    expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1); expect(f.inv.getItemCount(LOBSTER.cooked)).toBe(0);
});
test('receipt/checkpoint failure rolls back actual items and harvest quota, leaving the same intent retryable', () => {
    const f = fixture(), before = f.market.saved('prodtest')!;
    f.ports.checkpoint = save => { f.market.checkpoint('prodtest', save, true); throw new Error('injected checkpoint failure'); };
    const state = f.gather(); expect(state.execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(0);
    expect(f.market.saved('prodtest')).toEqual(before); expect(f.receipt(state)).toBeNull();
    f.ports.checkpoint = save => f.market.checkpoint('prodtest', save, true);
    expect(f.receipt(f.gather(4096, state.nativeFoodProductionActionId!))!.quota).toEqual({ before: 2, after: 1 });
});
test('gather to cook to eat uses actual content and reopens the canonical inventory', () => {
    const f = fixture(), raw = f.receipt(f.gather())!, cooked = f.receipt(f.cook())!;
    expect(raw.outputs).toEqual(cooked.inputs);
    const slot = f.inv.getItemIndex(LOBSTER.cooked), context = f.identity('prodtest', randomUUID(), slot, World.currentTick)!;
    const conflicting = f.identity('prodtest', raw.action.actionId, slot, World.currentTick)!;
    expect(() => executeNativeFoodAction(f.market, f.player, conflicting, f.ports.checkpoint, f.identity)).toThrow('conflicts with production');
    expect(executeNativeFoodAction(f.market, f.player, context, f.ports.checkpoint, f.identity).outcome).toBe('consumed');
    expect(f.gather(4096, context.action.actionId).execution).toBe(ScriptState.ABORTED);
    const restored = PlayerLoading.load('prodtest', new Packet(f.market.saved('prodtest')!), null);
    expect(restored.getInventory(InvType.INV)!.getItemCount(LOBSTER.raw)).toBe(0);
    expect(restored.getInventory(InvType.INV)!.getItemCount(LOBSTER.cooked)).toBe(0);
});
test('wrong worker/item/recipe/source and dead actor do not produce native evidence', () => {
    const f = fixture(); f.npc.x += 20;
    expect(f.gather().execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(0);
    f.npc.x -= 20; f.player.populationTerminal = true;
    expect(f.gather().execution).toBe(ScriptState.ABORTED);
    f.player.populationTerminal = false; const receipt = f.receipt(f.gather())!;
    expect(() => readNativeFoodProductionSource(f.path, { ...receipt.action, actorId: 'other' })).toThrow('identity mismatch');
    expect(() => validateFoodProductionAction({ ...receipt.action, recipeVersion: '2.0.0' })).toThrow('Invalid');
});
test('missing readonly source creates no database; quota tampering blocks further gains', () => {
    const f = fixture(), receipt = f.receipt(f.gather())!, missing = join(f.dir, 'missing.sqlite');
    expect(readNativeFoodProductionSource(missing, receipt.action).status).toBe('unavailable'); expect(existsSync(missing)).toBeFalse();
    f.market.db.run('UPDATE native_food_source_quota SET remaining=2');
    expect(f.gather().execution).toBe(ScriptState.ABORTED); expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1);
});
test('cooking receipt insertion failure cannot spend raw food without its native outcome', () => {
    const f = fixture(); f.inv.add(LOBSTER.raw, 1); f.market.checkpoint('prodtest', f.player.save(false), true);
    new NativeFoodProductionStore(f.market.db);
    f.market.db.run(`CREATE TRIGGER fail_food_production BEFORE UPDATE OF receipt_json ON native_food_production_actions
        BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END`);
    const state = f.cook(); expect(state.execution).toBe(ScriptState.ABORTED);
    expect(f.inv.getItemCount(LOBSTER.raw)).toBe(1); expect(f.inv.getItemCount(LOBSTER.cooked)).toBe(0); expect(f.receipt(state)).toBeNull();
});
for (const phase of ['before-commit', 'after-commit']) test(`native cooking process kill ${phase} preserves exact input/output/receipt and replay`, async () => {
    const f = fixture(), actionId = randomUUID();
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
        env: { ...process.env, NATIVE_PRODUCTION_CRASH_PHASE: phase, NATIVE_PRODUCTION_CRASH_DATABASE: f.path,
            NATIVE_PRODUCTION_CRASH_ACTION: actionId }, stdout: 'pipe', stderr: 'pipe' });
    const errors = new Response(child.stderr).text();
    try {
        const reader = child.stdout.getReader(); let output = '';
        while (!output.includes('NATIVE_PRODUCTION_CRASH_BOUNDARY')) {
            const chunk = await reader.read(); if (chunk.done) throw new Error(`Crash worker missed boundary: ${await errors}`);
            output += new TextDecoder().decode(chunk.value);
        }
        child.kill(); await child.exited; await errors;
        const reopened = new MarketStore(f.path); stores.push(reopened);
        const receipt = new NativeFoodProductionStore(reopened.db).get(actionId);
        const restored = PlayerLoading.load('prodtest', new Packet(reopened.saved('prodtest')!), null);
        expect(restored.getInventory(InvType.INV)!.getItemCount(LOBSTER.raw)).toBe(phase === 'before-commit' ? 1 : 0);
        expect(restored.getInventory(InvType.INV)!.getItemCount(LOBSTER.cooked)).toBe(phase === 'before-commit' ? 0 : 1);
        expect(receipt?.outcome ?? null).toBe(phase === 'before-commit' ? null : 'cooked');
        f.player.invs = restored.invs; f.player.levels.set(restored.levels); f.player.vars.set(restored.vars);
        f.ports.market = reopened; f.ports.checkpoint = save => reopened.checkpoint('prodtest', save, true);
        expect(f.receipt(f.cook(4096, actionId))!.outcome).toBe('cooked');
        expect(f.player.getInventory(InvType.INV)!.getItemCount(LOBSTER.raw)).toBe(0);
        expect(f.player.getInventory(InvType.INV)!.getItemCount(LOBSTER.cooked)).toBe(1);
    } finally { if (child.exitCode === null) { child.kill(); await child.exited; } }
}, 15000);
