import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import type Player from '../engine/entity/Player.js';
import World from '../engine/World.js';
import { ensurePlayerSaveStore, type MarketStore } from '../engine/market/MarketStore.js';
import { populationFoodContext } from './PopulationDeathRuntime.js';
import { appendFoodLineage, foodCustodian, initializeFoodLineage, type FoodTradeSide } from './NativeFoodLineageStore.js';
import type { FoodBalances } from './NativeFoodProductionStore.js';
import type { EngineTradeEvidence } from './TradeEvidenceStore.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import type { TradeLedgerEntry } from '../engine/entity/tracking/TradeLedger.js';

export interface FoodTradeWitness { sides: [Omit<FoodTradeSide, 'after'>, Omit<FoodTradeSide, 'after'>] }
export interface NativeFoodTradePorts { market: MarketStore; identity: typeof populationFoodContext;
    checkpoint(): void; record(entry: Omit<TradeLedgerEntry, 'ts'>): EngineTradeEvidence }
function balances(player: Player, offer: number): FoodBalances {
    const count = (item: number) => (player.getInventory(InvType.INV)?.getItemCount(item) ?? 0)
        + (player.getInventory(offer)?.getItemCount(item) ?? 0);
    return { raw: count(377), cooked: count(379), burnt: count(381) };
}
/** Capture before either BOTH_MOVEINV. Offers are custody, not newly produced food. */
export function captureFoodTrade(from: Player, to: Player, offer: number,
    identity: typeof populationFoodContext = populationFoodContext): FoodTradeWitness | null {
    const id = randomUUID(), contexts = [from, to].map(p => identity(p.username, id, 0, World.currentTick));
    const bound = contexts.find(context => context !== null);
    if (!bound) return null;
    const sides = [from, to].map((player, i) => {
        const context = contexts[i];
        if (context && (context.action.worldId !== bound.action.worldId || context.action.clockId !== bound.action.clockId
            || context.action.clockProfileDigest !== bound.action.clockProfileDigest)) throw new Error('Food trade crosses world/clock');
        return { custodian: context ? foodCustodian(context) : { worldId: bound.action.worldId,
            actorId: `external:${player.username}`, username: player.username, lifecycleId: 'untracked' }, before: balances(player, offer) };
    }) as FoodTradeWitness['sides'];
    return { sides };
}
/** A second DB failure leaves an explicit source gap. It cannot publish a lineage witness without durable Player saves. */
export function commitFoodTrade(witness: FoodTradeWitness | null, trade: EngineTradeEvidence,
    from: Player, to: Player, offer: number, market?: MarketStore, checkpoint?: () => void): void {
    if (!witness) return;
    if (!market) { getSharedPlayerEscrowAuthority(); market = ensurePlayerSaveStore(); }
    const store = market;
    store.db.transaction(() => {
        initializeFoodLineage(store.db);
        checkpoint ? checkpoint() : World.checkpointPlayers();
        for (const player of [from, to]) store.checkpoint(player.username, player.save(false), true);
        const sides = witness.sides.map((side, i) => ({ ...side, after: balances([from, to][i]!, offer) })) as [FoodTradeSide, FoodTradeSide];
        appendFoodLineage(store.db, { kind: 'transfer', trade, sides });
    }).immediate();
}
