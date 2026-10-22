import { ensurePlayerSaveStore } from '../engine/market/MarketStore.js';
import { getSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { NativeFoodConsumptionStore } from './NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import { populationFoodTickClock } from './PopulationDeathRuntime.js';

/** End-of-tick barrier: no gateway physiology advances beyond the engine's closed food history. */
export function closeNativeFoodTick(engineTick: number): void {
    const clock = populationFoodTickClock(engineTick);
    if (!clock) return;
    getSharedPlayerEscrowAuthority();
    const market = ensurePlayerSaveStore();
    new NativeFoodConsumptionStore(market);
    closeFoodDeliveryTick(market.db, clock);
}
