import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LlmDailyBudgetLimits {
    maxCostMicros: number;
    maxDecisions: number;
}

export interface LlmBudgetReservation {
    runId: string;
    scope: string;
    day: string;
    estimatedCostMicros: number;
    actualCostMicros: number | null;
    providerRequestId: string | null;
    status: 'reserved' | 'reconciled';
    createdAt: string;
    reconciledAt: string | null;
}

export interface LlmBudgetAdmission {
    admitted: boolean;
    reason: 'admitted' | 'existing-reservation' | 'cost-limit' | 'decision-limit';
    reservation: LlmBudgetReservation | null;
    reservedCostMicros: number;
    decisions: number;
}

type Row = { run_id: string; scope: string; budget_day: string; estimated_cost_micros: number;
    actual_cost_micros: number | null; provider_request_id: string | null;
    status: LlmBudgetReservation['status']; created_at: string; reconciled_at: string | null };

function iso(value: string, label: string): string {
    if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
    return value;
}

function integer(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) throw new Error(`${label} is invalid`);
    return value;
}

function normalizedScope(value: string): string {
    const scope = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(scope)) throw new Error('LLM budget scope is invalid');
    return scope;
}

function reservation(row: Row): LlmBudgetReservation {
    return { runId: row.run_id, scope: row.scope, day: row.budget_day,
        estimatedCostMicros: row.estimated_cost_micros, actualCostMicros: row.actual_cost_micros,
        providerRequestId: row.provider_request_id, status: row.status, createdAt: row.created_at,
        reconciledAt: row.reconciled_at };
}

export class LlmDailyBudgetStore {
    private readonly database: Database;

    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA journal_mode = WAL');
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`LLM budget schema ${version} is newer than supported version 1`);
        if (version < 1) {
            const migration = this.database.transaction(() => {
                this.database.run(`CREATE TABLE llm_budget_reservation (
                    run_id TEXT PRIMARY KEY, scope TEXT NOT NULL, budget_day TEXT NOT NULL,
                    estimated_cost_micros INTEGER NOT NULL CHECK (estimated_cost_micros >= 0),
                    actual_cost_micros INTEGER CHECK (actual_cost_micros >= 0), provider_request_id TEXT,
                    status TEXT NOT NULL CHECK (status IN ('reserved', 'reconciled')),
                    created_at TEXT NOT NULL, reconciled_at TEXT,
                    CHECK ((status = 'reconciled') = (actual_cost_micros IS NOT NULL)),
                    CHECK ((status = 'reconciled') = (reconciled_at IS NOT NULL)))`);
                this.database.run(`CREATE INDEX llm_budget_daily
                    ON llm_budget_reservation(scope, budget_day, status)`);
                this.database.run('PRAGMA user_version = 1');
            });
            migration.immediate();
        }
    }

    close(): void { this.database.close(true); }

    get(runId: string): LlmBudgetReservation | null {
        const row = this.database.query('SELECT * FROM llm_budget_reservation WHERE run_id = ?1')
            .get(runId) as Row | null;
        return row ? reservation(row) : null;
    }

    reserve(runId: string, scopeInput: string, estimatedCostMicros: number, limits: LlmDailyBudgetLimits,
        at = new Date().toISOString()): LlmBudgetAdmission {
        const scope = normalizedScope(scopeInput);
        const timestamp = iso(at, 'LLM budget reservation time');
        const day = timestamp.slice(0, 10);
        const estimate = integer(estimatedCostMicros, 'Estimated LLM cost');
        const maxCost = integer(limits.maxCostMicros, 'Daily LLM cost limit');
        const maxDecisions = integer(limits.maxDecisions, 'Daily LLM decision limit');
        if (maxDecisions < 1) throw new Error('Daily LLM decision limit must be positive');
        let result!: LlmBudgetAdmission;
        const transaction = this.database.transaction(() => {
            const existing = this.get(runId);
            if (existing) {
                if (existing.scope !== scope || existing.day !== day || existing.estimatedCostMicros !== estimate) {
                    throw new Error('LLM budget run id was reused with different admission data');
                }
                const usage = this.usage(scope, day);
                result = { admitted: true, reason: 'existing-reservation', reservation: existing, ...usage };
                return;
            }
            const usage = this.usage(scope, day);
            if (usage.decisions >= maxDecisions) {
                result = { admitted: false, reason: 'decision-limit', reservation: null, ...usage };
                return;
            }
            if (estimate > 0 && usage.reservedCostMicros + estimate > maxCost) {
                result = { admitted: false, reason: 'cost-limit', reservation: null, ...usage };
                return;
            }
            this.database.run(`INSERT INTO llm_budget_reservation
                (run_id, scope, budget_day, estimated_cost_micros, actual_cost_micros, provider_request_id,
                status, created_at, reconciled_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, 'reserved', ?5, NULL)`,
            [runId, scope, day, estimate, timestamp]);
            result = { admitted: true, reason: 'admitted', reservation: this.get(runId),
                reservedCostMicros: usage.reservedCostMicros + estimate, decisions: usage.decisions + 1 };
        });
        transaction.immediate();
        return result;
    }

    reconcile(runId: string, actualCostMicros: number, providerRequestId: string | undefined,
        at = new Date().toISOString()): LlmBudgetReservation {
        const actual = integer(actualCostMicros, 'Actual LLM cost');
        const timestamp = iso(at, 'LLM budget reconciliation time');
        const providerId = providerRequestId?.trim() || null;
        const current = this.get(runId);
        if (!current) throw new Error('LLM budget reservation does not exist');
        if (current.status === 'reconciled') {
            if (current.actualCostMicros !== actual || current.providerRequestId !== providerId) {
                throw new Error('LLM usage reconciliation conflicts with the recorded provider usage');
            }
            return current;
        }
        const changed = this.database.run(`UPDATE llm_budget_reservation SET status = 'reconciled',
            actual_cost_micros = ?2, provider_request_id = ?3, reconciled_at = ?4
            WHERE run_id = ?1 AND status = 'reserved'`, [runId, actual, providerId, timestamp]);
        if (changed.changes !== 1) throw new Error('LLM budget reservation changed during reconciliation');
        return this.get(runId)!;
    }

    usage(scopeInput: string, day: string): { reservedCostMicros: number; decisions: number } {
        const scope = normalizedScope(scopeInput);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('LLM budget day is invalid');
        const raw = this.database.query(`SELECT COUNT(*) AS decisions,
            COALESCE(SUM(CASE WHEN status = 'reconciled' THEN actual_cost_micros ELSE estimated_cost_micros END), 0)
                AS reserved_cost_micros
            FROM llm_budget_reservation WHERE scope = ?1 AND budget_day = ?2`).get(scope, day);
        const row: { decisions: number; reserved_cost_micros: number } = raw as never;
        return { reservedCostMicros: Number(row.reserved_cost_micros), decisions: Number(row.decisions) };
    }
}
