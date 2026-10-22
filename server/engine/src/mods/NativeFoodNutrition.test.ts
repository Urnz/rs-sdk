import World from '../engine/World.js';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
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
import { MarketStore } from '../engine/market/MarketStore.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import Packet from '../io/Packet.js';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { FOOD_ITEM, FOOD_POLICY, NativeFoodConsumptionStore, foodDigest, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick, readFoodDeliveries } from './NativeFoodDeliveryStore.js';
import { NativeFoodSource } from '../../../../food-loop/native-source.js';
import { FoodNeedsPersistence } from '../../../../food-loop/needs-persistence.js';
import type { AdvanceNeedsInput, NeedsBinding } from '../../../../needs/store.js';
import { loadNeedsDynamicsPolicyCatalog, loadNeedsPolicyCatalog } from '../../../../needs/config.js';
import { loadFoodLoopCatalog } from '../../../../food-loop/catalog.js';
import { closeFoodLoop } from '../../../../food-loop/closure.js';
import { SimulationClockStore } from '../../../../simulation-clock/store.js';
import { readNativeNutritionMetrics } from '../../../../society-metrics/native-food.js';

const config = resolve(import.meta.dir, '../../../../config');
const policy = loadNeedsPolicyCatalog(join(config, 'needs-policies.json')).policies[0]!;
const dynamics = loadNeedsDynamicsPolicyCatalog(join(config, 'needs-dynamics-policies.json'), policy).policies[0]!;
const catalog = loadFoodLoopCatalog(join(config, 'food-loops.json'));
const roots: string[] = [], closers: Array<() => void> = [];
const start = '2001-01-01T00:00:00.000Z', wall = '2026-10-18T10:00:00.000Z';
const pack = resolve(import.meta.dir, '../../data/pack');
beforeAll(() => {
    for (const type of [InvType, ObjType, VarPlayerType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack);
});
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'native-nutrition-')); roots.push(root);
    mkdirSync(join(root, 'config'));
    for (const file of ['needs-policies.json', 'needs-dynamics-policies.json', 'food-loops.json'])
        copyFileSync(join(config, file), join(root, 'config', file));
    const path = join(root, 'checkpoints.sqlite'), domainPath = join(root, '.local/simulation/food-needs.sqlite');
    const market = new MarketStore(path); closers.push(() => market.db.close(true));
    new NativeFoodConsumptionStore(market);
    const clock = new SimulationClockStore(join(root, 'clock.sqlite')); closers.push(() => clock.close());
    const created = clock.create({ clockId: 'nutrition-clock', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
        seed: 'si-a04-smoke', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: wall, simulationTime: start });
    const binding: NeedsBinding = { worldId: 'nutrition-world', actorId: 'nutrition-actor', playerId: 'foodtest',
        lifecycleId: 'nutrition-life', clockId: created.clockId, clockProfileDigest: created.profileDigest,
        worldProfileDigest: 'b'.repeat(64), lifecyclePolicyDigest: 'c'.repeat(64) };
    let persistence = new FoodNeedsPersistence(domainPath, policy, dynamics, catalog);
    closers.push(() => persistence.close());
    persistence.needs.initialize({ binding, clock: clock.observe(created.clockId, wall, 1), history: [], playerTime: null,
        admission: { kind: 'genesis', evidenceId: 'nutrition-genesis', evidenceDigest: 'd'.repeat(64) } });
    const player = new Player('foodtest', 1n, 1n); player.x = 3222; player.z = 3218;
    player.levels.fill(1); player.baseLevels.fill(1);
    player.levels[PlayerStat.HITPOINTS] = 20; player.baseLevels[PlayerStat.HITPOINTS] = 20;
    const inv = player.getInventory(InvType.INV)!; inv.add(FOOD_ITEM, 6);
    market.checkpoint(player.username, player.save(false), true);
    const source = new NativeFoodSource({ workspace: root, worldId: binding.worldId, checkpointPath: path });
    closers.push(() => source.close());
    const observation = (hours: number) => clock.observe(created.clockId,
        new Date(Date.parse(wall) + hours * 3600000).toISOString(), 100 + Math.floor(hours * 100));
    const eat = (hours = 10, noUse = false) => {
        const observed = observation(hours); World.currentTick = observed.engineTick!;
        const context: NativeFoodContext = { action: { actionId: randomUUID(), worldId: binding.worldId, actorId: binding.actorId,
            username: player.username, lifecycleId: binding.lifecycleId, itemId: FOOD_ITEM, quantity: 1,
            slot: inv.items.findIndex(item => item?.id === FOOD_ITEM), policyDigest: foodDigest(FOOD_POLICY),
            clockId: binding.clockId, clockProfileDigest: binding.clockProfileDigest }, clock: observed };
        player.setVar(VarPlayerType.getId('eat_delay'), noUse ? World.currentTick + 5 : 0);
        const result = executeNativeFoodAction(market, player, context, save => market.checkpoint(player.username, save, true), () => context);
        return { result, context };
    };
    const close = (hours = 10) => closeFoodDeliveryTick(market.db, observation(hours));
    const input = (sequence = 1): AdvanceNeedsInput => source.snapshot(() => ({ binding,
        clock: source.delivery(sequence).entry.clock!, history: [], playerTime: null,
        expectedRevision: persistence.needs.get(binding)!.revision }));
    const apply = (sequence = 1) => persistence.nativeFood.apply(source, sequence, input(sequence));
    const options = { workspace: root, worldId: binding.worldId, databasePath: domainPath,
        configDirectory: join(root, 'config'), nativeFoodCheckpointPath: path };
    return { root, path, domainPath, market, clock, player, inv, source, binding, eat, close, input, apply, observation, options,
        get persistence() { return persistence; }, reopen() { persistence.close(); persistence = new FoodNeedsPersistence(domainPath, policy, dynamics, catalog); } };
}

