import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    buildWorldModView,
    buildWorldModDisablePlan,
    createWorldModBackup,
    listWorldModBackups,
    loadWorldModManifests,
    readWorldModState,
    restoreWorldModBackup,
    updateWorldMod,
    validateWorldModEntry,
    type ActiveWorldModState,
    type WorldModManifest
} from './world-mods';

const manifest: WorldModManifest = {
    id: 'sample.test', name: 'Test', version: '1.0.0', category: 'test', description: 'Test mod.',
    dataSchemaVersion: 1,
    activation: 'restart-required', hooks: ['player.login'], dependencies: [], conflicts: [],
    disablePolicy: { mode: 'stateless', description: 'No state is retained.' },
    settings: [{ key: 'message', label: 'Message', type: 'string', default: 'hello', minimum: 1, maximum: 12, description: 'Test message.' }]
};

async function fixture(mods: WorldModManifest[] = [manifest]) {
    const root = await mkdtemp(join(tmpdir(), 'world-mods-'));
    const manifestPath = join(root, 'manifests.json');
    const statePath = join(root, 'state.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, mods }), 'utf8');
    return { root, manifestPath, statePath, backupsDir: join(root, 'world-mod-backups') };
}

describe('world mod registry and state', () => {
    test('creates disabled defaults and persists a validated revision atomically', async () => {
        const { manifestPath, statePath, backupsDir } = await fixture();
        const manifests = await loadWorldModManifests(manifestPath);
        expect(await readWorldModState(manifests, statePath)).toMatchObject({
            revision: 0,
            mods: { 'sample.test': { enabled: false, config: { message: 'hello' } } }
        });

        const result = await updateWorldMod('sample.test', { enabled: true, config: { message: 'welcome' } }, 0, manifestPath, statePath);
        expect(result.after).toMatchObject({ revision: 1, mods: { 'sample.test': { enabled: true, config: { message: 'welcome' } } } });
        expect(JSON.parse(await readFile(statePath, 'utf8')).revision).toBe(1);
        expect(await listWorldModBackups(30, backupsDir)).toMatchObject([{ operation: 'configure', revision: 0 }]);
    });

    test('rejects stale revisions, unknown settings and invalid values', async () => {
        const { manifestPath, statePath } = await fixture();
        await updateWorldMod('sample.test', { enabled: true, config: { message: 'welcome' } }, 0, manifestPath, statePath);
        await expect(updateWorldMod('sample.test', { enabled: false, config: {} }, 0, manifestPath, statePath)).rejects.toThrow('megváltoztak');
        expect(() => validateWorldModEntry(manifest, { enabled: true, config: { other: true } })).toThrow('Ismeretlen');
        expect(() => validateWorldModEntry(manifest, { enabled: true, config: { message: '' } })).toThrow('legalább');
    });

    test('validates diminishing XP skill names, ordered thresholds and non-increasing multipliers', async () => {
        const diminishing = (await loadWorldModManifests()).find(entry => entry.id === 'economy.diminishing-xp');
        expect(diminishing).toBeDefined();
        const defaults = Object.fromEntries(diminishing!.settings.map(setting => [setting.key, setting.default]));
        expect(validateWorldModEntry(diminishing!, { enabled: true, config: defaults })).toMatchObject({ enabled: true });
        expect(() => validateWorldModEntry(diminishing!, {
            enabled: true, config: { ...defaults, affectedSkills: 'FISHING,NOT_A_SKILL' }
        })).toThrow('ismeretlen nevek');
        expect(() => validateWorldModEntry(diminishing!, {
            enabled: true, config: { ...defaults, tier3At: defaults.tier2At }
        })).toThrow('szigorúan növekedniük');
        expect(() => validateWorldModEntry(diminishing!, {
            enabled: true, config: { ...defaults, multiplier4: 0.8 }
        })).toThrow('nem növekedhetnek');
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

    test('allows stateless and suspended mods to disable while declaring data preservation', async () => {
        const suspended = {
            ...manifest,
            id: 'sample.suspend',
            disablePolicy: { mode: 'suspend' as const, description: 'State is frozen and preserved.' }
        };
        const { manifestPath, statePath } = await fixture([suspended]);
        await updateWorldMod(suspended.id, { enabled: true, config: {} }, 0, manifestPath, statePath);
        const disabled = await updateWorldMod(suspended.id, { enabled: false, config: {} }, 1, manifestPath, statePath);
        expect(disabled.after.mods[suspended.id]?.enabled).toBe(false);
        expect(buildWorldModDisablePlan(suspended, [suspended], disabled.before)).toMatchObject({
            mode: 'suspend', allowed: true, dataPreserved: true, blockers: []
        });
        expect(buildWorldModDisablePlan(manifest, [manifest], {
            schemaVersion: 1, revision: 0, updatedAt: new Date(0).toISOString(),
            mods: { [manifest.id]: { enabled: true, config: { message: 'hello' } } }
        })).toMatchObject({ mode: 'stateless', dataPreserved: false });
    });

    test('blocks generic disable and backup restore for protected domain mods', async () => {
        const protectedMod = {
            ...manifest,
            id: 'sample.protected',
            disablePolicy: { mode: 'blocked' as const, description: 'Requires explicit domain shutdown.' }
        };
        const { manifestPath, statePath, backupsDir } = await fixture([protectedMod]);
        const disabledBackup = await createWorldModBackup('before enable', manifestPath, statePath, backupsDir);
        await updateWorldMod(protectedMod.id, { enabled: true, config: {} }, 0, manifestPath, statePath, backupsDir);
        await expect(updateWorldMod(
            protectedMod.id, { enabled: false, config: {} }, 1, manifestPath, statePath, backupsDir
        )).rejects.toThrow('külön domain-leállítási');
        await expect(restoreWorldModBackup(
            disabledBackup.id, 1, 'unsafe disable restore', manifestPath, statePath, backupsDir
        )).rejects.toThrow('külön domain-leállítási');
    });

    test('reports enabled dependents as disable preflight blockers', () => {
        const base = { ...manifest, id: 'sample.base' };
        const child = { ...manifest, id: 'sample.child', dependencies: [base.id] };
        const state = {
            schemaVersion: 1 as const, revision: 2, updatedAt: new Date().toISOString(),
            mods: {
                [base.id]: { enabled: true, config: { message: 'base' } },
                [child.id]: { enabled: true, config: { message: 'child' } }
            }
        };
        expect(buildWorldModDisablePlan(base, [base, child], state)).toMatchObject({
            allowed: false, blockers: ['Test (sample.child)']
        });
    });

    test('creates manual backups and restores snapshots without rolling revision backwards', async () => {
        const { manifestPath, statePath, backupsDir } = await fixture();
        await updateWorldMod('sample.test', { enabled: true, config: { message: 'first' } }, 0, manifestPath, statePath);
        const manual = await createWorldModBackup('known good', manifestPath, statePath, backupsDir);
        await updateWorldMod('sample.test', { enabled: true, config: { message: 'second' } }, 1, manifestPath, statePath);

        const restored = await restoreWorldModBackup(manual.id, 2, 'rollback test', manifestPath, statePath, backupsDir);
        expect(restored.after).toMatchObject({ revision: 3, mods: { 'sample.test': { enabled: true, config: { message: 'first' } } } });
        expect(restored.safetyBackup).toMatchObject({ operation: 'restore', revision: 2 });
        expect(await listWorldModBackups(30, backupsDir)).toHaveLength(4);
    });

    test('rejects stale restores and unsafe backup identifiers', async () => {
        const { manifestPath, statePath, backupsDir } = await fixture();
        const backup = await createWorldModBackup('initial', manifestPath, statePath, backupsDir);
        await updateWorldMod('sample.test', { enabled: true, config: { message: 'changed' } }, 0, manifestPath, statePath);
        await expect(restoreWorldModBackup(backup.id, 0, 'stale', manifestPath, statePath, backupsDir)).rejects.toThrow('megváltoztak');
        await expect(restoreWorldModBackup('../state', 1, 'unsafe', manifestPath, statePath, backupsDir)).rejects.toThrow('azonosító');
    });

    test('distinguishes active, pending and unreachable engine state', async () => {
        const requested = { schemaVersion: 1 as const, revision: 2, updatedAt: new Date().toISOString(), mods: { 'sample.test': { enabled: true, config: { message: 'new' } } } };
        const active: ActiveWorldModState = {
            revision: 1, engineReachable: true, loadedAt: new Date().toISOString(), lastReloadAt: null, loadError: null,
            metrics: { 'sample.test': { status: 'active', hookInvocations: 2, hookErrors: 0, lastHookAt: null, lastError: null, counters: { messagesSent: 2 } } },
            mods: { 'sample.test': { enabled: true, config: { message: 'old' }, version: '1.0.0', dataSchemaVersion: 1, activation: 'restart-required', appliedRevision: 1 } }
        };
        expect(buildWorldModView([manifest], requested, active)[0]?.status).toBe('restart-required');
        active.mods['sample.test'] = { ...active.mods['sample.test']!, ...requested.mods['sample.test'] };
        const view = buildWorldModView([manifest], requested, active)[0];
        expect(view?.status).toBe('active');
        expect(view?.runtime?.counters.messagesSent).toBe(2);
        active.metrics['sample.test']!.status = 'error';
        active.metrics['sample.test']!.lastError = 'test failure';
        expect(buildWorldModView([manifest], requested, active)[0]?.status).toBe('activation-error');
        expect(buildWorldModView([manifest], requested, {
            revision: null, mods: {}, metrics: {}, loadedAt: null, lastReloadAt: null, loadError: null, engineReachable: false
        })[0]?.status).toBe('engine-unreachable');
    });

    test('classifies hot reload, migration and rollback transitions', () => {
        const requested = { schemaVersion: 1 as const, revision: 2, updatedAt: new Date().toISOString(), mods: { 'sample.test': { enabled: true, config: { message: 'new' } } } };
        const active: ActiveWorldModState = {
            revision: 1, engineReachable: true, loadedAt: new Date().toISOString(), lastReloadAt: null, loadError: null, metrics: {},
            mods: { 'sample.test': { enabled: true, config: { message: 'old' }, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1 } }
        };
        expect(buildWorldModView([{ ...manifest, activation: 'hot-reload' }], requested, active)[0]?.status).toBe('hot-reload-required');
        expect(buildWorldModView([{ ...manifest, dataSchemaVersion: 2 }], requested, active)[0]?.status).toBe('migration-required');
        active.mods['sample.test']!.dataSchemaVersion = 2;
        expect(buildWorldModView([manifest], requested, active)[0]?.status).toBe('rollback-required');
    });
});
