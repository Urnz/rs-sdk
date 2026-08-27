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

export interface ActiveWorldModSnapshot {
    schemaVersion: 1;
    revision: number | null;
    loadedAt: string;
    mods: Record<string, ActiveMod>;
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
        return { schemaVersion: 1, revision: state ? Number(state.revision) : 0, loadedAt, mods, loadError: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WorldMods] Disabled all mods because configuration loading failed: ${message}`);
        return { schemaVersion: 1, revision: null, loadedAt, mods: {}, loadError: message };
    }
}

const snapshot = loadSnapshot();

export function getActiveWorldMods(): ActiveWorldModSnapshot {
    return structuredClone(snapshot);
}

export function onWorldModPlayerLogin(player: Player): void {
    const welcome = snapshot.mods['sample.welcome-message'];
    const message = welcome?.config.message;
    if (welcome?.enabled && typeof message === 'string' && message) player.wrappedMessageGame(message);
}
