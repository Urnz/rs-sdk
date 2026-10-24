import World from '../engine/World.js';
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
import { MarketStore } from '../engine/market/MarketStore.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import JavaRandom from '../util/JavaRandom.js';
import { foodDigest, FOOD_POLICY, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore, LOBSTER, validateFoodProductionAction } from './NativeFoodProductionStore.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import type { NativeFoodProductionPorts } from './NativeFoodProduction.js';
import { BusinessManagerStore } from '../../../gateway/admin/business-manager.js';
import { ProductionWorkInProgressStore, type ReserveProductionRun } from '../../../../production-workflow/wip-store.js';
import { loadDefaultProductionWorkflowCatalog } from '../../../../production-workflow/catalog.js';
import { loadNativeKitchenPolicy } from '../../../../production-workflow/native-kitchen-policy.js';
import { loadFacilityCapabilityCatalog } from '../../../../facility-capability/catalog.js';
import { NativeKitchenExecutor } from './NativeKitchen.js';
import { NativeKitchenReservationSource, NativeKitchenResultSource } from '../../../../production-workflow/native-kitchen-source.js';
import type { NativeKitchenIntent } from '../../../../production-workflow/native-kitchen-wip.js';
import { executeNativeFoodSkill } from './NativeFoodSkill.js';
import { executeFoodSkillRequest, foodSkillActionId, foodSkillCheckpointPath, verifyFoodSkillRunSources, type NativeFoodSkillOptions } from '../../../gateway/admin/native-food-skills.js';
import { validateSkillDefinition } from '../../../../agent-skills/validation.js';
import { BotSDK } from '../../../../sdk/index.js';
import type { SocietyFoodRequest } from '../../../../sdk/society-food.js';
import type { SkillRuntimeAuthorization } from '../../../../agent-skills/types.js';

const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], stores: MarketStore[] = [];
function loadPackedContent() {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
}
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
function kitchen(owner = 'actor-prodtest', role: 'manager' | 'worker' = 'manager', directory?: string) {
    const f = fixture(2, directory ? join(directory, 'checkpoints.sqlite') : undefined);
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

const grant: SkillRuntimeAuthorization = { operations: ['food-gather', 'food-cook', 'food-consume', 'walk-to'],
    itemNames: ['raw lobster', 'lobster'], partners: [], maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0 };
function request(operation: SocietyFoodRequest['operation'], overrides: Record<string, unknown> = {}): SocietyFoodRequest {
    const args = operation === 'food-gather' ? { item: 'Raw lobster', itemId: 377, amount: 1, sourceId: 'musa-point-lobster', timeoutMs: 1000 }
        : operation === 'food-consume' ? { item: 'Lobster', itemId: 379, amount: 1, slot: 1, timeoutMs: 1000 }
        : { item: 'Raw lobster', itemId: 377, amount: 1, kitchenRunId: 'cook-run-1', batchId: 'cook-batch-1', heatX: 2926, heatZ: 3180, timeoutMs: 1000 };
    return { operation, args: { ...args, ...overrides }, context: { runId: randomUUID(), skill: { id: 'procedure.food.test', version: '0.1.0' },
        stepId: 'food', parametersDigest: 'b'.repeat(64) } };
}
function options(f: ReturnType<typeof kitchen>): NativeFoodSkillOptions {
    const engine = new NativeKitchenExecutor({ ...f.ports, source: f.source, clock: f.clock, heat: () => f.heat });
    return { workspace: f.dir, worldId: 'fixture-world', checkpointPath: f.path, businessPath: f.businessPath,
        binding: username => ({ worldId: 'fixture-world', actorId: 'actor-prodtest', playerId: username, lifecycleId: 'fixture-lifecycle',
            clockId: 'fixture-clock', clockProfileDigest: 'a'.repeat(64), worldProfileDigest: 'c'.repeat(64), lifecyclePolicyDigest: 'd'.repeat(64) }),
        dispatch: async command => { executeNativeFoodSkill(command, f.player, f.ports, f.npc); if (command.operation === 'gather') World.currentTick++; },
        kitchen: async command => { const row = engine.execute(command, f.player); if (row.wakeTick) World.currentTick = row.wakeTick;
            return { ok: true, record: row }; } };
}
async function sdkHarness(f: ReturnType<typeof kitchen>, run: (sdk: BotSDK) => Promise<void>) {
    const opts = options(f);
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
        fetch(req, server) { if (server.upgrade(req)) return; return new Response(null, { status: 404 }); },
        websocket: { async message(ws, raw) {
            const message = JSON.parse(String(raw));
            if (message.type === 'sdk_connect') { ws.send(JSON.stringify({ type: 'sdk_connected', success: true, mode: 'control' })); return; }
            if (message.type !== 'sdk_action') return;
            let result;
            try { result = await executeFoodSkillRequest(opts, 'prodtest', message.action.request); }
            catch (error) { result = { success: false, message: String(error), reason: 'food-source-rejected' }; }
            ws.send(JSON.stringify({ type: 'sdk_action_result', actionId: message.actionId, result }));
        } } });
    const sdk = new BotSDK({ botUsername: 'prodtest', gatewayUrl: `ws://127.0.0.1:${server.port}`, autoLaunchBrowser: false,
        autoReconnect: false, readyTimeout: 0, actionTimeout: 3000 });
    try { await sdk.connect(); await run(sdk); } finally { await sdk.disconnect(); await server.stop(true); }
}
function definition(name: string) {
    return validateSkillDefinition(JSON.parse(readFileSync(join(root, `agent-skills/catalog/procedure.food.${name}-lobster@0.1.0.skill.json`), 'utf8')));
}

export { root, loadPackedContent, fixture, kitchen, grant, request, options, sdkHarness, definition, closers };
export function closeNativeFoodFixtures() { for (const close of closers.splice(0).reverse()) close(); for (const store of stores.splice(0)) store.db.close(true); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); }
export function retainNativeFoodFixture(dir: string) { const index = dirs.indexOf(dir); if (index < 0) throw new Error("Unknown fixture"); dirs.splice(index, 1); }
