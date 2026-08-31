import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { BUILTIN_WORLD_EVENT_TEMPLATES, selectWorldEvent, type WorldEventKind,
    type WorldEventSelection, type WorldEventTemplate } from './world-director.js';
import { worldDirectorConfigPath, worldDirectorDbPath } from './paths.js';

export interface WorldDirectorConfig {
    schemaVersion: 1;
    enabled: boolean;
    seed: string;
    epoch: string;
    intervalMinutes: number;
}

export type WorldDirectorCycleStatus = 'queued' | 'delivered';
export type WorldDirectorSignalStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

export interface WorldDirectorSignal {
    eventId: string;
    cycleKey: string;
    selectionDigest: string;
    kind: WorldEventKind;
    templateId: string;
    templateVersion: string;
    title: string;
    summary: string;
    regions: readonly string[];
    tags: readonly string[];
    queuedAt: string;
}

export interface WorldDirectorCycle {
    cycleKey: string;
    seed: string;
    selectionDigest: string;
    templateId: string;
    templateVersion: string;
    eventId: string;
    status: WorldDirectorCycleStatus;
    queuedAt: string;
    deliveredAt: string | null;
    revision: number;
}

export interface WorldDirectorOutboxEntry {
    signal: WorldDirectorSignal;
    status: WorldDirectorSignalStatus;
    attempts: number;
    adapterId: string | null;
    leaseToken: string | null;
    leaseExpiresAt: string | null;
    lastError: string | null;
    updatedAt: string;
    revision: number;
}

interface CycleRow {
    cycle_key: string; seed: string; selection_digest: string; template_id: string; template_version: string;
    event_id: string; status: WorldDirectorCycleStatus; queued_at: string; delivered_at: string | null; revision: number;
}
interface SignalRow {
    event_id: string; payload_json: string; status: WorldDirectorSignalStatus; attempts: number;
    adapter_id: string | null; lease_token: string | null; lease_expires_at: string | null;
    last_error: string | null; updated_at: string; revision: number;
}

function isoTime(value: string, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
    return new Date(value).toISOString();
}

function cycle(row: CycleRow): WorldDirectorCycle {
    return { cycleKey: row.cycle_key, seed: row.seed, selectionDigest: row.selection_digest,
        templateId: row.template_id, templateVersion: row.template_version, eventId: row.event_id,
        status: row.status, queuedAt: row.queued_at, deliveredAt: row.delivered_at, revision: row.revision };
}

function outbox(row: SignalRow): WorldDirectorOutboxEntry {
    return { signal: JSON.parse(row.payload_json) as WorldDirectorSignal, status: row.status,
        attempts: row.attempts, adapterId: row.adapter_id, leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at, lastError: row.last_error, updatedAt: row.updated_at,
        revision: row.revision };
}

function signalFor(selection: WorldEventSelection, queuedAt: string): WorldDirectorSignal {
    return Object.freeze({ eventId: `world-event-${selection.digest.slice(0, 24)}`, cycleKey: selection.cycleKey,
        selectionDigest: selection.digest, kind: selection.template.kind, templateId: selection.template.templateId,
        templateVersion: selection.template.version, title: selection.template.title,
        summary: selection.template.summary, regions: Object.freeze([...selection.template.regions]),
        tags: Object.freeze([...selection.template.tags]), queuedAt });
}

export function validateWorldDirectorConfig(input: unknown): WorldDirectorConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('World Director config must be an object');
    const value = input as Record<string, unknown>;
    if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean') throw new Error('World Director config version or enabled flag is invalid');
    if (typeof value.seed !== 'string' || !value.seed.trim() || value.seed.trim().length > 128) throw new Error('World Director seed is invalid');
    const epoch = isoTime(String(value.epoch ?? ''), 'epoch');
    const intervalMinutes = Number(value.intervalMinutes);
    if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10_080) {
        throw new Error('World Director intervalMinutes must be an integer from 5 to 10080');
    }
    return { schemaVersion: 1, enabled: value.enabled, seed: value.seed.trim(), epoch, intervalMinutes };
}

