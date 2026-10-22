import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { CreateAgentPlayerActionRequest } from '../agent-state/types.js';

export type NativeWorkTarget = { kind: 'cook'; kitchenRunId: string; batchId: string }
    | { kind: 'delivery'; recipient: string; itemId: 379; quantity: 1; afterSequence: number; afterHash: string };
export interface BusinessWorkBinding {
    schemaVersion: 1;
    workOrderId: string;
    requesterAgentId: string;
    username: string;
    request: Required<CreateAgentPlayerActionRequest>;
    target: NativeWorkTarget;
    settlementId: string;
    runId: string | null;
}
export function workDigest(value: unknown): string {
    const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function workUuid(value: string): string {
    const hex = workDigest(value); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function migrateWorkBindings(db: Database): void {
    db.transaction(() => {
        if (!(db.query('PRAGMA table_info(business_work_order)').all() as { name: string }[]).some(c => c.name === 'binding_digest'))
            db.run('ALTER TABLE business_work_order ADD COLUMN binding_digest TEXT');
        db.run('CREATE TABLE IF NOT EXISTS business_work_binding_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
        db.run('INSERT OR IGNORE INTO business_work_binding_schema VALUES(1)');
        db.run(`CREATE TABLE IF NOT EXISTS business_work_binding(work_order_id TEXT PRIMARY KEY REFERENCES business_work_order(work_order_id),
            request_id TEXT NOT NULL UNIQUE,run_id TEXT UNIQUE,settlement_id TEXT NOT NULL UNIQUE,native_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL)`);
        db.run(`CREATE TABLE IF NOT EXISTS business_work_binding_audit(sequence INTEGER PRIMARY KEY,work_order_id TEXT NOT NULL,
            payload TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL UNIQUE)`);
        db.run('CREATE TABLE IF NOT EXISTS business_work_binding_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT NOT NULL)');
        db.run("INSERT OR IGNORE INTO business_work_binding_head VALUES(1,0,'genesis')");
    }).immediate();
    readWorkBindings(db);
}
function snapshot(db: Database, binding: BusinessWorkBinding): unknown {
    return { binding, order: db.query('SELECT * FROM business_work_order WHERE work_order_id=?1').get(binding.workOrderId) };
}
export function readWorkBindings(db: Database): BusinessWorkBinding[] {
    const versions = db.query('SELECT version FROM business_work_binding_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported work binding schema');
    const rows = db.query('SELECT * FROM business_work_binding').all() as {
        work_order_id: string; request_id: string; run_id: string | null; settlement_id: string; native_key: string; payload: string }[];
    const audits = db.query('SELECT * FROM business_work_binding_audit ORDER BY sequence').all() as {
        sequence: number; work_order_id: string; payload: string; previous_hash: string; hash: string }[];
    const latest = new Map<string, unknown>(); let previous = 'genesis';
    for (const [index, audit] of audits.entries()) {
        const { hash, ...facts } = audit;
        if (audit.sequence !== index + 1 || audit.previous_hash !== previous || hash !== workDigest(facts))
            throw new Error('Work binding audit differs');
        latest.set(audit.work_order_id, JSON.parse(audit.payload)); previous = hash;
    }
    const head = db.query('SELECT * FROM business_work_binding_head WHERE id=1').get() as { sequence: number; hash: string } | null;
    const anchors = db.query('SELECT work_order_id,binding_digest FROM business_work_order WHERE binding_digest IS NOT NULL').all() as {
        work_order_id: string; binding_digest: string }[];
    if (!head || head.sequence !== audits.length || head.hash !== previous || latest.size !== rows.length || anchors.length !== rows.length)
        throw new Error('Work binding audit coverage differs');
    return rows.map(row => {
        const binding = JSON.parse(row.payload) as BusinessWorkBinding;
        if (binding.schemaVersion !== 1 || row.work_order_id !== binding.workOrderId || row.request_id !== binding.request.requestId
            || row.run_id !== binding.runId || row.settlement_id !== binding.settlementId || row.native_key !== nativeKey(binding)
            || anchors.find(a => a.work_order_id === binding.workOrderId)?.binding_digest !== workDigest({ ...binding, runId: null })
            || workDigest(latest.get(binding.workOrderId)) !== workDigest(snapshot(db, binding)))
            throw new Error('Work binding projection differs');
        return binding;
    });
}
const nativeKey = (b: BusinessWorkBinding) => b.target.kind === 'cook' ? `cook:${b.target.kitchenRunId}` : `delivery:${b.workOrderId}`;
/** The caller owns an IMMEDIATE transaction and verifies the old projection before any mutation. */
export function writeWorkBinding(db: Database, binding: BusinessWorkBinding): void {
    db.run(`INSERT INTO business_work_binding VALUES(?1,?2,?3,?4,?5,?6)
        ON CONFLICT(work_order_id) DO UPDATE SET run_id=excluded.run_id,payload=excluded.payload`,
    [binding.workOrderId, binding.request.requestId, binding.runId, binding.settlementId, nativeKey(binding), JSON.stringify(binding)]);
    const head = db.query('SELECT * FROM business_work_binding_head WHERE id=1').get() as { sequence: number; hash: string };
    const facts = { sequence: head.sequence + 1, work_order_id: binding.workOrderId,
        payload: JSON.stringify(snapshot(db, binding)), previous_hash: head.hash }, hash = workDigest(facts);
    db.run('INSERT INTO business_work_binding_audit VALUES(?1,?2,?3,?4,?5)',
        [facts.sequence, facts.work_order_id, facts.payload, facts.previous_hash, hash]);
    db.run('UPDATE business_work_binding_head SET sequence=?1,hash=?2 WHERE id=1', [facts.sequence, hash]);
    readWorkBindings(db);
}
