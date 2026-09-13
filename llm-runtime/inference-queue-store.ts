import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { InferenceQueueBacklogError, type InferenceQueueAdmission,
    type InferenceQueueClaimStore } from './queue.js';

export interface InferenceQueueClaimRecord extends InferenceQueueAdmission {
    status: 'pending' | 'claimed' | 'completed' | 'failed';
    attempt: number;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
    completedAt: string | null;
    error: string | null;
}

type Row = { request_id: string; agent_id: string; priority: number; enqueued_at: string;
    status: InferenceQueueClaimRecord['status']; attempt: number; lease_owner: string | null; lease_expires_at: string | null;
    completed_at: string | null; error: string | null };

function record(row: Row): InferenceQueueClaimRecord {
    return { requestId: row.request_id, agentId: row.agent_id, priority: row.priority,
        enqueuedAt: row.enqueued_at, status: row.status, attempt: row.attempt, leaseOwner: row.lease_owner,
        leaseExpiresAt: row.lease_expires_at, completedAt: row.completed_at, error: row.error };
}

/** Durable admission and exact-owner claim ledger for the process-local scheduler. */
export class SqliteInferenceQueueClaimStore implements InferenceQueueClaimStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA journal_mode = WAL');
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Inference queue schema ${version} is newer than supported version 1`);
        if (version < 1) {
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE inference_queue_claim (
                    request_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, priority INTEGER NOT NULL,
                    enqueued_at TEXT NOT NULL, status TEXT NOT NULL
                        CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
                    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 1000),
                    lease_owner TEXT, lease_expires_at TEXT, completed_at TEXT, error TEXT,
                    CHECK ((status = 'claimed') = (lease_owner IS NOT NULL)),
                    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)))`);
                this.database.run(`CREATE INDEX inference_queue_active
                    ON inference_queue_claim(status, enqueued_at, request_id)`);
                this.database.run('PRAGMA user_version = 1');
            });
            migration.immediate();
        }
    }

    close(): void { this.database.close(true); }

    get(requestId: string): InferenceQueueClaimRecord | null {
        const row = this.database.query('SELECT * FROM inference_queue_claim WHERE request_id = ?1')
            .get(requestId) as Row | null;
        return row ? record(row) : null;
    }

    listForAgent(agentId: string, limit = 1_000): InferenceQueueClaimRecord[] {
        if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(agentId)) throw new Error('Inference queue agent id is invalid');
        if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Inference queue list limit is invalid');
        return (this.database.query(`SELECT * FROM inference_queue_claim WHERE agent_id = ?1
            ORDER BY enqueued_at DESC, request_id DESC LIMIT ?2`).all(agentId, limit) as Row[]).map(record);
    }

    admit(value: InferenceQueueAdmission, maxBacklog: number): void {
        const transaction = this.database.transaction(() => {
            this.database.run(`UPDATE inference_queue_claim SET status = 'failed', lease_owner = NULL,
                lease_expires_at = NULL, completed_at = ?1, error = 'Persisted claim lease expired before recovery'
                WHERE status = 'claimed' AND lease_expires_at <= ?1`, [value.enqueuedAt]);
            const existing = this.get(value.requestId);
            if (existing) {
                if (existing.agentId !== value.agentId || existing.priority !== value.priority
                    || !['completed', 'failed'].includes(existing.status)) {
                    throw new Error(`Inference queue request ${value.requestId} was already admitted`);
                }
                this.database.run(`UPDATE inference_queue_claim SET status = 'pending', enqueued_at = ?2,
                    completed_at = NULL, error = NULL WHERE request_id = ?1`, [value.requestId, value.enqueuedAt]);
                return;
            }
            const active = Number((this.database.query(`SELECT COUNT(*) AS count FROM inference_queue_claim
                WHERE status IN ('pending', 'claimed')`).get() as { count: number }).count);
            if (active >= maxBacklog) throw new InferenceQueueBacklogError(maxBacklog);
            this.database.run(`INSERT INTO inference_queue_claim
                (request_id, agent_id, priority, enqueued_at, status, attempt, lease_owner, lease_expires_at, completed_at, error)
                VALUES (?1, ?2, ?3, ?4, 'pending', 0, NULL, NULL, NULL, NULL)`,
            [value.requestId, value.agentId, value.priority, value.enqueuedAt]);
        });
        transaction.immediate();
    }

    claim(requestId: string, leaseOwner: string, leaseExpiresAt: string, now: string): boolean {
        let claimed = false;
        const transaction = this.database.transaction(() => {
            this.database.run(`UPDATE inference_queue_claim SET status = 'pending', lease_owner = NULL,
                lease_expires_at = NULL WHERE request_id = ?1 AND status = 'claimed' AND lease_expires_at <= ?2`,
            [requestId, now]);
            claimed = this.database.run(`UPDATE inference_queue_claim SET status = 'claimed', attempt = attempt + 1,
                lease_owner = ?2, lease_expires_at = ?3 WHERE request_id = ?1 AND status = 'pending'`,
            [requestId, leaseOwner, leaseExpiresAt]).changes === 1;
        });
        transaction.immediate();
        return claimed;
    }

    complete(requestId: string, leaseOwner: string, status: 'completed' | 'failed', now: string,
        error?: string): void {
        const changed = this.database.run(`UPDATE inference_queue_claim SET status = ?3, lease_owner = NULL,
            lease_expires_at = NULL, completed_at = ?4, error = ?5
            WHERE request_id = ?1 AND status = 'claimed' AND lease_owner = ?2`,
        [requestId, leaseOwner, status, now, error?.slice(0, 2_000) ?? null]);
        if (changed.changes !== 1) throw new Error('Inference queue persisted claim ownership changed');
    }
}
