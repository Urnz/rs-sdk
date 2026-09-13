import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { LlmReplanEvent, LlmReplanEventType } from '../../../llm-runtime/events.js';

export type ReplanInboxStatus = 'pending' | 'claimed' | 'completed' | 'discarded';

export interface ReplanInboxRecord {
    event: LlmReplanEvent;
    payloadDigest: string;
    status: ReplanInboxStatus;
    attempt: number;
    nextAttemptAt: string;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    terminalOutcome: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

interface InboxRow {
    event_id: string; agent_id: string; event_type: LlmReplanEventType; source_key: string;
    payload: string; payload_digest: string; status: ReplanInboxStatus; attempt: number;
    next_attempt_at: string; lease_owner: string | null; lease_expires_at: string | null;
    terminal_outcome: string | null; last_error: string | null; created_at: string;
    updated_at: string; revision: number;
}

const EVENT_TYPES = new Set<LlmReplanEventType>(['manual-request', 'skill-finished', 'skill-failed',
    'goal-changed', 'unexpected-world-event', 'offer-received', 'significant-economic-change',
    'capability-ready', 'economic-contract-changed', 'player-action-changed', 'business-work-available',
    'property-changed', 'governance-changed', 'allowlisted-world-event',
    'autonomy-startup', 'autonomy-reconnect', 'autonomy-idle']);

function iso(value: string, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
    return value;
}

function canonicalEvent(event: LlmReplanEvent): LlmReplanEvent {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId)) {
        throw new Error('Replan event id must be a UUID');
    }
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(event.agentId)) throw new Error('Replan event agent id is invalid');
    if (!EVENT_TYPES.has(event.type)) throw new Error('Replan event type is invalid');
    const sourceKey = event.sourceKey.trim();
    const summary = event.summary.trim();
    const selectionSeed = event.selectionSeed?.trim();
    if (!sourceKey || sourceKey.length > 500) throw new Error('Replan event source key is invalid');
    if (!summary || summary.length > 1_000) throw new Error('Replan event summary is invalid');
    if (selectionSeed !== undefined && (!selectionSeed || selectionSeed.length > 256)) {
        throw new Error('Replan event selection seed is invalid');
    }
    return { eventId: event.eventId, agentId: event.agentId, type: event.type, sourceKey,
        occurredAt: iso(event.occurredAt, 'Replan event occurrence'), summary,
        ...(selectionSeed ? { selectionSeed } : {}) };
}

function payloadForDigest(event: LlmReplanEvent): string {
    return JSON.stringify({ agentId: event.agentId, type: event.type, sourceKey: event.sourceKey,
        occurredAt: event.occurredAt, summary: event.summary, selectionSeed: event.selectionSeed ?? null });
}

