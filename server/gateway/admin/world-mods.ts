import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { worldModBackupsDir, worldModManifestPath, worldModStatePath } from './paths';

export type WorldModActivation = 'hot-reload' | 'restart-required';
export type WorldModSettingType = 'boolean' | 'integer' | 'number' | 'string';
export type WorldModDisableMode = 'stateless' | 'suspend' | 'read-only' | 'blocked';

export interface WorldModDisablePolicy {
    mode: WorldModDisableMode;
    description: string;
}

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
    dataSchemaVersion: number;
    category: string;
    description: string;
    activation: WorldModActivation;
    disablePolicy: WorldModDisablePolicy;
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
    mods: Record<string, ActiveWorldModEntry>;
    loadedAt: string | null;
    lastReloadAt: string | null;
    loadError: string | null;
    metrics: Record<string, WorldModRuntimeMetrics>;
    engineReachable: boolean;
}

export interface ActiveWorldModEntry extends WorldModStateEntry {
    version: string | null;
    dataSchemaVersion: number | null;
    activation: WorldModActivation | null;
    appliedRevision: number | null;
}

export interface WorldModRuntimeMetrics {
    status: 'disabled' | 'active' | 'error';
    hookInvocations: number;
    hookErrors: number;
    lastHookAt: string | null;
    lastError: string | null;
    counters: Record<string, number>;
    details?: WorldModRuntimeDetail[];
}

export interface WorldModRuntimeDetail {
    username: string;
    activityKey: string;
    repetitionScore: number;
    nextMultiplier: number;
    updatedAt: string;
    nextRecoveryAt: string;
}

export interface WorldModView extends WorldModManifest {
    requested: WorldModStateEntry;
    active: WorldModStateEntry | null;
    runtime: WorldModRuntimeMetrics | null;
    disablePlan: WorldModDisablePlan;
    status: 'disabled' | 'active' | 'hot-reload-required' | 'restart-required' | 'migration-required' | 'rollback-required' | 'engine-unreachable' | 'activation-error';
}

export interface WorldModDisablePlan {
    mode: WorldModDisableMode;
    allowed: boolean;
    dataPreserved: boolean;
    description: string;
    blockers: string[];
}

export type WorldModBackupOperation = 'configure' | 'manual' | 'restore';

export interface WorldModBackupSummary {
    id: string;
    createdAt: string;
    operation: WorldModBackupOperation;
    reason: string;
    revision: number;
}

interface WorldModBackupFile extends WorldModBackupSummary {
    schemaVersion: 1;
    state: WorldModState;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9.-]{1,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const BACKUP_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSetting(value: unknown): value is WorldModSetting {
    if (!isRecord(value) || typeof value.key !== 'string' || !SETTING_KEY_PATTERN.test(value.key)
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
        || !Number.isInteger(value.dataSchemaVersion) || Number(value.dataSchemaVersion) < 1
        || typeof value.category !== 'string' || !value.category || value.category.length > 40
        || typeof value.description !== 'string' || !value.description || value.description.length > 400
        || !['hot-reload', 'restart-required'].includes(String(value.activation))
        || !isRecord(value.disablePolicy)
        || !['stateless', 'suspend', 'read-only', 'blocked'].includes(String(value.disablePolicy.mode))
        || typeof value.disablePolicy.description !== 'string' || !value.disablePolicy.description
        || value.disablePolicy.description.length > 240) return false;
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
    const entry = {
        enabled: value.enabled,
        config: Object.fromEntries(manifest.settings.map(setting => [
            setting.key,
            validateSetting(setting, requestedConfig[setting.key] ?? setting.default)
        ]))
    };
    validateModSpecificConfig(manifest, entry.config);
    return entry;
}

const PLAYER_SKILLS = new Set([
    'ATTACK', 'DEFENCE', 'STRENGTH', 'HITPOINTS', 'RANGED', 'PRAYER', 'MAGIC', 'COOKING', 'WOODCUTTING',
    'FLETCHING', 'FISHING', 'FIREMAKING', 'CRAFTING', 'SMITHING', 'MINING', 'HERBLORE', 'AGILITY', 'THIEVING', 'RUNECRAFT'
]);

function validateModSpecificConfig(manifest: WorldModManifest, config: Record<string, boolean | number | string>): void {
    if (manifest.id !== 'economy.diminishing-xp') return;
    const skills = String(config.affectedSkills).split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
    const unknownSkills = skills.filter(skill => !PLAYER_SKILLS.has(skill));
    if (skills.length === 0 || unknownSkills.length > 0) {
        throw new Error(`Érintett skillek: ${unknownSkills.length > 0 ? `ismeretlen nevek: ${unknownSkills.join(', ')}` : 'legalább egy skill szükséges.'}`);
    }
    const thresholds = ['tier2At', 'tier3At', 'tier4At', 'tier5At'].map(key => Number(config[key]));
    if (thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1]!)) {
        throw new Error('Az XP-lépcsők kezdeteinek szigorúan növekedniük kell.');
    }
    const multipliers = [1, ...['multiplier2', 'multiplier3', 'multiplier4', 'multiplier5'].map(key => Number(config[key]))];
    if (multipliers.some((value, index) => index > 0 && value > multipliers[index - 1]!)) {
        throw new Error('Az XP-szorzók a későbbi lépcsőkön nem növekedhetnek.');
    }
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

