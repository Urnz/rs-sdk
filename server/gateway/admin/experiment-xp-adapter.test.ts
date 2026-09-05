import { describe, expect, test } from 'bun:test';
import { buildExperimentXpWorldModEntry, verifyExperimentXpWorldMod } from './experiment-xp-adapter.js';
import { validateExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

function profile(activityKey = 'skill:mining') {
    return validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.0', label: 'Baseline',
        description: '', origin: 'manual', parameters: { respawns: [], marketPrices: [], finishedProducts: [],
            xpRewards: [{ activityKey, multiplier: 0.75 }] } }, '2026-01-01T00:00:00.000Z');
}

describe('experiment XP world-mod adapter', () => {
    test('builds an exact enabled world-mod entry with immutable provenance', () => {
        const source = profile();
        expect(buildExperimentXpWorldModEntry(source)).toEqual({ enabled: true, config: {
            profileId: source.profileId, profileVersion: source.version, profileDigest: source.digest,
            rewardsJson: '[{"activityKey":"skill:mining","multiplier":0.75}]'
        } });
    });

    test('rejects unsupported selectors before mutating world-mod state', () => {
        expect(() => buildExperimentXpWorldModEntry(profile('mining:copper:varrock-east'))).toThrow('nem támogatja');
    });

    test('requires exact active engine readback', () => {
        const source = profile();
        const expected = buildExperimentXpWorldModEntry(source);
        const view = { id: 'experiment.xp-calibration', status: 'active', active: expected,
            requested: expected } as unknown as WorldModView;
        expect(verifyExperimentXpWorldMod(source, [view])).toBe(view);
        const stale = structuredClone(view);
        stale.active!.config.profileVersion = '0.9.0';
        expect(() => verifyExperimentXpWorldMod(source, [stale])).toThrow('exact');
    });
});
