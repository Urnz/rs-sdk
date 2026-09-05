import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExperimentParameterStore, validateExperimentParameterProfile } from './experiment-parameters.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

function input() {
    return { profileId: 'baseline.economy', version: '1.0.0', label: 'Baseline economy',
        description: 'First manually curated calibration.', origin: 'manual' as const,
        parameters: {
            respawns: [{ targetKey: 'loc:copper-rocks:varrock-east', ticks: 100 }],
            xpRewards: [{ activityKey: 'mining:copper:varrock-east', multiplier: 1 }],
            marketPrices: [{ itemId: 436, itemName: 'Copper ore', buyGp: 3, sellGp: 1 }],
            finishedProducts: [{ itemId: 1205, itemName: 'Bronze dagger', valueGp: 16 }]
        } };
}

describe('versioned experiment parameter profiles', () => {
    test('canonicalizes, digests and persists an immutable exact version', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-experiment-parameters-'));
        directories.push(root);
        let store = new ExperimentParameterStore(join(root, 'profiles.sqlite'));
        const created = store.create(input(), '2026-09-05T12:00:00.000Z');
        expect(created).toMatchObject({ schemaVersion: 1, profileId: 'baseline.economy', version: '1.0.0',
            origin: 'manual', createdAt: '2026-09-05T12:00:00.000Z' });
        expect(created.digest).toHaveLength(64);
        expect(store.create(input(), '2026-09-05T12:01:00.000Z')).toEqual(created);
        expect(() => store.create({ ...input(), label: 'Changed in place' })).toThrow('immutable');
        store.close();
        store = new ExperimentParameterStore(join(root, 'profiles.sqlite'));
        expect(store.list()).toEqual([created]);
        store.close();
    });

    test('rejects duplicate, empty and unbounded parameter entries', () => {
        expect(() => validateExperimentParameterProfile({ ...input(), parameters: {
            ...input().parameters, respawns: [input().parameters.respawns[0]!, input().parameters.respawns[0]!]
        } })).toThrow('duplicate');
        expect(() => validateExperimentParameterProfile({ ...input(), parameters: {
            respawns: [], xpRewards: [], marketPrices: [], finishedProducts: []
        } })).toThrow('cannot be empty');
        expect(() => validateExperimentParameterProfile({ ...input(), parameters: {
            ...input().parameters, xpRewards: [{ activityKey: 'mining', multiplier: 11 }]
        } })).toThrow('invalid');
    });
});
