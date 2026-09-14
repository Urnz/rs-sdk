import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog,
    validateWorldGenesisResult, validateWorldGenesisRunConfiguration,
    worldGenesisConfigurationDigest, worldGenesisEntropy } from '../index.js';

const catalog = loadWorldGenesisProfileCatalog(join(import.meta.dir, '..', '..', 'config',
    'world-genesis-profiles.json'));
const profile = catalog.profiles.find(item => item.profileId === 'seeded-economy')!;
const clock = { clockId: 'world', profileDigest: 'a'.repeat(64),
    initialSimulationTime: '2001-01-01T00:00:00.000Z' };

describe('world genesis reproducibility envelope', () => {
    test('binds the seed, complete configuration and output to stable digests', () => {
        const left = buildWorldGenesisConfiguration({ seed: 'world-seed-42', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock,
            parameters: { population: 24, regions: ['Varrock', 'Falador'] } });
        const right = buildWorldGenesisConfiguration({ seed: 'world-seed-42', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock,
            parameters: { regions: ['Varrock', 'Falador'], population: 24 } });
        expect(worldGenesisConfigurationDigest(left)).toBe(worldGenesisConfigurationDigest(right));
        const outcome = { assignments: [{ agentId: 'alice', profession: 'miner' }], createdCoins: 5000 };
        const first = buildWorldGenesisResult(left, outcome, '2026-09-14T10:00:00.000Z');
        const repeated = buildWorldGenesisResult(right, outcome, '2026-09-14T10:01:00.000Z');
        expect(first.configurationDigest).toBe(repeated.configurationDigest);
        expect(first.outputDigest).toBe(repeated.outputDigest);
        expect(first.resultDigest).toBe(repeated.resultDigest);
        expect(first.resultId).toBe(repeated.resultId);
        expect(first.generatedAtAudit).not.toBe(repeated.generatedAtAudit);
        expect(validateWorldGenesisResult(first)).toEqual(first);
        expect(() => validateWorldGenesisResult({ ...first, output: { changed: true } }))
            .toThrow('digest does not match');
    });

    test('provides stable namespaced entropy and changes it with the seed', () => {
        const first = buildWorldGenesisConfiguration({ seed: 'seed-a', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock });
        const repeated = buildWorldGenesisConfiguration({ seed: 'seed-a', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock });
        const changed = buildWorldGenesisConfiguration({ seed: 'seed-b', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock });
        expect(worldGenesisEntropy(first, 'profession', 'alice', 1_000_000))
            .toBe(worldGenesisEntropy(repeated, 'profession', 'alice', 1_000_000));
        expect(worldGenesisEntropy(first, 'profession', 'alice', 1_000_000))
            .not.toBe(worldGenesisEntropy(changed, 'profession', 'alice', 1_000_000));
        expect(worldGenesisEntropy(first, 'profession', 'alice', 7)).toBeLessThan(7);
    });

    test('rejects profile tampering and non-canonical unsafe values', () => {
        expect(() => buildWorldGenesisConfiguration({ seed: 'seed', profile: { ...profile,
            label: 'tampered' }, worldBuild: 'lostcity-local-v1', simulationClock: clock }))
            .toThrow('profile digest does not match');
        expect(() => buildWorldGenesisConfiguration({ seed: 'seed', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock,
            parameters: { ratio: 0.5 } })).toThrow('finite safe integers');
        const configuration = buildWorldGenesisConfiguration({ seed: 'seed', profile,
            worldBuild: 'lostcity-local-v1', simulationClock: clock });
        expect(() => buildWorldGenesisResult(configuration, { invalid: Number.POSITIVE_INFINITY }))
            .toThrow('finite safe integers');
        expect(() => validateWorldGenesisRunConfiguration({ ...configuration, unexpected: true }))
            .toThrow('configuration is invalid');
    });
});
