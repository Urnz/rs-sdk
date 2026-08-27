import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Player from '#/engine/entity/Player.js';

type ConfigValue = boolean | number | string;
export type WorldModActivation = 'hot-reload' | 'restart-required';

interface ModManifest {
    id: string;
    version: string;
    dataSchemaVersion: number;
    activation: WorldModActivation;
    settings: Array<{ key: string; default: ConfigValue }>;
}

export interface ActiveMod {
    enabled: boolean;
    config: Record<string, ConfigValue>;
    version: string;
    dataSchemaVersion: number;
    activation: WorldModActivation;
    appliedRevision: number;
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
    lastReloadAt: string | null;
    mods: Record<string, ActiveMod>;
    metrics: Record<string, WorldModRuntimeMetrics>;
    loadError: string | null;
}

export interface HotReloadResult {
    snapshot: ActiveWorldModSnapshot;
    appliedIds: string[];
    pendingRestartIds: string[];
    migrationRequiredIds: string[];
    rollbackRequiredIds: string[];
}

const manifestPath = fileURLToPath(new URL('../../../../config/world-mods.json', import.meta.url));
const statePath = fileURLToPath(new URL('../../../../.local/admin/world-mod-state.json', import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validManifest(value: unknown): value is ModManifest {
    return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'string'
        && Number.isInteger(value.dataSchemaVersion) && Number(value.dataSchemaVersion) >= 1
        && ['hot-reload', 'restart-required'].includes(String(value.activation))
        && Array.isArray(value.settings) && value.settings.every(setting => isRecord(setting)
            && typeof setting.key === 'string' && ['boolean', 'number', 'string'].includes(typeof setting.default));
}

function emptyMetrics(enabled: boolean): WorldModRuntimeMetrics {
    return {
        status: enabled ? 'active' : 'disabled', hookInvocations: 0, hookErrors: 0,
        lastHookAt: null, lastError: null, counters: {}
    };
}

function loadSnapshot(): ActiveWorldModSnapshot {
    const loadedAt = new Date().toISOString();
    try {
        const manifestFile = JSON.parse(readFileSync(manifestPath, 'utf8')) as { schemaVersion?: unknown; mods?: unknown };
        if (manifestFile.schemaVersion !== 1 || !Array.isArray(manifestFile.mods) || !manifestFile.mods.every(validManifest)) {
            throw new Error('invalid manifest registry');
        }
        const manifests = manifestFile.mods;
        let rawState: unknown = null;
        try {
            rawState = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
        } catch (error) {
            const code = isRecord(error) ? error.code : undefined;
            if (code !== 'ENOENT') throw error;
        }
        const state = isRecord(rawState) && rawState.schemaVersion === 1 && Number.isInteger(rawState.revision) && isRecord(rawState.mods)
            ? rawState : null;
        if (rawState !== null && !state) throw new Error('invalid world mod state');
        const revision = state ? Number(state.revision) : 0;
        const stateMods = state?.mods as Record<string, unknown> | undefined;
        const mods = Object.fromEntries(manifests.map(manifest => {
            const candidate = stateMods?.[manifest.id];
            const requested = isRecord(candidate) ? candidate : null;
            const config = Object.fromEntries(manifest.settings.map(setting => [
                setting.key,
                requested && isRecord(requested.config) && ['boolean', 'number', 'string'].includes(typeof requested.config[setting.key])
                    ? requested.config[setting.key] as ConfigValue : setting.default
            ]));
            return [manifest.id, {
                enabled: requested?.enabled === true, config, version: manifest.version,
                dataSchemaVersion: manifest.dataSchemaVersion, activation: manifest.activation, appliedRevision: revision
            } satisfies ActiveMod];
        }));
        const metrics = Object.fromEntries(Object.entries(mods).map(([id, mod]) => [id, emptyMetrics(mod.enabled)]));
        return { schemaVersion: 1, revision, loadedAt, lastReloadAt: null, mods, metrics, loadError: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WorldMods] Disabled all mods because configuration loading failed: ${message}`);
        return { schemaVersion: 1, revision: null, loadedAt, lastReloadAt: null, mods: {}, metrics: {}, loadError: message };
    }
}

function sameRuntimeConfig(left: ActiveMod, right: ActiveMod): boolean {
    return left.enabled === right.enabled && JSON.stringify(left.config) === JSON.stringify(right.config);
}

export function mergeHotReloadSnapshot(current: ActiveWorldModSnapshot, candidate: ActiveWorldModSnapshot): HotReloadResult {
    if (candidate.loadError || candidate.revision === null) throw new Error(candidate.loadError || 'candidate configuration is invalid');
    const next = structuredClone(current);
    const result: HotReloadResult = {
        snapshot: next, appliedIds: [], pendingRestartIds: [], migrationRequiredIds: [], rollbackRequiredIds: []
    };
    for (const [id, desired] of Object.entries(candidate.mods)) {
        const active = current.mods[id];
        if (desired.activation === 'restart-required') {
            if (!active || !sameRuntimeConfig(active, desired) || active.version !== desired.version
                || active.dataSchemaVersion !== desired.dataSchemaVersion) result.pendingRestartIds.push(id);
            continue;
        }
        if (active && desired.dataSchemaVersion > active.dataSchemaVersion) {
            result.migrationRequiredIds.push(id);
            continue;
        }
        if (active && desired.dataSchemaVersion < active.dataSchemaVersion) {
            result.rollbackRequiredIds.push(id);
            continue;
        }
        next.mods[id] = desired;
        next.metrics[id] = current.metrics[id] ?? emptyMetrics(desired.enabled);
        next.metrics[id]!.status = desired.enabled ? 'active' : 'disabled';
        next.mods[id]!.appliedRevision = candidate.revision;
        result.appliedIds.push(id);
    }
    next.revision = candidate.revision;
    next.lastReloadAt = new Date().toISOString();
    next.loadError = null;
    return result;
}

let snapshot = loadSnapshot();

export function getActiveWorldMods(): ActiveWorldModSnapshot {
    return structuredClone(snapshot);
}

export function reloadHotWorldMods(): HotReloadResult {
    const result = mergeHotReloadSnapshot(snapshot, loadSnapshot());
    snapshot = result.snapshot;
    return { ...result, snapshot: getActiveWorldMods() };
}

export interface WorldModPlayerTarget {
    wrappedMessageGame(message: string): void;
}

function incrementCounter(activeSnapshot: ActiveWorldModSnapshot, modId: string, key: string): void {
    const metric = activeSnapshot.metrics[modId];
    if (metric) metric.counters[key] = (metric.counters[key] ?? 0) + 1;
}

function runHook(activeSnapshot: ActiveWorldModSnapshot, modId: string, action: () => void): void {
    const mod = activeSnapshot.mods[modId];
    const metric = activeSnapshot.metrics[modId];
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

function sendLoginMessage(activeSnapshot: ActiveWorldModSnapshot, player: WorldModPlayerTarget, modId: string): void {
    runHook(activeSnapshot, modId, () => {
        const message = activeSnapshot.mods[modId]?.config.message;
        if (typeof message !== 'string' || !message) throw new Error('Login message is empty');
        player.wrappedMessageGame(message);
        incrementCounter(activeSnapshot, modId, 'messagesSent');
    });
}

export function runWorldModPlayerLoginHooks(activeSnapshot: ActiveWorldModSnapshot, player: WorldModPlayerTarget): void {
    sendLoginMessage(activeSnapshot, player, 'sample.welcome-message');
    sendLoginMessage(activeSnapshot, player, 'sample.restart-message');
}

export function onWorldModPlayerLogin(player: Player): void {
    runWorldModPlayerLoginHooks(snapshot, player);
}
