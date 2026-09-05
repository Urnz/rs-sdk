import { validateExperimentParameterProfile, type ExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

export const EXPERIMENT_MARKET_MOD_ID = 'experiment.market-calibration';

export interface ExperimentMarketWorldModEntry {
    enabled: true;
    config: { profileId: string; profileVersion: string; profileDigest: string; pricesJson: string };
}

export function buildExperimentMarketWorldModEntry(profileInput: ExperimentParameterProfile): ExperimentMarketWorldModEntry {
    const profile = validateExperimentParameterProfile(profileInput, profileInput.createdAt);
    if (profile.digest !== profileInput.digest) throw new Error('A paraméterprofil digestje sérült.');
    if (profile.parameters.marketPrices.length === 0) throw new Error('A kiválasztott profil nem tartalmaz piaci árat.');
    return { enabled: true, config: { profileId: profile.profileId, profileVersion: profile.version,
        profileDigest: profile.digest, pricesJson: JSON.stringify(profile.parameters.marketPrices) } };
}

export function verifyExperimentMarketWorldMod(profile: ExperimentParameterProfile, mods: WorldModView[]): WorldModView {
    const expected = buildExperimentMarketWorldModEntry(profile);
    const mod = mods.find(entry => entry.id === EXPERIMENT_MARKET_MOD_ID);
    if (!mod || mod.status !== 'active' || !mod.active?.enabled
        || JSON.stringify(mod.active.config) !== JSON.stringify(expected.config)) {
        throw new Error('Az engine nem az exact kiválasztott piaci árprofilt olvasta vissza aktívként.');
    }
    return mod;
}
