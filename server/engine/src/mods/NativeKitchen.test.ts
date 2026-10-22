import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { ScriptOpcodeNameMap } from '../engine/script/ScriptOpcode.js';
import { BusinessManagerStore } from '../../../gateway/admin/business-manager.js';
import { BusinessAssetStore } from '../../../../business-assets/store.js';
import { ProductionWorkInProgressStore, type ReserveProductionRun } from '../../../../production-workflow/wip-store.js';
import { loadDefaultProductionWorkflowCatalog } from '../../../../production-workflow/catalog.js';
import { loadNativeKitchenPolicy } from '../../../../production-workflow/native-kitchen-policy.js';
import { loadFacilityCapabilityCatalog } from '../../../../facility-capability/catalog.js';
import { NativeKitchenExecutor } from './NativeKitchen.js';
import { NativeKitchenReservationSource, NativeKitchenResultSource } from '../../../../production-workflow/native-kitchen-source.js';
import type { NativeKitchenIntent } from '../../../../production-workflow/native-kitchen-wip.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import { readNativeKitchen } from './NativeKitchenStore.js';
import { Database } from 'bun:sqlite';
import { finalizePopulationKitchen } from '../../../gateway/admin/native-kitchen.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';

const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], stores: MarketStore[] = [];
function loadPackedContent() {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
}
beforeAll(loadPackedContent);
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const store of stores.splice(0)) store.db.close(true); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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