function validateStateSnapshot(manifests: WorldModManifest[], value: unknown): WorldModState {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isInteger(value.revision)
        || Number(value.revision) < 0 || typeof value.updatedAt !== 'string' || !isRecord(value.mods)) {
        throw new Error('A world mod backup állapota érvénytelen.');
    }
    const snapshotMods = value.mods;
    const knownIds = new Set(manifests.map(manifest => manifest.id));
    for (const id of Object.keys(snapshotMods)) if (!knownIds.has(id)) throw new Error(`A backup ismeretlen modot tartalmaz: ${id}`);
    const state: WorldModState = {
        schemaVersion: 1,
        revision: Number(value.revision),
        updatedAt: value.updatedAt,
        mods: Object.fromEntries(manifests.map(manifest => [
            manifest.id,
            snapshotMods[manifest.id] === undefined ? defaultEntry(manifest) : validateWorldModEntry(manifest, snapshotMods[manifest.id])
        ]))
    };
    validateRelationships(manifests, state);
    return state;
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

export function buildWorldModDisablePlan(
    manifest: WorldModManifest,
    manifests: WorldModManifest[],
    state: WorldModState
): WorldModDisablePlan {
    const enabledDependents = manifests
        .filter(candidate => candidate.dependencies.includes(manifest.id) && state.mods[candidate.id]?.enabled)
        .map(candidate => `${candidate.name} (${candidate.id})`);
    const blockers = [...enabledDependents];
    if (manifest.disablePolicy.mode === 'blocked') {
        blockers.unshift('Ez a mod csak külön domain-leállítási vagy migrációs folyamattal kapcsolható ki.');
    }
    return {
        mode: manifest.disablePolicy.mode,
        allowed: blockers.length === 0,
        dataPreserved: manifest.disablePolicy.mode !== 'stateless',
        description: manifest.disablePolicy.description,
        blockers
    };
}

function validateDisableTransitions(manifests: WorldModManifest[], before: WorldModState, after: WorldModState): void {
    for (const manifest of manifests) {
        if (!before.mods[manifest.id]?.enabled || after.mods[manifest.id]?.enabled) continue;
        const plan = buildWorldModDisablePlan(manifest, manifests, before);
        if (!plan.allowed) throw new Error(`${manifest.name} nem kapcsolható ki: ${plan.blockers.join(' ')}`);
    }
}

let updateQueue: Promise<void> = Promise.resolve();

function backupDirectoryFor(statePath: string): string {
    return statePath === worldModStatePath ? worldModBackupsDir : join(dirname(statePath), 'world-mod-backups');
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
}

