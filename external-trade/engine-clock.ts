import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSimulationClockRuntimeConfig } from '../simulation-clock/config.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
/** Only called contemporaneously for new engine trades; never backfills legacy events. */
export function bindNativeEngineTradeClock(event: { eventId: string; eventDigest: string; tick: number; committedAt: string },
    locations?: { configPath: string; databasePath: string }): void {
    bindNativeEconomicEvent({ domain: 'engine-trade', sourceId: event.eventId, sourceDigest: event.eventDigest,
        wallTime: event.committedAt, engineTick: event.tick }, locations);
}
export const nativeBusinessProductionPath = fileURLToPath(new URL('../.local/economy/businesses.sqlite', import.meta.url));
export function bindNativeEconomicEvent(event: { domain: string; sourceId: string; sourceDigest: string; wallTime: string; engineTick?: number },
    locations?: { configPath: string; databasePath: string }): import('../simulation-clock/types.js').BoundSimulationEventStamp | null {
    const path = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
    const database = locations?.databasePath ?? path('.local/simulation/simulation-clock.sqlite');
    if (!existsSync(database)) return null;
    const config = loadSimulationClockRuntimeConfig(locations?.configPath ?? path('config/simulation-clock.json')),
        store = new SimulationClockStore(database);
    try {
        const state = store.get(config.clockId);
        if (!state || state.profileDigest !== simulationClockProfileDigest(config.profile)) throw new Error('Native trade requires the existing configured clock');
        return store.bindEvent({ clockId: config.clockId, ...event }).stamp; }
    finally { store.close(); }
}
