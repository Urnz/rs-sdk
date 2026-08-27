import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Player from '#/engine/entity/Player.js';

type ConfigValue = boolean | number | string;

interface ModManifest {
    id: string;
    settings: Array<{ key: string; default: ConfigValue }>;
}

interface ActiveMod {
    enabled: boolean;
    config: Record<string, ConfigValue>;
}

export interface WorldModRuntimeMetrics {
    status: 'disabled' | 'active' | 'error';
    hookInvocations: number;
    hookErrors: number;
    lastHookAt: string | null;
    lastError: string | null;
    counters: Record<string, number>;
}

export interface ActiveWorldModSnapshot {
    schemaVersion: 1;
    revision: number | null;
    loadedAt: string;
    mods: Record<string, ActiveMod>;
    metrics: Record<string, WorldModRuntimeMetrics>;
    loadError: string | null;
}

const manifestPath = fileURLToPath(new URL('../../../../config/world-mods.json', import.meta.url));
const statePath = fileURLToPath(new URL('../../../../.local/admin/world-mod-state.json', import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function loadSnapshot(): ActiveWorldModSnapshot {
    const loadedAt = new Date().toISOString();
    try {
        const manifestFile = JSON.parse(readFileSync(manifestPath, 'utf8')) as { schemaVersion?: unknown; mods?: unknown };
        if (manifestFile.schemaVersion !== 1 || !Array.isArray(manifestFile.mods)) throw new Error('invalid manifest registry');
        const manifests = manifestFile.mods as ModManifest[];
        let rawState: unknown = null;
        try {
            rawState = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
        } catch (error) {
            const code = isRecord(error) ? error.code : undefined;
            if (code !== 'ENOENT') throw error;
        }
        const state = isRecord(rawState) && rawState.schemaVersion === 1 && Number.isInteger(rawState.revision) && isRecord(rawState.mods)
            ? rawState : null;
        const stateMods = state?.mods as Record<string, unknown> | undefined;
        const mods = Object.fromEntries(manifests.map(manifest => {
            const candidate = stateMods?.[manifest.id];
            const requested = isRecord(candidate) ? candidate : null;
            const config = Object.fromEntries(manifest.settings.map(setting => [
                setting.key,
                requested && isRecord(requested.config) && ['boolean', 'number', 'string'].includes(typeof requested.config[setting.key])
                    ? requested.config[setting.key] as ConfigValue : setting.default
            ]));
            return [manifest.id, { enabled: requested?.enabled === true, config }];
        }));
        const metrics = Object.fromEntries(Object.entries(mods).map(([id, mod]) => [id, {
            status: mod.enabled ? 'active' : 'disabled', hookInvocations: 0, hookErrors: 0,
            lastHookAt: null, lastError: null, counters: {}
        } satisfies WorldModRuntimeMetrics]));
        return { schemaVersion: 1, revision: state ? Number(state.revision) : 0, loadedAt, mods, metrics, loadError: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WorldMods] Disabled all mods because configuration loading failed: ${message}`);
        return { schemaVersion: 1, revision: null, loadedAt, mods: {}, metrics: {}, loadError: message };
    }
}

const snapshot = loadSnapshot();

export function getActiveWorldMods(): ActiveWorldModSnapshot {
    return structuredClone(snapshot);
}

function incrementCounter(modId: string, key: string): void {
    const metric = snapshot.metrics[modId];
    if (metric) metric.counters[key] = (metric.counters[key] ?? 0) + 1;
}

function runHook(modId: string, action: () => void): void {
    const mod = snapshot.mods[modId];
    const metric = snapshot.metrics[modId];
    if (!mod?.enabled || !metric) return;
    metric.hookInvocations++;
    metric.lastHookAt = new Date().toISOString();
    try {
        action();
    } catch (error) {
        metric.status = 'error';
        metric.hookErrors++;
        metric.lastError = error instanceof Error ? error.message : String(error);
        console.error(`[WorldMods] ${modId} hook failed: ${metric.lastError}`);
    }
}

export function onWorldModPlayerLogin(player: Player): void {
    const modId = 'sample.welcome-message';
    runHook(modId, () => {
        const message = snapshot.mods[modId]?.config.message;
        if (typeof message !== 'string' || !message) throw new Error('Welcome message is empty');
        player.wrappedMessageGame(message);
        incrementCounter(modId, 'messagesSent');
    });
}
