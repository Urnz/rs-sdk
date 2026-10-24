import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import InvType from '../cache/config/InvType.js';
import LocType from '../cache/config/LocType.js';
import ObjType from '../cache/config/ObjType.js';
import type Player from '../engine/entity/Player.js';
import type ScriptState from '../engine/script/ScriptState.js';
import World from '../engine/World.js';
import { playerSaveStore, type MarketStore } from '../engine/market/MarketStore.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import type { NativeFoodContext } from './NativeFoodConsumptionStore.js';
import type { EngineTradeEvidence } from './TradeEvidenceStore.js';
import { NativeToolStore, NATIVE_PICKAXE, nativeToolCatalog, nativeToolCycles, nativeToolDigest,
    type NativeToolBinding, type NativeToolOwner } from '../../../../item-lifecycle/native-tool.js';

export interface NativeMiningPorts { market: MarketStore; identity: typeof populationFoodContext; checkpoint(players: Player[]): void }
type Position = NativeToolBinding['position'];
type Token = { reference: {id:number;count:number}; position: Position };
const tokens = new WeakMap<Player, Token>();
const rocks: Record<string, number> = { copperrock1: 436, copperrock2: 436, tinrock1: 438, tinrock2: 438 };
function ports(player: Player): NativeMiningPorts | null {
    if (player.nativeMiningPorts) return player.nativeMiningPorts;
    const market = playerSaveStore();
    return market ? { market, identity: populationFoodContext,
        checkpoint: players => { for (const player of players) World.checkpointPlayers(player); } } : null;
}
function storeFor(player: Player): { ports: NativeMiningPorts; store: NativeToolStore } | null {
    const p = ports(player);
    return p && NativeToolStore.present(p.market.db) ? { ports: p, store: new NativeToolStore(p.market.db) } : null;
}
function owner(context: NativeFoodContext): NativeToolOwner {
    const { actorId, username, lifecycleId, worldId, clockId, clockProfileDigest } = context.action;
    if (context.clock.status !== 'running' || context.clock.clockId !== clockId || context.clock.profileDigest !== clockProfileDigest)
        throw new Error('Native mining clock is unavailable or stale');
    return { actorId, username, lifecycleId, worldId, clockId, clockProfileDigest };
}
function positions(player: Player): Token[] {
    const found: Token[] = [];
    for (const [inventory, inv] of player.invs) for (let slot = 0; slot < inv.capacity; slot++) {
        const reference = inv.get(slot);
        if (reference?.id === NATIVE_PICKAXE) found.push({ reference, position: { inventory, slot } });
    }
    return found;
}
function token(player: Player): Token {
    const anchored = tokens.get(player), found = positions(player);
    if (!anchored || found.length !== 1 || found[0]!.reference !== anchored.reference || anchored.reference.count !== 1)
        throw new Error('Mining tool identity is ambiguous/unwitnessed; explicit reconciliation required');
    return found[0]!;
}
function identity(player: Player, p: NativeMiningPorts, binding: NativeToolBinding, actionId: string) {
    const context = p.identity(player.username, actionId, binding.position.slot, World.currentTick);
    if (!context || nativeToolDigest(owner(context)) !== nativeToolDigest(binding.owner) || binding.status !== 'bound')
        throw new Error('Native mining owner/lifecycle is unavailable or quarantined');
    if (player.populationTerminal) throw new Error('Terminal avatar cannot use or transfer a mining tool');
    return context;
}