export function loadWorldDirectorConfig(path = worldDirectorConfigPath): WorldDirectorConfig {
    return validateWorldDirectorConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function worldDirectorCycleKey(config: WorldDirectorConfig, now: string): string | null {
    const current = Date.parse(isoTime(now, 'now'));
    const epoch = Date.parse(config.epoch);
    if (current < epoch) return null;
    const intervalMs = config.intervalMinutes * 60_000;
    return `cycle-${Math.floor((current - epoch) / intervalMs)}`;
}

export class WorldDirectorStore {
    private readonly database: Database;

    constructor(path = worldDirectorDbPath) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.database.run(`CREATE TABLE IF NOT EXISTS world_director_cycle (
            cycle_key TEXT PRIMARY KEY, seed TEXT NOT NULL, selection_digest TEXT NOT NULL,
            template_id TEXT NOT NULL, template_version TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (status IN ('queued', 'delivered')), queued_at TEXT NOT NULL,
            delivered_at TEXT, revision INTEGER NOT NULL CHECK (revision >= 1))`);
        this.database.run(`CREATE TABLE IF NOT EXISTS world_director_outbox (
            event_id TEXT PRIMARY KEY REFERENCES world_director_cycle(event_id) ON DELETE RESTRICT,
            payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
            attempts INTEGER NOT NULL CHECK (attempts >= 0), adapter_id TEXT, lease_token TEXT UNIQUE,
            lease_expires_at TEXT, last_error TEXT, updated_at TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 1))`);
    }

    close(): void { this.database.close(true); }

    getCycle(cycleKey: string): WorldDirectorCycle | null {
        const row = this.database.query('SELECT * FROM world_director_cycle WHERE cycle_key = ?1')
            .get(cycleKey) as CycleRow | null;
        return row ? cycle(row) : null;
    }

    listCycles(limit = 50): WorldDirectorCycle[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('World Director cycle limit is invalid');
        return (this.database.query(`SELECT * FROM world_director_cycle ORDER BY queued_at DESC, cycle_key DESC
            LIMIT ?1`).all(limit) as CycleRow[]).map(cycle);
    }

    getOutbox(eventId: string): WorldDirectorOutboxEntry | null {
        const row = this.database.query('SELECT * FROM world_director_outbox WHERE event_id = ?1')
            .get(eventId) as SignalRow | null;
        return row ? outbox(row) : null;
    }

    listOutbox(limit = 50): WorldDirectorOutboxEntry[] {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('World Director outbox limit is invalid');
        return (this.database.query(`SELECT * FROM world_director_outbox ORDER BY updated_at DESC, event_id DESC
            LIMIT ?1`).all(limit) as SignalRow[]).map(outbox);
    }

    enqueue(selection: WorldEventSelection, now = new Date().toISOString()):
        { cycle: WorldDirectorCycle; outbox: WorldDirectorOutboxEntry; created: boolean } {
        const queuedAt = isoTime(now, 'now');
        const signal = signalFor(selection, queuedAt);
        let created = false;
        const transaction = this.database.transaction(() => {
            const existing = this.getCycle(selection.cycleKey);
            if (existing) {
                if (existing.seed !== selection.seed || existing.selectionDigest !== selection.digest
                    || existing.eventId !== signal.eventId) {
                    throw new Error('World Director cycle key is already bound to another deterministic selection');
                }
                return;
            }
            this.database.run(`INSERT INTO world_director_cycle
                (cycle_key, seed, selection_digest, template_id, template_version, event_id, status,
                    queued_at, delivered_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, NULL, 1)`,
            [selection.cycleKey, selection.seed, selection.digest, selection.template.templateId,
                selection.template.version, signal.eventId, queuedAt]);
            this.database.run(`INSERT INTO world_director_outbox
                (event_id, payload_json, status, attempts, adapter_id, lease_token, lease_expires_at,
                    last_error, updated_at, revision)
                VALUES (?1, ?2, 'pending', 0, NULL, NULL, NULL, NULL, ?3, 1)`,
            [signal.eventId, JSON.stringify(signal), queuedAt]);
            created = true;
        });
        transaction.immediate();
        return { cycle: this.getCycle(selection.cycleKey)!, outbox: this.getOutbox(signal.eventId)!, created };
    }

    claimNext(adapterId: string, supportedKinds: readonly WorldEventKind[], leaseMs: number,
        now = new Date().toISOString()): WorldDirectorOutboxEntry | null {
        if (!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(adapterId)) throw new Error('World Director adapter id is invalid');
        if (!supportedKinds.length) return null;
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new Error('World Director lease is invalid');
        const current = isoTime(now, 'now');
        const leaseExpiresAt = new Date(Date.parse(current) + leaseMs).toISOString();
        const placeholders = supportedKinds.map((_, index) => `?${index + 2}`).join(', ');
        let claimed: WorldDirectorOutboxEntry | null = null;
        const transaction = this.database.transaction(() => {
            const row = this.database.query(`SELECT * FROM world_director_outbox
                WHERE (status IN ('pending', 'failed') OR (status = 'delivering' AND lease_expires_at <= ?1))
                AND json_extract(payload_json, '$.kind') IN (${placeholders})
                ORDER BY updated_at, event_id LIMIT 1`).get(current, ...supportedKinds) as SignalRow | null;
            if (!row) return;
            const token = randomUUID();
            const updated = this.database.run(`UPDATE world_director_outbox SET status = 'delivering',
                attempts = attempts + 1, adapter_id = ?2, lease_token = ?3, lease_expires_at = ?4,
                last_error = NULL, updated_at = ?5, revision = revision + 1
                WHERE event_id = ?1 AND revision = ?6`,
            [row.event_id, adapterId, token, leaseExpiresAt, current, row.revision]);
            if (updated.changes !== 1) throw new Error('World Director outbox changed during claim');
            claimed = this.getOutbox(row.event_id);
        });
        transaction.immediate();
        return claimed;
    }

    complete(eventId: string, leaseToken: string, now = new Date().toISOString()): WorldDirectorOutboxEntry {
        const deliveredAt = isoTime(now, 'now');
        const transaction = this.database.transaction(() => {
            const current = this.getOutbox(eventId);
            if (!current || current.status !== 'delivering' || current.leaseToken !== leaseToken) {
                throw new Error('World Director delivery lease is invalid or already used');
            }
            this.database.run(`UPDATE world_director_outbox SET status = 'delivered', lease_token = NULL,
                lease_expires_at = NULL, updated_at = ?3, revision = revision + 1
                WHERE event_id = ?1 AND lease_token = ?2`, [eventId, leaseToken, deliveredAt]);
            this.database.run(`UPDATE world_director_cycle SET status = 'delivered', delivered_at = ?2,
                revision = revision + 1 WHERE event_id = ?1 AND status = 'queued'`, [eventId, deliveredAt]);
        });
        transaction.immediate();
        return this.getOutbox(eventId)!;
    }

    fail(eventId: string, leaseToken: string, error: string,
        now = new Date().toISOString()): WorldDirectorOutboxEntry {
        const updatedAt = isoTime(now, 'now');
        const message = error.trim().slice(0, 1000);
        if (!message) throw new Error('World Director delivery failure requires an error');
        const result = this.database.run(`UPDATE world_director_outbox SET status = 'failed',
            lease_token = NULL, lease_expires_at = NULL, last_error = ?3, updated_at = ?4,
            revision = revision + 1 WHERE event_id = ?1 AND status = 'delivering' AND lease_token = ?2`,
        [eventId, leaseToken, message, updatedAt]);
        if (result.changes !== 1) throw new Error('World Director delivery lease is invalid or already used');
        return this.getOutbox(eventId)!;
    }
}

