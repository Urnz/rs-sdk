import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadWorldGenesisProfileCatalog, validateWorldGenesisProfile,
    validateWorldGenesisProfileCatalog, worldGenesisProfileDigest } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'world-genesis-profiles.json');

describe('world genesis profiles', () => {
    test('loads all five versioned built-in profiles with stable digests', () => {
        const first = loadWorldGenesisProfileCatalog(configPath);
        const second = loadWorldGenesisProfileCatalog(configPath);
        expect(first.schemaVersion).toBe(1);
        expect(first.profiles.map(profile => profile.profileId)).toEqual([
            'blank-slate', 'frontier', 'seeded-economy', 'mature-society', 'historical-burn-in'
        ]);
        expect(first.profiles.map(profile => profile.digest)).toEqual(second.profiles.map(profile => profile.digest));
        for (const { digest, ...definition } of first.profiles) {
            expect(digest).toMatch(/^[0-9a-f]{64}$/);
            expect(worldGenesisProfileDigest(definition)).toBe(digest);
        }
    });

    test('expresses the required economic starting conditions', () => {
        const profiles = new Map(loadWorldGenesisProfileCatalog(configPath).profiles
            .map(profile => [profile.profileId, profile]));
        expect(profiles.get('blank-slate')).toMatchObject({ assets: { wealthDistribution: 'minimal',
            ownership: 'unowned', inventory: 'empty' }, economy: { createBusinesses: false } });
        expect(profiles.get('frontier')).toMatchObject({ assets: { wealthDistribution: 'small-stake',
            inventory: 'survival-kit', starterFood: true, starterTools: true, starterHousing: true } });
        expect(profiles.get('seeded-economy')).toMatchObject({ population: { assignProfessions: true },
            assets: { ownership: 'generated', inventory: 'profession-kit' },
            economy: { createBusinesses: true, seedBusinessInventory: true } });
        expect(profiles.get('mature-society')).toMatchObject({ assets: { wealthDistribution: 'stratified' },
            economy: { createBusinesses: true, createContracts: true, createLeases: true,
                createInstitutions: true } });
        expect(profiles.get('historical-burn-in')?.burnIn).toEqual({ sourceProfileId: 'seeded-economy',
            durationSimulationMilliseconds: 7_776_000_000, access: 'agent-only' });
    });

    test('rejects unbounded, unknown and recursive burn-in definitions', () => {
        const catalog = JSON.parse(JSON.stringify({ schemaVersion: 1,
            profiles: loadWorldGenesisProfileCatalog(configPath).profiles.map(({ digest: _digest, ...profile }) => profile) }));
        catalog.profiles[0].unexpected = true;
        expect(() => validateWorldGenesisProfileCatalog(catalog)).toThrow('fields are invalid');

        const historical = loadWorldGenesisProfileCatalog(configPath).profiles.at(-1)!;
        const { digest: _digest, ...definition } = historical;
        expect(() => validateWorldGenesisProfile({ ...definition,
            burnIn: { ...definition.burnIn, sourceProfileId: 'historical-burn-in' } }))
            .toThrow('Historical burn-in policy is invalid');
        expect(() => validateWorldGenesisProfile({ ...definition,
            population: { ...definition.population, maximumAgents: 10_001 } }))
            .toThrow('maximumAgents must be an integer');
    });
});