/** Explicit existing-instance opening. No stack lookup ever creates a fresh lifecycle instance. */
export function bindNativeMiningTool(player: Player, itemInstanceId: string, evidenceDigest: string, p: NativeMiningPorts): void {
    if (!/^[0-9a-f]{64}$/.test(evidenceDigest)) throw new Error('Native mining opening evidence is invalid');
    const store = new NativeToolStore(p.market.db), item = store.lifecycle.get(itemInstanceId), found = positions(player);
    const context = p.identity(player.username, randomUUID(), 0, World.currentTick);
    if (!context || !item || item.itemId !== NATIVE_PICKAXE || item.ownerActorId !== context.action.actorId
        || found.length !== 1 || found[0]!.reference.count !== 1) throw new Error('Explicit native tool opening does not match the existing instance');
    if (store.binding(player.username) || p.market.db.query('SELECT 1 FROM native_tool_binding WHERE instance_id=?').get(itemInstanceId))
        throw new Error('Native tool is already bound; no implicit reset/rebinding');
    const current = found[0]!;
    tokens.set(player, current);
    try {
        p.market.db.transaction(() => {
            const save = player.save(false);
            store.put({ schemaVersion: 1, itemInstanceId, owner: owner(context), position: current.position,
                status: 'bound', reason: null, catalogDigest: nativeToolCatalog.digest, cycleDigest: nativeToolCycles.digest,
                checkpointDigest: nativeToolDigest([...save]) });
            store.append(`opening:${itemInstanceId}`, { kind: 'explicit-opening', itemInstanceId, item, owner: owner(context), evidenceDigest });
            p.checkpoint([player]); p.market.checkpoint(player.username, save, true);
        }).immediate();
    } catch (error) { tokens.delete(player); throw error; }
}

/** Called on verified Player-load, before any script can replace the physical object. */
export function hydrateNativeMiningTool(player: Player): void {
    const runtime = storeFor(player), binding = runtime?.store.binding(player.username);
    if (!runtime || !binding || binding.status !== 'bound') return;
    const saved = runtime.ports.market.saved(player.username), reference = player.getInventory(binding.position.inventory)?.get(binding.position.slot);
    if (saved && nativeToolDigest([...saved]) === binding.checkpointDigest && reference?.id === NATIVE_PICKAXE && reference.count === 1
        && positions(player).length === 1) tokens.set(player, { reference, position: binding.position });
}

/** Any unsupported loss/replacement becomes durable quarantine, never a guessed physical identity. */
export function checkpointNativeMiningTool(player: Player, save: Uint8Array, authority?: Database): void {
    const runtime = storeFor(player), binding = runtime?.store.binding(player.username);
    if (!runtime || !binding) return;
    if (authority && runtime.ports.market.db !== authority) throw new Error('Native tool checkpoint authority mismatch');
    let position = binding.position, status = binding.status, reason = binding.reason;
    if (status === 'bound') {
        try { position = token(player).position; }
        catch { status = 'quarantined'; reason = 'unwitnessed-native-item-movement'; }
    }
    runtime.store.put({ ...binding, position, status, reason, checkpointDigest: nativeToolDigest([...save]) });
}

/** Only the native move opcodes may reconstruct a token inside the same avatar. */
export function captureNativeMiningMove(player: Player): (() => void) | null {
    const runtime = storeFor(player), binding = runtime?.store.binding(player.username);
    if (!binding || binding.status !== 'bound') return null;
    token(player);
    return () => {
        const found = positions(player);
        if (found.length === 1 && found[0]!.reference.count === 1) tokens.set(player, found[0]!);
        else tokens.delete(player); // No reassignment from an ambiguous merge/overflow.
    };
}

