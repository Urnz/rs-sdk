import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { ThievingDiscoveryObservation } from '../thieving-procedures/types.js';
import type { CrimeCaseStore } from './store.js';
import type { CrimeEvidenceStore } from './evidence-store.js';
import type { CrimeCaseEvent } from './types.js';
import type { CrimeEvidenceEntry, CrimeEvidenceKind } from './evidence-types.js';

const ZERO = '0'.repeat(64);
type CursorRow = { sequence: number; source_sequence: number; observation_id: string;
    observation_digest: string; case_id: string; discovery_event_id: string;
    identification_event_id: string | null; evidence_id: string | null;
    recorded_at: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function stableId(prefix: string, sourceId: string): string { return `${prefix}:${hash(sourceId)}`; }
function time(value: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value) throw new Error('Case ingest time is invalid');
    return value;
}
function payload(row: CursorRow) { return { sourceSequence: row.source_sequence,
    observationId: row.observation_id, observationDigest: row.observation_digest,
    caseId: row.case_id, discoveryEventId: row.discovery_event_id,
    identificationEventId: row.identification_event_id, evidenceId: row.evidence_id,
    recordedAt: row.recorded_at }; }
function admissibleEvidence(observation: ThievingDiscoveryObservation): CrimeEvidenceKind | null {
    if (observation.source === 'physical-trace') return 'physical-trace';
    if (observation.actorIdentification === 'direct'
        && (observation.source === 'direct-witness' || observation.source === 'guard-line-of-sight'))
        return 'direct-identification';
    return null;
}

export interface PromotedCrimeObservation {
    caseId: string;
    discovery: CrimeCaseEvent;
    identification: CrimeCaseEvent | null;
    evidence: CrimeEvidenceEntry | null;
}

/** Idempotent, cross-ledger promotion; no suspect is inferred from hidden outcome truth. */
export function promoteCrimeObservation(observationId: string, thieving: ThievingProcedureStore,
    cases: CrimeCaseStore, evidence: CrimeEvidenceStore,
    recordedAt = new Date().toISOString()): PromotedCrimeObservation {
    const at = time(recordedAt);
    if (!thieving.verifyAuditChain() || !cases.verifyAuditChain() || !evidence.verifyAuditChain())
        throw new Error('Crime observation source audit is invalid');
    const observation = thieving.getDiscovery(observationId);
    if (!observation) throw new Error('Crime observation is absent');
    const outcome = thieving.getOutcome(observation.outcomeReceiptId);
    if (!outcome || outcome.result !== 'succeeded') throw new Error('Crime observation has no successful outcome');
    if (Date.parse(at) < Date.parse(observation.recordedAt))
        throw new Error('Crime observation ingest predates source record');
    const boundCaseId = cases.getCaseForOutcome(observation.outcomeReceiptId);
    const existing = cases.findEventByObservation('discovery-recorded', observationId);
    const caseId = existing?.caseId ?? boundCaseId ?? stableId('case', observation.outcomeReceiptId);
    if (existing && boundCaseId !== existing.caseId) throw new Error('Observation case binding changed');
    const discovery = existing ?? cases.recordDiscovery(caseId, stableId('case-discovery', observationId),
        observationId, at);
    if (discovery.caseId !== caseId || discovery.observationDigest !== observation.observationDigest)
        throw new Error('Crime discovery conflicts with source observation');
    let identification: CrimeCaseEvent | null = null;
    if (observation.actorIdentification !== 'none') {
        identification = cases.findEventByObservation('suspect-identified', observationId)
            ?? cases.recordIdentification(caseId, stableId('case-identification', observationId),
                observationId, at);
        if (identification.caseId !== caseId || identification.suspectAgentId !== observation.suspectAgentId)
            throw new Error('Crime identification conflicts with source observation');
    }
    const kind = admissibleEvidence(observation), sourceEvent = kind === 'physical-trace'
        ? discovery : kind === 'direct-identification' ? identification : null;
    const proof = kind && sourceEvent ? evidence.findEvidenceBySource(kind, sourceEvent.eventId)
        ?? evidence.recordCaseEvidence(stableId('case-evidence', sourceEvent.eventId),
            sourceEvent.eventId, at) : null;
    if (proof && (proof.caseId !== caseId || proof.sourceDigest !== sourceEvent?.eventDigest))
        throw new Error('Crime evidence conflicts with source case event');
    return { caseId, discovery, identification, evidence: proof };
}

