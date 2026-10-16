import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { CrimeCaseStore } from './store.js';
import type { CrimeEvidenceEntry, CrimeEvidenceKind, JurisdictionCriminalRecord, LegalFinding, LegalFindingRequest,
    LegalFindingVerifier, PossessionObservation, PossessionVerifier } from './evidence-types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);
type EvidenceRow = { evidence_id: string; case_id: string; kind: CrimeEvidenceKind; source_id: string;
    source_digest: string; suspect_agent_id: string | null; asset_id: string | null; occurred_at: string;
    recorded_at: string; evidence_digest: string };
type FindingRow = { finding_id: string; case_id: string; jurisdiction_id: string; suspect_agent_id: string;
    conclusion: LegalFinding['conclusion']; evidence_ids_json: string; policy_id: string; policy_digest: string;
    authority_evidence_digest: string; occurred_at: string; finding_digest: string; recorded_at: string };
type AuditRow = { entry_kind: 'evidence' | 'finding'; entry_id: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function digest(value: unknown, field: string): string { if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${field} is invalid`); return value; }
function time(value: unknown, field: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`); return value; }
function exact(value: unknown, keys: string[], field: string): void { if (!value || typeof value !== 'object'
    || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error(`${field} fields are invalid`); }
function evidence(row: EvidenceRow): CrimeEvidenceEntry { return { evidenceId: row.evidence_id, caseId: row.case_id,
    kind: row.kind, sourceId: row.source_id, sourceDigest: row.source_digest,
    suspectAgentId: row.suspect_agent_id, assetId: row.asset_id, occurredAt: row.occurred_at,
    recordedAt: row.recorded_at, evidenceDigest: row.evidence_digest }; }
function finding(row: FindingRow): LegalFinding { return { findingId: row.finding_id, caseId: row.case_id,
    jurisdictionId: row.jurisdiction_id, suspectAgentId: row.suspect_agent_id, conclusion: row.conclusion,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[], policyId: row.policy_id,
    policyDigest: row.policy_digest, authorityEvidenceDigest: row.authority_evidence_digest,
    occurredAt: row.occurred_at, findingDigest: row.finding_digest, recordedAt: row.recorded_at }; }
function evidenceFacts(value: CrimeEvidenceEntry): object { const { recordedAt, evidenceDigest, ...facts } = value;
    void recordedAt; void evidenceDigest; return facts; }
function findingFacts(value: LegalFinding): LegalFindingRequest { const { findingDigest, recordedAt, ...facts } = value;
    void findingDigest; void recordedAt; return facts; }

/** Separate, append-only evidence and finding ledger. No sanction or inventory action lives here. */
export class CrimeEvidenceStore {
    private readonly database: Database;
    constructor(path: string, private readonly cases: CrimeCaseStore, private readonly thieving: ThievingProcedureStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    getEvidence(evidenceIdInput: string): CrimeEvidenceEntry | null {
        this.assertAuditChain();
        return this.readEvidence(evidenceIdInput);
    }
    private readEvidence(evidenceIdInput: string): CrimeEvidenceEntry | null {
        const row = this.database.query('SELECT * FROM crime_evidence WHERE evidence_id=?1')
            .get(id(evidenceIdInput, 'evidenceId')) as EvidenceRow | null;
        return row ? evidence(row) : null;
    }
    findEvidenceBySource(kind: CrimeEvidenceKind, sourceCaseEventIdInput: string): CrimeEvidenceEntry | null {
        this.assertAuditChain();
        if (!['direct-identification', 'physical-trace', 'possession'].includes(kind))
            throw new Error('Evidence kind is invalid');
        const row = this.database.query('SELECT * FROM crime_evidence WHERE kind=?1 AND source_id=?2')
            .get(kind, id(sourceCaseEventIdInput, 'sourceCaseEventId')) as EvidenceRow | null;
        return row ? evidence(row) : null;
    }
    listEvidence(caseIdInput: string): CrimeEvidenceEntry[] {
        this.assertAuditChain();
        return (this.database.query('SELECT * FROM crime_evidence WHERE case_id=?1 ORDER BY sequence')
            .all(id(caseIdInput, 'caseId')) as EvidenceRow[]).map(evidence);
    }
    getFinding(findingIdInput: string): LegalFinding | null {
        this.assertAuditChain();
        return this.readFinding(findingIdInput);
    }
    private readFinding(findingIdInput: string): LegalFinding | null {
        const row = this.database.query('SELECT * FROM crime_legal_finding WHERE finding_id=?1')
            .get(id(findingIdInput, 'findingId')) as FindingRow | null;
        return row ? finding(row) : null;
    }
    listFindings(caseIdInput: string): LegalFinding[] {
        this.assertAuditChain();
        return (this.database.query('SELECT * FROM crime_legal_finding WHERE case_id=?1 ORDER BY sequence')
            .all(id(caseIdInput, 'caseId')) as FindingRow[]).map(finding);
    }
    /** Internal view: only verified responsibility in this jurisdiction; never a reputation or sanction. */
    getJurisdictionCriminalRecord(suspectAgentIdInput: string,
        jurisdictionIdInput: string): JurisdictionCriminalRecord {
        const suspectAgentId = id(suspectAgentIdInput, 'suspectAgentId');
        const jurisdictionId = id(jurisdictionIdInput, 'jurisdictionId');
        this.assertAuditChain();
        const responsibleFindings = (this.database.query(`SELECT * FROM crime_legal_finding
            WHERE suspect_agent_id=?1 AND jurisdiction_id=?2 AND conclusion='responsible'
            ORDER BY sequence`).all(suspectAgentId, jurisdictionId) as FindingRow[]).map(finding);
        return { suspectAgentId, jurisdictionId, responsibleFindings };
    }
    recordCaseEvidence(evidenceIdInput: string, sourceCaseEventIdInput: string,
        recordedAtInput = new Date().toISOString()): CrimeEvidenceEntry {
        const evidenceId = id(evidenceIdInput, 'evidenceId');
        const sourceId = id(sourceCaseEventIdInput, 'sourceCaseEventId');
        const recordedAt = time(recordedAtInput, 'recordedAt');
        if (!this.verifyAuditChain()) throw new Error('Crime evidence or source audit chain is invalid');
        const source = this.cases.getEvent(sourceId);
        if (!source) throw new Error('Case evidence requires a persisted case event');
        const observation = this.thieving.getDiscovery(source.observationId);
        if (!observation) throw new Error('Case evidence source observation is absent');
        let kind: CrimeEvidenceKind;
        if (source.kind === 'suspect-identified' && source.identification === 'direct'
            && (observation.source === 'direct-witness' || observation.source === 'guard-line-of-sight'))
            kind = 'direct-identification';
        else if (source.kind === 'discovery-recorded' && observation.source === 'physical-trace')
            kind = 'physical-trace';
        else throw new Error('Case event is not admissible evidence in this slice');
        if (Date.parse(recordedAt) < Date.parse(source.recordedAt))
            throw new Error('Evidence cannot predate its case source');
        const facts = { evidenceId, caseId: source.caseId, kind, sourceId,
            sourceDigest: source.eventDigest, suspectAgentId: kind === 'direct-identification'
                ? source.suspectAgentId : null, assetId: null, occurredAt: source.occurredAt };
        return this.insertEvidence(facts, recordedAt);
    }
    recordPossession(evidenceIdInput: string, input: PossessionObservation,
        verify?: PossessionVerifier, recordedAtInput = new Date().toISOString()): CrimeEvidenceEntry {
        const evidenceId = id(evidenceIdInput, 'evidenceId'), recordedAt = time(recordedAtInput, 'recordedAt');
        exact(input, ['observationId', 'caseId', 'assetId', 'holderAgentId', 'sourceEvidenceDigest',
            'occurredAt'], 'Possession observation');
        const normalized: PossessionObservation = { observationId: id(input.observationId, 'observationId'),
            caseId: id(input.caseId, 'caseId'), assetId: id(input.assetId, 'assetId'),
            holderAgentId: id(input.holderAgentId, 'holderAgentId'),
            sourceEvidenceDigest: digest(input.sourceEvidenceDigest, 'sourceEvidenceDigest'),
            occurredAt: time(input.occurredAt, 'occurredAt') };
        if (!this.verifyAuditChain()) throw new Error('Crime evidence or source audit chain is invalid');
        if (!this.cases.getState(normalized.caseId)) throw new Error('Possession evidence requires a discovered case');
        if (Date.parse(recordedAt) < Date.parse(normalized.occurredAt))
            throw new Error('Evidence cannot predate its possession observation');
        if (!verify?.(Object.freeze(normalized))) throw new Error('Possession observation is not trusted');
        return this.insertEvidence({ evidenceId, caseId: normalized.caseId, kind: 'possession',
            sourceId: normalized.observationId, sourceDigest: normalized.sourceEvidenceDigest,
            suspectAgentId: normalized.holderAgentId, assetId: normalized.assetId,
            occurredAt: normalized.occurredAt }, recordedAt);
    }
    private insertEvidence(facts: Omit<CrimeEvidenceEntry, 'recordedAt' | 'evidenceDigest'>,
        recordedAt: string): CrimeEvidenceEntry {
        const evidenceDigest = hash(facts), existing = this.readEvidence(facts.evidenceId);
        if (existing) { if (existing.evidenceDigest !== evidenceDigest) throw new Error('Evidence id was reused');
            return existing; }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO crime_evidence(evidence_id,case_id,kind,source_id,source_digest,
                suspect_agent_id,asset_id,occurred_at,recorded_at,evidence_digest)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`, [facts.evidenceId, facts.caseId, facts.kind,
                facts.sourceId, facts.sourceDigest, facts.suspectAgentId, facts.assetId, facts.occurredAt,
                recordedAt, evidenceDigest]);
            this.audit('evidence', facts.evidenceId, evidenceDigest, recordedAt);
        });
        transaction.immediate();
        return this.readEvidence(facts.evidenceId)!;
    }
    recordFinding(input: LegalFindingRequest, verify?: LegalFindingVerifier,
        recordedAtInput = new Date().toISOString()): LegalFinding {
        exact(input, ['findingId', 'caseId', 'jurisdictionId', 'suspectAgentId', 'conclusion', 'evidenceIds',
            'policyId', 'policyDigest', 'authorityEvidenceDigest', 'occurredAt'], 'Legal finding');
        const evidenceIds = input.evidenceIds;
        if (!Array.isArray(evidenceIds) || evidenceIds.length > 100
            || new Set(evidenceIds).size !== evidenceIds.length) throw new Error('Legal finding evidence ids are invalid');
        const request: LegalFindingRequest = { findingId: id(input.findingId, 'findingId'),
            caseId: id(input.caseId, 'caseId'), jurisdictionId: id(input.jurisdictionId, 'jurisdictionId'),
            suspectAgentId: id(input.suspectAgentId, 'suspectAgentId'), conclusion: input.conclusion,
            evidenceIds: evidenceIds.map(value => id(value, 'evidenceId')).sort(),
            policyId: id(input.policyId, 'policyId'), policyDigest: digest(input.policyDigest, 'policyDigest'),
            authorityEvidenceDigest: digest(input.authorityEvidenceDigest, 'authorityEvidenceDigest'),
            occurredAt: time(input.occurredAt, 'occurredAt') };
        const recordedAt = time(recordedAtInput, 'recordedAt');
        if (!['responsible', 'not-proven'].includes(request.conclusion)
            || Date.parse(recordedAt) < Date.parse(request.occurredAt)) throw new Error('Legal finding is invalid');
        if (!this.verifyAuditChain()) throw new Error('Crime evidence or source audit chain is invalid');
        const state = this.cases.getState(request.caseId);
        if (!state) throw new Error('Legal finding requires a discovered case');
        const entries = request.evidenceIds.map(value => this.readEvidence(value));
        if (entries.some(value => !value || value.caseId !== request.caseId))
            throw new Error('Legal finding references foreign or absent evidence');
        const admitted = entries as CrimeEvidenceEntry[];
        if (admitted.some(value => Date.parse(value.occurredAt) > Date.parse(request.occurredAt)))
            throw new Error('Legal finding predates cited evidence');
        if (request.conclusion === 'responsible' && (!state.identifications.some(value =>
            value.suspectAgentId === request.suspectAgentId)
            || !admitted.some(value => value.kind === 'direct-identification'
                && value.suspectAgentId === request.suspectAgentId)))
            throw new Error('Possession or suspicion alone cannot establish responsibility');
        const verifiedRequest = Object.freeze({ ...request, evidenceIds: Object.freeze([...request.evidenceIds]) });
        const verifiedEvidence = Object.freeze(admitted.map(value => Object.freeze({ ...value })));
        if (!verify?.(verifiedRequest as Readonly<LegalFindingRequest>, verifiedEvidence))
            throw new Error('Legal finding is not trusted by jurisdiction policy');
        const findingDigest = hash(request), existing = this.readFinding(request.findingId);
        if (existing) { if (existing.findingDigest !== findingDigest) throw new Error('Finding id was reused');
            return existing; }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO crime_legal_finding(finding_id,case_id,jurisdiction_id,suspect_agent_id,
                conclusion,evidence_ids_json,policy_id,policy_digest,authority_evidence_digest,occurred_at,
                finding_digest,recorded_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
            [request.findingId, request.caseId, request.jurisdictionId, request.suspectAgentId,
                request.conclusion, JSON.stringify(request.evidenceIds), request.policyId, request.policyDigest,
                request.authorityEvidenceDigest, request.occurredAt, findingDigest, recordedAt]);
            this.audit('finding', request.findingId, findingDigest, recordedAt);
        });
        transaction.immediate();
        return this.readFinding(request.findingId)!;
    }
    private audit(kind: 'evidence' | 'finding', entryId: string, entryDigest: string, recordedAt: string): void {
        const previous = (this.database.query('SELECT entry_hash FROM crime_evidence_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
        const payload = { kind, entryId, entryDigest, recordedAt };
        this.database.run(`INSERT INTO crime_evidence_audit(entry_kind,entry_id,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4)`, [kind, entryId, previous, hash({ previousHash: previous, payload })]);
    }
    verifyAuditChain(): boolean {
        if (!this.cases.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM crime_evidence_audit ORDER BY sequence').all() as AuditRow[];
        const count = this.database.query(`SELECT
            (SELECT COUNT(*) FROM crime_evidence)+(SELECT COUNT(*) FROM crime_legal_finding) AS events`)
            .get() as { events: number };
        if (rows.length !== count.events) return false;
        let previous = ZERO;
        for (const row of rows) {
            const source = row.entry_kind === 'evidence' ? this.readEvidence(row.entry_id)
                : row.entry_kind === 'finding' ? this.readFinding(row.entry_id) : null;
            if (!source) return false;
            const sourceDigest = row.entry_kind === 'evidence' ? (source as CrimeEvidenceEntry).evidenceDigest
                : (source as LegalFinding).findingDigest;
            const facts = row.entry_kind === 'evidence' ? evidenceFacts(source as CrimeEvidenceEntry)
                : findingFacts(source as LegalFinding);
            if (hash(facts) !== sourceDigest) return false;
            if (row.entry_kind === 'evidence' && (source as CrimeEvidenceEntry).kind !== 'possession') {
                const entry = source as CrimeEvidenceEntry, caseEvent = this.cases.getEvent(entry.sourceId);
                if (!caseEvent || caseEvent.eventDigest !== entry.sourceDigest || caseEvent.caseId !== entry.caseId)
                    return false;
            }
            if (row.entry_kind === 'finding' && (source as LegalFinding).evidenceIds.some(value =>
                this.readEvidence(value)?.caseId !== (source as LegalFinding).caseId)) return false;
            const payload = { kind: row.entry_kind, entryId: row.entry_id, entryDigest: sourceDigest,
                recordedAt: source.recordedAt };
            if (row.previous_hash !== previous || row.entry_hash !== hash({ previousHash: previous, payload })) return false;
            previous = row.entry_hash;
        }
        return true;
    }
    private assertAuditChain(): void {
        if (!this.verifyAuditChain()) throw new Error('Crime evidence or source audit chain is invalid');
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Crime evidence schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE crime_evidence(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                evidence_id TEXT NOT NULL UNIQUE,case_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,
                source_digest TEXT NOT NULL,suspect_agent_id TEXT,asset_id TEXT,occurred_at TEXT NOT NULL,
                recorded_at TEXT NOT NULL,evidence_digest TEXT NOT NULL,UNIQUE(kind,source_id))`);
            this.database.run(`CREATE TABLE crime_legal_finding(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                finding_id TEXT NOT NULL UNIQUE,case_id TEXT NOT NULL,jurisdiction_id TEXT NOT NULL,
                suspect_agent_id TEXT NOT NULL,conclusion TEXT NOT NULL,evidence_ids_json TEXT NOT NULL,
                policy_id TEXT NOT NULL,policy_digest TEXT NOT NULL,authority_evidence_digest TEXT NOT NULL,
                occurred_at TEXT NOT NULL,finding_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                UNIQUE(case_id,jurisdiction_id,suspect_agent_id))`);
            this.database.run(`CREATE TABLE crime_evidence_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_kind TEXT NOT NULL,entry_id TEXT NOT NULL,previous_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL UNIQUE,UNIQUE(entry_kind,entry_id))`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