export function prepareNativeMining(state: ScriptState): void {
    if (!state._activePlayer) return;
    if (!/^\[oploc[13],(?:_mining_rock_[a-z_]+|blankrunestone|gemrock)\]$/.test(state.script.name) && !state.nativeMiningActionId) return;
    const player = state._activePlayer, p = ports(player);
    if (!p) return;
    const id = state.nativeMiningActionId ??= randomUUID();
    if (NativeToolStore.present(p.market.db) && new NativeToolStore(p.market.db).event(id)) { state.execution = 1; return; }
    const context = p.identity(player.username, id, 0, World.currentTick);
    if (!context) {
        if (storeFor(player)?.store.binding(player.username)) throw new Error('Native tool population identity disappeared');
        state.nativeMiningActionId = null; return;
    }
    const source = state._activeLoc;
    const output = source && rocks[LocType.get(source.type).debugname ?? ''];
    const hasBronze = positions(player).length > 0;
    const runtime = storeFor(player), binding = runtime?.store.binding(player.username);
    if (!hasBronze && !binding) { state.nativeMiningActionId = null; return; }
    if (!source || !output || Math.max(Math.abs(source.x-player.x),Math.abs(source.z-player.z))>1 || source.level!==player.level)
        throw new Error('Native bronze mining is limited to adjacent copper/tin sources');
    if (!runtime || !binding) throw new Error('Mining tool requires explicit instance migration');
    if (!runtime.store.lifecycle.verifyAuditChain()) throw new Error('Native tool lifecycle audit is invalid');
    const revision = runtime.store.lifecycle.get(binding.itemInstanceId)!.revision;
    if (state.nativeMiningInstanceId !== null && (state.nativeMiningInstanceId !== binding.itemInstanceId || state.nativeMiningToolRevision !== revision))
        throw new Error('Native mining tool changed during the suspended workload');
    state.nativeMiningInstanceId = binding.itemInstanceId; state.nativeMiningToolRevision = revision;
    identity(player, p, binding, id);
    const current = token(player);
    if (![InvType.INV, InvType.WORN].includes(current.position.inventory)) throw new Error('Mining tool is not available in inventory/equipment');
    for (const name of ['iron_pickaxe','steel_pickaxe','mithril_pickaxe','adamant_pickaxe','rune_pickaxe']) {
        const item = ObjType.getId(name);
        if ((player.getInventory(InvType.INV)?.getItemCount(item) ?? 0) + (player.getInventory(InvType.WORN)?.getItemCount(item) ?? 0)>0)
            throw new Error('Native bronze mining cannot ambiguously select another pickaxe');
    }
    if (!runtime.store.cycle.utility('bronze-pickaxe-mining', binding.itemInstanceId, binding.owner.actorId).capabilityAvailable)
        throw new Error('Broken/replaced native mining tool cannot work');
    state.nativeMiningOutput = output;
    state.nativeMiningSource ??= { type: source.type, x: source.x, z: source.z, level: source.level };
}

export function handleNativeMiningOutput(state: ScriptState, inv: number, item: number, count: number): boolean {
    if (!state.nativeMiningActionId || state.script.name !== '[label,get_ore_normal]' || inv !== InvType.INV) return false;
    // Gem side-rolls are not copper/tin production and do not consume this cycle.
    if (item !== 436 && item !== 438) return false;
    const player = state.activePlayer, p = ports(player)!;
    const store = new NativeToolStore(p.market.db), id = state.nativeMiningActionId;
    if (store.event(id)) { state.execution = 1; return true; }
    const binding = store.binding(player.username)!;
    const context = identity(player, p, binding, id); token(player);
    if (binding.itemInstanceId !== state.nativeMiningInstanceId || store.lifecycle.get(binding.itemInstanceId)?.revision !== state.nativeMiningToolRevision)
        throw new Error('Native mining output tool revision changed');
    if (count !== 1 || state.nativeMiningOutput !== item || !state.nativeMiningSource) throw new Error('Native mining output differs from source');
    const inventory = player.getInventory(inv)!, original = [...inventory.items];
    try {
        p.market.db.transaction(() => {
            const before = store.lifecycle.get(binding.itemInstanceId)!;
            if (inventory.add(item, 1) !== 1) throw new Error('Native mining output overflow');
            const source = { actionId: id, owner: binding.owner, toolPosition: token(player).position, source: state.nativeMiningSource, outputItemId: item,
                outputQuantity: 1, clock: context.clock, checkpointDigest: nativeToolDigest([...player.save(false)]) };
            const after = store.cycle.recordUse({ receiptId: id, cycleId: 'bronze-pickaxe-mining', itemInstanceId: binding.itemInstanceId,
                actorId: binding.owner.actorId, expectedRevision: before.revision, skillName: 'Mining', successfulActions: 1,
                outputItemId: item, outputQuantity: 1, sourceEvidenceDigest: nativeToolDigest(source), atSimulationTime: context.clock.simulationTime });
            p.checkpoint([player]); p.market.checkpoint(player.username, player.save(false), true);
            store.append(id, { kind: 'mined', source, before, after, lifecycleAuditValid: store.lifecycle.verifyAuditChain() });
        }).immediate();
    } catch (error) { original.forEach((item, slot) => inventory.set(slot, item)); throw error; }
    return true;
}

