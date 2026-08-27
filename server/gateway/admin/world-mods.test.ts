import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    buildWorldModView,
    loadWorldModManifests,
    readWorldModState,
    updateWorldMod,
    validateWorldModEntry,
    type ActiveWorldModState,
    type WorldModManifest
} from './world-mods';

const manifest: WorldModManifest = {
    id: 'sample.test', name: 'Test', version: '1.0.0', category: 'test', description: 'Test mod.',
    activation: 'restart-required', hooks: ['player.login'], dependencies: [], conflicts: [],
    settings: [{ key: 'message', label: 'Message', type: 'string', default: 'hello', minimum: 1, maximum: 12, description: 'Test message.' }]
};

async function fixture(mods: WorldModManifest[] = [manifest]) {
    const root = await mkdtemp(join(tmpdir(), 'world-mods-'));
    const manifestPath = join(root, 'manifests.json');
    const statePath = join(root, 'state.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, mods }), 'utf8');
    return { root, manifestPath, statePath };
}

describe('world mod registry and state', () => {
    test('creates disabled defaults and persists a validated revision atomically', async () => {
        const { manifestPath, statePath } = await fixture();
        const manifests = await loadWorldModManifests(manifestPath);
        expect(await readWorldModState(manifests, statePath)).toMatchObject({
            revision: 0,
            mods: { 'sample.test': { enabled: false, config: { message: 'hello' } } }
        });

        const result = await updateWorldMod('sample.test', { enabled: true, config: { message: 'welcome' } }, 0, manifestPath, statePath);
        expect(result.after).toMatchObject({ revision: 1, mods: { 'sample.test': { enabled: true, config: { message: 'welcome' } } } });
        expect(JSON.parse(await readFile(statePath, 'utf8')).revision).toBe(1);
    });

    test('rejects stale revisions, unknown settings and invalid values', async () => {
        const { manifestPath, statePath } = await fixture();
        await updateWorldMod('sample.test', { enabled: true, config: { message: 'welcome' } }, 0, manifestPath, statePath);
        await expect(updateWorldMod('sample.test', { enabled: false, config: {} }, 0, manifestPath, statePath)).rejects.toThrow('megváltoztak');
        expect(() => validateWorldModEntry(manifest, { enabled: true, config: { other: true } })).toThrow('Ismeretlen');
        expect(() => validateWorldModEntry(manifest, { enabled: true, config: { message: '' } })).toThrow('legalább');
    });

    test('serializes concurrent writes so the same revision cannot win twice', async () => {
        const { manifestPath, statePath } = await fixture();
        const results = await Promise.allSettled([
            updateWorldMod('sample.test', { enabled: true, config: { message: 'first' } }, 0, manifestPath, statePath),
            updateWorldMod('sample.test', { enabled: true, config: { message: 'second' } }, 0, manifestPath, statePath)
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect((await readWorldModState([manifest], statePath)).revision).toBe(1);
    });

    test('enforces dependencies and conflicts', async () => {
        const dependency = { ...manifest, id: 'sample.base', dependencies: [], conflicts: [] };
        const dependent = { ...manifest, id: 'sample.child', dependencies: ['sample.base'], conflicts: [] };
        const conflicting = { ...manifest, id: 'sample.conflict', dependencies: [], conflicts: ['sample.base'] };
        const { manifestPath, statePath } = await fixture([dependency, dependent, conflicting]);
        await expect(updateWorldMod('sample.child', { enabled: true, config: {} }, 0, manifestPath, statePath)).rejects.toThrow('függősége');
        await updateWorldMod('sample.base', { enabled: true, config: {} }, 0, manifestPath, statePath);
        await expect(updateWorldMod('sample.conflict', { enabled: true, config: {} }, 1, manifestPath, statePath)).rejects.toThrow('ütközik');
    });

    test('distinguishes active, pending and unreachable engine state', async () => {
        const requested = { schemaVersion: 1 as const, revision: 2, updatedAt: new Date().toISOString(), mods: { 'sample.test': { enabled: true, config: { message: 'new' } } } };
        const active: ActiveWorldModState = { revision: 1, engineReachable: true, mods: { 'sample.test': { enabled: true, config: { message: 'old' } } } };
        expect(buildWorldModView([manifest], requested, active)[0]?.status).toBe('restart-required');
        active.mods['sample.test'] = requested.mods['sample.test'];
        expect(buildWorldModView([manifest], requested, active)[0]?.status).toBe('active');
        expect(buildWorldModView([manifest], requested, { revision: null, mods: {}, engineReachable: false })[0]?.status).toBe('engine-unreachable');
    });
});
