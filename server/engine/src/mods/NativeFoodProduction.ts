import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import InvType from '../cache/config/InvType.js';
import NpcType from '../cache/config/NpcType.js';
import type Player from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import type ScriptState from '../engine/script/ScriptState.js';
import { ensurePlayerSaveStore, type MarketStore } from '../engine/market/MarketStore.js';
import World from '../engine/World.js';
import { foodDigest, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore, LOBSTER, type FoodBalances, type FoodProductionAction, type FoodProductionReceipt } from './NativeFoodProductionStore.js';
import { loadNativeFoodProductionPolicy, type NativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { assertManagedModuleRoot } from '../../../control-plane/instance-context.js';

export interface NativeFoodProductionPorts {
    market: MarketStore; policy: NativeFoodProductionPolicy;
    identity: typeof populationFoodContext; checkpoint(save: Uint8Array): void;
    custody?: { runId: string; batchId: string; evidence: NonNullable<FoodProductionReceipt['custody']>;
        authorize(): void; settle(output: number): void };
}
export interface NativeFoodProductionStage { action: FoodProductionAction; ports: NativeFoodProductionPorts; identity: NativeFoodContext }

function balances(player: Player): FoodBalances {
    const inv = player.getInventory(InvType.INV)!;
    return { raw: inv.getItemCount(LOBSTER.raw), cooked: inv.getItemCount(LOBSTER.cooked), burnt: inv.getItemCount(LOBSTER.burnt) };
}
function portsFor(state: ScriptState, identity: NativeFoodContext): NativeFoodProductionPorts {
    if (state.nativeFoodProductionPorts) return state.nativeFoodProductionPorts;
    const root = fileURLToPath(new URL('../../../../', import.meta.url)); assertManagedModuleRoot(root);
    getSharedPlayerEscrowAuthority();
    return { market: ensurePlayerSaveStore(), policy: loadNativeFoodProductionPolicy(root), identity: populationFoodContext,
        checkpoint: save => { World.checkpointPlayers(state.activePlayer, save); } };
}
function prepare(state: ScriptState, kind: FoodProductionAction['kind']): NativeFoodProductionStage | null {
    const player = state.activePlayer;
    const id = state.nativeFoodProductionActionId ??= randomUUID();
    const identity = (state.nativeFoodProductionPorts?.identity ?? populationFoodContext)(player.username, id, 0, World.currentTick);
    if (!identity) return null; // Existing non-enrolled avatars keep the vanilla path; no native society proof is claimed.
    if (identity.action.username !== player.username || identity.action.actionId !== id
        || identity.clock.clockId !== identity.action.clockId || identity.clock.profileDigest !== identity.action.clockProfileDigest
        || player.populationTerminal || player.levels[PlayerStat.HITPOINTS] === 0 || identity.clock.status !== 'running')
        throw new Error('Native food production actor/clock is not active');
    const ports = portsFor(state, identity), policy = ports.policy;
    if (ports.custody) { if (kind !== 'cook') throw new Error('Business custody only permits its cooking step'); ports.custody.authorize(); }
    const source = kind === 'gather' ? state._activeNpc : state._activeLoc;
    if (!source || Math.max(Math.abs(source.x - player.x), Math.abs(source.z - player.z)) > 2 || source.level !== player.level)
        throw new Error('Native food production lacks its reachable content source');
    const quota = kind === 'gather' ? policy.sources.find(s => s.npcDebugName === NpcType.get(state.activeNpc.type).debugname
        && source.x >= s.minX && source.x <= s.maxX && source.z >= s.minZ && source.z <= s.maxZ && source.level === s.level) : null;
    if (kind === 'gather' && !quota) throw new Error('Native lobster source is outside the bounded run');
    const action: FoodProductionAction = { actionId: id, worldId: identity.action.worldId, actorId: identity.action.actorId,
        username: player.username, lifecycleId: identity.action.lifecycleId, clockId: identity.action.clockId,
        clockProfileDigest: identity.action.clockProfileDigest, policyDigest: policy.digest, catalogDigest: policy.catalogDigest,
        kind, runId: ports.custody?.runId ?? policy.runId, batchId: ports.custody?.batchId ?? `${policy.runId}:${id}`, recipeId: policy.recipeId, recipeVersion: policy.recipeVersion,
        source: { kind: kind === 'gather' ? 'npc' : 'loc', sourceId: quota?.sourceId ?? `heat:${source.level}:${source.x}:${source.z}:${source.type}`,
            typeId: source.type, x: source.x, z: source.z, level: source.level } };
    return { action: new NativeFoodProductionStore(ports.market.db).admit(action), ports, identity };
}
function commit(state: ScriptState, stage: NativeFoodProductionStage, output: number): void {
    const { action, ports } = stage, player = state.activePlayer, market = ports.market;
    const fresh = ports.identity(player.username, action.actionId, 0, World.currentTick);
    if (!fresh || foodDigest(fresh.action) !== foodDigest(stage.identity.action) || fresh.clock.status !== 'running'
        || player.populationTerminal || player.levels[PlayerStat.HITPOINTS] === 0)
        throw new Error('Native food production lifecycle/world binding changed');
    const store = new NativeFoodProductionStore(market.db), prior = store.get(action.actionId);
    if (prior) { state.execution = 1; return; } // Replay must not repeat inventory mutation or the following XP award.
    const inv = player.getInventory(InvType.INV)!, original = inv.items.map(item => item && { ...item });
    try {
        market.db.transaction(() => {
            ports.custody?.authorize();
            const before = balances(player);
            const quota = action.kind === 'gather' ? store.takeQuota(action, ports.policy.sources.find(s => s.sourceId === action.source.sourceId)!.quantity) : null;
            if (action.kind === 'cook' && player.invDel(InvType.INV, LOBSTER.raw, 1) !== 1)
                throw new Error('Native cooking input is missing');
            if (inv.freeSlotCount < 1 || player.invAdd(InvType.INV, output, 1) !== 1) throw new Error('Native food output has no inventory space');
            const after = balances(player);
            ports.custody?.settle(output);
            const save = player.save(false);
            ports.checkpoint(save); market.checkpoint(player.username, save, true);
            const receipt: FoodProductionReceipt = { schemaVersion: 1, action, requestDigest: foodDigest(action),
                outcome: action.kind === 'gather' ? 'raw-gained' : output === LOBSTER.cooked ? 'cooked' : 'burnt',
                inputs: action.kind === 'gather' ? [] : [{ itemId: LOBSTER.raw, quantity: 1 }], outputs: [{ itemId: output, quantity: 1 }],
                before, after, quota, clock: fresh.clock, checkpointId: `food-production:${action.actionId}`,
                checkpointDigest: foodDigest([...save]), ...(ports.custody ? { custody: ports.custody.evidence } : {}) };
            store.finish(receipt);
        }).immediate();
    } catch (error) { original.forEach((item, slot) => inv.set(slot, item)); throw error; }
}

/** Called only after the existing protected inventory-opcode checks. No caller-uploaded outcomes. */
export function handleNativeFoodProduction(state: ScriptState, operation: 'add' | 'del', inv: number, item: number, count: number): boolean {
    if (inv !== InvType.INV) return false;
    const name = state.script.name;
    if (operation === 'add' && item === LOBSTER.raw && name === '[proc,fish_roll]') {
        if (count !== 1) throw new Error('Native lobster gathering quantity differs');
        const stage = prepare(state, 'gather'); if (!stage) return false;
        commit(state, stage, LOBSTER.raw); return true;
    }
    if (name !== '[label,cook_item]') return false;
    if (operation === 'del' && item === LOBSTER.raw) {
        if (count !== 1 || state.nativeFoodProductionStage) throw new Error('Native cooking input differs or is duplicated');
        const stage = prepare(state, 'cook'); if (!stage) return false;
        const prior = new NativeFoodProductionStore(stage.ports.market.db).get(stage.action.actionId);
        if (prior) { state.execution = 1; return true; }
        // The existing content performs no yield between this deletion and its cooked/burnt INV_ADD.
        // Stage the deletion until that native outcome, then apply both item changes in one durable transaction.
        state.nativeFoodProductionStage = stage; return true;
    }
    if (operation === 'add' && (item === LOBSTER.cooked || item === LOBSTER.burnt)) {
        const stage = state.nativeFoodProductionStage;
        if (!stage) {
            if ((state.nativeFoodProductionPorts?.identity ?? populationFoodContext)(state.activePlayer.username,
                state.nativeFoodProductionActionId ??= randomUUID(), 0, World.currentTick)) throw new Error('Native cooking output lacks its input intent');
            return false;
        }
        if (count !== 1) throw new Error('Native cooking output quantity differs');
        commit(state, stage, item); state.nativeFoodProductionStage = null; return true;
    }
    if (state.nativeFoodProductionStage) throw new Error('Unexpected mutation in native cooking transformation');
    return false;
}

export function finishNativeFoodProductionSegment(state: ScriptState): void {
    if (state.nativeFoodProductionStage) {
        state.nativeFoodProductionStage = null;
        throw new Error('Native cooking interrupted before output: intent remains pending, input is unspent');
    }
}
