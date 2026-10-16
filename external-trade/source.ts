import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { integer, time, username, hash } from './policy.js';
import type { CommittedEngineTrade } from '../fencing-market/engine-trade-source.js';
import type { BoundSimulationEventStamp } from '../simulation-clock/types.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION } from '../simulation-clock/types.js';
export const ZERO = '0'.repeat(64);
export interface NativeTrade { sequence: number; headHash: string; event: CommittedEngineTrade; stamp: BoundSimulationEventStamp | null }
export const nativeHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
export function readDatabase<T>(path: string, read: (db: Database) => T): T {
    const db = new Database(path, { readonly: true, strict: true });
    try { return db.transaction(() => read(db))(); }
    finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
}
export function verifyNativeTrade(value: NativeTrade, previous: string): void {
    const { event, stamp } = value, { eventDigest, ...facts } = event;
    check(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId), 'Invalid native trade id');
    integer(event.tick); integer(event.fromValue); integer(event.toValue); time(event.committedAt);
    username(event.fromUsername); username(event.toUsername);
    check(event.fromUsername !== event.toUsername && nativeHash(facts) === hash(eventDigest), 'Native trade digest differs');
    for (const items of [event.fromItems, event.toItems]) {
        check(Array.isArray(items) && items.length <= 28, 'Invalid native trade item list');
        for (const item of items) {
            if (item.id !== undefined) integer(item.id, 65535);
            check(integer(item.count) > 0 && (item.name === null || typeof item.name === 'string'), 'Invalid native trade item');
        }
    }
    const payload = { eventId: event.eventId, eventDigest: event.eventDigest, committedAt: event.committedAt };
    check(value.headHash === nativeHash({ previousHash: previous, payload }), 'Native trade prefix differs');
    if (stamp) check(stamp.domain === 'engine-trade' && stamp.sourceId === event.eventId && stamp.sourceDigest === event.eventDigest
        && stamp.engineTick === event.tick && stamp.wallTime === event.committedAt && integer(stamp.sequence) > 0
        && ['paused', 'running'].includes(stamp.status) && !!hash(stamp.profileDigest) && !!time(stamp.simulationTime), 'Native clock stamp differs');
}
export function readNativeTradeLedger(enginePath: string): NativeTrade[] {
    const snapshot = readDatabase(enginePath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === 1, 'Unsupported native trade schema');
        return { audits: db.query('SELECT * FROM engine_trade_evidence_audit ORDER BY sequence').all() as any[],
            rows: db.query('SELECT * FROM engine_trade_evidence').all() as any[] };
    });
    {
        const { audits, rows } = snapshot;
        check(rows.length <= 100000 && rows.length === audits.length, 'Native trade rows/audit count differs');
        const byId = new Map(rows.map(row => [row.event_id, row]));
        let previous = ZERO;
        return audits.map((audit, index) => {
            const row = byId.get(audit.event_id); check(row && audit.sequence === index + 1, 'Native trade audit sequence differs');
            const event: CommittedEngineTrade = { eventId: row.event_id, tick: row.tick, fromUsername: row.from_username, toUsername: row.to_username,
                fromItems: JSON.parse(row.from_items_json), toItems: JSON.parse(row.to_items_json), fromValue: row.from_value,
                toValue: row.to_value, committedAt: row.committed_at, eventDigest: row.event_digest };
            check(audit.event_digest === event.eventDigest && audit.committed_at === event.committedAt && audit.previous_hash === previous, 'Native trade audit differs');
            const value: NativeTrade = { sequence: audit.sequence, headHash: audit.entry_hash, event, stamp: null };
            verifyNativeTrade(value, previous); previous = value.headHash; return value;
        });
    }
}
export function readNativeTrades(enginePath: string, clockPath: string, clockId: string): NativeTrade[] {
    // Read committed rows before stamps: the engine binds the stamp before publishing its row.
    const trades = readNativeTradeLedger(enginePath);
    const stamps = readDatabase(clockPath, db => {
        check((db.query('PRAGMA user_version').get() as any).user_version === SIMULATION_CLOCK_STORE_SCHEMA_VERSION, 'Unsupported native clock schema');
        const rows = db.query("SELECT * FROM simulation_event_stamp WHERE clock_id=?1 AND domain='engine-trade'").all(clockId) as any[];
        check(rows.length <= 100000, 'External clock source exceeds limit');
        return new Map(rows.map(row => [row.source_id, { clockId: row.clock_id, domain: row.domain, sourceId: row.source_id,
            sourceDigest: row.source_digest, sequence: row.sequence, wallTime: row.wall_time, simulationTime: row.simulation_time,
            engineTick: row.engine_tick, profileDigest: row.profile_digest, status: row.clock_status, revision: row.clock_revision } as BoundSimulationEventStamp]));
    });
    let previous = ZERO;
    return trades.map(trade => { const value = { ...trade, stamp: stamps.get(trade.event.eventId) ?? null };
        verifyNativeTrade(value, previous); previous = value.headHash; return value; });
}
