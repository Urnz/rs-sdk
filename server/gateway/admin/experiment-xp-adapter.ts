import { validateExperimentParameterProfile, type ExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

export const EXPERIMENT_XP_MOD_ID = 'experiment.xp-calibration';

export interface ExperimentXpWorldModEntry {
    enabled: true;
    config: { profileId: string; profileVersion: string; profileDigest: string; rewardsJson: string };
}

const SELECTOR = /^(?:all|skill:[a-z]+|script:[a-z0-9_.-]+|target:(?:loc|npc|obj|none):(?:\d+|none)|activity:[a-z0-9_.:/-]+)$/;

export function buildExperimentXpWorldModEntry(profileInput: ExperimentParameterProfile): ExperimentXpWorldModEntry {
    const profile = validateExperimentParameterProfile(profileInput, profileInput.createdAt);
    if (profile.digest !== profileInput.digest) throw new Error('A paraméterprofil digestje sérült.');
    if (profile.parameters.xpRewards.length === 0) throw new Error('A kiválasztott profil nem tartalmaz XP-szorzót.');
    for (const reward of profile.parameters.xpRewards) {
        if (!SELECTOR.test(reward.activityKey)) {
            throw new Error(`Az XP-adapter nem támogatja ezt a selectort: ${reward.activityKey}`);
        }
    }
    return { enabled: true, config: { profileId: profile.profileId, profileVersion: profile.version,
        profileDigest: profile.digest, rewardsJson: JSON.stringify(profile.parameters.xpRewards) } };
}

export function verifyExperimentXpWorldMod(profile: ExperimentParameterProfile, mods: WorldModView[]): WorldModView {
    const expected = buildExperimentXpWorldModEntry(profile);
    const mod = mods.find(entry => entry.id === EXPERIMENT_XP_MOD_ID);
    if (!mod || mod.status !== 'active' || !mod.active?.enabled
        || JSON.stringify(mod.active.config) !== JSON.stringify(expected.config)) {
        throw new Error('Az engine nem az exact kiválasztott XP-profilt olvasta vissza aktívként.');
    }
    return mod;
}
