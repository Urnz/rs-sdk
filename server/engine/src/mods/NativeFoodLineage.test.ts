import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
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
import { foodDigest, FOOD_POLICY, NativeFoodConsumptionStore, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore, LOBSTER, validateFoodProductionAction } from './NativeFoodProductionStore.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import type { NativeFoodProductionPorts } from './NativeFoodProduction.js';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { readNativeFoodProductionSource } from '../../../gateway/admin/native-food-production-source.js';
import { readNativeFoodTransformation } from '../../../../item-transformation/native-food.js';
import { captureFoodTrade, commitFoodTrade } from './NativeFoodTrade.js';
import { TradeEvidenceStore } from './TradeEvidenceStore.js';
import { readFoodLineage } from './NativeFoodLineageStore.js';
import { projectFoodLineage } from '../../../../food-loop/lineage.js';
import { NativeFoodSource } from '../../../../food-loop/native-source.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import { FoodNeedsPersistence } from '../../../../food-loop/needs-persistence.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../../../../needs/config.js';
import { loadFoodLoopCatalog } from '../../../../food-loop/catalog.js';
import { readPopulationFoodLineage } from '../../../gateway/admin/needs-runtime.js';
import type { NeedsBinding } from '../../../../needs/store.js';
import { ItemProvenanceStore } from '../../../../item-provenance/store.js';
import { loadItemStatePolicyCatalog } from '../../../../item-lifecycle/classification.js';
import { loadItemProvenancePolicyCatalog } from '../../../../item-provenance/policy.js';
import { loadItemLifecycleCatalog } from '../../../../item-lifecycle/catalog.js';
import type { ThievingOutcomeReceipt } from '../../../../thieving-procedures/types.js';
import { SocietyIntegrityStore, saveValueSnapshot } from '../../../../society-integrity/store.js';
import { withSocietyValueMutation } from '../../../../society-integrity/runtime.js';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog } from '../../../../world-genesis/index.js';
import { appendFoodLineage } from './NativeFoodLineageStore.js';
import { recordNativeFoodOpening } from './NativeFoodOpening.js';
import InvOps from '../engine/script/handlers/InvOps.js';
import { ScriptOpcode } from '../engine/script/ScriptOpcode.js';
import ScriptPointer from '../engine/script/ScriptPointer.js';

