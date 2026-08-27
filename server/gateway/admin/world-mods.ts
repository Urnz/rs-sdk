import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { worldModManifestPath, worldModStatePath } from './paths';

export type WorldModActivation = 'hot-reload' | 'restart-required';
export type WorldModSettingType = 'boolean' | 'integer' | 'number' | 'string';

export interface WorldModSetting {
    key: string;
    label: string;
    type: WorldModSettingType;
    default: boolean | number | string;
    minimum?: number;
    maximum?: number;
    description: string;
}

export interface WorldModManifest {
    id: string;
    name: string;
    version: string;
    category: string;
    description: string;
    activation: WorldModActivation;
    hooks: string[];
    dependencies: string[];
    conflicts: string[];
    settings: WorldModSetting[];
}

export interface WorldModStateEntry {
    enabled: boolean;
    config: Record<string, boolean | number | string>;
}

export interface WorldModState {
    schemaVersion: 1;
    revision: number;
    updatedAt: string;
    mods: Record<string, WorldModStateEntry>;
}

export interface ActiveWorldModState {
    revision: number | null;
    mods: Record<string, { enabled: boolean; config: Record<string, boolean | number | string> }>;
    engineReachable: boolean;
}

export interface WorldModView extends WorldModManifest {
    requested: WorldModStateEntry;
    active: WorldModStateEntry | null;
    status: 'disabled' | 'active' | 'restart-required' | 'engine-unreachable';
}

const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSetting(value: unknown): value is WorldModSetting {
    if (!isRecord(value) || typeof value.key !== 'string' || !ID_PATTERN.test(value.key)
        || typeof value.label !== 'string' || !value.label || value.label.length > 80
        || !['boolean', 'integer', 'number', 'string'].includes(String(value.type))
        || typeof value.description !== 'string' || value.description.length > 240) return false;
    if (!['boolean', 'number', 'string'].includes(typeof value.default)) return false;
    return (value.minimum === undefined || typeof value.minimum === 'number')
        && (value.maximum === undefined || typeof value.maximum === 'number');
}

function validManifest(value: unknown): value is WorldModManifest {
    if (!isRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)
        || typeof value.name !== 'string' || !value.name || value.name.length > 80
        || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)
        || typeof value.category !== 'string' || !value.category || value.category.length > 40
        || typeof value.description !== 'string' || !value.description || value.description.length > 400
        || !['hot-reload', 'restart-required'].includes(String(value.activation))) return false;
    return Array.isArray(value.hooks) && value.hooks.every(entry => typeof entry === 'string')
        && Array.isArray(value.dependencies) && value.dependencies.every(entry => typeof entry === 'string' && ID_PATTERN.test(entry))
        && Array.isArray(value.conflicts) && value.conflicts.every(entry => typeof entry === 'string' && ID_PATTERN.test(entry))
        && Array.isArray(value.settings) && value.settings.every(validSetting);
}

export async function loadWorldModManifests(path = worldModManifestPath): Promise<WorldModManifest[]> {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.mods) || !parsed.mods.every(validManifest)) {
        throw new Error('A world mod manifest fájl érvénytelen.');
    }
    const manifests = parsed.mods as WorldModManifest[];
    const ids = new Set(manifests.map(manifest => manifest.id));
    if (ids.size !== manifests.length) throw new Error('A world mod manifest ismétlődő azonosítót tartalmaz.');
    for (const manifest of manifests) {
        if (new Set(manifest.settings.map(setting => setting.key)).size !== manifest.settings.length) {
            throw new Error(`Ismétlődő beállításkulcs: ${manifest.id}`);
        }
        for (const dependency of manifest.dependencies) if (!ids.has(dependency)) throw new Error(`Hiányzó modfüggőség: ${manifest.id} -> ${dependency}`);
        for (const conflict of manifest.conflicts) if (!ids.has(conflict)) throw new Error(`Ismeretlen modütközés: ${manifest.id} -> ${conflict}`);
    }
    return manifests;
}

function defaultEntry(manifest: WorldModManifest): WorldModStateEntry {
    return { enabled: false, config: Object.fromEntries(manifest.settings.map(setting => [setting.key, setting.default])) };
}

function validateSetting(setting: WorldModSetting, value: unknown): boolean | number | string {
    if (setting.type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`${setting.label}: logikai érték szükséges.`);
        return value;
    }
    if (setting.type === 'string') {
        if (typeof value !== 'string') throw new Error(`${setting.label}: szöveg szükséges.`);
        const length = value.trim().length;
        if (setting.minimum !== undefined && length < setting.minimum) throw new Error(`${setting.label}: legalább ${setting.minimum} karakter szükséges.`);
        if (setting.maximum !== undefined && length > setting.maximum) throw new Error(`${setting.label}: legfeljebb ${setting.maximum} karakter lehet.`);
        return value.trim();
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || (setting.type === 'integer' && !Number.isInteger(value))) {
        throw new Error(`${setting.label}: ${setting.type === 'integer' ? 'egész szám' : 'szám'} szükséges.`);
    }
    if (setting.minimum !== undefined && value < setting.minimum) throw new Error(`${setting.label}: minimum ${setting.minimum}.`);
    if (setting.maximum !== undefined && value > setting.maximum) throw new Error(`${setting.label}: maximum ${setting.maximum}.`);
    return value;
}