const closers: Array<() => void> = [];
function kitchen(owner = 'actor-prodtest', role: 'manager' | 'worker' = 'manager') {
    const f = fixture();
    const config = join(f.dir, 'config'); mkdirSync(config);
    for (const name of ['native-kitchen.json', 'facility-capabilities.json', 'production-workflows.json', 'native-food-production.json', 'properties.json', 'food-loops.json'])
        copyFileSync(join(root, 'config', name), join(config, name));
    const businessPath = join(f.dir, '.local/economy/businesses.sqlite'), manager = new BusinessManagerStore(businessPath);
    manager.create({ businessId: 'fish-kitchen', name: 'Fish kitchen', summary: 'Native single-batch smoke', ownerAgentId: owner, propertyId: 'karamja.fishing-hut' });
    const employment = owner !== 'actor-prodtest' ? manager.hire('fish-kitchen', { workerAgentId: 'actor-prodtest', role, title: 'Cook', wageGp: 0 }) : null;
    manager.creditGenesisInventory('opening-raw', 'fish-kitchen', 377, 1); manager.close();
    const work = new ProductionWorkInProgressStore(businessPath, loadDefaultProductionWorkflowCatalog(), undefined, false); closers.push(() => work.close());
    const source = new NativeKitchenReservationSource({ workspace: f.dir, worldId: 'fixture-world', checkpointPath: businessPath }); closers.push(() => source.close());
    const results = new NativeKitchenResultSource({ workspace: f.dir, worldId: 'fixture-world', checkpointPath: f.path }); closers.push(() => results.close());
    const policy = loadNativeKitchenPolicy(f.dir), facilities = loadFacilityCapabilityCatalog(join(config, 'facility-capabilities.json'));
    const intent: NativeKitchenIntent = { runId: 'cook-run-1', businessId: 'fish-kitchen', actorAgentId: 'actor-prodtest', username: 'prodtest',
        worldId: 'fixture-world', lifecycleId: 'fixture-lifecycle', clockId: 'fixture-clock', clockProfileDigest: 'a'.repeat(64),
        catalogDigest: f.ports.policy.catalogDigest, policy, actionId: randomUUID(), inputEscrowId: randomUUID(), outputEscrowId: randomUUID(),
        batchId: 'cook-batch-1', stepId: 'cook', targetStorageId: null, grant: { grantId: 'kitchen-grant', kind: 'explicit',
            subjectAgentId: 'actor-prodtest', facilityId: policy.facilityId, capabilityId: policy.capabilityId, status: 'active',
            validFrom: '2001-01-01T00:00:00.000Z', validUntil: '2001-01-01T00:10:00.000Z', sourceEvidenceId: 'kitchen-owner-access' } };
    const reservation: ReserveProductionRun = { operationId: 'reserve-cook-1', runId: intent.runId, businessId: intent.businessId, actorAgentId: intent.actorAgentId,
        workflowId: 'food.cooked-lobster', workflowVersion: '1.0.0', inputs: [{ itemId: 377, count: 1, storageId: null }] };
    let simulationTime = '2001-01-01T00:00:01.000Z';
    const clock = () => ({ ...f.identity('prodtest', intent.actionId, 0, World.currentTick)!.clock, simulationTime });
    const executor = () => new NativeKitchenExecutor({ ...f.ports, source, clock, heat: () => f.heat });
    let engine = executor();
    const prepare = () => work.reserveNativeKitchen(reservation, intent, facilities, clock().simulationTime, () => true);
    const command = (operation: 'issue' | 'process' | 'return') => engine.execute({ operation, runId: intent.runId }, f.player);
    return { ...f, work, source, results, intent, reservation, facilities, prepare, command, clock,
        businessPath, employment, advance(time: string) { simulationTime = time; },
        restart() { engine = executor(); } };
}
if (process.env.KITCHEN_RESERVE_ROOT) {
    const directory = process.env.KITCHEN_RESERVE_ROOT, suffix = process.env.KITCHEN_RESERVE_ID!;
    const saved = JSON.parse(readFileSync(join(directory, 'reserve.json'), 'utf8')) as { reservation: ReserveProductionRun; intent: NativeKitchenIntent };
    const work = new ProductionWorkInProgressStore(join(directory, '.local/economy/businesses.sqlite'), loadDefaultProductionWorkflowCatalog(), undefined, false);
    try {
        work.reserveNativeKitchen({ ...saved.reservation, operationId: `reserve-${suffix}`, runId: `cook-${suffix}` },
            { ...saved.intent, runId: `cook-${suffix}`, actionId: randomUUID(), inputEscrowId: randomUUID(), outputEscrowId: randomUUID() },
        loadFacilityCapabilityCatalog(join(directory, 'config/facility-capabilities.json')), '2001-01-01T00:00:01.000Z', () => true);
        process.stdout.write('KITCHEN_RESERVED\n');
    } catch (error) { if (!(error instanceof Error) || !error.message.includes('insufficient')) throw error; process.stdout.write('KITCHEN_REJECTED\n'); }
    finally { work.close(); }
    process.exit(0);
}
if (process.env.KITCHEN_CRASH_ROOT) {
    loadPackedContent();
    const directory = process.env.KITCHEN_CRASH_ROOT, path = join(directory, 'checkpoints.sqlite'), market = new MarketStore(path);
    const source = new NativeKitchenReservationSource({ workspace: directory, worldId: 'fixture-world', checkpointPath: join(directory, '.local/economy/businesses.sqlite') });
    const binding = source.read('cook-run-1'), intent = binding.intent;
    const player = PlayerLoading.load(intent.username, new Packet(market.saved(intent.username)!), null);
    const heat = new Loc(0, 2926, 3180, 1, 1, EntityLifeCycle.FOREVER, LocType.getId('loc_2729'), 10, 0);
    const identity: NativeFoodProductionPorts['identity'] = (username, actionId, slot, tick) => ({ action: { actionId, worldId: intent.worldId,
        actorId: intent.actorAgentId, username, lifecycleId: intent.lifecycleId, itemId: 379, quantity: 1, slot,
        policyDigest: foodDigest(FOOD_POLICY), clockId: intent.clockId, clockProfileDigest: intent.clockProfileDigest },
        clock: { clockId: intent.clockId, profileDigest: intent.clockProfileDigest, wallTime: '2026-10-18T12:00:00.000Z',
            simulationTime: '2001-01-01T00:00:01.000Z', status: 'running', revision: 1, engineTick: tick } });
    const boundary = () => { process.stdout.write('KITCHEN_CRASH_BOUNDARY\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    const engine = new NativeKitchenExecutor({ market, source, policy: loadNativeFoodProductionPolicy(directory), identity,
        clock: () => identity(intent.username, intent.actionId, 0, World.currentTick)!.clock, heat: () => heat,
        checkpoint: save => { market.checkpoint(intent.username, save, true); if (process.env.KITCHEN_CRASH_PHASE === 'before-commit') boundary(); } });
    engine.execute({ operation: process.env.KITCHEN_CRASH_OPERATION as 'issue' | 'return', runId: intent.runId }, player); boundary();
}
test('reserved stock issues to protected worker escrow, real native cooking returns exactly one Business output', () => {
    const f = kitchen(), binding = f.prepare();
    expect(f.work.get(f.intent.runId)!.status).toBe('reserved');
    const assets = new BusinessAssetStore(join(f.dir, '.local/economy/businesses.sqlite'));
    try { expect(assets.listAssets('fish-kitchen', null).find(item => item.itemId === 377)!.count).toBe(0); } finally { assets.close(); }
    expect(f.command('issue').phase).toBe('issued'); expect(f.inv.getItemCount(377)).toBe(0);
    expect(() => f.work.cancelReserved(f.intent.runId)).toThrow('physical custody');
    JavaRandom.setSeed(4096); const first = f.command('process'); expect(first.phase).toBe('waiting'); expect(f.inv.getItemCount(377)).toBe(0);
    expect(f.command('process')).toEqual(first); World.currentTick = first.wakeTick!;
    const processed = f.command('process'); expect(processed.phase).toBe('processed');
    expect([...f.player.queue.all(), ...f.player.weakQueue.all()]).toHaveLength(0); expect(f.player.target).toBeNull();
    expect(processed.receipt).toMatchObject({ outcome: 'cooked', action: { actorId: 'actor-prodtest', runId: f.intent.runId, batchId: f.intent.batchId },
        custody: { businessId: 'fish-kitchen', bindingDigest: binding.digest } });
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
    expect(() => f.work.settleNativeKitchen(f.intent.runId, f.results)).toThrow('has not returned');
    const returned = f.command('return'); expect(returned.phase).toBe('returned-output');
    expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('completed');
    expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('completed'); expect(f.command('return')).toEqual(returned);
    const final = new BusinessAssetStore(join(f.dir, '.local/economy/businesses.sqlite'));
    try { expect(final.listAssets('fish-kitchen', null).find(item => item.itemId === 379)!.count).toBe(1); }
    finally { final.close(); }
});