const root = resolve(import.meta.dir, '../../../..'), pack = resolve(import.meta.dir, '../../data/pack');
const dirs: string[] = [], stores: MarketStore[] = [];
function loadPackedContent() {
    for (const type of [InvType, ObjType, NpcType, LocType, VarPlayerType, VarNpcType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack); FontType.load(pack);
}
beforeAll(loadPackedContent);
afterEach(() => { for (const store of stores.splice(0)) store.db.close(true);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(quantity = 4, databasePath?: string, username = 'prodtest') {
    const dir = databasePath ? dirname(databasePath) : mkdtempSync(join(tmpdir(), 'native-production-')); dirs.push(dir);
    const path = databasePath ?? join(dir, 'checkpoints.sqlite'), market = new MarketStore(path); stores.push(market);
    const player = new Player(username, 2n, 2n); player.x = 2925; player.z = 3180;
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
        action: { actionId, worldId: 'fixture-world', actorId: `actor-${username}`, username, lifecycleId: 'fixture-lifecycle',
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

function trio() {
    const a = fixture(4, undefined, 'gatherer'), b = fixture(4, a.path, 'chef'), c = fixture(4, a.path, 'eater');
    const tradePath = join(a.dir, 'trades.sqlite');
    new NativeFoodConsumptionStore(a.market);
    new TradeEvidenceStore(tradePath).close();
    const offer = InvType.getId('tradeoffer');
    const move = (from: typeof a, to: typeof a, item: number, quantity: number) => {
        expect(from.player.invDel(InvType.INV, item, quantity)).toBe(quantity);
        expect(from.player.invAdd(offer, item, quantity)).toBe(quantity);
        const witness = captureFoodTrade(from.player, to.player, offer, a.identity);
        expect(from.player.invDel(offer, item, quantity)).toBe(quantity);
        expect(to.player.invAdd(InvType.INV, item, quantity)).toBe(quantity);
        const tradeStore = new TradeEvidenceStore(tradePath);
        let trade;
        try { trade = tradeStore.record({ tick: World.currentTick, fromUsername: from.player.username, toUsername: to.player.username,
            fromItems: [{ id: item, name: null, count: quantity }], toItems: [], fromValue: 0, toValue: 0, committedAt: new Date().toISOString() }); }
        finally { tradeStore.close(); }
        commitFoodTrade(witness, trade, from.player, to.player, offer, a.market, () => {});
        return trade;
    };
    const eat = (who = c) => {
        const context = who.identity(who.player.username, randomUUID(), who.inv.items.findIndex(item => item?.id === 379), World.currentTick)!;
        who.player.setVar(VarPlayerType.getId('eat_delay'), 0); who.player.delayed = false;
        const result = executeNativeFoodAction(who.market, who.player, context,
            save => who.market.checkpoint(who.player.username, save, true), who.identity);
        closeFoodDeliveryTick(who.market.db, context.clock);
        return { context, result };
    };
    const view = () => {
        const source = new NativeFoodSource({ workspace: a.dir, worldId: 'fixture-world', checkpointPath: a.path });
        try { return source.snapshot(() => source.lineage(tradePath)); } finally { source.close(); }
    };
    return { a, b, c, move, eat, view, tradePath };
}

test('A gathers, B cooks, C eats: partial transfers conserve four units and only C gets one relief', () => {
    const f = trio(); for (let i = 0; i < 4; i++) f.a.gather();
    f.move(f.a, f.b, 377, 3); f.b.cook(); f.b.cook();
    f.move(f.b, f.c, 379, 2); const { context, result } = f.eat();
    expect(result.outcome).toBe('consumed');
    const view = f.view(); expect(view.projection).not.toBeNull();
    expect(view.projection).toMatchObject({ produced: 4, transformed: 2, transferred: 5, consumed: 1, sourceGaps: [], gaps: [] });
    expect(view.projection!.consumptions[0]).toMatchObject({ origin: 'internal', internalSupply: 'verified',
        gatherers: ['actor-gatherer'], cooks: ['actor-chef'], consumer: { actorId: 'actor-eater' }, quantity: 1 });
    const config = join(f.a.dir, 'config'); mkdirSync(config);
    for (const name of ['needs-policies.json', 'needs-dynamics-policies.json', 'food-loops.json']) copyFileSync(join(root, 'config', name), join(config, name));
    const domainPath = join(f.a.dir, '.local/simulation/food-needs.sqlite');
    const policy = loadNeedsPolicyCatalog(join(config, 'needs-policies.json')).policies[0]!,
        dynamics = loadNeedsDynamicsPolicyCatalog(join(config, 'needs-dynamics-policies.json'), policy).policies[0]!,
        persistence = new FoodNeedsPersistence(domainPath, policy, dynamics, loadFoodLoopCatalog(join(config, 'food-loops.json')));
    const binding: NeedsBinding = { worldId: 'fixture-world', actorId: 'actor-eater', playerId: 'eater', lifecycleId: 'fixture-lifecycle',
        clockId: 'fixture-clock', clockProfileDigest: 'a'.repeat(64), worldProfileDigest: 'b'.repeat(64), lifecyclePolicyDigest: 'c'.repeat(64) };
    const source = new NativeFoodSource({ workspace: f.a.dir, worldId: binding.worldId, checkpointPath: f.a.path });
    try {
        const initial = { ...context.clock, simulationTime: '2000-12-31T14:00:01.000Z', wallTime: '2026-10-18T02:00:00.000Z' };
        persistence.needs.initialize({ binding, clock: initial, history: [], playerTime: null,
            admission: { kind: 'genesis', evidenceId: 'lineage-genesis', evidenceDigest: 'd'.repeat(64) } });
        const input = { binding, clock: context.clock, history: [], playerTime: null, expectedRevision: 1 };
        const event = persistence.nativeFood.apply(source, 1, input);
        expect(event.hungerRelief).toBe(1800); expect(persistence.nativeFood.apply(source, 1, input)).toEqual(event);
        expect(persistence.nativeFood.list()).toHaveLength(1);
        expect(persistence.needs.get({ ...binding, actorId: 'actor-chef', playerId: 'chef' })).toBeNull();
        const joined = readPopulationFoodLineage({ workspace: f.a.dir, worldId: binding.worldId, configDirectory: config,
            databasePath: domainPath, nativeFoodCheckpointPath: f.a.path, nativeFoodTradePath: f.tradePath });
        expect(joined.consumptions![0]).toMatchObject({ actorId: 'actor-eater', hungerRelief: 1800, internalSupply: 'verified' });
    } finally { source.close(); persistence.close(); }
    const q = Object.values(view.projection!.pools).reduce((sum, pool) => sum + pool.quantity, 0);
    expect(q + view.projection!.consumed).toBe(4);
    expect(f.a.inv.getItemCount(377)).toBe(1); expect(f.b.inv.getItemCount(377)).toBe(1); expect(f.c.inv.getItemCount(379)).toBe(1);
});

test('split cooked batches survive multiple trades, replay and reopen without new production or consumption', () => {
    const f = trio(); for (let i = 0; i < 3; i++) f.a.gather(); f.move(f.a, f.b, 377, 3);
    for (let i = 0; i < 3; i++) f.b.cook(); f.move(f.b, f.c, 379, 2); f.eat();
    f.move(f.c, f.a, 379, 1); f.eat(f.a);
    const first = f.view(); expect(first.projection).toMatchObject({ produced: 3, transformed: 3, consumed: 2, transferred: 6 });
    expect(first.projection!.consumptions.every(item => item.internalSupply === 'verified')).toBe(true);
    expect(f.view()).toEqual(first);
    const reopened = new MarketStore(f.a.path); try { expect(projectFoodLineage(readFoodLineage(reopened.db)).consumed).toBe(2); }
    finally { (reopened.db as typeof reopened.db & { clearQueryCache(): void }).clearQueryCache(); reopened.db.close(true); }
    expect(() => f.move(f.c, f.a, 379, 1)).toThrow();
});

test('unknown opening food remains physiological evidence without invented internal ancestry', () => {
    const f = trio(); f.c.inv.add(379, 2); f.eat(); const view = f.view().projection!;
    expect(view.consumptions[0]).toMatchObject({ origin: 'unknown', internalSupply: 'unproven', gatherers: [], cooks: [] });
    expect(view.produced).toBe(0); expect(view.gaps).toHaveLength(1);
});

test('mixing unknown raw with native raw cannot manufacture a clean internal unit by FIFO', () => {
    const f = trio(); f.a.inv.add(377, 1); f.a.gather(); f.move(f.a, f.b, 377, 2); f.b.cook(); f.move(f.b, f.c, 379, 1); f.eat();
    expect(f.view().projection!.consumptions[0]).toMatchObject({ origin: 'mixed', internalSupply: 'unproven' });
});

test('missing trade source fails closed and a missing witness cannot claim internal supply', () => {
    const f = trio(); f.a.gather(); f.move(f.a, f.b, 377, 1); f.b.cook(); f.move(f.b, f.c, 379, 1); f.eat();
    const native = new TradeEvidenceStore(f.tradePath); native.record({ tick: 100, fromUsername: 'other', toUsername: 'another',
        fromItems: [{ id: 377, name: null, count: 1 }], toItems: [], fromValue: 0, toValue: 0, committedAt: new Date().toISOString() }); native.close();
    expect(f.view().projection!.consumptions[0]!.internalSupply).toBe('unproven');
    f.a.market.db.run("UPDATE native_food_lineage SET entry_json=replace(entry_json,'gatherer','forged') WHERE sequence=1");
    expect(() => f.view()).toThrow('audit mismatch');
});

test('journal append failure rolls back the physical production checkpoint and quota', () => {
    const f = trio(); f.a.gather();
    f.a.market.db.run("CREATE TRIGGER fail_lineage BEFORE INSERT ON native_food_lineage BEGIN SELECT RAISE(ABORT,'lineage fault'); END");
    expect(f.a.gather().execution).toBe(ScriptState.ABORTED);
    expect(f.a.inv.getItemCount(377)).toBe(1); expect(readFoodLineage(f.a.market.db).entries).toHaveLength(1);
    f.a.market.db.run('DROP TRIGGER fail_lineage'); f.a.gather(); expect(f.view().projection!.produced).toBe(2);
});

test('existing provenance theft blocks internal eligibility through native cook and transfer ancestry', () => {
    const f = trio(); const receipt = f.a.receipt(f.a.gather())!;
    const lifecycle = loadItemLifecycleCatalog(join(root, 'config/item-lifecycle.json'));
    const state = loadItemStatePolicyCatalog(join(root, 'config/item-state-policies.json'), lifecycle);
    const policy = loadItemProvenancePolicyCatalog(join(root, 'config/item-provenance-policies.json'), state);
    const path = join(f.a.dir, 'provenance.sqlite'), provenance = new ItemProvenanceStore(path, policy);
    const at = '2026-10-18T12:00:00.000Z';
    try {
        provenance.register({ eventId: 'food-catch', assetId: 'raw-food-lot', itemId: 377, quantity: 1,
            titleOwner: { kind: 'agent', id: 'victim' }, holder: { kind: 'agent', id: 'victim' },
            evidence: { evidenceId: 'native-food-catch', sourceDomain: 'item-lifecycle', sourceRecordId: receipt.action.actionId,
                sourceStateVersion: 1, sourceEvidenceDigest: foodDigest(receipt), occurredAt: at } }, () => true, at);
        const theft: ThievingOutcomeReceipt = { receiptId: 'theft-food', evidenceId: 'engine-theft', procedureId: 'container.theft', procedureVersion: '1.0.0',
            procedureKind: 'container-theft', actorAgentId: 'actor-gatherer', playerUsername: 'gatherer',
            target: { kind: 'loc', typeId: 1, instanceIndex: null, name: 'Crate', x: 1, z: 1, level: 0 },
            result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId: 377, itemName: 'Raw lobster', quantity: 1 }],
            thievingXpDelta: 5, startedAtEngineTick: 1, endedAtEngineTick: 2, sourceEventId: 'engine-theft-food', sourceEvidenceDigest: 'b'.repeat(64),
            occurredAt: at, receiptDigest: 'c'.repeat(64), recordedAt: at };
        provenance.recordTheft({ eventId: 'stolen-food', claimId: null, assetId: 'raw-food-lot', expectedRevision: 1,
            itemId: 377, quantity: 1, titleOwner: { kind: 'agent', id: 'victim' }, previousHolder: { kind: 'agent', id: 'victim' },
            thiefAgentId: 'actor-gatherer', unitValueCoins: null }, theft, () => true, at);
        f.move(f.a, f.b, 377, 1); f.b.cook(); f.move(f.b, f.c, 379, 1); f.eat();
        const source = new NativeFoodSource({ workspace: f.a.dir, worldId: 'fixture-world', checkpointPath: f.a.path });
        try { source.snapshot(() => expect(source.lineage(f.tradePath, provenance).projection!.consumptions[0]).toMatchObject({
            origin: 'internal', provenanceGate: 'stolen', internalSupply: 'unproven', cleanTitleFinding: 'not-established' })); }
        finally { source.close(); }
    } finally { provenance.close(); }
    const readonly = new ItemProvenanceStore(path, policy, true);
    try { expect(readonly.foodSourceGate([{ sourceRecordId: receipt.action.actionId, sourceEvidenceDigest: foodDigest(receipt) }])).toBe('stolen'); }
    finally { readonly.close(); }
});

test('real single-use genesis and runtime injection proofs keep bootstrap/import separate from internal production', () => {
    const f = trio(), directory = join(f.a.dir, '.local/simulation'); mkdirSync(directory, { recursive: true });
    const path = join(directory, 'society-integrity.sqlite');
    const profile = loadWorldGenesisProfileCatalog(join(root, 'config/world-genesis-profiles.json')).profiles.find(p => p.profileId === 'mature-society')!;
    const configuration = buildWorldGenesisConfiguration({ seed: 'food-origin', profile, worldBuild: 'local',
        simulationClock: { clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), initialSimulationTime: '2001-01-01T00:00:00.000Z' } });
    const result = buildWorldGenesisResult(configuration, { assets: [{ allocationId: 'starter-lobster', kind: 'item',
        owner: { kind: 'player', id: 'eater' }, container: 'inventory', itemId: 379, count: 1, slot: null }] }, '2026-10-18T12:00:00.000Z');
    const before = { coins: 0, skills: [], inventory: [], bank: [], equipment: [], position: { x: 1, z: 1, level: 0 } };
    const after = { ...before, inventory: [{ id: 379, count: 1 }] };
    const mutation = { source: 'engine.offline-save' as const, operationId: `offline-save:${randomUUID()}`, actor: 'player:eater',
        payload: { before: saveValueSnapshot(before), after: saveValueSnapshot(after) } };
    const integrity = new SocietyIntegrityStore(path); integrity.begin(result, true); integrity.authorize(result.resultId, mutation); integrity.close();
    const boundary = { path, observe: () => ({ clockId: 'fixture-clock', profileDigest: 'a'.repeat(64), simulationTime: '2001-01-01T00:00:00.000Z', wallTime: '2026-10-18T12:00:00.000Z' }) };
    const opening = (input: typeof mutation) => {
        const prior = PlayerLoading.load('eater', new Packet(f.c.player.save(false)), null);
        withSocietyValueMutation(input, () => { f.c.inv.add(379, 1); }, boundary);
        recordNativeFoodOpening(input, prior, f.c.player, f.c.player.save(false), { market: f.c.market, identity: f.c.identity, integrityPath: path });
    };
    opening(mutation); f.eat();
    const finish = new SocietyIntegrityStore(path); finish.finishBootstrap(result.resultId); finish.close();
    opening({ ...mutation, operationId: `offline-save:${randomUUID()}` }); f.eat();
    const view = f.view().projection!;
    expect(view.consumptions.map(item => item.origin)).toEqual(['bootstrap', 'import']);
    expect(view.consumptions.every(item => item.internalSupply === 'unproven')).toBe(true); expect(view.produced).toBe(0);
});

test('real BOTH_MOVEINV opcode journals only after both offer movements and includes offered food in custody', () => {
    const f = trio(), state = f.a.gather(), offer = InvType.getId('tradeoffer');
    f.a.player.invDel(InvType.INV, 377, 1); f.a.player.invAdd(offer, 377, 1);
    state._activePlayer = f.a.player; state._activePlayer2 = f.b.player;
    for (const pointer of [ScriptPointer.ActivePlayer, ScriptPointer.ActivePlayer2, ScriptPointer.ProtectedActivePlayer, ScriptPointer.ProtectedActivePlayer2]) state.pointerAdd(pointer);
    let operand = 0; Object.defineProperty(state, 'intOperand', { get: () => operand });
    state.nativeFoodTradePorts = { market: f.a.market, identity: f.a.identity, checkpoint: () => {}, record: entry => {
        const store = new TradeEvidenceStore(f.tradePath);
        try { return store.record({ tick: entry.tick, fromUsername: entry.from, toUsername: entry.to, fromItems: entry.fromItems,
            toItems: entry.toItems, fromValue: entry.fromValue, toValue: entry.toValue, committedAt: new Date().toISOString() }); }
        finally { store.close(); }
    } };
    const move = InvOps[ScriptOpcode.BOTH_MOVEINV]!;
    state.pushInt(offer); state.pushInt(InvType.INV); move(state);
    expect(readFoodLineage(f.a.market.db).entries).toHaveLength(1);
    operand = 1; state.pushInt(offer); state.pushInt(InvType.INV); move(state);
    const journal = readFoodLineage(f.a.market.db); expect(journal.entries).toHaveLength(2);
    expect(projectFoodLineage(journal)).toMatchObject({ produced: 1, transferred: 1, consumed: 0, gaps: [] });
    expect(f.b.inv.getItemCount(377)).toBe(1);
    expect(PlayerLoading.load('chef', new Packet(f.a.market.saved('chef')!), null).getInventory(InvType.INV)!.getItemCount(377)).toBe(1);
});

test('transfer checkpoint failure leaves a source gap instead of a fictitious internal transfer', () => {
    const f = trio(); f.a.gather();
    f.a.market.db.run("CREATE TRIGGER fail_trade_lineage BEFORE INSERT ON native_food_lineage WHEN NEW.source_key LIKE 'trade:%' BEGIN SELECT RAISE(ABORT,'trade lineage fault'); END");
    expect(() => f.move(f.a, f.b, 377, 1)).toThrow('trade lineage fault');
    expect(readFoodLineage(f.a.market.db).entries).toHaveLength(1);
    expect(PlayerLoading.load('chef', new Packet(f.a.market.saved('chef')!), null).getInventory(InvType.INV)!.getItemCount(377)).toBe(0);
    f.a.market.db.run('DROP TRIGGER fail_trade_lineage'); f.b.cook(); f.move(f.b, f.c, 379, 1); f.eat();
    expect(f.view().projection!.consumptions[0]!.internalSupply).toBe('unproven');
});

test('journal tail truncation and external world paths fail closed', () => {
    const f = trio(); f.a.gather(); f.move(f.a, f.b, 377, 1);
    const source = new NativeFoodSource({ workspace: f.a.dir, worldId: 'fixture-world', checkpointPath: f.a.path });
    try { expect(() => source.snapshot(() => source.lineage(join(f.a.dir, '../other-world/trades.sqlite')))).toThrow('escapes'); }
    finally { source.close(); }
    f.a.market.db.run('DELETE FROM native_food_lineage WHERE sequence=2'); expect(() => f.view()).toThrow('tail differs');
});