export interface NativeToolTradeWitness { p: NativeMiningPorts; transfers: Array<{from: Player; to: Player; binding: NativeToolBinding; revision: number}> }
export function captureNativeToolTrade(from: Player, to: Player, offer: number): NativeToolTradeWitness | null {
    const p = ports(from);
    if (!p || !NativeToolStore.present(p.market.db)) return null;
    const store = new NativeToolStore(p.market.db), transfers: NativeToolTradeWitness['transfers'] = [];
    for (const [sender, receiver] of [[from,to],[to,from]]) {
        const binding = store.binding(sender.username);
        if (!binding) continue;
        identity(sender, p, binding, randomUUID());
        const current = token(sender);
        if (current.position.inventory !== offer) continue;
        if (!p.identity(receiver.username, randomUUID(), 0, World.currentTick)) throw new Error('Native tool recipient requires population identity');
        if (ports(receiver)?.market.db !== p.market.db) throw new Error('Native tool transfer crosses checkpoint authorities');
        transfers.push({ from: sender, to: receiver, binding, revision: store.lifecycle.get(binding.itemInstanceId)!.revision });
    }
    return transfers.length ? { p, transfers } : null;
}
export function commitNativeToolTrade(witness: NativeToolTradeWitness | null, trade: EngineTradeEvidence): void {
    if (!witness) return;
    const { p, transfers } = witness, store = new NativeToolStore(p.market.db);
    const id = `trade:${trade.eventId}`;
    const prior = store.event(id);
    if (prior) { if (nativeToolDigest(prior.trade) !== nativeToolDigest(trade)) throw new Error('Native tool trade event conflict'); return; }
    try { p.market.db.transaction(() => {
        for (const {from,to,binding,revision} of transfers) {
            identity(from,p,binding,id);
            const forward = trade.fromUsername===from.username && trade.toUsername===to.username;
            const reverse = trade.toUsername===from.username && trade.fromUsername===to.username;
            const items = forward ? trade.fromItems : reverse ? trade.toItems : [];
            if (items.filter(item=>item.id===NATIVE_PICKAXE).reduce((sum,item)=>sum+item.count,0)!==1
                || store.lifecycle.get(binding.itemInstanceId)?.revision!==revision)
                throw new Error('Native tool transfer source/revision mismatch');
        }
        // Release unique username slots together so an exact two-tool swap is also atomic.
        for (const {binding} of transfers) p.market.db.query('DELETE FROM native_tool_binding WHERE instance_id=?').run(binding.itemInstanceId);
        for (const {from} of transfers) tokens.delete(from);
        const result = [];
        for (const {from, to, binding} of transfers) {
            const context = p.identity(to.username, id, 0, World.currentTick)!;
            const nextOwner = owner(context), found = positions(to);
            if (found.length !== 1 || found[0]!.reference.count !== 1 || nextOwner.worldId !== binding.owner.worldId
                || nextOwner.clockId !== binding.owner.clockId || nextOwner.clockProfileDigest !== binding.owner.clockProfileDigest)
                throw new Error('Native tool transfer has ambiguous inventory/world/clock');
            const before = store.lifecycle.get(binding.itemInstanceId)!;
            const after = store.lifecycle.transfer(`native-trade:${nativeToolDigest({eventId:trade.eventId,itemInstanceId:binding.itemInstanceId})}`, binding.itemInstanceId, before.revision,
                binding.owner.actorId, nextOwner.actorId, nativeToolDigest(trade), context.clock.simulationTime);
            tokens.set(to, found[0]!);
            store.put({ ...binding, owner: nextOwner, position: found[0]!.position });
            result.push({ itemInstanceId: binding.itemInstanceId, before, after, from: binding.owner, to: nextOwner });
        }
        p.checkpoint([...new Set(transfers.flatMap(t=>[t.from,t.to]))]);
        for (const player of new Set(transfers.flatMap(t=>[t.from,t.to]))) p.market.checkpoint(player.username,player.save(false),true);
        store.append(id,{kind:'transfer',trade,result});
    }).immediate(); } catch (error) {
        for (const {from,to} of transfers) { tokens.delete(from); tokens.delete(to); }
        throw error; // The separate trade ledger may have committed: quarantine, never invent repaired custody.
    }
}