describe('SI-A04 native consume to durable hunger relief', () => {
    test('full HP native smoke deletes one item and applies exactly one catalog relief with both audit histories', () => {
        const f = fixture(), { result } = f.eat(); f.close();
        expect(result.receipt).toMatchObject({ hpBefore: 20, hpAfter: 20, before: 6, after: 5 });
        f.source.snapshot(() => expect(f.persistence.nativeFood.status(f.source, 1).status).toBe('native-committed/domain-pending'));
        const event = f.apply();
        expect(event).toMatchObject({ outcome: 'consumed', quantity: 1, hungerBefore: 2000, hungerRelief: 1800, hungerAfter: 200,
            evidenceScope: 'native-physiology-without-lineage' });
        expect(f.persistence.needs.get(f.binding)!.state.values.find(value => value.needId === 'hunger')!.value).toBe(200);
        expect(PlayerLoading.load('foodtest', new Packet(f.market.saved('foodtest')!), null).getInventory(InvType.INV)!.getItemCount(FOOD_ITEM)).toBe(5);
        f.source.snapshot(() => expect(f.persistence.nativeFood.status(f.source, 1).status).toBe('completed'));
        expect(f.apply()).toEqual(event); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
    });
    test('relief clamps to actual hunger and later consumption cannot reuse an earlier receipt', () => {
        const f = fixture(); f.eat(); f.close(); f.apply();
        f.eat(11); f.close(11); const second = f.apply(2);
        expect(second).toMatchObject({ hungerBefore: 400, hungerRelief: 400, hungerAfter: 0 });
        expect(f.persistence.nativeFood.list()).toHaveLength(2); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(4);
        expect(f.apply(1).hungerRelief).toBe(1800); expect(f.persistence.nativeFood.list()).toHaveLength(2);
    });
    test('zero-hunger food is still a real one-unit consumption with zero physiological credit', () => {
        const f = fixture(); f.eat(0); f.close(0);
        expect(f.apply()).toMatchObject({ quantity: 1, hungerBefore: 0, hungerAfter: 0, hungerRelief: 0 });
        expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
    });
    test('no-use outcome gets no needs mutation, receipt lock or hunger relief', () => {
        const f = fixture(); f.eat(10, true); f.close(); const before = f.persistence.needs.get(f.binding);
        const event = f.apply(); expect(event).toMatchObject({ outcome: 'no-use', quantity: 0, hungerRelief: 0 });
        expect(f.persistence.needs.get(f.binding)).toEqual(before); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(6);
    });
    test('an unclosed tick remains native-committed/domain-pending and never grants speculative relief', () => {
        const f = fixture(); f.eat(); expect(() => f.apply()).toThrow('tick is not closed');
        expect(f.persistence.needs.get(f.binding)!.revision).toBe(1); f.close(); expect(f.apply().hungerRelief).toBe(1800);
    });
    test('reopen and competing gateway connections return the same application without a second relief', () => {
        const f = fixture(); f.eat(); f.close(); const event = f.apply(); f.reopen();
        const other = new FoodNeedsPersistence(f.domainPath, policy, dynamics, catalog);
        try { expect(other.nativeFood.apply(f.source, 1, { ...f.input(), expectedRevision: 1 })).toEqual(event); }
        finally { other.close(); }
        expect(f.apply()).toEqual(event); expect(f.persistence.needs.get(f.binding)!.state.digest).toBe(event.needsAfter!.digest);
    });
    test('wrong actor, player, lifecycle, world, clock and stale revision cannot apply the receipt', () => {
        const f = fixture(); f.eat(); f.close();
        for (const change of [{ actorId: 'other' }, { playerId: 'other' }, { lifecycleId: 'other' }, { worldId: 'other' },
            { clockId: 'other' }, { clockProfileDigest: 'e'.repeat(64) }])
            expect(() => f.persistence.nativeFood.apply(f.source, 1, { ...f.input(), binding: { ...f.binding, ...change } })).toThrow('mismatch');
        expect(() => f.persistence.nativeFood.apply(f.source, 1, { ...f.input(), expectedRevision: 999 })).toThrow('revision conflict');
        expect(f.persistence.nativeFood.list()).toHaveLength(0); expect(f.persistence.needs.get(f.binding)!.revision).toBe(1);
    });
    test('tampered source, truncated outbox, removed receipt lock and replaced needs history fail closed', () => {
        const f = fixture(); f.eat(); f.close(); f.apply();
        f.market.db.run('UPDATE native_food_actions SET result_digest=?1', ['f'.repeat(64)]);
        expect(() => f.source.snapshot(() => f.persistence.nativeFood.verifySource(f.source))).toThrow('audit mismatch');
        const g = fixture(); g.eat(); g.close(); g.market.db.run('DELETE FROM native_food_delivery');
        expect(() => g.apply()).toThrow('truncated');
        const h = fixture(); h.eat(); h.close(); h.apply();
        const db = new Database(h.domainPath); db.run('DELETE FROM native_food_receipt_use'); db.close(true);
        expect(() => h.persistence.nativeFood.list()).toThrow('receipt-use audit');
        const replaced = fixture(); replaced.eat(); replaced.close(); replaced.apply();
        replaced.market.db.run('UPDATE native_food_delivery_head SET source_id=?1', [randomUUID()]);
        expect(() => replaced.source.snapshot(() => replaced.persistence.nativeFood.verifySource(replaced.source))).toThrow('replaced');
    });
    test('deleting the whole projection cannot spend a receipt already anchored in needs history again', () => {
        const f = fixture(); f.eat(); f.close(); const event = f.apply(), before = f.persistence.needs.get(f.binding);
        const db = new Database(f.domainPath);
        for (const table of ['native_food_receipt_use', 'native_food_consumption_event', 'native_food_recovery']) db.run(`DELETE FROM ${table}`);
        db.close(true);
        expect(() => f.apply()).toThrow('lost its needs receipt anchor');
        expect(f.persistence.needs.get(f.binding)).toEqual(before); expect(before!.state.digest).toBe(event.needsAfter!.digest);
    });
    test('out-of-order deliveries and an already advanced needs observation require reconciliation', () => {
        const f = fixture(); f.eat(); f.eat(11); f.close(11);
        expect(() => f.apply(2)).toThrow('source order');
        f.persistence.needs.advance({ ...f.input(), clock: f.observation(12), expectedRevision: 1 });
        expect(() => f.apply(1)).toThrow('monotonic'); expect(f.persistence.nativeFood.list()).toHaveLength(0);
    });
    test('all projection commit boundaries roll back needs/event/lock/cursor without restoring the eaten item', () => {
        for (const phase of ['before-needs', 'after-needs', 'after-event', 'after-cursor']) {
            const f = fixture(); f.eat(); f.close(); const before = f.persistence.needs.get(f.binding);
            expect(() => f.persistence.nativeFood.apply(f.source, 1, f.input(), reached => {
                if (reached === phase) throw new Error(`injected ${phase}`);
            })).toThrow(`injected ${phase}`);
            expect(f.persistence.needs.get(f.binding)).toEqual(before); expect(f.persistence.nativeFood.list()).toEqual([]);
            expect(f.persistence.nativeFood.cursor()).toBeNull(); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
            expect(f.apply().hungerRelief).toBe(1800);
        }
    });
    test('metrics binds the native source and needs audit while keeping internal food origin unknown', () => {
        const f = fixture(); f.eat(); f.close();
        const query = { clockId: f.binding.clockId, clockProfileDigest: f.binding.clockProfileDigest,
            fromSimulationTime: f.observation(10).simulationTime, toSimulationTime: f.observation(10).simulationTime };
        expect(readNativeNutritionMetrics(f.options, query).status).toBe('inconclusive');
        f.apply(); expect(readNativeNutritionMetrics(f.options, query)).toMatchObject({ status: 'verified', units: 1,
            hungerRelief: 1800, internalOrigin: 'unknown' });
        expect(readNativeNutritionMetrics(f.options, { ...query, fromSimulationTime: start })).toMatchObject({
            status: 'inconclusive', units: 1, hungerRelief: 1800 });
        const before = f.persistence.needs.get(f.binding)!;
        expect(() => readNativeNutritionMetrics(f.options, { ...query, clockId: 'other' })).toThrow('mismatch');
        expect(() => readNativeNutritionMetrics({ ...f.options, worldId: 'other-world' }, query)).toThrow('another world');
        expect(f.persistence.needs.get(f.binding)).toEqual(before);
    });
    test('native receipt use is exclusive with the legacy closure ledger', () => {
        const f = fixture(); const { result } = f.eat(); f.close(); const applied = f.apply();
        const at = result.receipt!.clock.simulationTime;
        const closure = closeFoodLoop({ closureId: 'legacy-repeat', foodChainId: 'lobster', state: applied.needsBefore!,
            gathered: { receiptId: 'legacy-gather', actorAgentId: f.binding.actorId, kind: 'gathered', occurredAtSimulationTime: at,
                skill: 'Fishing', inputs: [], outputs: [{ itemId: 377, quantity: 1 }], sourceDigest: 'a'.repeat(64) },
            processed: { receiptId: 'legacy-cook', actorAgentId: f.binding.actorId, kind: 'processed', occurredAtSimulationTime: at,
                skill: 'Cooking', inputs: [{ itemId: 377, quantity: 1 }], outputs: [{ itemId: 379, quantity: 1 }], sourceDigest: 'b'.repeat(64) },
            consumed: { receiptId: result.action.actionId, actorAgentId: f.binding.actorId, kind: 'consumed', occurredAtSimulationTime: at,
                skill: null, inputs: [{ itemId: 379, quantity: 1 }], outputs: [], sourceDigest: foodDigest(result) } }, catalog, policy);
        expect(() => f.persistence.food.record(closure)).toThrow('already applied');
        expect(f.persistence.food.list()).toEqual([]); expect(f.persistence.nativeFood.list()).toHaveLength(1);
    });
    test('legacy completed native results migrate as blocked evidence without invented needs relief', () => {
        const f = fixture(); f.eat();
        for (const table of ['native_food_delivery', 'native_food_delivery_head', 'native_food_delivery_schema']) f.market.db.run(`DROP TABLE ${table}`);
        new NativeFoodConsumptionStore(f.market); f.close();
        expect(readFoodDeliveries(f.market.db).entries[0]!.legacy).toBeTrue();
        expect(() => f.apply()).toThrow('Legacy'); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
    });
    test('terminal needs receive no new relief and missing readonly source creates no file', () => {
        const f = fixture(); f.eat(); f.close();
        f.persistence.needs.advance({ ...f.input(), terminal: { kind: 'deceased', at: f.input().clock.simulationTime,
            sourceId: 'death', sourceDigest: 'f'.repeat(64) } });
        expect(() => f.apply()).toThrow('Terminal');
        const missing = join(f.root, 'missing.sqlite');
        expect(() => new NativeFoodSource({ workspace: f.root, worldId: f.binding.worldId, checkpointPath: missing })).toThrow();
        expect(existsSync(missing)).toBeFalse();
    });
    test('simultaneous gateway processes race safely on the same native receipt', async () => {
        const f = fixture(); f.eat(); f.close(); writeFileSync(join(f.root, 'request.json'), JSON.stringify(f.input()));
        const workers = Array.from({ length: 2 }, () => Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
            env: { ...process.env, NATIVE_NUTRITION_CRASH_ROOT: f.root, NATIVE_NUTRITION_CRASH_PHASE: 'concurrent' }, stdout: 'pipe', stderr: 'pipe' }));
        const outcomes = await Promise.all(workers.map(async child => {
            const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
            if (code !== 0) throw new Error(`Concurrent worker failed: ${stderr}`);
            return stdout;
        }));
        expect(outcomes.every(output => output.includes('NUTRITION_APPLIED'))).toBeTrue();
        f.reopen(); expect(f.persistence.nativeFood.list()).toHaveLength(1);
        expect(f.persistence.needs.get(f.binding)!.state.values.find(value => value.needId === 'hunger')!.value).toBe(200);
    }, 15000);
    for (const phase of ['before-needs', 'after-needs', 'after-event', 'after-cursor', 'after-commit'])
        test(`forced process kill ${phase} recovers the same native consumption exactly once`, async () => {
            const f = fixture(); f.eat(); f.close();
            writeFileSync(join(f.root, 'request.json'), JSON.stringify(f.input()));
            const child = Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
                env: { ...process.env, NATIVE_NUTRITION_CRASH_ROOT: f.root, NATIVE_NUTRITION_CRASH_PHASE: phase }, stdout: 'pipe', stderr: 'pipe' });
            const errors = new Response(child.stderr).text();
            try {
                const reader = child.stdout.getReader(); let output = '';
                while (!output.includes('NUTRITION_CRASH_BOUNDARY')) {
                    const chunk = await reader.read(); if (chunk.done) throw new Error(`Worker missed boundary: ${await errors}`);
                    output += new TextDecoder().decode(chunk.value);
                }
                child.kill(); await child.exited; await errors; f.reopen();
                expect(f.persistence.nativeFood.list()).toHaveLength(phase === 'after-commit' ? 1 : 0);
                expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
                expect(f.apply()).toMatchObject({ hungerBefore: 2000, hungerRelief: 1800, hungerAfter: 200 });
                expect(f.persistence.nativeFood.list()).toHaveLength(1);
            } finally { if (child.exitCode === null) { child.kill(); await child.exited; } }
        }, 15000);
});

if (process.env.NATIVE_NUTRITION_CRASH_PHASE) {
    const root = process.env.NATIVE_NUTRITION_CRASH_ROOT!;
    const input = JSON.parse(readFileSync(join(root, 'request.json'), 'utf8')) as AdvanceNeedsInput;
    const source = new NativeFoodSource({ workspace: root, worldId: input.binding.worldId, checkpointPath: join(root, 'checkpoints.sqlite') });
    const persistence = new FoodNeedsPersistence(join(root, '.local/simulation/food-needs.sqlite'), policy, dynamics, catalog);
    persistence.nativeFood.apply(source, 1, input, phase => {
        if (phase === process.env.NATIVE_NUTRITION_CRASH_PHASE) {
            process.stdout.write('NUTRITION_CRASH_BOUNDARY\n');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
    });
    if (process.env.NATIVE_NUTRITION_CRASH_PHASE === 'concurrent') {
        persistence.close(); source.close(); process.stdout.write('NUTRITION_APPLIED\n'); process.exit(0);
    }
    throw new Error('Crash boundary was not reached');
}
