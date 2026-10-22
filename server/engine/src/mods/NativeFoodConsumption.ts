import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import type { MarketStore } from '../engine/market/MarketStore.js';
import { playerSaveStore } from '../engine/market/MarketStore.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptState from '../engine/script/ScriptState.js';
import ServerTriggerType from '../engine/script/ServerTriggerType.js';
import ObjType from '../cache/config/ObjType.js';
import World from '../engine/World.js';
import { FOOD_ITEM, NativeFoodConsumptionStore, foodDigest, validateFoodAction, type FoodResult, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
export type { NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';

/** Synchronous world-tick operation. It invokes the existing content, including duel and eat-delay checks. */
export function executeNativeFoodAction(market: MarketStore, player: Player, context: NativeFoodContext,
    checkpointAll?: (save: Uint8Array) => void,
    authority: typeof populationFoodContext = populationFoodContext): FoodResult {
    if (!checkpointAll && playerSaveStore() !== market) throw new Error('Native food requires the canonical Player checkpoint authority');
    const checkpoint = checkpointAll ?? (save => { World.checkpointPlayers(player, save); });
    const action = validateFoodAction(context.action);
    const authorized = authority(player.username, action.actionId, action.slot, World.currentTick);
    if (!authorized || foodDigest(validateFoodAction(authorized.action)) !== foodDigest(action))
        throw new Error('Native food actor/lifecycle/world authority mismatch');
    const clock = authorized.clock;
    if (player.username !== action.username || player.populationTerminal || player.levels[PlayerStat.HITPOINTS] === 0
        || clock.clockId !== action.clockId || clock.profileDigest !== action.clockProfileDigest || clock.status !== 'running'
        || clock.engineTick === null || !Number.isSafeInteger(clock.engineTick) || clock.engineTick < 0
        || !Number.isFinite(Date.parse(clock.wallTime)) || !Number.isFinite(Date.parse(clock.simulationTime)))
        throw new Error('Native food actor/lifecycle/clock is not active');
    const store = new NativeFoodConsumptionStore(market);
    store.admit(action);
    const prior = store.get(action.actionId);
    if (prior) return prior;
    const inv = player.getInventory(InvType.INV);
    if (!inv) throw new Error('Native food inventory is unavailable');
    const items = inv.items.map(item => item && { ...item });
    const levels = player.levels.slice(), vars = player.vars.slice(), strings = [...player.varsString];
    const previous = { lastItem: player.lastItem, lastSlot: player.lastSlot, protect: player.protect };
    let result!: FoodResult;
    try {
        market.db.transaction(() => {
            // Recheck under the writer lock, so replay cannot mutate twice.
            const committed = store.get(action.actionId);
            if (committed) { result = committed; return; }
            const before = inv.getItemCount(FOOD_ITEM), hpBefore = player.levels[PlayerStat.HITPOINTS];
            let state: ScriptState | null = null;
            if (!player.delayed && !player.protect && inv.hasAt(action.slot, FOOD_ITEM)) {
                const obj = ObjType.get(FOOD_ITEM);
                const script = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, obj.id, obj.category);
                // The allowlist is also tied to the exact native content trigger; a drop/other inv_del is never food.
                if (!script || script.name !== '[opheld1,_category_58]') throw new Error(`Native lobster content binding changed: ${script?.name}`);
                player.lastItem = FOOD_ITEM; player.lastSlot = action.slot;
                state = ScriptRunner.init(script, player);
                state.nativeFoodConsumption = { username: player.username, itemId: FOOD_ITEM,
                    inventoryId: InvType.INV, slot: action.slot, deletions: 0 };
                const execution = player.runScript(state, true);
                if (execution !== ScriptState.FINISHED) throw new Error('Native food content did not finish synchronously');
            }
            const after = inv.getItemCount(FOOD_ITEM), quantity = before - after;
            if (quantity !== 0 && quantity !== 1) throw new Error('Native food content quantity mismatch');
            if ((state?.nativeFoodConsumption?.deletions ?? 0) !== quantity)
                throw new Error('Native food mutation lacks exact content consume witness');
            const save = player.save(false);
            checkpoint(save);
            // Always enroll this actor; the callback extends this transaction to the rest of the world.
            market.checkpoint(player.username, save, true);
            result = { action, outcome: quantity === 1 ? 'consumed' : 'no-use', receipt: quantity === 1 ? {
                ...action, schemaVersion: 1, cause: 'content:consume_effect_stat', before, after,
                hpBefore, hpAfter: player.levels[PlayerStat.HITPOINTS], clock,
                checkpointId: `food:${action.actionId}`, checkpointDigest: foodDigest([...save]), requestDigest: foodDigest(action)
            } : null };
            store.finish(result, clock);
        }).immediate();
        return result;
    } catch (error) {
        items.forEach((item, slot) => inv.set(slot, item));
        player.levels.set(levels); player.vars.set(vars); player.varsString = strings;
        Object.assign(player, previous);
        throw error;
    }
}

/** IDs are allocated by the engine before content executes; typed internal callers can retain theirs across retries. */
export const nativeFoodActionId = (): string => randomUUID();
