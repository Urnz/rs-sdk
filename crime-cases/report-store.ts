import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { CrimeCaseStore } from './store.js';
import type { CrimeCaseEvent } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);

/** An explicit witness action, not a legal finding or a claim that the suspect is guilty. */
export interface CrimeReportRequest {
    reportId: string;
    caseId: string;
    sourceCaseEventId: string;
    reporterAgentId: string;
    reporterAttestationDigest: string;
    occurredAt: string;
}
export interface CrimeReport extends CrimeReportRequest {
    sourceCaseEventDigest: string;
    reportDigest: string;
    recordedAt: string;
}
export type CrimeReportVerifier = (request: Readonly<CrimeReportRequest>,
    discovery: Readonly<CrimeCaseEvent>) => string | null;

type ReportRow = { report_id: string; case_id: string; source_case_event_id: string;
    source_case_event_digest: string; reporter_agent_id: string; reporter_attestation_digest: string;
    occurred_at: string; report_digest: string; recorded_at: string };
type AuditRow = { report_id: string; previous_hash: string; entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`);
    return value;
}
function exact(value: unknown, keys: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error('Crime report fields are invalid');
}
function report(row: ReportRow): CrimeReport {
    return { reportId: row.report_id, caseId: row.case_id, sourceCaseEventId: row.source_case_event_id,
        reporterAgentId: row.reporter_agent_id, reporterAttestationDigest: row.reporter_attestation_digest,
        occurredAt: row.occurred_at, sourceCaseEventDigest: row.source_case_event_digest,
        reportDigest: row.report_digest, recordedAt: row.recorded_at };
}
function facts(value: CrimeReport): Omit<CrimeReport, 'reportDigest' | 'recordedAt'> {
    const { reportDigest: unusedDigest, recordedAt: unusedTime, ...rest } = value;
    void unusedDigest; void unusedTime; return rest;
}

/** Separate append-only report ledger. It never changes case identification, title or inventory. */
export class CrimeReportStore {
    private readonly database: Database;
    constructor(path: string, private readonly cases: CrimeCaseStore) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(reportIdInput: string): CrimeReport | null {
        if (!this.verifyAuditChain()) throw new Error('Crime report or case audit chain is invalid');
        return this.readReport(reportIdInput);
    }
    private readReport(reportIdInput: string): CrimeReport | null {
        const row = this.database.query('SELECT * FROM crime_report WHERE report_id=?1')
            .get(id(reportIdInput, 'reportId')) as ReportRow | null;
        return row ? report(row) : null;
    }
    listForCase(caseIdInput: string): CrimeReport[] {
        if (!this.verifyAuditChain()) throw new Error('Crime report or case audit chain is invalid');
        return (this.database.query('SELECT * FROM crime_report WHERE case_id=?1 ORDER BY sequence')
            .all(id(caseIdInput, 'caseId')) as ReportRow[]).map(report);
    }
    record(input: CrimeReportRequest, verify?: CrimeReportVerifier,
        recordedAtInput = new Date().toISOString()): CrimeReport {
        exact(input, ['reportId', 'caseId', 'sourceCaseEventId', 'reporterAgentId',
            'reporterAttestationDigest', 'occurredAt']);
        const request: CrimeReportRequest = { reportId: id(input.reportId, 'reportId'),
            caseId: id(input.caseId, 'caseId'), sourceCaseEventId: id(input.sourceCaseEventId, 'sourceCaseEventId'),
            reporterAgentId: id(input.reporterAgentId, 'reporterAgentId'),
            reporterAttestationDigest: digest(input.reporterAttestationDigest, 'reporterAttestationDigest'),
            occurredAt: time(input.occurredAt, 'occurredAt') };
        const recordedAt = time(recordedAtInput, 'recordedAt');
        if (!this.verifyAuditChain()) throw new Error('Crime report or case audit chain is invalid');
        const source = this.cases.getEvent(request.sourceCaseEventId);
        if (!source || source.kind !== 'discovery-recorded' || source.caseId !== request.caseId
            || source.observerAgentId !== request.reporterAgentId)
            throw new Error('Report requires this agent\'s recorded case discovery');
        if (Date.parse(request.occurredAt) < Date.parse(source.recordedAt)
            || Date.parse(recordedAt) < Date.parse(request.occurredAt))
            throw new Error('Report predates its discovery or action');
        const attested = verify?.(Object.freeze({ ...request }), Object.freeze({ ...source }));
        if (attested !== request.reporterAttestationDigest)
            throw new Error('Explicit witness report action is not trusted');
        const sourceCaseEventDigest = source.eventDigest;
        const reportDigest = hash({ ...request, sourceCaseEventDigest });
        const existing = this.get(request.reportId);
        if (existing) {
            if (existing.reportDigest !== reportDigest) throw new Error('Crime report id was reused');
            return existing;
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO crime_report
                (report_id,case_id,source_case_event_id,source_case_event_digest,reporter_agent_id,
                    reporter_attestation_digest,occurred_at,report_digest,recorded_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
            [request.reportId, request.caseId, request.sourceCaseEventId, sourceCaseEventDigest,
                request.reporterAgentId, request.reporterAttestationDigest, request.occurredAt,
                reportDigest, recordedAt]);
            const previous = (this.database.query('SELECT entry_hash FROM crime_report_audit ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { reportId: request.reportId, reportDigest, recordedAt };
            this.database.run(`INSERT INTO crime_report_audit(report_id,previous_hash,entry_hash)
                VALUES(?1,?2,?3)`, [request.reportId, previous, hash({ previousHash: previous, payload })]);
        });
        transaction.immediate();
        return this.get(request.reportId)!;
    }
    verifyAuditChain(): boolean {
        if (!this.cases.verifyAuditChain()) return false;
        const rows = this.database.query('SELECT * FROM crime_report_audit ORDER BY sequence').all() as AuditRow[];
        const count = this.database.query('SELECT COUNT(*) AS reports FROM crime_report').get() as { reports: number };
        if (rows.length !== count.reports) return false;
        let previous = ZERO;
        for (const row of rows) {
            const value = this.readReport(row.report_id);
            if (!value || value.reportDigest !== hash(facts(value))) return false;
            const source = this.cases.getEvent(value.sourceCaseEventId);
            if (!source || source.kind !== 'discovery-recorded' || source.caseId !== value.caseId
                || source.observerAgentId !== value.reporterAgentId
                || source.eventDigest !== value.sourceCaseEventDigest
                || !DIGEST.test(value.reporterAttestationDigest)
                || Date.parse(value.occurredAt) < Date.parse(source.recordedAt)
                || Date.parse(value.recordedAt) < Date.parse(value.occurredAt)) return false;
            const payload = { reportId: value.reportId, reportDigest: value.reportDigest,
                recordedAt: value.recordedAt };
            if (row.previous_hash !== previous || row.entry_hash !== hash({ previousHash: previous, payload }))
                return false;
            previous = row.entry_hash;
        }
        return true;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Crime report schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE crime_report (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL UNIQUE,
                case_id TEXT NOT NULL,source_case_event_id TEXT NOT NULL,
                source_case_event_digest TEXT NOT NULL,reporter_agent_id TEXT NOT NULL,
                reporter_attestation_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
                report_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                UNIQUE(source_case_event_id,reporter_agent_id))`);
            this.database.run(`CREATE TABLE crime_report_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL UNIQUE
                    REFERENCES crime_report(report_id),previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