async function createBackupFile(
    state: WorldModState,
    operation: WorldModBackupOperation,
    reason: string,
    backupsDir: string
): Promise<WorldModBackupSummary> {
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[:.]/g, '-')}_${crypto.randomUUID()}`;
    const backup: WorldModBackupFile = {
        schemaVersion: 1, id, createdAt, operation, reason: reason.trim(), revision: state.revision, state
    };
    await writeAtomic(join(backupsDir, `${id}.json`), backup);
    const { state: _state, schemaVersion: _schemaVersion, ...summary } = backup;
    return summary;
}

function queueMutation<T>(action: () => Promise<T>): Promise<T> {
    const operation = updateQueue.then(action);
    updateQueue = operation.then(() => undefined, () => undefined);
    return operation;
}

export async function listWorldModBackups(
    limit = 30,
    backupsDir = worldModBackupsDir
): Promise<WorldModBackupSummary[]> {
    let names: string[];
    try {
        names = await readdir(backupsDir);
    } catch {
        return [];
    }
    const backups = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
        try {
            const parsed = JSON.parse(await readFile(join(backupsDir, name), 'utf8')) as unknown;
            if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.id !== 'string'
                || !BACKUP_ID_PATTERN.test(parsed.id) || typeof parsed.createdAt !== 'string'
                || !['configure', 'manual', 'restore'].includes(String(parsed.operation))
                || typeof parsed.reason !== 'string' || !Number.isInteger(parsed.revision)) return null;
            return {
                id: parsed.id, createdAt: parsed.createdAt, operation: parsed.operation as WorldModBackupOperation,
                reason: parsed.reason, revision: Number(parsed.revision)
            } satisfies WorldModBackupSummary;
        } catch {
            return null;
        }
    }));
    return backups.filter((entry): entry is WorldModBackupSummary => entry !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, Math.max(1, Math.min(100, Math.trunc(limit) || 30)));
}

export function createWorldModBackup(
    reason: string,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath,
    backupsDir = backupDirectoryFor(statePath)
): Promise<WorldModBackupSummary> {
    return queueMutation(async () => {
        const manifests = await loadWorldModManifests(manifestPath);
        const state = await readWorldModState(manifests, statePath);
        return createBackupFile(state, 'manual', reason, backupsDir);
    });
}

async function performWorldModUpdate(
    modId: string,
    value: unknown,
    expectedRevision: number,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath,
    backupsDir = backupDirectoryFor(statePath),
    reason = 'World mod konfiguráció módosítása'
): Promise<{ before: WorldModState; after: WorldModState; manifest: WorldModManifest; backup: WorldModBackupSummary }> {
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
    validateDisableTransitions(manifests, before, after);
    validateRelationships(manifests, after);
    const backup = await createBackupFile(before, 'configure', reason, backupsDir);
    await writeAtomic(statePath, after);
    return { before, after, manifest, backup };
}

export function updateWorldMod(
    modId: string,
    value: unknown,
    expectedRevision: number,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath,
    backupsDir = backupDirectoryFor(statePath),
    reason = 'World mod konfiguráció módosítása'
): Promise<{ before: WorldModState; after: WorldModState; manifest: WorldModManifest; backup: WorldModBackupSummary }> {
    return queueMutation(() => performWorldModUpdate(modId, value, expectedRevision, manifestPath, statePath, backupsDir, reason));
}

export function restoreWorldModBackup(
    backupId: string,
    expectedRevision: number,
    reason: string,
    manifestPath = worldModManifestPath,
    statePath = worldModStatePath,
    backupsDir = backupDirectoryFor(statePath)
): Promise<{ before: WorldModState; after: WorldModState; restored: WorldModBackupSummary; safetyBackup: WorldModBackupSummary }> {
    return queueMutation(async () => {
        if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error('Érvénytelen world mod backup azonosító.');
        const manifests = await loadWorldModManifests(manifestPath);
        const before = await readWorldModState(manifests, statePath);
        if (before.revision !== expectedRevision) throw new Error('A modbeállítások időközben megváltoztak; frissítsd a World Admin nézetet.');
        let parsed: unknown;
        try {
            parsed = JSON.parse(await readFile(join(backupsDir, `${backupId}.json`), 'utf8')) as unknown;
        } catch {
            throw new Error('A world mod backup nem található vagy nem olvasható.');
        }
        if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.id !== backupId
            || typeof parsed.createdAt !== 'string' || typeof parsed.reason !== 'string'
            || !['configure', 'manual', 'restore'].includes(String(parsed.operation)) || !Number.isInteger(parsed.revision)) {
            throw new Error('A world mod backup fájl érvénytelen.');
        }
        const snapshot = validateStateSnapshot(manifests, parsed.state);
        const after: WorldModState = {
            ...snapshot,
            revision: before.revision + 1,
            updatedAt: new Date().toISOString()
        };
        validateDisableTransitions(manifests, before, after);
        validateRelationships(manifests, after);
        const safetyBackup = await createBackupFile(before, 'restore', reason, backupsDir);
        await writeAtomic(statePath, after);
        return {
            before, after,
            restored: {
                id: parsed.id as string, createdAt: parsed.createdAt, operation: parsed.operation as WorldModBackupOperation,
                reason: parsed.reason, revision: Number(parsed.revision)
            },
            safetyBackup
        };
    });
}

export function buildWorldModView(manifests: WorldModManifest[], requested: WorldModState, active: ActiveWorldModState): WorldModView[] {
    return manifests.map(manifest => {
        const desired = requested.mods[manifest.id] ?? defaultEntry(manifest);
        const running = active.mods[manifest.id] ?? null;
        const runtime = active.metrics[manifest.id] ?? null;
        const matches = !!running && running.enabled === desired.enabled && JSON.stringify(running.config) === JSON.stringify(desired.config);
        const schemaStatus: WorldModView['status'] | null = running?.dataSchemaVersion !== null && running?.dataSchemaVersion !== undefined
            ? manifest.dataSchemaVersion > running.dataSchemaVersion ? 'migration-required'
                : manifest.dataSchemaVersion < running.dataSchemaVersion ? 'rollback-required' : null
            : null;
        const status: WorldModView['status'] = !active.engineReachable ? 'engine-unreachable'
            : active.loadError || runtime?.status === 'error' ? 'activation-error'
                : schemaStatus ?? (matches ? (desired.enabled ? 'active' : 'disabled')
                    : manifest.activation === 'hot-reload' ? 'hot-reload-required' : 'restart-required');
        return {
            ...manifest,
            requested: desired,
            active: running,
            runtime,
            disablePlan: buildWorldModDisablePlan(manifest, manifests, requested),
            status
        };
    });
}

function unreachableActiveState(): ActiveWorldModState {
    return { revision: null, mods: {}, loadedAt: null, lastReloadAt: null, loadError: null, metrics: {}, engineReachable: false };
}

export async function readActiveWorldMods(): Promise<ActiveWorldModState> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    const baseUrl = (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, '');
    if (!token) return unreachableActiveState();
    try {
        const response = await fetch(`${baseUrl}/api/internal/admin/world-mods`, {
            headers: { 'X-Engine-Admin-Token': token },
            signal: AbortSignal.timeout(3_000)
        });
        if (!response.ok) return unreachableActiveState();
        const parsed = await response.json() as unknown;
        if (!isRecord(parsed) || (parsed.revision !== null && !Number.isInteger(parsed.revision)) || !isRecord(parsed.mods)) {
            return unreachableActiveState();
        }
        const mods: ActiveWorldModState['mods'] = {};
        for (const [id, value] of Object.entries(parsed.mods)) {
            if (isRecord(value) && typeof value.enabled === 'boolean' && isRecord(value.config)) {
                mods[id] = {
                    enabled: value.enabled, config: value.config as Record<string, boolean | number | string>,
                    version: typeof value.version === 'string' ? value.version : null,
                    dataSchemaVersion: Number.isInteger(value.dataSchemaVersion) ? Number(value.dataSchemaVersion) : null,
                    activation: ['hot-reload', 'restart-required'].includes(String(value.activation)) ? value.activation as WorldModActivation : null,
                    appliedRevision: Number.isInteger(value.appliedRevision) ? Number(value.appliedRevision) : null
                };
            }
        }
        const metrics: ActiveWorldModState['metrics'] = {};
        if (isRecord(parsed.metrics)) {
            for (const [id, value] of Object.entries(parsed.metrics)) {
                if (!isRecord(value) || !['disabled', 'active', 'error'].includes(String(value.status))
                    || !Number.isInteger(value.hookInvocations) || !Number.isInteger(value.hookErrors)
                    || (value.lastHookAt !== null && typeof value.lastHookAt !== 'string')
                    || (value.lastError !== null && typeof value.lastError !== 'string') || !isRecord(value.counters)) continue;
                const counters = Object.fromEntries(Object.entries(value.counters)
                    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
                const details = Array.isArray(value.details) ? value.details.filter((entry): entry is WorldModRuntimeDetail => {
                    if (!isRecord(entry)) return false;
                    return typeof entry.username === 'string' && typeof entry.activityKey === 'string'
                        && typeof entry.repetitionScore === 'number' && Number.isFinite(entry.repetitionScore)
                        && typeof entry.nextMultiplier === 'number' && Number.isFinite(entry.nextMultiplier)
                        && typeof entry.updatedAt === 'string' && typeof entry.nextRecoveryAt === 'string';
                }) : [];
                metrics[id] = {
                    status: value.status as WorldModRuntimeMetrics['status'],
                    hookInvocations: Number(value.hookInvocations), hookErrors: Number(value.hookErrors),
                    lastHookAt: value.lastHookAt as string | null, lastError: value.lastError as string | null, counters, details
                };
            }
        }
        return {
            revision: parsed.revision as number | null, mods, metrics, engineReachable: true,
            loadedAt: typeof parsed.loadedAt === 'string' ? parsed.loadedAt : null,
            lastReloadAt: typeof parsed.lastReloadAt === 'string' ? parsed.lastReloadAt : null,
            loadError: typeof parsed.loadError === 'string' ? parsed.loadError : null
        };
    } catch {
        return unreachableActiveState();
    }
}

export interface WorldModHotReloadReport {
    appliedIds: string[];
    pendingRestartIds: string[];
    migrationRequiredIds: string[];
    rollbackRequiredIds: string[];
}

export async function requestWorldModHotReload(): Promise<WorldModHotReloadReport> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
    const baseUrl = (process.env.ENGINE_ADMIN_URL?.trim() || 'http://localhost:8888').replace(/\/$/, '');
    if (!token) throw new Error('Az engine admin token nincs beállítva.');
    const response = await fetch(`${baseUrl}/api/internal/admin/world-mods/reload`, {
        method: 'POST', headers: { 'X-Engine-Admin-Token': token }, signal: AbortSignal.timeout(5_000)
    });
    const parsed = await response.json() as unknown;
    if (!response.ok || !isRecord(parsed)) throw new Error(isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : 'A hot reload sikertelen.');
    const list = (key: string): string[] => Array.isArray(parsed[key]) ? parsed[key].filter((value): value is string => typeof value === 'string') : [];
    return {
        appliedIds: list('appliedIds'), pendingRestartIds: list('pendingRestartIds'),
        migrationRequiredIds: list('migrationRequiredIds'), rollbackRequiredIds: list('rollbackRequiredIds')
    };
}

export async function listWorldMods(): Promise<{ revision: number; updatedAt: string; activeRevision: number | null; engineLoadedAt: string | null; engineLastReloadAt: string | null; engineLoadError: string | null; mods: WorldModView[] }> {
    const manifests = await loadWorldModManifests();
    const requested = await readWorldModState(manifests);
    const active = await readActiveWorldMods();
    return {
        revision: requested.revision,
        updatedAt: requested.updatedAt,
        activeRevision: active.revision,
        engineLoadedAt: active.loadedAt,
        engineLastReloadAt: active.lastReloadAt,
        engineLoadError: active.loadError,
        mods: buildWorldModView(manifests, requested, active)
    };
}
