import { validateExperimentParameterProfile, type ExperimentParameterProfile } from './experiment-parameters.js';
import type { MultiAgentExperimentEnvironment } from './multi-agent-experiments.js';
import { buildExperimentXpWorldModEntry, EXPERIMENT_XP_MOD_ID } from './experiment-xp-adapter.js';
import { buildExperimentRespawnWorldModEntry, EXPERIMENT_RESPAWN_MOD_ID } from './experiment-respawn-adapter.js';
import { buildExperimentMarketWorldModEntry, EXPERIMENT_MARKET_MOD_ID } from './experiment-market-adapter.js';
import { buildExperimentFinishedProductWorldModEntry,
    EXPERIMENT_FINISHED_PRODUCT_MOD_ID } from './experiment-finished-product-adapter.js';

export const EXPERIMENT_ADAPTERS = [
    { id: EXPERIMENT_XP_MOD_ID, category: 'xpRewards', build: buildExperimentXpWorldModEntry },
    { id: EXPERIMENT_RESPAWN_MOD_ID, category: 'respawns', build: buildExperimentRespawnWorldModEntry },
    { id: EXPERIMENT_MARKET_MOD_ID, category: 'marketPrices', build: buildExperimentMarketWorldModEntry },
    { id: EXPERIMENT_FINISHED_PRODUCT_MOD_ID, category: 'finishedProducts', build: buildExperimentFinishedProductWorldModEntry }
] as const;

/** Check the captured engine state, never the requested configuration. */
export function verifyExperimentAppliedProfile(input: ExperimentParameterProfile,
    environment: MultiAgentExperimentEnvironment): void {
    const profile = validateExperimentParameterProfile(input, input.createdAt);
    if (profile.digest !== input.digest) throw new Error('Experiment parameter profile digest is invalid');
    for (const adapter of EXPERIMENT_ADAPTERS) {
        const matches = environment.mods.filter(mod => mod.id === adapter.id);
        if (matches.length > 1) throw new Error(`Duplicate experiment adapter: ${adapter.id}`);
        const mod = matches[0];
        if (profile.parameters[adapter.category].length === 0) {
            if (mod?.enabled) throw new Error(`Unexpected active experiment adapter: ${adapter.id}`);
            continue;
        }
        const expected = adapter.build(profile).config;
        if (!mod?.enabled || mod.version !== '1.0.0' || mod.dataSchemaVersion !== 1
            || Object.keys(mod.config).length !== Object.keys(expected).length
            || Object.entries(expected).some(([key, value]) => mod.config[key] !== value)) {
            throw new Error(`Engine must apply the exact parameter profile: ${adapter.id}`);
        }
    }
}
