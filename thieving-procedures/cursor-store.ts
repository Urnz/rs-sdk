import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingProcedureStore } from './store.js';
import { processEngineThievingBatch, type ThievingBatchResult,
    type SkippedThievingEvent, type ThievingEventProcessorDependencies } from './event-processor.js';

const ZERO = '0'.repeat(64);
type Row = { sequence: number; from_sequence: number; to_sequence: number; event_count: number;
    last_event_id: string; last_event_digest: string; recorded_at: string;
    previous_hash: string; entry_hash: string; skipped_json: string | null };
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function timestamp(value: unknown): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error('Cursor time is invalid'); return value; }
function payload(row: Row) { const value = { fromSequence: row.from_sequence, toSequence: row.to_sequence,
    eventCount: row.event_count, lastEventId: row.last_event_id,
    lastEventDigest: row.last_event_digest, recordedAt: row.recorded_at };
    return row.skipped_json === null ? value : { ...value, skipped: JSON.parse(row.skipped_json) as SkippedThievingEvent[] }; }
function skips(row: Row): SkippedThievingEvent[] {
    if (row.skipped_json === null) return [];
    const value = JSON.parse(row.skipped_json) as unknown;
    if (!Array.isArray(value)) throw new Error('Thieving cursor skipped-event data is invalid');
    return value as SkippedThievingEvent[];
}

