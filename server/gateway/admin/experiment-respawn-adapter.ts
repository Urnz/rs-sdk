import { validateExperimentParameterProfile, type ExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

export const EXPERIMENT_RESPAWN_MOD_ID = 'experiment.respawn-calibration';
const SELECTOR = /^(?:loc|obj|npc):\d+(?::\d+:\d+:\d+)?$/;

export interface ExperimentRespawnWorldModEntry {
    enabled: true;
    config: { profileId: string; profileVersion: string; profileDigest: string; targetsJson: string };
}

export function buildExperimentRespawnWorldModEntry(profileInput: ExperimentParameterProfile): ExperimentRespawnWorldModEntry {
    const profile = validateExperimentParameterProfile(profileInput, profileInput.createdAt);
    if (profile.digest !== profileInput.digest) throw new Error('A paraméterprofil digestje sérült.');
    if (profile.parameters.respawns.length === 0) throw new Error('A kiválasztott profil nem tartalmaz respawnidőt.');
    for (const target of profile.parameters.respawns) {
        if (!SELECTOR.test(target.targetKey)) {
            throw new Error(`A respawn-adapter nem támogatja ezt a selectort: ${target.targetKey}`);
        }
    }
    return { enabled: true, config: { profileId: profile.profileId, profileVersion: profile.version,
        profileDigest: profile.digest, targetsJson: JSON.stringify(profile.parameters.respawns) } };
}

export function verifyExperimentRespawnWorldMod(profile: ExperimentParameterProfile, mods: WorldModView[]): WorldModView {
    const expected = buildExperimentRespawnWorldModEntry(profile);
    const mod = mods.find(entry => entry.id === EXPERIMENT_RESPAWN_MOD_ID);
    if (!mod || mod.status !== 'active' || !mod.active?.enabled
        || JSON.stringify(mod.active.config) !== JSON.stringify(expected.config)) {
        throw new Error('Az engine nem az exact kiválasztott respawn-profilt olvasta vissza aktívként.');
    }
    return mod;
}
