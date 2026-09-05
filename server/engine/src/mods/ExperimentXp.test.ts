import { describe, expect, test } from 'bun:test';
import { applyExperimentXpMultiplier, experimentXpSelectors, parseExperimentXpConfig } from './ExperimentXp.js';

const context = { script: 'fishing spot', targetKind: 'npc' as const, targetId: 316, x: 2924, z: 3179, level: 0 };

function config(rewardsJson: string) {
    return parseExperimentXpConfig({
        profileId: 'economy.baseline', profileVersion: '1.2.0',
        profileDigest: 'a'.repeat(64), rewardsJson
    });
}

describe('experiment XP calibration adapter', () => {
    test('uses deterministic selector precedence and rounds the resulting XP', () => {
        const parsed = config(JSON.stringify([
            { activityKey: 'all', multiplier: 0.1 },
            { activityKey: 'skill:fishing', multiplier: 0.5 },
            { activityKey: 'target:npc:316', multiplier: 0.75 },
            { activityKey: 'activity:fishing/fishing-spot/npc/316/0/2924/3179', multiplier: 1.25 }
        ]));
        expect(experimentXpSelectors('FISHING', context)).toEqual([
            'activity:fishing/fishing-spot/npc/316/0/2924/3179', 'target:npc:316',
            'script:fishing-spot', 'skill:fishing', 'all'
        ]);
        expect(applyExperimentXpMultiplier(83, 'FISHING', context, parsed)).toEqual({
            grantedXp: 104, multiplier: 1.25, selector: 'activity:fishing/fishing-spot/npc/316/0/2924/3179'
        });
    });

    test('leaves unmatched XP byte-for-byte unchanged', () => {
        const parsed = config('[{"activityKey":"skill:mining","multiplier":0.5}]');
        expect(applyExperimentXpMultiplier(83, 'FISHING', context, parsed)).toEqual({
            grantedXp: 83, multiplier: 1, selector: null
        });
    });

    test('rejects invalid provenance, duplicate selectors and out-of-range values', () => {
        expect(() => parseExperimentXpConfig({ profileId: 'bad id', profileVersion: '1.0.0',
            profileDigest: 'a'.repeat(64), rewardsJson: '[{"activityKey":"all","multiplier":1}]' })).toThrow('profileId');
        expect(() => config('[{"activityKey":"skill:mining","multiplier":1},{"activityKey":"skill:mining","multiplier":2}]'))
            .toThrow('duplicate');
        expect(() => config('[{"activityKey":"skill:mining","multiplier":11}]')).toThrow('multiplier');
    });
});
