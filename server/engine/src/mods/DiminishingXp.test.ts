import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    buildXpActivityKey,
    decayRepetitionScore,
    DiminishingXpStore,
    multiplierForRepetition,
    parseDiminishingXpConfig,
    type XpActivityContext
} from './DiminishingXp.js';

const temporaryDirectories: string[] = [];
const context: XpActivityContext = { script: 'skill_fishing_lobster', targetKind: 'npc', targetId: 316, x: 2924, z: 3179, level: 0 };
const rawConfig = {
    affectedSkills: 'FISHING, MINING', regionSize: 64, recoveryMinutes: 60,
    tier2At: 3, tier3At: 5, tier4At: 7, tier5At: 9,
    multiplier2: 0.9, multiplier3: 0.7, multiplier4: 0.4, multiplier5: 0.15
};

function statePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'diminishing-xp-'));
    temporaryDirectories.push(directory);
    return join(directory, 'state.json');
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('diminishing XP policy', () => {
    test('builds an activity key from skill, activity, target and region', () => {
        expect(buildXpActivityKey('fishing', context, 64)).toBe('FISHING|skill_fishing_lobster|npc:316|0:45,49');
        expect(buildXpActivityKey('fishing', { ...context, x: 3000 }, 64)).not.toBe(buildXpActivityKey('fishing', context, 64));
    });

    test('uses the configured non-increasing reward curve at exact boundaries', () => {
        const config = parseDiminishingXpConfig(rawConfig);
        expect([1, 2, 3, 5, 7, 9].map(value => multiplierForRepetition(value, config))).toEqual([1, 1, 0.9, 0.7, 0.4, 0.15]);
    });

    test('regenerates one repetition step during every configured recovery interval', () => {
        expect(decayRepetitionScore(8, 1_000, 1_000 + 2.5 * 60 * 60_000, 60)).toBe(5.5);
        expect(decayRepetitionScore(1, 1_000, 1_000 + 2 * 60 * 60_000, 60)).toBe(0);
    });

    test('persists per-player activity counters and resumes them after restart', () => {
        const path = statePath();
        const config = parseDiminishingXpConfig(rawConfig);
        const store = new DiminishingXpStore(path);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 1_000).grantedXp).toBe(100);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 2_000).grantedXp).toBe(100);

        const restarted = new DiminishingXpStore(path);
        const third = restarted.award('Ferry14', 'FISHING', context, 100, config, 3_000);
        expect(third).toMatchObject({ grantedXp: 90, multiplier: 0.9 });
        expect(third.repetitionScore).toBeCloseTo(3, 2);
        expect(restarted.summary()).toEqual({ playersTracked: 1, activitiesTracked: 1 });
        expect(restarted.inspect(config, 3_000)).toMatchObject([{
            username: 'ferry14', activityKey: 'FISHING|skill_fishing_lobster|npc:316|0:45,49', nextMultiplier: 0.9
        }]);
    });

    test('rejects increasing curves and overlapping thresholds', () => {
        expect(() => parseDiminishingXpConfig({ ...rawConfig, multiplier4: 0.8 })).toThrow('must not increase');
        expect(() => parseDiminishingXpConfig({ ...rawConfig, tier4At: 5 })).toThrow('strictly increasing');
    });

    test('serializes rapidly scheduled awards without losing persistent updates', async () => {
        const path = statePath();
        const config = parseDiminishingXpConfig(rawConfig);
        const store = new DiminishingXpStore(path);
        await Promise.all(Array.from({ length: 25 }, (_, index) => Promise.resolve().then(() =>
            store.award('Parallel1', 'MINING', { ...context, script: 'mining', targetKind: 'loc', targetId: 2090 }, 40, config, 1_000 + index)
        )));
        const restarted = new DiminishingXpStore(path);
        expect(restarted.inspect(config, 2_000)[0]?.repetitionScore).toBeCloseTo(25, 2);
    });

    test('allows an administrator to configure a hard zero reward tier', () => {
        const path = statePath();
        const config = parseDiminishingXpConfig({ ...rawConfig, multiplier5: 0 });
        const store = new DiminishingXpStore(path);
        for (let index = 0; index < 8; index++) store.award('Ferry14', 'FISHING', context, 100, config, 1_000 + index);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 1_009).grantedXp).toBe(0);
    });
});
