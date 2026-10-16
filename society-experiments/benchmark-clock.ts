import { join } from 'node:path';
import { check, readDatabase } from '../external-trade/source.js';
import { SimulationClockStore } from '../simulation-clock/store.js';
import { loadSimulationClockRuntimeConfig } from '../simulation-clock/config.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
import { defaultLongExperimentSources } from './runtime.js';

/** Caller must stop all writers. Pause/resume preserves native revision checks and never creates a missing clock. */
export function transitionBenchmarkClock(root: string, action: 'pause' | 'resume', wallTime?: string) {
    const paths = defaultLongExperimentSources(root), config = loadSimulationClockRuntimeConfig(join(paths.configDirectory, 'simulation-clock.json'));
    readDatabase(paths.clockPath, db => check((db.query('PRAGMA user_version').get() as { user_version: number }).user_version === SIMULATION_CLOCK_STORE_SCHEMA_VERSION, 'Unsupported native clock'));
    const store = new SimulationClockStore(paths.clockPath);
    try {
        const state = store.get(config.clockId); check(state && state.profileDigest === simulationClockProfileDigest(config.profile), 'Existing configured clock required');
        const at = wallTime ?? new Date(Math.max(Date.now(), Date.parse(state.lastObservedWallTime))).toISOString();
        return action === 'pause' ? store.pause(config.clockId, state.revision, at) : store.resume(config.clockId, state.revision, at);
    } finally { store.close(); }
}
