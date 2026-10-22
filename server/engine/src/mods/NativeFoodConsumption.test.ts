import World from '../engine/World.js';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import VarBitType from '../cache/config/VarBitType.js';
import ParamType from '../cache/config/ParamType.js';
import EnumType from '../cache/config/EnumType.js';
import StructType from '../cache/config/StructType.js';
import SeqType from '../cache/config/SeqType.js';
import DbRowType from '../cache/config/DbRowType.js';
import DbTableType from '../cache/config/DbTableType.js';
import DbTableIndex from '../cache/config/DbTableIndex.js';
import Player from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { MarketStore, ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import Packet from '../io/Packet.js';
import { executeNativeFoodAction as executeEngineFood, type NativeFoodContext } from './NativeFoodConsumption.js';
import { FOOD_ITEM, FOOD_POLICY, NativeFoodConsumptionStore, foodDigest, validateFoodAction } from './NativeFoodConsumptionStore.js';
import { readNativeFoodSource } from '../../../gateway/admin/native-food-source.js';

const roots: string[] = [], markets: MarketStore[] = [];
const identities = new WeakMap<Player, NativeFoodContext>();
function executeNativeFoodAction(market: MarketStore, player: Player, context: NativeFoodContext,
    checkpoint: (save: Uint8Array) => void) {
    return executeEngineFood(market, player, context, checkpoint, (_username, actionId, slot) => {
        const bound = identities.get(player)!;
        return { ...bound, action: { ...bound.action, actionId, slot } };
    });
}
const id = '11111111-1111-4111-8111-111111111111';
const pack = resolve(import.meta.dir, '../../data/pack');
function loadPackedContent() {
    for (const type of [InvType, ObjType, VarPlayerType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack);
}
beforeAll(loadPackedContent);
afterEach(() => {
    for (const market of markets.splice(0)) market.db.close(true);
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(full = false, databasePath?: string) {
    const root = databasePath ? dirname(databasePath) : mkdtempSync(join(tmpdir(), 'native-food-')); roots.push(root);
    const path = databasePath ?? join(root, 'checkpoints.sqlite'), market = new MarketStore(path); markets.push(market);
    const player = new Player('foodtest', 1n, 1n);
    player.x = 3222; player.z = 3218;
    player.levels.fill(1); player.baseLevels.fill(1);
    player.levels[PlayerStat.HITPOINTS] = full ? 20 : 5; player.baseLevels[PlayerStat.HITPOINTS] = 20;
    const inv = player.getInventory(InvType.INV)!;
    inv.add(FOOD_ITEM, 2);
    World.currentTick = 100;
    const context: NativeFoodContext = { action: { actionId: id, worldId: 'local-test', actorId: 'actor-foodtest',
        username: player.username, lifecycleId: 'fixture-life-1', itemId: FOOD_ITEM, quantity: 1, slot: 0,
        policyDigest: foodDigest(FOOD_POLICY), clockId: 'fixture-clock', clockProfileDigest: 'a'.repeat(64) },
        clock: { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), wallTime: '2026-10-18T10:00:00.000Z',
            simulationTime: '2001-01-01T00:00:01.000Z', engineTick: 100, revision: 1, status: 'running' } };
    const checkpoint = (save: Uint8Array) => market.checkpoint(player.username, save, true);
    identities.set(player, context);
    market.checkpoint(player.username, player.save(false), true);
    return { root, path, market, player, inv, context, checkpoint };
}

// The parent kills this process at a precise native transaction boundary. No graceful cleanup runs.
if (process.env.NATIVE_FOOD_CRASH_PHASE) {
    loadPackedContent();
    const f = fixture(false, process.env.NATIVE_FOOD_CRASH_DATABASE!);
    const waitForKill = () => {
        process.stdout.write('NATIVE_FOOD_CRASH_BOUNDARY\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    executeNativeFoodAction(f.market, f.player, f.context, save => {
        f.checkpoint(save);
        if (process.env.NATIVE_FOOD_CRASH_PHASE === 'before-commit') waitForKill();
    });
    waitForKill();
}

describe('SI-A01 native lobster content and canonical checkpoint', () => {
    test('real content consumes once, heals, persists and replays after restart with original inventory comparison', () => {
        const f = fixture(), initial = f.inv.getItemCount(FOOD_ITEM);
        const result = executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint);
        expect(result.outcome).toBe('consumed');
        expect(result.receipt).toMatchObject({ before: initial, after: initial - 1, hpBefore: 5, hpAfter: 17 });
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(1);
        expect(PlayerLoading.load('foodtest', new Packet(f.market.saved('foodtest')!), null)
            .getInventory(InvType.INV)!.getItemCount(FOOD_ITEM)).toBe(1);
        expect(executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint)).toEqual(result);
        const reopened = new MarketStore(f.path); markets.push(reopened);
        expect(new NativeFoodConsumptionStore(reopened).get(id)).toEqual(result);
        expect(readNativeFoodSource(f.path, f.context.action)).toEqual({ status: 'completed', result });
        expect(executeNativeFoodAction(reopened, f.player, f.context, save => reopened.checkpoint('foodtest', save, true))).toEqual(result);
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(1);
    });
    test('full HP still follows content: item is eaten with zero HP gain', () => {
        const f = fixture(true), result = executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint);
        expect(result.receipt).toMatchObject({ before: 2, after: 1, hpBefore: 20, hpAfter: 20 });
    });
    test('eat-delay is a durable no-use result and never a consumption receipt', () => {
        const f = fixture();
        f.player.setVar(VarPlayerType.getId('eat_delay'), 101);
        const result = executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint);
        expect(result).toMatchObject({ outcome: 'no-use', receipt: null });
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(2);
        World.currentTick = 200;
        expect(executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint)).toEqual(result);
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(2);
    });
    test('an empty slot is a no-use outcome, with no fabricated receipt', () => {
        const f = fixture(); f.inv.set(0, null);
        expect(executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint)).toMatchObject({ outcome: 'no-use', receipt: null });
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(1);
    });
    test('failed checkpoint rolls back actual inventory, HP and content vars; the durable intent resumes once', () => {
        const f = fixture(), before = f.market.saved('foodtest')!, vars = f.player.vars.slice();
        expect(() => executeNativeFoodAction(f.market, f.player, f.context, save => {
            f.checkpoint(save); throw new Error('injected disk failure');
        })).toThrow('injected disk failure');
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(2); expect(f.player.levels[PlayerStat.HITPOINTS]).toBe(5);
        expect(f.player.vars).toEqual(vars); expect(f.market.saved('foodtest')).toEqual(before);
        expect(readNativeFoodSource(f.path, f.context.action)).toEqual({ status: 'pending', result: null });
        expect(executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint).outcome).toBe('consumed');
    });
    test('receipt insertion failure also rolls back the Player checkpoint and memory', () => {
        const f = fixture(); new NativeFoodConsumptionStore(f.market);
        f.market.db.run(`CREATE TRIGGER fail_food BEFORE UPDATE OF result_json ON native_food_actions
            BEGIN SELECT RAISE(ABORT,'receipt-write-failed'); END`);
        const before = f.market.saved('foodtest')!;
        expect(() => executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint)).toThrow('receipt-write-failed');
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(2); expect(f.market.saved('foodtest')).toEqual(before);
    });
    test('ID collisions, actor/item/lifecycle/world/clock mismatch and dead actors fail closed', () => {
        const f = fixture(); executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint);
        for (const change of [{ actorId: 'other' }, { lifecycleId: 'other' }, { worldId: 'other' }, { slot: 1 }, { itemId: 315 }])
            expect(() => executeNativeFoodAction(f.market, f.player, { ...f.context,
                action: { ...f.context.action, ...change } }, f.checkpoint)).toThrow();
        expect(() => readNativeFoodSource(f.path, { ...f.context.action, actorId: 'other' })).toThrow('identity mismatch');
        expect(() => executeNativeFoodAction(f.market, f.player, { ...f.context,
            action: { ...f.context.action, username: 'other' } }, f.checkpoint)).toThrow('authority mismatch');
        f.player.populationTerminal = true;
        expect(() => executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint)).toThrow('not active');
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(1);
    });
    test('readonly missing and legacy sources create no database or receipt; strict action validation', () => {
        const f = fixture(), absent = join(f.root, 'absent.sqlite');
        expect(readNativeFoodSource(absent, f.context.action).status).toBe('unavailable'); expect(existsSync(absent)).toBeFalse();
        expect(readNativeFoodSource(f.path, f.context.action).status).toBe('unavailable');
        expect(() => validateFoodAction({ ...f.context.action, quantity: 2 })).toThrow('Invalid');
        expect(() => validateFoodAction({ ...f.context.action, actionId: 'bad' })).toThrow('Invalid');
    });
    test('receipt tampering fails closed and a future evidence schema cannot be migrated silently', () => {
        const f = fixture(); executeNativeFoodAction(f.market, f.player, f.context, f.checkpoint);
        f.market.db.run('UPDATE native_food_actions SET result_digest=?1', ['0'.repeat(64)]);
        expect(() => readNativeFoodSource(f.path, f.context.action)).toThrow('audit mismatch');
        f.market.db.run('DROP TABLE native_food_schema');
        f.market.db.run('CREATE TABLE native_food_schema(version INTEGER PRIMARY KEY)');
        f.market.db.run('INSERT INTO native_food_schema VALUES(2)');
        expect(() => new NativeFoodConsumptionStore(f.market)).toThrow('Unsupported');
        expect(f.market.db.query('SELECT version FROM native_food_schema').all()).toEqual([{ version: 2 }]);
    });
    test('readonly source rejects foreign managed worlds and paths', () => {
        const f = fixture(), keys = ['CONTROL_PLANE_SERVER_ID', 'MANAGED_WORKSPACE', 'ENGINE_ADMIN_URL', 'GATEWAY_URL'];
        const original = keys.map(key => process.env[key]);
        try {
            process.env.CONTROL_PLANE_SERVER_ID = 'srv-11111111-1111-4111-8111-111111111111';
            process.env.MANAGED_WORKSPACE = f.root;
            process.env.ENGINE_ADMIN_URL = 'http://127.0.0.1:20001'; process.env.GATEWAY_URL = 'ws://127.0.0.1:20000';
            expect(() => readNativeFoodSource(f.path, f.context.action)).toThrow('another managed world');
            expect(() => readNativeFoodSource(f.path, { ...f.context.action,
                worldId: process.env.CONTROL_PLANE_SERVER_ID! })).toThrow('another managed world');
        } finally { keys.forEach((key, index) => { if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index]; }); }
    });
    for (const phase of ['before-commit', 'after-commit']) test(`forced process crash ${phase} keeps receipt and canonical inventory together`, async () => {
        const f = fixture();
        const child = Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
            env: { ...process.env, NATIVE_FOOD_CRASH_PHASE: phase, NATIVE_FOOD_CRASH_DATABASE: f.path }, stdout: 'pipe', stderr: 'pipe' });
        const errors = new Response(child.stderr).text();
        try {
            const reader = child.stdout.getReader(); let output = '';
            while (!output.includes('NATIVE_FOOD_CRASH_BOUNDARY')) {
                const chunk = await reader.read();
                if (chunk.done) throw new Error(`Crash worker exited before boundary: ${await errors}`);
                output += new TextDecoder().decode(chunk.value);
            }
            child.kill(); await child.exited; await errors;
            const reopened = new MarketStore(f.path); markets.push(reopened);
            const receipt = new NativeFoodConsumptionStore(reopened).get(id);
            const restored = PlayerLoading.load('foodtest', new Packet(reopened.saved('foodtest')!), null);
            identities.set(restored, f.context);
            expect(restored.getInventory(InvType.INV)!.getItemCount(FOOD_ITEM)).toBe(phase === 'before-commit' ? 2 : 1);
            expect(receipt?.outcome ?? null).toBe(phase === 'before-commit' ? null : 'consumed');
            expect(executeNativeFoodAction(reopened, restored, f.context, save => reopened.checkpoint('foodtest', save, true)).outcome).toBe('consumed');
            expect(restored.getInventory(InvType.INV)!.getItemCount(FOOD_ITEM)).toBe(1);
        } finally { if (child.exitCode === null) { child.kill(); await child.exited; } }
    }, 15000);
    test('actual World.checkpointPlayers shares the receipt transaction and canonical save authority', () => {
        const f = fixture(), canonical = ensurePlayerSaveStore();
        f.player.username = 'worldtest';
        const context = { ...f.context, action: { ...f.context.action, username: 'worldtest', actorId: 'world-actor' } };
        const result = executeEngineFood(canonical, f.player, context, undefined, () => context);
        expect(result.outcome).toBe('consumed');
        expect(PlayerLoading.load('worldtest', new Packet(canonical.saved('worldtest')!), null)
            .getInventory(InvType.INV)!.getItemCount(FOOD_ITEM)).toBe(1);
        expect(readNativeFoodSource(process.env.PLAYER_CHECKPOINT_DATABASE!, context.action).result).toEqual(result);
        canonical.db.close(true);
    });
});
