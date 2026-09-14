import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog,
    WorldGenesisProvenanceStore, type GenesisAssetAllocation } from '../index.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(assets: GenesisAssetAllocation[]) {
    const profile = loadWorldGenesisProfileCatalog(join(import.meta.dir, '..', '..', 'config',
        'world-genesis-profiles.json')).profiles.find(item => item.profileId === 'mature-society')!;
    const configuration = buildWorldGenesisConfiguration({ seed: 'provenance-seed', profile,
        worldBuild: 'lostcity-local-v1', simulationClock: { clockId: 'world', profileDigest: 'b'.repeat(64),
            initialSimulationTime: '2001-01-01T00:00:00.000Z' } });
    return buildWorldGenesisResult(configuration, { assets }, '2026-09-14T10:00:00.000Z');
}

function path(): string {
    const directory = mkdtempSync(join(tmpdir(), 'world-genesis-provenance-'));
    directories.push(directory);
    return join(directory, 'provenance.sqlite');
}

describe('world genesis asset provenance', () => {
    test('atomically records each supported bootstrap asset as an immutable genesis lot', () => {
        const assets: GenesisAssetAllocation[] = [
            { allocationId: 'alice-coins', kind: 'currency', owner: { kind: 'player', id: 'alice' }, amountGp: 5000 },
            { allocationId: 'alice-pickaxe', kind: 'item', owner: { kind: 'player', id: 'alice' },
                container: 'bank', itemId: 1275, count: 1, slot: null },
            { allocationId: 'forge-property', kind: 'property', owner: { kind: 'business', id: 'varrock-forge' },
                propertyId: 'varrock.east-workshop' },
            { allocationId: 'forge-business', kind: 'business', owner: { kind: 'player', id: 'alice' },
                businessId: 'varrock-forge', openingCapitalGp: 25000, openingInventoryDigest: 'c'.repeat(64) }
        ];
        const result = fixture(assets), store = new WorldGenesisProvenanceStore(path());
        const recorded = store.recordResult(result, '2001-01-01T00:00:00.000Z', '2026-09-14T10:01:00.000Z');
        expect(recorded).toHaveLength(4);
        expect(recorded.map(item => item.kind)).toEqual(['currency', 'item', 'business', 'property']);
        expect(recorded.every(item => item.source === 'world-genesis'
            && item.resultDigest === result.resultDigest && item.configurationDigest === result.configurationDigest))
            .toBeTrue();
        expect(store.listByOwner({ kind: 'player', id: 'alice' })).toHaveLength(3);
        expect(store.recordResult(result, '2001-01-01T00:00:00.000Z')).toEqual(recorded);
        expect(() => store.recordResult(result, '2001-01-02T00:00:00.000Z'))
            .toThrow('different provenance');
        store.close();
    });

    test('rejects duplicate allocation ids before writing any provenance', () => {
        const duplicate = fixture([
            { allocationId: 'same-lot', kind: 'currency', owner: { kind: 'player', id: 'alice' }, amountGp: 5 },
            { allocationId: 'same-lot', kind: 'item', owner: { kind: 'player', id: 'alice' },
                container: 'inventory', itemId: 436, count: 1, slot: null }
        ]);
        const store = new WorldGenesisProvenanceStore(path());
        expect(() => store.recordResult(duplicate, '2001-01-01T00:00:00.000Z')).toThrow('duplicate allocation ids');
        expect(store.listByResult(duplicate.resultDigest)).toEqual([]);
        store.close();
    });

    test('rejects result tampering and invalid asset bounds', () => {
        const result = fixture([{ allocationId: 'coins', kind: 'currency',
            owner: { kind: 'player', id: 'alice' }, amountGp: 5 }]);
        const store = new WorldGenesisProvenanceStore(path());
        expect(() => store.recordResult({ ...result, output: { assets: [{ allocationId: 'coins', kind: 'currency',
            owner: { kind: 'player', id: 'alice' }, amountGp: 6 }] } }, '2001-01-01T00:00:00.000Z'))
            .toThrow('digest does not match');
        const invalid = fixture([{ allocationId: 'coins', kind: 'currency',
            owner: { kind: 'player', id: 'alice' }, amountGp: 0 }]);
        expect(() => store.recordResult(invalid, '2001-01-01T00:00:00.000Z')).toThrow('amountGp is invalid');
        store.close();
    });
});