export function validateWorldModEntry(manifest: WorldModManifest, value: unknown): WorldModStateEntry {
    if (!isRecord(value) || typeof value.enabled !== 'boolean' || !isRecord(value.config)) throw new Error(`Érvénytelen modbeállítás: ${manifest.id}`);
    const requestedConfig = value.config;
    const known = new Set(manifest.settings.map(setting => setting.key));
    for (const key of Object.keys(requestedConfig)) if (!known.has(key)) throw new Error(`Ismeretlen beállítás: ${manifest.id}.${key}`);
    return {
        enabled: value.enabled,
        config: Object.fromEntries(manifest.settings.map(setting => [
            setting.key,
            validateSetting(setting, requestedConfig[setting.key] ?? setting.default)
        ]))
    };
}

export async function readWorldModState(manifests: WorldModManifest[], path = worldModStatePath): Promise<WorldModState> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
        parsed = null;
    }
    const raw = isRecord(parsed) && parsed.schemaVersion === 1 && Number.isInteger(parsed.revision) && isRecord(parsed.mods) ? parsed : null;
    const rawMods = raw?.mods as Record<string, unknown> | undefined;
    const mods = Object.fromEntries(manifests.map(manifest => {
        const entry = rawMods?.[manifest.id];
        return [manifest.id, entry === undefined ? defaultEntry(manifest) : validateWorldModEntry(manifest, entry)];
    }));
    return {
        schemaVersion: 1,
        revision: raw ? Number(raw.revision) : 0,
        updatedAt: raw && typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
        mods
    };
}

function validateRelationships(manifests: WorldModManifest[], state: WorldModState): void {
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]));
    for (const [id, entry] of Object.entries(state.mods)) {
        if (!entry.enabled) continue;
        const manifest = byId.get(id)!;
        for (const dependency of manifest.dependencies) if (!state.mods[dependency]?.enabled) throw new Error(`${manifest.name} függősége nincs engedélyezve: ${dependency}`);
        for (const conflict of manifest.conflicts) if (state.mods[conflict]?.enabled) throw new Error(`${manifest.name} ütközik ezzel a moddal: ${conflict}`);
    }
}

let updateQueue: Promise<void> = Promise.resolve();

async function performWorldModUpdate(
    modId: string,
    value: unknown,
    expectedRevision: number,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath
): Promise<{ before: WorldModState; after: WorldModState; manifest: WorldModManifest }> {
    const manifests = await loadWorldModManifests(manifestPath);
    const manifest = manifests.find(entry => entry.id === modId);
    if (!manifest) throw new Error(`Ismeretlen world mod: ${modId}`);
    const before = await readWorldModState(manifests, statePath);
    if (before.revision !== expectedRevision) throw new Error('A modbeállítások időközben megváltoztak; frissítsd a World Admin nézetet.');
    const after: WorldModState = {
        ...before,
        revision: before.revision + 1,
        updatedAt: new Date().toISOString(),
        mods: { ...before.mods, [modId]: validateWorldModEntry(manifest, value) }
    };
    validateRelationships(manifests, after);
    await mkdir(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(after, null, 2)}\n`, 'utf8');
    await rename(temporary, statePath);
    return { before, after, manifest };
}

export function updateWorldMod(
    modId: string,
    value: unknown,
    expectedRevision: number,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath
): Promise<{ before: WorldModState; after: WorldModState; manifest: WorldModManifest }> {
    const operation = updateQueue.then(() => performWorldModUpdate(modId, value, expectedRevision, manifestPath, statePath));
    updateQueue = operation.then(() => undefined, () => undefined);
    return operation;
}

export function buildWorldModView(manifests: WorldModManifest[], requested: WorldModState, active: ActiveWorldModState): WorldModView[] {
    return manifests.map(manifest => {
        const desired = requested.mods[manifest.id] ?? defaultEntry(manifest);
        const running = active.mods[manifest.id] ?? null;
        const matches = !!running && running.enabled === desired.enabled && JSON.stringify(running.config) === JSON.stringify(desired.config);
        const status: WorldModView['status'] = !active.engineReachable ? 'engine-unreachable'
            : matches ? (desired.enabled ? 'active' : 'disabled') : 'restart-required';
        return { ...manifest, requested: desired, active: running, status };
    });
}

export async function readActiveWorldMods(): Promise<ActiveWorldModState> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    const baseUrl = (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, '');
    if (!token) return { revision: null, mods: {}, engineReachable: false };
    try {
        const response = await fetch(`${baseUrl}/api/internal/admin/world-mods`, {
            headers: { 'X-Engine-Admin-Token': token },
            signal: AbortSignal.timeout(3_000)
        });
        if (!response.ok) return { revision: null, mods: {}, engineReachable: false };
        const parsed = await response.json() as unknown;
        if (!isRecord(parsed) || (parsed.revision !== null && !Number.isInteger(parsed.revision)) || !isRecord(parsed.mods)) {
            return { revision: null, mods: {}, engineReachable: false };
        }
        const mods: ActiveWorldModState['mods'] = {};
        for (const [id, value] of Object.entries(parsed.mods)) {
            if (isRecord(value) && typeof value.enabled === 'boolean' && isRecord(value.config)) {
                mods[id] = { enabled: value.enabled, config: value.config as Record<string, boolean | number | string> };
            }
        }
        return { revision: parsed.revision as number | null, mods, engineReachable: true };
    } catch {
        return { revision: null, mods: {}, engineReachable: false };
    }
}

export async function listWorldMods(): Promise<{ revision: number; updatedAt: string; activeRevision: number | null; mods: WorldModView[] }> {
    const manifests = await loadWorldModManifests();
    const requested = await readWorldModState(manifests);
    const active = await readActiveWorldMods();
    return {
        revision: requested.revision,
        updatedAt: requested.updatedAt,
        activeRevision: active.revision,
        mods: buildWorldModView(manifests, requested, active)
    };
}