export interface TrustedWorldEventAdapter {
    readonly adapterId: string;
    readonly supportedKinds: readonly WorldEventKind[];
    /** Must deduplicate signal.eventId: a crash after publish may cause lease-based redelivery. */
    publish(signal: WorldDirectorSignal): Promise<void>;
}

export class WorldDirectorDispatcher {
    constructor(private readonly store: WorldDirectorStore, private readonly adapter: TrustedWorldEventAdapter,
        private readonly leaseMs = 30_000) {}

    async tick(now = new Date().toISOString()): Promise<WorldDirectorOutboxEntry | null> {
        const entry = this.store.claimNext(this.adapter.adapterId, this.adapter.supportedKinds, this.leaseMs, now);
        if (!entry) return null;
        try {
            await this.adapter.publish(entry.signal);
            return this.store.complete(entry.signal.eventId, entry.leaseToken!, now);
        } catch (error) {
            return this.store.fail(entry.signal.eventId, entry.leaseToken!, String(error), now);
        }
    }
}

export type WorldDirectorSchedulerResult = { status: 'disabled' | 'waiting' | 'queued' | 'already-queued';
    reason: string; cycle: WorldDirectorCycle | null };

export interface WorldDirectorSchedulerDependencies {
    loadConfig(): WorldDirectorConfig;
    templates: readonly WorldEventTemplate[];
    storePath: string;
}

export class GatewayWorldDirectorScheduler {
    constructor(private readonly dependencies: WorldDirectorSchedulerDependencies = {
        loadConfig: () => loadWorldDirectorConfig(), templates: BUILTIN_WORLD_EVENT_TEMPLATES,
        storePath: worldDirectorDbPath
    }) {}

    tick(now = new Date().toISOString()): WorldDirectorSchedulerResult {
        const config = this.dependencies.loadConfig();
        if (!config.enabled) return { status: 'disabled', reason: 'World Director is disabled.', cycle: null };
        const cycleKey = worldDirectorCycleKey(config, now);
        if (!cycleKey) return { status: 'waiting', reason: 'World Director epoch has not started.', cycle: null };
        const selection = selectWorldEvent(config.seed, cycleKey, this.dependencies.templates);
        const store = new WorldDirectorStore(this.dependencies.storePath);
        try {
            const result = store.enqueue(selection, now);
            return { status: result.created ? 'queued' : 'already-queued',
                reason: result.created ? `Queued ${result.cycle.eventId}.` : `Cycle ${cycleKey} was already queued.`,
                cycle: result.cycle };
        } finally { store.close(); }
    }
}