function processBatch(f: ReturnType<typeof kitchen>, seed = 4096) {
    f.command('issue'); JavaRandom.setSeed(seed); const waiting = f.command('process');
    expect(waiting.phase).toBe('waiting'); World.currentTick = waiting.wakeTick!;
    return f.command('process');
}
test('concurrent reservations cannot allocate the same raw unit and a failed entitlement rolls stock back', () => {
    const f = kitchen();
    expect(() => f.work.reserveNativeKitchen(f.reservation, f.intent, f.facilities, f.clock().simulationTime, () => false)).toThrow('entitlement');
    expect(f.work.get(f.intent.runId)).toBeNull(); f.prepare();
    const second = new ProductionWorkInProgressStore(f.businessPath, loadDefaultProductionWorkflowCatalog(), undefined, false);
    try { expect(() => second.reserve({ ...f.reservation, operationId: 'reserve-other', runId: 'cook-other' })).toThrow('insufficient'); }
    finally { second.close(); }
    expect(f.prepare()).toEqual(f.work.nativeKitchen(f.intent.runId)!.binding);
});
test('full inventory and unreachable heat do not spend or expose held Business input', () => {
    const f = kitchen(); f.prepare();
    while (f.inv.freeSlotCount) f.inv.add(377, 1);
    expect(() => f.command('issue')).toThrow('full'); expect(readNativeKitchen(f.market.db)).toHaveLength(0);
    f.player.invDel(InvType.INV, 377, 27); f.command('issue');
    const before = f.inv.getItemCount(377); f.heat.x += 20;
    expect(() => f.command('process')).toThrow('unreachable'); expect(f.inv.getItemCount(377)).toBe(before);
    const escrow = new PlayerInventoryEscrowStore(f.market); expect(escrow.get(f.intent.inputEscrowId)!.status).toBe('held');
});
test('generic escrow release, commit and consume cannot bypass protected Business custody', () => {
    const f = kitchen(); const binding = f.prepare(); f.command('issue');
    const escrow = new PlayerInventoryEscrowStore(f.market), wallet = { count: () => 0, remove: () => 0, add: () => 0 };
    for (const operation of ['release', 'consume', 'commit'] as const) {
        const request = operation === 'commit' ? { operation, escrowId: f.intent.inputEscrowId, username: 'prodtest', payeeUsername: 'prodtest' }
            : { operation, escrowId: f.intent.inputEscrowId, username: 'prodtest' };
        expect(() => escrow.mutateWithCheckpoint(request, wallet, { owner: 'prodtest', save: () => f.player.save(false), rollback: () => {} })).toThrow('exact native WIP');
    }
    f.market.db.run('DELETE FROM player_inventory_escrow_business_binding');
    expect(escrow.verifySharedAuditChain()).toBe(false);
    expect(() => f.command('process')).toThrow('audit');
});
test('worker death and expired/revoked access keep input locked but allow proven unspent input recovery', () => {
    const f = kitchen(); f.prepare(); f.command('issue');
    f.advance('2001-01-01T00:11:00.000Z'); expect(() => f.command('process')).toThrow('entitlement');
    f.advance('2001-01-01T00:00:01.000Z'); f.player.populationTerminal = true; f.player.levels[PlayerStat.HITPOINTS] = 0;
    expect(() => f.command('process')).toThrow('not alive');
    f.work.revokeNativeKitchen(f.intent.runId);
    expect(f.command('return').phase).toBe('returned-input'); expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('cancelled');
    expect(f.inv.getItemCount(377)).toBe(0);
    const assets = new BusinessAssetStore(f.businessPath); try { expect(assets.listAssets('fish-kitchen', null).find(row => row.itemId === 377)!.count).toBe(1); }
    finally { assets.close(); }
});
test('lost suspended script restarts its native delay, never duplicates or frees input, then finishes forward', () => {
    const f = kitchen(); f.prepare(); f.command('issue'); const first = f.command('process');
    f.restart(); World.currentTick = first.wakeTick!; JavaRandom.setSeed(4096);
    const repeated = f.command('process'); expect(repeated.phase).toBe('waiting'); expect(repeated.wakeTick).toBeGreaterThan(first.wakeTick!);
    expect(f.inv.getItemCount(377)).toBe(0); World.currentTick = repeated.wakeTick!;
    const processed = f.command('process'); expect(processed.phase).toBe('processed'); f.restart(); expect(f.command('process')).toEqual(processed);
    f.command('return'); expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('completed');
});
test('native burn spends raw input and returns burnt output without cooked stock or successful WIP completion', () => {
    const f = kitchen(); f.prepare(); const result = processBatch(f, 0);
    expect(result.receipt!.outcome).toBe('burnt');
    expect(() => f.work.cancelReserved(f.intent.runId)).toThrow('physical custody');
    f.command('return'); expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('running');
    expect(f.work.nativeKitchen(f.intent.runId)!.phase).toBe('burnt');
    const assets = new BusinessAssetStore(f.businessPath);
    try { const inventory = assets.listAssets('fish-kitchen', null); expect(inventory.find(row => row.itemId === 377)!.count).toBe(0);
        expect(inventory.find(row => row.itemId === 379)).toBeUndefined(); expect(inventory.find(row => row.itemId === 381)!.count).toBe(1); }
    finally { assets.close(); }
});
test('checkpoint/escrow receipt failure rolls back native input, output, Player save and physical outcome together', () => {
    const f = kitchen(); f.prepare(); f.command('issue'); const waiting = f.command('process'); World.currentTick = waiting.wakeTick!;
    f.market.db.run("CREATE TRIGGER fail_kitchen BEFORE UPDATE ON native_food_production_actions WHEN NEW.receipt_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'kitchen receipt failure'); END");
    JavaRandom.setSeed(4096); expect(() => f.command('process')).toThrow('did not produce');
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
    const escrow = new PlayerInventoryEscrowStore(f.market); expect(escrow.get(f.intent.inputEscrowId)!.status).toBe('held'); expect(escrow.get(f.intent.outputEscrowId)).toBeNull();
    expect(new NativeFoodProductionStore(f.market.db).get(f.intent.actionId)).toBeNull();
    f.market.db.run('DROP TRIGGER fail_kitchen'); f.restart(); const next = f.command('process'); World.currentTick = next.wakeTick!;
    JavaRandom.setSeed(4096); expect(f.command('process').phase).toBe('processed');
});
test('Business finalize failure after native return preserves forward recovery and never recreates physical input', () => {
    const f = kitchen(); f.prepare(); processBatch(f); f.command('return');
    const db = new Database(f.businessPath); db.run("CREATE TRIGGER fail_finalize BEFORE INSERT ON business_production_step BEGIN SELECT RAISE(ABORT,'finalize fault'); END"); db.close(true);
    expect(() => f.work.settleNativeKitchen(f.intent.runId, f.results)).toThrow('finalize fault'); expect(f.work.get(f.intent.runId)!.status).toBe('reserved');
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
    const repair = new Database(f.businessPath); repair.run('DROP TRIGGER fail_finalize'); repair.close(true);
    expect(finalizePopulationKitchen({ workspace: f.dir, worldId: 'fixture-world', businessPath: f.businessPath, checkpointPath: f.path }, f.intent.runId).status).toBe('completed');
});
test('wrong worker/run/world and an edited native receipt cannot finalize another reservation', () => {
    const f = kitchen(); const binding = f.prepare(); processBatch(f); f.command('return');
    expect(() => f.results.snapshot(() => f.results.result({ ...binding, intent: { ...binding.intent, actorAgentId: 'other-worker' } }))).toThrow('binding');
    const foreign = new NativeKitchenResultSource({ workspace: f.dir, worldId: 'foreign-world', checkpointPath: f.path });
    try { expect(() => f.work.settleNativeKitchen(f.intent.runId, foreign)).toThrow('world'); } finally { foreign.close(); }
    f.market.db.run("UPDATE native_food_production_actions SET receipt_digest='forged' WHERE action_id=?1", [f.intent.actionId]);
    expect(() => f.work.settleNativeKitchen(f.intent.runId, f.results)).toThrow('audit');
});
test('partial/multiple batches and an untrusted source grant cannot create native custody', () => {
    const f = kitchen(), catalog = loadDefaultProductionWorkflowCatalog();
    const second = { ...f.intent, runId: 'other-run', actionId: randomUUID(), inputEscrowId: randomUUID(), outputEscrowId: randomUUID() };
    expect(() => f.work.reserveNativeKitchen({ ...f.reservation, runId: 'other-run', workflowId: 'food.cooked-shrimp',
        inputs: [{ itemId: 317, count: 1, storageId: null }] }, second, f.facilities, f.clock().simulationTime, () => true)).toThrow();
    expect(f.work.get('other-run')).toBeNull();
    f.intent.grant.subjectAgentId = 'other-worker'; expect(() => f.prepare()).toThrow('entitlement');
    expect(f.work.get(f.intent.runId)).toBeNull(); expect(catalog.recipes.some(recipe => recipe.recipeId === 'food.cook-lobster')).toBe(true);
});
test('ending the actual Business employment blocks new cooking, while output recovery survives death and expiry', () => {
    const f = kitchen('boss'); f.prepare(); f.command('issue');
    const manager = new BusinessManagerStore(f.businessPath); manager.endEmployment('fish-kitchen', f.employment!.employmentId, f.employment!.revision); manager.close();
    expect(() => f.command('process')).toThrow('role'); f.command('return');
    expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('cancelled');
    const g = kitchen(); g.prepare(); processBatch(g); g.player.populationTerminal = true; g.player.levels[PlayerStat.HITPOINTS] = 0;
    g.advance('2001-01-01T00:11:00.000Z'); g.work.revokeNativeKitchen(g.intent.runId); g.command('return');
    expect(g.work.settleNativeKitchen(g.intent.runId, g.results).status).toBe('completed'); expect(g.inv.getItemCount(379)).toBe(0);
});
test('lost native WIP projection cannot refund a committed physical custody through generic cancellation', () => {
    const f = kitchen(); f.prepare(); f.command('issue');
    const db = new Database(f.businessPath); db.run('DELETE FROM business_production_native_operation');
    db.run('DELETE FROM business_production_native_audit'); db.run('UPDATE business_production_native_head SET sequence=0,digest=NULL'); db.close(true);
    expect(() => f.work.cancelReserved(f.intent.runId)).toThrow('anchor'); expect(f.inv.getItemCount(377)).toBe(0);
});
test('failure after native XP and output settlement rolls back the complete Player state and receipt', () => {
    const f = kitchen(); f.prepare(); f.command('issue'); JavaRandom.setSeed(4096); const waiting = f.command('process');
    const stats = [...f.player.stats], base = [...f.player.baseLevels]; World.currentTick = waiting.wakeTick!;
    f.market.db.run("CREATE TRIGGER fail_final_kitchen BEFORE INSERT ON native_kitchen_audit WHEN json_extract(NEW.record_json,'$.phase')='processed' BEGIN SELECT RAISE(ABORT,'native final audit fault'); END");
    expect(() => f.command('process')).toThrow('native final audit fault');
    expect([...f.player.stats]).toEqual(stats); expect([...f.player.baseLevels]).toEqual(base);
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
    expect(new NativeFoodProductionStore(f.market.db).get(f.intent.actionId)).toBeNull();
    expect(new PlayerInventoryEscrowStore(f.market).get(f.intent.inputEscrowId)!.status).toBe('held');
});
test('internal API rejects unauthorized and caller-supplied assets, workers, receipts and custody bindings', async () => {
    const prior = process.env.ENGINE_ADMIN_TOKEN; process.env.ENGINE_ADMIN_TOKEN = 'isolated-kitchen-test-token';
    const url = new URL('http://localhost/api/internal/admin/native-kitchen');
    try {
        const unauthorized = await handleInternalAdminRequest(new Request(url, { method: 'POST', body: '{}' }), url);
        expect(unauthorized!.status).toBe(401);
        for (const extra of ['assets', 'username', 'receipt', 'businessBindingDigest']) {
            const response = await handleInternalAdminRequest(new Request(url, { method: 'POST', headers: { 'X-Engine-Admin-Token': process.env.ENGINE_ADMIN_TOKEN },
                body: JSON.stringify({ commandId: randomUUID(), operation: 'issue', runId: 'cook-run-1', [extra]: 'forbidden' }) }), url);
            expect(response!.status).toBe(400);
        }
    } finally { if (prior === undefined) delete process.env.ENGINE_ADMIN_TOKEN; else process.env.ENGINE_ADMIN_TOKEN = prior; }
});
test('ordinary worker storage-withdraw and inventory-receive permissions suffice without an inventory-issue grant', () => {
    const f = kitchen('boss', 'worker'), assets = new BusinessAssetStore(f.businessPath);
    try {
        assets.createStorage({ storageId: 'raw-bin', businessId: 'fish-kitchen', actorAgentId: 'boss', name: 'Raw food bin', capacityUnits: 10 });
        assets.move({ operationId: 'store-raw', businessId: 'fish-kitchen', actorAgentId: 'boss', itemId: 377, count: 1, sourceStorageId: null, targetStorageId: 'raw-bin' });
    } finally { assets.close(); }
    f.reservation.inputs[0]!.storageId = 'raw-bin'; f.prepare(); const result = processBatch(f);
    expect(readNativeFoodTransformation(f.path, result.receipt!.action, join(root, 'config/production-workflows.json'))).toMatchObject({ businessCustody: { businessId: 'fish-kitchen' } });
    f.command('return'); expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('completed');
});
test('two real concurrent reservation processes can reserve only the single available raw unit', async () => {
    const f = kitchen(); writeFileSync(join(f.dir, 'reserve.json'), JSON.stringify({ reservation: f.reservation, intent: f.intent }));
    const workers = ['a', 'b'].map(id => Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
        env: { ...process.env, KITCHEN_RESERVE_ROOT: f.dir, KITCHEN_RESERVE_ID: id }, stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(workers.map(async worker => {
        const [stdout, stderr, code] = await Promise.all([new Response(worker.stdout).text(), new Response(worker.stderr).text(), worker.exited]);
        if (code !== 0) throw new Error(`Concurrent kitchen worker failed: ${stderr}`); return stdout;
    }));
    expect(results.filter(result => result.includes('KITCHEN_RESERVED'))).toHaveLength(1);
    expect(results.filter(result => result.includes('KITCHEN_REJECTED'))).toHaveLength(1);
    expect([f.work.nativeKitchen('cook-a'), f.work.nativeKitchen('cook-b')].filter(Boolean)).toHaveLength(1);
}, 20000);
for (const operation of ['issue', 'return'] as const) for (const phase of ['before-commit', 'after-commit'] as const)
test(`process kill ${operation} ${phase} preserves one owner and one recoverable custody`, async () => {
    const f = kitchen(); f.prepare(); if (operation === 'return') processBatch(f);
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], { cwd: process.cwd(),
        env: { ...process.env, KITCHEN_CRASH_ROOT: f.dir, KITCHEN_CRASH_OPERATION: operation, KITCHEN_CRASH_PHASE: phase }, stdout: 'pipe', stderr: 'pipe' });
    const stderr = new Response(child.stderr).text(), reader = child.stdout.getReader(); let output = '', timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([(async () => { while (!output.includes('KITCHEN_CRASH_BOUNDARY')) {
            const next = await reader.read(); if (next.done) throw new Error(`Kitchen crash worker exited: ${await stderr}`);
            output += new TextDecoder().decode(next.value);
        } })(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Kitchen crash boundary timed out')), 15000); })]);
    } finally { if (timeout) clearTimeout(timeout); child.kill(); await child.exited; await reader.cancel(); }
    const record = f.command(operation), escrow = new PlayerInventoryEscrowStore(f.market);
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
    if (operation === 'issue') { expect(record.phase).toBe('issued'); expect(escrow.get(f.intent.inputEscrowId)!.status).toBe('held'); }
    else { expect(record.phase).toBe('returned-output'); expect(escrow.get(f.intent.outputEscrowId)!.status).toBe('committed');
        expect(f.work.settleNativeKitchen(f.intent.runId, f.results).status).toBe('completed'); }
    expect(f.command(operation)).toEqual(record); expect(escrow.verifySharedAuditChain()).toBe(true);
}, 25000);
