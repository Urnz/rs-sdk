import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { societyMinimumDigest } from '../society-minimum/policy.js';
import { timestamp } from './policy.js';

export type Row = Record<string, any>;
export interface LedgerData { tables: Record<string, Row[]>; headHash: string; entries: number; snapshotDigest: string }
export type LedgerSource = { status: 'available'; data: LedgerData } | { status: 'unavailable' | 'invalid'; reason: string };
export interface MetricSourcePaths { food?: string; tools?: string; housing?: string }
const specifications = {
    food: { version: 1, audit: 'food_consumption_audit', tables: ['food_loop_closure', 'food_receipt_use', 'food_consumption_event'] },
    tools: { version: 3, audit: 'item_lifecycle_audit', tables: ['item_instance', 'item_lifecycle_operation', 'item_replacement', 'item_repair_evidence'] },
    housing: { version: 2, audit: 'housing_tenancy_audit', tables: ['housing_tenancy', 'housing_rent_payment', 'housing_tenancy_meta'] }
} as const;
export function nativeHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function same(a: unknown, b: unknown): boolean { return societyMinimumDigest(a) === societyMinimumDigest(b); }
export function requireEvidence(condition: unknown, reason: string): asserts condition {
    if (!condition) throw new Error(reason);
}

/** No constructors/migrations of domain stores are called by this reader. Each DB is a separate consistent snapshot. */
export function readLedger(kind: keyof typeof specifications, path?: string): LedgerSource {
    if (!path || !existsSync(path)) return { status: 'unavailable', reason: 'Native ledger not configured or absent; no history inferred.' };
    let db: Database | undefined;
    try {
        db = new Database(path, { readonly: true, strict: true });
        const connection = db, spec = specifications[kind];
        const data = connection.transaction(() => {
            requireEvidence((connection.query('PRAGMA user_version').get() as Row).user_version === spec.version,
                `Unsupported ${kind} ledger schema`);
            for (const table of [spec.audit, ...spec.tables]) {
                requireEvidence((connection.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count <= 100000,
                    'Native metric source exceeds the 100000-row per-table limit');
            }
            const audit = connection.query(`SELECT * FROM ${spec.audit} ORDER BY sequence`).all() as Row[];
            let head = '0'.repeat(64);
            const payloads: Row[] = [];
            for (const [index, row] of audit.entries()) {
                const payload = JSON.parse(row.payload_json);
                requireEvidence(row.sequence === index + 1 && row.previous_hash === head
                    && nativeHash({ previousHash: head, payload }) === row.entry_hash, 'Invalid audit chain');
                timestamp(payload.at); head = row.entry_hash; payloads.push(payload);
                if (kind === 'food') requireEvidence(row.closure_id === payload.closureId && row.occurred_at === payload.at, 'Food audit columns differ');
                if (kind === 'tools') requireEvidence(row.operation_id === payload.operationId, 'Tool audit columns differ');
                if (kind === 'housing') requireEvidence(row.tenancy_id === payload.tenancyId && row.action === payload.action
                    && row.occurred_at === payload.at, 'Housing audit columns differ');
            }
            const tables: Record<string, Row[]> = { audit: payloads };
            for (const table of spec.tables) tables[table] = connection.query(`SELECT * FROM ${table}`).all() as Row[];
            // Row order of unaudited tables must not change the evidence digest.
            const snapshot = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table,
                [...rows].sort((a, b) => societyMinimumDigest(a).localeCompare(societyMinimumDigest(b)))]));
            return { tables, headHash: head, entries: audit.length, snapshotDigest: societyMinimumDigest(snapshot) };
        })();
        return { status: 'available', data };
    } catch (error) {
        return { status: 'invalid', reason: error instanceof Error ? error.message : 'Unreadable native ledger' };
    } finally { if (db) { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); } }
}
