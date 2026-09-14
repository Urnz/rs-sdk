import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog,
    WorldGenesisProvenanceStore, WorldGenesisRunStore } from '../../../world-genesis/index.js';
import { previewAdminWorldGenesis, resetAdminWorldGenesis, startAdminWorldGenesis,
    type WorldGenesisAdminAdapter } from './world-genesis.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
    const profile = loadWorldGenesisProfileCatalog(join(import.meta.dir, '..', '..', '..', 'config',
        'world-genesis-profiles.json')).profiles.find(item => item.profileId === 'frontier')!;
    const configuration = buildWorldGenesisConfiguration({ seed: 'admin-genesis', profile,
        worldBuild: 'lostcity-local-v1', simulationClock: { clockId: 'world', profileDigest: 'd'.repeat(64),
            initialSimulationTime: '2001-01-01T00:00:00.000Z' } });
    return buildWorldGenesisResult(configuration, { assets: [{ allocationId: 'alice-coins', kind: 'currency',
        owner: { kind: 'player', id: 'alice' }, amountGp: 1000 }] }, '2026-09-14T10:00:00.000Z');
}

function paths() {
    const directory = mkdtempSync(join(tmpdir(), 'admin-world-genesis-'));
    directories.push(directory);
    return { runDbPath: join(directory, 'runs.sqlite'), provenanceDbPath: join(directory, 'provenance.sqlite') };
}

function adapter(fail: 'none' | 'apply' | 'reset' = 'none') {
    const calls: string[] = [];
    const value: WorldGenesisAdminAdapter = {
        async preview() { calls.push('preview'); return { ok: true, warnings: [],
            checks: [{ key: 'stack', ok: true, message: 'ready' }] }; },
        async prepare() { calls.push('prepare'); return { createdAtSimulationTime: '2001-01-01T00:00:00.000Z',
            rollbackToken: { backupId: 'backup-1' } }; },
        async apply() { calls.push('apply'); if (fail === 'apply') throw new Error('domain rejected');
            return { verified: true }; },
        async reset() { calls.push('reset'); if (fail === 'reset') throw new Error('restore rejected');
            return { restored: true }; }
    };
    return { value, calls };
}

describe('admin world genesis lifecycle', () => {
    test('keeps preview read-only, requires digest confirmation, applies and resets with a durable journal', async () => {
        const result = fixture(), location = paths(), boundary = adapter();
        const preview = await previewAdminWorldGenesis(result, boundary.value);
        expect(preview).toMatchObject({ simulation: true, confirmationDigest: result.resultDigest,
            preview: { ok: true } });
        expect(boundary.calls).toEqual(['preview']);
        await expect(startAdminWorldGenesis(result, '0'.repeat(64), boundary.value, location))
            .rejects.toThrow('exact preview result digest');
        expect(boundary.calls).toEqual(['preview']);

        const applied = await startAdminWorldGenesis(result, result.resultDigest, boundary.value, location,
            '2026-09-14T10:01:00.000Z');
        expect(applied).toMatchObject({ status: 'applied', resultDigest: result.resultDigest,
            rollbackToken: { backupId: 'backup-1' }, applyReceipt: { verified: true }, revision: 2 });
        expect(boundary.calls).toEqual(['preview', 'prepare', 'apply']);
        expect(await startAdminWorldGenesis(result, result.resultDigest, boundary.value, location))
            .toEqual(applied);
        expect(boundary.calls).toEqual(['preview', 'prepare', 'apply']);

        const provenance = new WorldGenesisProvenanceStore(location.provenanceDbPath);
        expect(provenance.listByResult(result.resultDigest)).toHaveLength(1);
        provenance.close();
        const reset = await resetAdminWorldGenesis(result.resultId, applied.revision, result.resultDigest,
            boundary.value, location, '2026-09-14T10:02:00.000Z');
        expect(reset).toMatchObject({ application: { status: 'reset', revision: 4 },
            resetReceipt: { restored: true } });
        expect(boundary.calls.at(-1)).toBe('reset');
    });

    test('persists rollback-required when apply fails after preparation', async () => {
        const result = fixture(), location = paths(), boundary = adapter('apply');
        await expect(startAdminWorldGenesis(result, result.resultDigest, boundary.value, location,
            '2026-09-14T10:01:00.000Z')).rejects.toThrow('requires reset');
        const runs = new WorldGenesisRunStore(location.runDbPath);
        expect(runs.get(result.resultId)).toMatchObject({ status: 'rollback-required', revision: 2,
            error: 'domain rejected', rollbackToken: { backupId: 'backup-1' } });
        runs.close();
    });

    test('persists rollback-required when reset cannot verify restoration', async () => {
        const result = fixture(), location = paths(), good = adapter();
        const applied = await startAdminWorldGenesis(result, result.resultDigest, good.value, location,
            '2026-09-14T10:01:00.000Z');
        const failing = adapter('reset');
        await expect(resetAdminWorldGenesis(result.resultId, applied.revision, result.resultDigest,
            failing.value, location, '2026-09-14T10:02:00.000Z')).rejects.toThrow('requires recovery');
        const runs = new WorldGenesisRunStore(location.runDbPath);
        expect(runs.get(result.resultId)).toMatchObject({ status: 'rollback-required', revision: 4,
            error: 'restore rejected' });
        runs.close();
    });

    test('rejects invalid rollback material before opening an application journal', async () => {
        const result = fixture(), location = paths(), boundary = adapter();
        boundary.value.prepare = async () => ({ createdAtSimulationTime: 'not-a-time',
            rollbackToken: { backupId: 'backup-1' } });
        await expect(startAdminWorldGenesis(result, result.resultDigest, boundary.value, location))
            .rejects.toThrow('invalid simulation timestamp');
        const runs = new WorldGenesisRunStore(location.runDbPath);
        expect(runs.get(result.resultId)).toBeNull();
        runs.close();
    });
});
