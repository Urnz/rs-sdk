import { describe, expect, test } from 'bun:test';
import { buildExperimentRespawnWorldModEntry, verifyExperimentRespawnWorldMod } from './experiment-respawn-adapter.js';
import { validateExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

function profile(targetKey = 'loc:2090') {
    return validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.0', label: 'Baseline',
        description: '', origin: 'manual', parameters: { xpRewards: [], marketPrices: [], finishedProducts: [],
            respawns: [{ targetKey, ticks: 80 }] } }, '2026-01-01T00:00:00.000Z');
}

describe('experiment respawn world-mod adapter', () => {
    test('builds exact provenance and canonical targets for the world mod', () => {
        const source = profile();
        expect(buildExperimentRespawnWorldModEntry(source)).toEqual({ enabled: true, config: {
            profileId: source.profileId, profileVersion: source.version, profileDigest: source.digest,
            targetsJson: '[{"targetKey":"loc:2090","ticks":80}]'
        } });
    });

    test('rejects symbolic legacy selectors before mutating world-mod state', () => {
        expect(() => buildExperimentRespawnWorldModEntry(profile('loc:copper-rocks:varrock-east'))).toThrow('nem támogatja');
    });

    test('requires exact active engine readback', () => {
        const source = profile();
        const expected = buildExperimentRespawnWorldModEntry(source);
        const view = { id: 'experiment.respawn-calibration', status: 'active', active: expected,
            requested: expected } as unknown as WorldModView;
        expect(verifyExperimentRespawnWorldMod(source, [view])).toBe(view);
        const stale = structuredClone(view);
        stale.active!.config.targetsJson = '[]';
        expect(() => verifyExperimentRespawnWorldMod(source, [stale])).toThrow('exact');
    });
});
