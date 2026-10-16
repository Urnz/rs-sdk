import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { ThievingDiscoveryObservation } from '../thieving-procedures/types.js';
import type { CrimeCaseEvent, CrimeCaseEventKind, CrimeCaseState, WitnessSuspectDescription } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, ZERO = '0'.repeat(64);
type EventRow = { event_id: string; case_id: string; kind: CrimeCaseEventKind; outcome_receipt_id: string;
    observation_id: string; observation_digest: string; observer_agent_id: string | null;
    suspect_agent_id: string | null; identification: CrimeCaseEvent['identification']; occurred_at: string;
    event_digest: string; recorded_at: string };
type AuditRow = { event_id: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: string, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function time(value: string, field: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`); return value; }
function event(row: EventRow): CrimeCaseEvent { return { eventId: row.event_id, caseId: row.case_id, kind: row.kind,
    outcomeReceiptId: row.outcome_receipt_id, observationId: row.observation_id,
    observationDigest: row.observation_digest, observerAgentId: row.observer_agent_id,
    suspectAgentId: row.suspect_agent_id, identification: row.identification,
    occurredAt: row.occurred_at, eventDigest: row.event_digest, recordedAt: row.recorded_at }; }
function facts(value: CrimeCaseEvent): object { const { eventDigest, recordedAt, ...rest } = value;
    void eventDigest; void recordedAt; return rest; }

/** An observer-scoped, append-only case journal. It cannot assert guilt or seize assets. */
export class CrimeCaseStore {
    private readonly database: Database;
    constructor(path: string, private readonly thieving: ThievingProcedureStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    getEvent(eventIdInput: string): CrimeCaseEvent | null {
        const row = this.database.query('SELECT * FROM crime_case_event WHERE event_id=?1')
            .get(id(eventIdInput, 'eventId')) as EventRow | null;
        return row ? event(row) : null;
    }
    findEventByObservation(kind: CrimeCaseEventKind, observationIdInput: string): CrimeCaseEvent | null {
        if (kind !== 'discovery-recorded' && kind !== 'suspect-identified') throw new Error('Case kind is invalid');
        const row = this.database.query('SELECT * FROM crime_case_event WHERE kind=?1 AND observation_id=?2')
            .get(kind, id(observationIdInput, 'observationId')) as EventRow | null;
        return row ? event(row) : null;
    }
    getCaseForOutcome(outcomeReceiptIdInput: string): string | null {
        const rows = this.database.query('SELECT case_id FROM crime_case_binding WHERE outcome_receipt_id=?1 LIMIT 2')
            .all(id(outcomeReceiptIdInput, 'outcomeReceiptId')) as Array<{ case_id: string }>;
        if (rows.length > 1) throw new Error('Outcome has ambiguous case bindings');
        return rows[0]?.case_id ?? null;
    }
    listEvents(caseIdInput: string): CrimeCaseEvent[] {
        return (this.database.query('SELECT * FROM crime_case_event WHERE case_id=?1 ORDER BY sequence')
            .all(id(caseIdInput, 'caseId')) as EventRow[]).map(event);
    }
    /** Internal observer-scoped description; callers must authenticate the viewer independently. */
    getWitnessSuspectDescription(viewerAgentIdInput: string,
        targetAgentIdInput: string): WitnessSuspectDescription | null {
        const viewerAgentId = id(viewerAgentIdInput, 'viewerAgentId');
        const targetAgentId = id(targetAgentIdInput, 'targetAgentId');
        const events = this.database.query(`SELECT * FROM crime_case_event
            WHERE kind='suspect-identified' AND identification='direct'
                AND observer_agent_id=?1 AND suspect_agent_id=?2 ORDER BY sequence`)
            .all(viewerAgentId, targetAgentId) as EventRow[];
        if (!this.verifyAuditChain()) throw new Error('Crime case or Thieving audit chain is invalid');
        if (events.length === 0) return null;
        return { viewerAgentId, targetAgentId,
            description: 'Personally identified as a suspect during a theft',
            sourceCaseEventIds: events.map(value => value.event_id) };
    }
    /** Bounded descriptions for known viewer identities; each row stays scoped to its own observer. */
    listWitnessSuspectDescriptionsForViewers(viewerAgentIds: readonly string[]): WitnessSuspectDescription[] {
        const viewers = new Set(viewerAgentIds.map(value => id(value, 'viewerAgentId')));
        if (viewers.size === 0) return [];
        const rows = this.database.query(`SELECT * FROM crime_case_event
            WHERE kind='suspect-identified' AND identification='direct'
                AND observer_agent_id IS NOT NULL AND suspect_agent_id IS NOT NULL
            ORDER BY sequence DESC`).all() as EventRow[];
        if (!this.verifyAuditChain()) throw new Error('Crime case or Thieving audit chain is invalid');
        const grouped = new Map<string, WitnessSuspectDescription>();
        const countByViewer = new Map<string, number>();
        for (const row of rows) {
            if (!row.observer_agent_id || !row.suspect_agent_id || !viewers.has(row.observer_agent_id)) continue;
            const key = `${row.observer_agent_id}\0${row.suspect_agent_id}`;
            let description = grouped.get(key);
            if (!description) {
                const count = countByViewer.get(row.observer_agent_id) ?? 0;
                if (count >= 12) continue;
                description = { viewerAgentId: row.observer_agent_id, targetAgentId: row.suspect_agent_id,
                    description: 'Personally identified as a suspect during a theft', sourceCaseEventIds: [] };
                grouped.set(key, description);
                countByViewer.set(row.observer_agent_id, count + 1);
            }
            if (description.sourceCaseEventIds.length < 3) description.sourceCaseEventIds.push(row.event_id);
        }
        return [...grouped.values()];
    }
    getState(caseIdInput: string): CrimeCaseState | null {
        const caseId = id(caseIdInput, 'caseId');
        const first = this.database.query('SELECT outcome_receipt_id FROM crime_case_binding WHERE case_id=?1')
            .get(caseId) as { outcome_receipt_id: string } | null;
        if (!first) return null;
        const events = this.listEvents(caseId);
        return { caseId, outcomeReceiptId: first.outcome_receipt_id,
            discoveryObservationIds: events.filter(value => value.kind === 'discovery-recorded')
                .map(value => value.observationId),
            identifications: events.filter(value => value.kind === 'suspect-identified')
                .map(value => ({ observationId: value.observationId, suspectAgentId: value.suspectAgentId!,
                    identification: value.identification as 'direct' | 'inferred',
                    observerAgentId: value.observerAgentId })), legalFinding: null };
    }
    recordDiscovery(caseIdInput: string, eventIdInput: string, observationIdInput: string,
        recordedAtInput = new Date().toISOString()): CrimeCaseEvent {
        return this.record('discovery-recorded', caseIdInput, eventIdInput, observationIdInput, recordedAtInput);
    }
    recordIdentification(caseIdInput: string, eventIdInput: string, observationIdInput: string,
        recordedAtInput = new Date().toISOString()): CrimeCaseEvent {
        return this.record('suspect-identified', caseIdInput, eventIdInput, observationIdInput, recordedAtInput);
    }
    private record(kind: CrimeCaseEventKind, caseIdInput: string, eventIdInput: string, observationIdInput: string,
        recordedAtInput: string): CrimeCaseEvent {
        const caseId = id(caseIdInput, 'caseId'), eventId = id(eventIdInput, 'eventId');
        const observationId = id(observationIdInput, 'observationId');
        const recordedAt = time(recordedAtInput, 'recordedAt');
        if (!this.verifyAuditChain()) throw new Error('Crime case or Thieving audit chain is invalid');
        const observation = this.thieving.getDiscovery(observationId);
        if (!observation) throw new Error('Case requires a persisted discovery observation');
        if (Date.parse(recordedAt) < Date.parse(observation.recordedAt))
            throw new Error('Case event cannot predate its source observation');
        const outcome = this.thieving.getOutcome(observation.outcomeReceiptId);
        if (!outcome || outcome.result !== 'succeeded') throw new Error('Case requires a successful Thieving outcome');
        if (kind === 'suspect-identified') {
            const discovered = this.database.query(`SELECT 1 FROM crime_case_event WHERE case_id=?1
                AND observation_id=?2 AND kind='discovery-recorded'`).get(caseId, observationId);
            if (!discovered) throw new Error('Identification requires a recorded case discovery');
            if (!observation.suspectAgentId || observation.actorIdentification === 'none')
                throw new Error('Observation does not identify a suspect');
        }
        const normalized = this.normalized(kind, caseId, eventId, observation);
        const eventDigest = hash(normalized), existing = this.getEvent(eventId);
        if (existing) {
            if (existing.eventDigest !== eventDigest) throw new Error('Case event id was reused');
            return existing;
        }
        const prior = this.database.query('SELECT event_id FROM crime_case_event WHERE kind=?1 AND observation_id=?2')
            .get(kind, observationId);
        if (prior) throw new Error('Observation was already recorded for this case stage');
        const transaction = this.database.transaction(() => {
            this.database.run('INSERT OR IGNORE INTO crime_case_binding(case_id,outcome_receipt_id) VALUES(?1,?2)',
                [caseId, normalized.outcomeReceiptId]);
            const binding = this.database.query('SELECT outcome_receipt_id FROM crime_case_binding WHERE case_id=?1')
                .get(caseId) as { outcome_receipt_id: string };
            if (binding.outcome_receipt_id !== normalized.outcomeReceiptId)
                throw new Error('Case id belongs to another outcome');
            this.database.run(`INSERT INTO crime_case_event(event_id,case_id,kind,outcome_receipt_id,observation_id,
                observation_digest,observer_agent_id,suspect_agent_id,identification,occurred_at,event_digest,recorded_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`, [eventId, caseId, kind,
                normalized.outcomeReceiptId, observationId, normalized.observationDigest,
                normalized.observerAgentId, normalized.suspectAgentId, normalized.identification,
                normalized.occurredAt, eventDigest, recordedAt]);
            const previous = (this.database.query('SELECT entry_hash FROM crime_case_audit ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { eventId, eventDigest, recordedAt };
            this.database.run(`INSERT INTO crime_case_audit(event_id,previous_hash,entry_hash)
                VALUES(?1,?2,?3)`, [eventId, previous, hash({ previousHash: previous, payload })]);
        });
        transaction.immediate();
        return this.getEvent(eventId)!;
    }
    private normalized(kind: CrimeCaseEventKind, caseId: string, eventId: string,
        observation: ThievingDiscoveryObservation): Omit<CrimeCaseEvent, 'eventDigest' | 'recordedAt'> {
        return { eventId, caseId, kind, outcomeReceiptId: observation.outcomeReceiptId,
            observationId: observation.observationId, observationDigest: observation.observationDigest,
            observerAgentId: observation.observerAgentId,
            suspectAgentId: kind === 'suspect-identified' ? observation.suspectAgentId : null,
            identification: kind === 'suspect-identified' ? observation.actorIdentification : 'none',
            occurredAt: observation.occurredAt };
    }
    verifyAuditChain(): boolean {
        if (!this.thieving.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM crime_case_audit ORDER BY sequence').all() as AuditRow[];
        const count = this.database.query('SELECT COUNT(*) AS events FROM crime_case_event').get() as { events: number };
        if (rows.length !== count.events) return false;
        const orphanCount = this.database.query(`SELECT COUNT(*) AS orphans FROM crime_case_event e
            LEFT JOIN crime_case_binding b ON b.case_id=e.case_id
            WHERE b.case_id IS NULL OR b.outcome_receipt_id!=e.outcome_receipt_id`).get() as { orphans: number };
        const emptyCount = this.database.query(`SELECT COUNT(*) AS empty_cases FROM crime_case_binding b
            WHERE NOT EXISTS(SELECT 1 FROM crime_case_event e WHERE e.case_id=b.case_id)`)
            .get() as { empty_cases: number };
        if (orphanCount.orphans > 0 || emptyCount.empty_cases > 0) return false;
        let previous = ZERO;
        for (const row of rows) {
            const source = this.getEvent(row.event_id);
            if (!source || source.eventDigest !== hash(facts(source))) return false;
            const observation = this.thieving.getDiscovery(source.observationId);
            if (!observation || observation.observationDigest !== source.observationDigest
                || hash(this.normalized(source.kind, source.caseId, source.eventId, observation)) !== source.eventDigest)
                return false;
            const payload = { eventId: source.eventId, eventDigest: source.eventDigest, recordedAt: source.recordedAt };
            if (row.previous_hash !== previous || row.entry_hash !== hash({ previousHash: previous, payload })) return false;
            previous = row.entry_hash;
        }
        return true;
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Crime case schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE crime_case_binding(case_id TEXT PRIMARY KEY,
                outcome_receipt_id TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE crime_case_event(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,case_id TEXT NOT NULL REFERENCES crime_case_binding(case_id),
                kind TEXT NOT NULL,outcome_receipt_id TEXT NOT NULL,
                observation_id TEXT NOT NULL,observation_digest TEXT NOT NULL,observer_agent_id TEXT,
                suspect_agent_id TEXT,identification TEXT NOT NULL,occurred_at TEXT NOT NULL,event_digest TEXT NOT NULL,
                recorded_at TEXT NOT NULL,UNIQUE(kind,observation_id))`);
            this.database.run(`CREATE TABLE crime_case_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE REFERENCES crime_case_event(event_id),previous_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
