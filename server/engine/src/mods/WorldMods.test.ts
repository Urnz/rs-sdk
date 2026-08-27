import { describe, expect, test } from 'bun:test';
import {
    mergeHotReloadSnapshot,
    runWorldModPlayerLoginHooks,
    runWorldModXpAwardHook,
    type ActiveMod,
    type ActiveWorldModSnapshot,
    type WorldModRuntimeMetrics
} from './WorldMods.js';

function mod(activation: ActiveMod['activation'], message: string, dataSchemaVersion = 1): ActiveMod {
    return { enabled: true, config: { message }, version: '1.0.0', dataSchemaVersion, activation, appliedRevision: 1 };
}

function metric(): WorldModRuntimeMetrics {
    return { status: 'active', hookInvocations: 4, hookErrors: 0, lastHookAt: null, lastError: null, counters: { messagesSent: 4 }, details: [] };
}

function snapshot(mods: Record<string, ActiveMod>, revision = 1): ActiveWorldModSnapshot {
    return {
        schemaVersion: 1, revision, loadedAt: new Date(0).toISOString(), lastReloadAt: null,
        mods, metrics: Object.fromEntries(Object.keys(mods).map(id => [id, metric()])), loadError: null
    };
}

describe('world mod hot reload lifecycle', () => {
    test('applies hot mods while keeping restart-required mods on their active state', () => {
        const current = snapshot({ hot: mod('hot-reload', 'old'), restart: mod('restart-required', 'old') });
        const candidate = snapshot({ hot: mod('hot-reload', 'new'), restart: mod('restart-required', 'new') }, 2);
        const result = mergeHotReloadSnapshot(current, candidate);
        expect(result.appliedIds).toEqual(['hot']);
        expect(result.pendingRestartIds).toEqual(['restart']);
        expect(result.snapshot.mods.hot?.config.message).toBe('new');
        expect(result.snapshot.mods.restart?.config.message).toBe('old');
        expect(result.snapshot.metrics.hot?.counters.messagesSent).toBe(4);
    });

    test('blocks schema upgrades and downgrades until an explicit migration or rollback', () => {
        const current = snapshot({ hot: mod('hot-reload', 'old', 2) });
        const upgrade = mergeHotReloadSnapshot(current, snapshot({ hot: mod('hot-reload', 'new', 3) }, 2));
        expect(upgrade.migrationRequiredIds).toEqual(['hot']);
        expect(upgrade.snapshot.mods.hot?.config.message).toBe('old');
        const rollback = mergeHotReloadSnapshot(current, snapshot({ hot: mod('hot-reload', 'new', 1) }, 3));
        expect(rollback.rollbackRequiredIds).toEqual(['hot']);
        expect(rollback.snapshot.mods.hot?.dataSchemaVersion).toBe(2);
    });

    test('fails closed when the candidate configuration cannot be loaded', () => {
        const current = snapshot({ hot: mod('hot-reload', 'old') });
        const invalid = { ...snapshot({}, 2), revision: null, loadError: 'invalid state' };
        expect(() => mergeHotReloadSnapshot(current, invalid)).toThrow('invalid state');
        expect(current.mods.hot?.config.message).toBe('old');
    });

    test('is a strict no-op for disabled gameplay hooks', () => {
        const disabled = mod('hot-reload', 'must not be sent');
        disabled.enabled = false;
        const active = snapshot({ 'sample.welcome-message': disabled });
        active.metrics['sample.welcome-message']!.status = 'disabled';
        const metricsBefore = structuredClone(active.metrics['sample.welcome-message']);
        const messages: string[] = [];
        runWorldModPlayerLoginHooks(active, { wrappedMessageGame: message => messages.push(message) });
        expect(messages).toEqual([]);
        expect(active.metrics['sample.welcome-message']).toEqual(metricsBefore);
    });

    test('contains hook failures without throwing into the world tick', () => {
        const active = snapshot({ 'sample.welcome-message': mod('hot-reload', 'welcome') });
        expect(() => runWorldModPlayerLoginHooks(active, { wrappedMessageGame: () => { throw new Error('client write failed'); } })).not.toThrow();
        expect(active.metrics['sample.welcome-message']).toMatchObject({
            status: 'error', hookInvocations: 5, hookErrors: 1, lastError: 'client write failed', counters: { messagesSent: 4 }
        });
    });

    test('keeps XP byte-for-byte unchanged while the diminishing mod is disabled', () => {
        const disabled: ActiveMod = {
            enabled: false, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1,
            config: {}
        };
        const active = snapshot({ 'economy.diminishing-xp': disabled });
        active.metrics['economy.diminishing-xp']!.status = 'disabled';
        const before = structuredClone(active.metrics['economy.diminishing-xp']);
        const granted = runWorldModXpAwardHook(active, { username: 'Ferry14' }, 'FISHING', 100, {
            script: 'fishing', targetKind: 'npc', targetId: 316, x: 2924, z: 3179, level: 0
        });
        expect(granted).toBe(100);
        expect(active.metrics['economy.diminishing-xp']).toEqual(before);
    });

    test('applies diminishing XP and exposes aggregate runtime metrics', () => {
        const config = {
            affectedSkills: 'FISHING', regionSize: 64, recoveryMinutes: 60,
            tier2At: 5, tier3At: 15, tier4At: 30, tier5At: 60,
            multiplier2: 0.9, multiplier3: 0.7, multiplier4: 0.4, multiplier5: 0.15
        };
        const active = snapshot({
            'economy.diminishing-xp': {
                enabled: true, config, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1
            }
        });
        active.metrics['economy.diminishing-xp']!.counters = {};
        const granted = runWorldModXpAwardHook(active, { username: 'Ferry14' }, 'FISHING', 100, {
            script: 'fishing', targetKind: 'npc', targetId: 316, x: 2924, z: 3179, level: 0
        }, {
            award: () => ({
                activityKey: 'key', baseXp: 100, grantedXp: 70, multiplier: 0.7,
                repetitionScore: 15, nextRecoveryAt: new Date(0).toISOString()
            }),
            summary: () => ({ playersTracked: 2, activitiesTracked: 7 })
        });
        expect(granted).toBe(70);
        expect(active.metrics['economy.diminishing-xp']).toMatchObject({
            hookInvocations: 5,
            counters: { baseXp: 100, grantedXp: 70, withheldXp: 30, reducedAwards: 1, playersTracked: 2, activitiesTracked: 7 }
        });
    });

    test('fails open to the original XP award when diminishing configuration is invalid', () => {
        const active = snapshot({
            'economy.diminishing-xp': {
                enabled: true, config: {}, version: '1.0.0', dataSchemaVersion: 1, activation: 'hot-reload', appliedRevision: 1
            }
        });
        expect(runWorldModXpAwardHook(active, { username: 'Ferry14' }, 'FISHING', 100, {
            script: 'fishing', targetKind: 'npc', targetId: 316, x: 2924, z: 3179, level: 0
        })).toBe(100);
        expect(active.metrics['economy.diminishing-xp']).toMatchObject({
            status: 'error', hookErrors: 1, lastError: 'Invalid diminishing XP setting: affectedSkills'
        });
    });
});