function record(row: InboxRow): ReplanInboxRecord {
    return { event: JSON.parse(row.payload) as LlmReplanEvent, payloadDigest: row.payload_digest,
        status: row.status, attempt: row.attempt, nextAttemptAt: row.next_attempt_at,
        leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
        terminalOutcome: row.terminal_outcome, lastError: row.last_error,
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}

export class ReplanInboxStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA journal_mode = WAL');
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Replan inbox schema ${version} is newer than supported version 1`);
        if (version < 1) {
            const transaction = this.database.transaction(() => {
                this.database.run(`CREATE TABLE replan_inbox (
                    event_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, event_type TEXT NOT NULL, source_key TEXT NOT NULL,
                    payload TEXT NOT NULL, payload_digest TEXT NOT NULL, status TEXT NOT NULL
                        CHECK (status IN ('pending', 'claimed', 'completed', 'discarded')),
                    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 1000), next_attempt_at TEXT NOT NULL,
                    lease_owner TEXT, lease_expires_at TEXT, terminal_outcome TEXT, last_error TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
                    UNIQUE (agent_id, event_type, source_key),
                    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
                    CHECK ((status = 'claimed') = (lease_owner IS NOT NULL)),
                    CHECK ((status IN ('completed', 'discarded')) = (terminal_outcome IS NOT NULL)))`);
                this.database.run(`CREATE INDEX replan_inbox_due
                    ON replan_inbox(status, next_attempt_at, event_id)`);
                this.database.run('PRAGMA user_version = 1');
            });
            transaction.immediate();
        }
    }

    close(): void { this.database.close(true); }

    get(eventId: string): ReplanInboxRecord | null {
        const row = this.database.query('SELECT * FROM replan_inbox WHERE event_id = ?1').get(eventId) as InboxRow | null;
        return row ? record(row) : null;
    }

    listTerminal(limit = 10_000): ReplanInboxRecord[] {
        if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('Replan terminal list limit is invalid');
        return (this.database.query(`SELECT * FROM replan_inbox
            WHERE status IN ('completed', 'discarded') ORDER BY updated_at DESC, event_id LIMIT ?1`)
            .all(limit) as InboxRow[]).map(record);
    }

    listForAgent(agentId: string, limit = 1_000): ReplanInboxRecord[] {
        if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(agentId)) throw new Error('Replan event agent id is invalid');
        if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Replan inbox list limit is invalid');
        return (this.database.query(`SELECT * FROM replan_inbox WHERE agent_id = ?1
            ORDER BY created_at, event_id LIMIT ?2`).all(agentId, limit) as InboxRow[]).map(record);
    }

    nextClaimableForAgent(agentId: string, now = new Date().toISOString()): ReplanInboxRecord | null {
        if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(agentId)) throw new Error('Replan event agent id is invalid');
        iso(now, 'Replan inbox lookup time');
        const row = this.database.query(`SELECT * FROM replan_inbox WHERE agent_id = ?1 AND
            ((status = 'pending' AND next_attempt_at <= ?2)
                OR (status = 'claimed' AND lease_expires_at <= ?2))
            ORDER BY next_attempt_at, event_id LIMIT 1`).get(agentId, now) as InboxRow | null;
        return row ? record(row) : null;
    }

    enqueue(input: LlmReplanEvent, now = new Date().toISOString()): { created: boolean; record: ReplanInboxRecord } {
        const event = canonicalEvent(input);
        iso(now, 'Replan inbox enqueue time');
        const digest = createHash('sha256').update(payloadForDigest(event)).digest('hex');
        let outcome: { created: boolean; record: ReplanInboxRecord } | null = null;
        const transaction = this.database.transaction(() => {
            const existing = this.database.query(`SELECT * FROM replan_inbox
                WHERE agent_id = ?1 AND event_type = ?2 AND source_key = ?3`)
                .get(event.agentId, event.type, event.sourceKey) as InboxRow | null;
            if (existing) {
                if (existing.payload_digest !== digest) {
                    throw new Error('Replan source key was reused with a different payload');
                }
                outcome = { created: false, record: record(existing) };
                return;
            }
            this.database.run(`INSERT INTO replan_inbox
                (event_id, agent_id, event_type, source_key, payload, payload_digest, status, attempt,
                next_attempt_at, lease_owner, lease_expires_at, terminal_outcome, last_error, created_at, updated_at, revision)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, NULL, NULL, NULL, NULL, ?7, ?7, 1)`,
            [event.eventId, event.agentId, event.type, event.sourceKey, JSON.stringify(event), digest, now]);
            outcome = { created: true, record: this.get(event.eventId)! };
        });
        transaction.immediate();
        return outcome!;
    }

    claimDue(leaseOwner: string, leaseExpiresAt: string, limit = 25,
        now = new Date().toISOString()): ReplanInboxRecord[] {
        const owner = leaseOwner.trim();
        if (!owner || owner.length > 160) throw new Error('Replan inbox lease owner is invalid');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Replan inbox claim limit is invalid');
        const current = Date.parse(iso(now, 'Replan inbox claim time'));
        if (Date.parse(iso(leaseExpiresAt, 'Replan inbox lease expiry')) <= current) {
            throw new Error('Replan inbox lease must expire after claim time');
        }
        const claimed: string[] = [];
        const transaction = this.database.transaction(() => {
            this.database.run(`UPDATE replan_inbox SET status = 'pending', lease_owner = NULL,
                lease_expires_at = NULL, next_attempt_at = ?1, updated_at = ?1, revision = revision + 1
                WHERE status = 'claimed' AND lease_expires_at <= ?1`, [now]);
            const rows = this.database.query(`SELECT event_id FROM replan_inbox
                WHERE status = 'pending' AND next_attempt_at <= ?1 ORDER BY next_attempt_at, event_id LIMIT ?2`)
                .all(now, limit) as { event_id: string }[];
            for (const row of rows) {
                const changed = this.database.run(`UPDATE replan_inbox SET status = 'claimed', attempt = attempt + 1,
                    lease_owner = ?2, lease_expires_at = ?3, updated_at = ?4, revision = revision + 1
                    WHERE event_id = ?1 AND status = 'pending'`, [row.event_id, owner, leaseExpiresAt, now]);
                if (changed.changes === 1) claimed.push(row.event_id);
            }
        });
        transaction.immediate();
        return claimed.map(eventId => this.get(eventId)!);
    }

    claim(eventId: string, leaseOwner: string, leaseExpiresAt: string,
        now = new Date().toISOString()): ReplanInboxRecord | null {
        const owner = leaseOwner.trim();
        if (!owner || owner.length > 160) throw new Error('Replan inbox lease owner is invalid');
        const current = Date.parse(iso(now, 'Replan inbox claim time'));
        if (Date.parse(iso(leaseExpiresAt, 'Replan inbox lease expiry')) <= current) {
            throw new Error('Replan inbox lease must expire after claim time');
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`UPDATE replan_inbox SET status = 'pending', lease_owner = NULL,
                lease_expires_at = NULL, next_attempt_at = ?2, updated_at = ?2, revision = revision + 1
                WHERE event_id = ?1 AND status = 'claimed' AND lease_expires_at <= ?2`, [eventId, now]);
            this.database.run(`UPDATE replan_inbox SET status = 'claimed', attempt = attempt + 1,
                lease_owner = ?2, lease_expires_at = ?3, updated_at = ?4, revision = revision + 1
                WHERE event_id = ?1 AND status = 'pending' AND next_attempt_at <= ?4`,
            [eventId, owner, leaseExpiresAt, now]);
        });
        transaction.immediate();
        const currentRecord = this.get(eventId);
        return currentRecord?.status === 'claimed' && currentRecord.leaseOwner === owner ? currentRecord : null;
    }

    resolve(eventId: string, expectedRevision: number, leaseOwner: string,
        outcome: string, terminalStatus: 'completed' | 'discarded' = 'completed',
        now = new Date().toISOString()): ReplanInboxRecord {
        const normalizedOutcome = outcome.trim();
        if (!normalizedOutcome || normalizedOutcome.length > 20_000) throw new Error('Replan terminal outcome is invalid');
        iso(now, 'Replan inbox resolve time');
        const changed = this.database.run(`UPDATE replan_inbox SET status = ?4, lease_owner = NULL,
            lease_expires_at = NULL, terminal_outcome = ?5, last_error = NULL, updated_at = ?6,
            revision = revision + 1 WHERE event_id = ?1 AND revision = ?2 AND status = 'claimed' AND lease_owner = ?3`,
        [eventId, expectedRevision, leaseOwner, terminalStatus, normalizedOutcome, now]);
        if (changed.changes !== 1) throw new Error('Replan inbox lease ownership changed; refresh and reconcile');
        return this.get(eventId)!;
    }

    retry(eventId: string, expectedRevision: number, leaseOwner: string, error: string,
        nextAttemptAt: string, now = new Date().toISOString()): ReplanInboxRecord {
        const normalizedError = error.trim();
        if (!normalizedError || normalizedError.length > 2_000) throw new Error('Replan retry error is invalid');
        if (Date.parse(iso(nextAttemptAt, 'Replan retry time')) < Date.parse(iso(now, 'Replan inbox retry update time'))) {
            throw new Error('Replan retry time cannot be in the past');
        }
        const changed = this.database.run(`UPDATE replan_inbox SET status = 'pending', next_attempt_at = ?4,
            lease_owner = NULL, lease_expires_at = NULL, last_error = ?5, updated_at = ?6,
            revision = revision + 1 WHERE event_id = ?1 AND revision = ?2 AND status = 'claimed' AND lease_owner = ?3`,
        [eventId, expectedRevision, leaseOwner, nextAttemptAt, normalizedError, now]);
        if (changed.changes !== 1) throw new Error('Replan inbox lease ownership changed; refresh and reconcile');
        return this.get(eventId)!;
    }
}