/** Append-only checkpoint; outcome/discovery writes precede every cursor advance. */
export class ThievingEventCursorStore {
    private readonly database: Database;
    constructor(path: string, private readonly source: ThievingEvidenceStore,
        private readonly thieving: ThievingProcedureStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.migrate();
    }
    close(): void { this.database.close(true); }
    current(): number {
        const row = this.database.query('SELECT to_sequence FROM thieving_event_cursor ORDER BY sequence DESC LIMIT 1')
            .get() as { to_sequence: number } | null;
        return row?.to_sequence ?? 0;
    }
    getSkipped(eventId: string, sourceEvidenceDigest: string): SkippedThievingEvent | null {
        if (!this.verifyAuditChain()) throw new Error('Thieving cursor or source audit is invalid');
        for (const row of this.database.query('SELECT * FROM thieving_event_cursor ORDER BY sequence').all() as Row[]) {
            const found = skips(row).find(value => value.eventId === eventId
                && value.sourceEvidenceDigest === sourceEvidenceDigest);
            if (found) return found;
        }
        return null;
    }
    advance(result: ThievingBatchResult, recordedAtInput = new Date().toISOString()): number {
        const recordedAt = timestamp(recordedAtInput);
        if (!this.verifyAuditChain()) throw new Error('Thieving cursor or source audit is invalid');
        const fromSequence = this.current();
        const processed = result.processed, skipped = result.skipped;
        const eventCount = processed.length + skipped.length;
        if (eventCount === 0) {
            if (result.nextSequence !== fromSequence) throw new Error('Empty batch cannot advance the cursor');
            return fromSequence;
        }
        if (eventCount > 1_000) throw new Error('Cursor batch is too large');
        const actual = this.source.listAfter(fromSequence, eventCount);
        const processedBySequence = new Map(processed.map(value => [value.sequence, value]));
        const skippedBySequence = new Map(skipped.map(value => [value.sequence, value]));
        if (actual.length !== eventCount || result.nextSequence !== actual.at(-1)!.sequence
            || actual.some(event => {
                const completed = processedBySequence.get(event.sequence);
                const omitted = skippedBySequence.get(event.sequence);
                return (completed ? 1 : 0) + (omitted ? 1 : 0) !== 1
                    || !!completed && (event.eventId !== completed.eventId
                        || completed.outcomeReceiptId !== `outcome:${event.eventId}`
                        || this.thieving.getOutcome(completed.outcomeReceiptId)?.sourceEvidenceDigest !== event.eventDigest)
                    || !!omitted && (omitted.eventId !== event.eventId
                        || omitted.sourceEvidenceDigest !== event.eventDigest || omitted.reason !== 'unbound-actor');
            }))
            throw new Error('Cursor batch does not match the next engine events');
        const last = actual.at(-1)!;
        const transaction = this.database.transaction(() => {
            if (this.current() !== fromSequence) throw new Error('Thieving cursor changed before advance');
            const previous = this.database.query('SELECT entry_hash FROM thieving_event_cursor ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null;
            const previousHash = previous?.entry_hash ?? ZERO;
            const value = { fromSequence, toSequence: last.sequence, eventCount,
                lastEventId: last.eventId, lastEventDigest: last.eventDigest, recordedAt };
            const row = { from_sequence: value.fromSequence, to_sequence: value.toSequence,
                event_count: eventCount, last_event_id: value.lastEventId, last_event_digest: value.lastEventDigest,
                recorded_at: value.recordedAt, skipped_json: JSON.stringify(skipped) } as Row;
            this.database.run(`INSERT INTO thieving_event_cursor
                (from_sequence,to_sequence,event_count,last_event_id,last_event_digest,recorded_at,
                previous_hash,entry_hash,skipped_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            [value.fromSequence, value.toSequence, eventCount, value.lastEventId,
                value.lastEventDigest, value.recordedAt, previousHash, hash({ previousHash, payload: payload(row) }),
                row.skipped_json]);
        });
        transaction.immediate();
        return last.sequence;
    }
    verifyAuditChain(): boolean {
        if (!this.source.verifyChain() || !this.thieving.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM thieving_event_cursor ORDER BY sequence').all() as Row[];
        let previousHash = ZERO, fromSequence = 0;
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index]!;
            if (!Number.isSafeInteger(row.event_count) || row.event_count < 1 || row.event_count > 1_000)
                return false;
            const events = this.source.listAfter(fromSequence, row.event_count), omitted = skips(row);
            const skippedBySequence = new Map(omitted.map(value => [value.sequence, value]));
            const last = events.at(-1);
            if (row.sequence !== index + 1 || row.from_sequence !== fromSequence
                || events.length !== row.event_count || !last || last.sequence !== row.to_sequence
                || last.eventId !== row.last_event_id || last.eventDigest !== row.last_event_digest
                || omitted.length !== skippedBySequence.size
                || events.some(event => {
                    const skipped = skippedBySequence.get(event.sequence);
                    if (skipped) return skipped.eventId !== event.eventId
                        || skipped.sourceEvidenceDigest !== event.eventDigest || skipped.reason !== 'unbound-actor'
                        || this.thieving.getOutcome(`outcome:${event.eventId}`) !== null;
                    return this.thieving.getOutcome(`outcome:${event.eventId}`)?.sourceEvidenceDigest !== event.eventDigest;
                })
                || row.previous_hash !== previousHash
                || row.entry_hash !== hash({ previousHash, payload: payload(row) })) return false;
            previousHash = row.entry_hash;
            fromSequence = row.to_sequence;
        }
        return true;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 2) throw new Error(`Thieving cursor schema ${version} is newer than supported version 2`);
        if (version === 2) return;
        if (version === 1) {
            const migration = this.database.transaction(() => {
                this.database.run('ALTER TABLE thieving_event_cursor ADD COLUMN skipped_json TEXT');
                this.database.run('PRAGMA user_version = 2');
            });
            migration.immediate();
            return;
        }
        const migration = this.database.transaction(() => {
            this.database.run(`CREATE TABLE thieving_event_cursor (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,from_sequence INTEGER NOT NULL,
                to_sequence INTEGER NOT NULL UNIQUE,event_count INTEGER NOT NULL,
                last_event_id TEXT NOT NULL,last_event_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,skipped_json TEXT)`);
            this.database.run('PRAGMA user_version = 2');
        });
        migration.immediate();
    }
}

/** Commit the cursor only after all effects in this page have completed. */
export function runThievingProcessorPage(deps: ThievingEventProcessorDependencies,
    cursor: ThievingEventCursorStore, limit = 100, recordedAt = new Date().toISOString()): ThievingBatchResult {
    if (!cursor.verifyAuditChain()) throw new Error('Thieving cursor or source audit is invalid');
    const result = processEngineThievingBatch(deps, cursor.current(), limit, recordedAt);
    cursor.advance(result, recordedAt);
    return result;
}