/** A separate durable cursor backfills old discoveries and survives partial cross-ledger writes. */
export class CrimeObservationCursorStore {
    private readonly database: Database;
    constructor(path: string, private readonly thieving: ThievingProcedureStore,
        private readonly cases: CrimeCaseStore, private readonly evidence: CrimeEvidenceStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    current(): number {
        const row = this.database.query(`SELECT source_sequence FROM crime_observation_cursor
            ORDER BY sequence DESC LIMIT 1`).get() as { source_sequence: number } | null;
        return row?.source_sequence ?? 0;
    }
    runPage(limit = 100, recordedAt = new Date().toISOString()): { processed: number; nextSequence: number } {
        const at = time(recordedAt);
        if (!this.verifyAuditChain()) throw new Error('Crime observation cursor or source audit is invalid');
        const page = this.thieving.listDiscoveriesAfter(this.current(), limit);
        for (const item of page) {
            const promoted = promoteCrimeObservation(item.observation.observationId,
                this.thieving, this.cases, this.evidence, at);
            const transaction = this.database.transaction(() => {
                const previous = this.database.query(`SELECT * FROM crime_observation_cursor
                    ORDER BY sequence DESC LIMIT 1`).get() as CursorRow | null;
                const last = previous?.source_sequence ?? 0;
                if (this.thieving.listDiscoveriesAfter(last, 1)[0]?.sequence !== item.sequence)
                    throw new Error('Crime observation cursor source changed');
                const previousHash = previous?.entry_hash ?? ZERO;
                const value = { sourceSequence: item.sequence,
                    observationId: item.observation.observationId,
                    observationDigest: item.observation.observationDigest,
                    caseId: promoted.caseId, discoveryEventId: promoted.discovery.eventId,
                    identificationEventId: promoted.identification?.eventId ?? null,
                    evidenceId: promoted.evidence?.evidenceId ?? null, recordedAt: at };
                this.database.run(`INSERT INTO crime_observation_cursor
                    (source_sequence,observation_id,observation_digest,case_id,discovery_event_id,
                        identification_event_id,evidence_id,recorded_at,previous_hash,entry_hash)
                    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
                [value.sourceSequence, value.observationId, value.observationDigest,
                    value.caseId, value.discoveryEventId, value.identificationEventId,
                    value.evidenceId, value.recordedAt, previousHash, hash({ previousHash, payload: value })]);
            });
            transaction.immediate();
        }
        return { processed: page.length, nextSequence: this.current() };
    }
    verifyAuditChain(): boolean {
        if (!this.thieving.verifyAuditChain() || !this.cases.verifyAuditChain()
            || !this.evidence.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM crime_observation_cursor ORDER BY sequence')
            .all() as CursorRow[];
        let last = 0, previousHash = ZERO;
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index]!, source = this.thieving.listDiscoveriesAfter(last, 1)[0];
            const discovery = this.cases.getEvent(row.discovery_event_id);
            const identification = row.identification_event_id
                ? this.cases.getEvent(row.identification_event_id) : null;
            const proof = row.evidence_id ? this.evidence.getEvidence(row.evidence_id) : null;
            if (row.sequence !== index + 1 || !source || row.source_sequence !== source.sequence
                || typeof row.recorded_at !== 'string' || Number.isNaN(Date.parse(row.recorded_at))
                || new Date(row.recorded_at).toISOString() !== row.recorded_at
                || row.recorded_at < source.observation.recordedAt
                || row.observation_id !== source.observation.observationId
                || row.observation_digest !== source.observation.observationDigest
                || discovery?.caseId !== row.case_id || discovery.observationId !== row.observation_id
                || (source.observation.actorIdentification !== 'none') !== (identification !== null)
                || (identification && (identification.caseId !== row.case_id
                    || identification.observationId !== row.observation_id))
                || (admissibleEvidence(source.observation) !== null) !== (proof !== null)
                || (proof && (proof.kind !== admissibleEvidence(source.observation)
                    || proof.caseId !== row.case_id || proof.sourceId !== (identification
                    && proof.kind === 'direct-identification' ? identification.eventId : discovery.eventId)))
                || row.previous_hash !== previousHash
                || row.entry_hash !== hash({ previousHash, payload: payload(row) })) return false;
            last = row.source_sequence;
            previousHash = row.entry_hash;
        }
        return true;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Crime observation cursor schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE crime_observation_cursor (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                source_sequence INTEGER NOT NULL UNIQUE,observation_id TEXT NOT NULL UNIQUE,
                observation_digest TEXT NOT NULL,case_id TEXT NOT NULL,discovery_event_id TEXT NOT NULL,
                identification_event_id TEXT,evidence_id TEXT,recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
