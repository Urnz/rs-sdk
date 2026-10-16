import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import { verifyPlayerOnlyWitness, type PlayerOnlyWitnessProof, type VerifyPlayerRecognition } from './player-witness-proof.js';
import type { CrimeCaseStore } from './store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const USERNAME = /^[a-z0-9]{1,12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(64);

export interface PlayerWitnessReportAction {
    reportId: string;
    caseId: string;
    sourceCaseEventId: string;
    actionAttestationDigest: string;
    occurredAt: string;
}

/** A witness statement only: neither an agent report nor a finding of guilt. */
export interface PlayerWitnessReport extends PlayerWitnessReportAction {
    reporterUsername: string;
    sourceCaseEventDigest: string;
    observationId: string;
    witnessDecisionDigest: string;
    reportDigest: string;
    recordedAt: string;
}

/** Must attest an explicit action from an authenticated game session, independently of request fields. */
export type PlayerWitnessReportActionVerifier = (action: Readonly<PlayerWitnessReportAction>,
    authenticatedUsername: string, proof: Readonly<PlayerOnlyWitnessProof>) => string | null;

type Row = { report_id: string; case_id: string; source_case_event_id: string;
    action_attestation_digest: string; occurred_at: string; reporter_username: string;
    source_case_event_digest: string; observation_id: string; witness_decision_digest: string;
    report_digest: string; recorded_at: string };
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
function username(value: unknown): string {
    if (typeof value !== 'string' || !USERNAME.test(value))
        throw new Error('Authenticated witness username is invalid');
    return value;
}
function exact(value: unknown, keys: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error('Player witness report action fields are invalid');
}
function report(row: Row): PlayerWitnessReport {
    return { reportId: row.report_id, caseId: row.case_id, sourceCaseEventId: row.source_case_event_id,
        actionAttestationDigest: row.action_attestation_digest, occurredAt: row.occurred_at,
        reporterUsername: row.reporter_username, sourceCaseEventDigest: row.source_case_event_digest,
        observationId: row.observation_id, witnessDecisionDigest: row.witness_decision_digest,
        reportDigest: row.report_digest, recordedAt: row.recorded_at };
}
function facts(value: PlayerWitnessReport): Omit<PlayerWitnessReport, 'reportDigest' | 'recordedAt'> {
    const { reportDigest: unusedDigest, recordedAt: unusedTime, ...rest } = value;
    void unusedDigest; void unusedTime; return rest;
}

/** Independent append-only ledger for noticed player witnesses without an agent binding. */
export class PlayerWitnessReportStore {
    private readonly database: Database;
    constructor(path: string, private readonly sources: {
        cases: CrimeCaseStore;
        thieving: ThievingProcedureStore;
        witnessDecisions: WitnessAttentionDecisionStore;
        verifyRecognition?: VerifyPlayerRecognition;
    }) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    get(reportIdInput: string): PlayerWitnessReport | null {
        if (!this.verifyAuditChain()) throw new Error('Player witness report or source audit chain is invalid');
        return this.readReport(reportIdInput);
    }
    listForCase(caseIdInput: string): PlayerWitnessReport[] {
        if (!this.verifyAuditChain()) throw new Error('Player witness report or source audit chain is invalid');
        return (this.database.query('SELECT * FROM player_witness_report WHERE case_id=?1 ORDER BY sequence')
            .all(id(caseIdInput, 'caseId')) as Row[]).map(report);
    }
    /** The username is derived from the authenticated session, never from the action body. */
    record(actionInput: PlayerWitnessReportAction, authenticatedUsername: () => string | null,
        verifyAction: PlayerWitnessReportActionVerifier, recordedAtInput = new Date().toISOString())
        : PlayerWitnessReport {
        exact(actionInput, ['reportId', 'caseId', 'sourceCaseEventId', 'actionAttestationDigest', 'occurredAt']);
        const action: PlayerWitnessReportAction = { reportId: id(actionInput.reportId, 'reportId'),
            caseId: id(actionInput.caseId, 'caseId'),
            sourceCaseEventId: id(actionInput.sourceCaseEventId, 'sourceCaseEventId'),
            actionAttestationDigest: digest(actionInput.actionAttestationDigest, 'actionAttestationDigest'),
            occurredAt: time(actionInput.occurredAt, 'occurredAt') };
        const reporterUsername = username(authenticatedUsername()?.trim().toLowerCase());
        const recordedAt = time(recordedAtInput, 'recordedAt');
        if (!this.verifyAuditChain()) throw new Error('Player witness report or source audit chain is invalid');
        const proof = verifyPlayerOnlyWitness(action.caseId, action.sourceCaseEventId,
            reporterUsername, this.sources);
        if (!proof) throw new Error('Reporter is not the recorded player-only witness');
        const source = this.sources.cases.getEvent(action.sourceCaseEventId)!;
        if (Date.parse(action.occurredAt) < Date.parse(source.recordedAt)
            || Date.parse(recordedAt) < Date.parse(action.occurredAt))
            throw new Error('Player witness report predates discovery or action');
        if (verifyAction(Object.freeze({ ...action }), reporterUsername, Object.freeze({ ...proof }))
            !== action.actionAttestationDigest)
            throw new Error('Explicit player witness report action is not trusted');
        const sourceCaseEventDigest = source.eventDigest;
        const base = { ...action, reporterUsername, sourceCaseEventDigest,
            observationId: proof.observationId, witnessDecisionDigest: proof.witnessDecisionDigest };
        const reportDigest = hash(base);
        const existing = this.readReport(action.reportId);
        if (existing) {
            if (existing.reportDigest !== reportDigest) throw new Error('Player witness report id was reused');
            return existing;
        }
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO player_witness_report
                (report_id,case_id,source_case_event_id,action_attestation_digest,occurred_at,
                    reporter_username,source_case_event_digest,observation_id,witness_decision_digest,
                    report_digest,recorded_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
            [action.reportId, action.caseId, action.sourceCaseEventId, action.actionAttestationDigest,
                action.occurredAt, reporterUsername, sourceCaseEventDigest, proof.observationId,
                proof.witnessDecisionDigest, reportDigest, recordedAt]);
            const previous = (this.database.query(`SELECT entry_hash FROM player_witness_report_audit
                ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const payload = { reportId: action.reportId, reportDigest, recordedAt };
            this.database.run(`INSERT INTO player_witness_report_audit(report_id,previous_hash,entry_hash)
                VALUES(?1,?2,?3)`, [action.reportId, previous, hash({ previousHash: previous, payload })]);
        });
        transaction.immediate();
        return this.get(action.reportId)!;
    }
    verifyAuditChain(): boolean {
        if (!this.sources.cases.verifyAuditChain() || !this.sources.thieving.verifyAuditChain()
            || !this.sources.witnessDecisions.verifyAuditChain()) return false;
        const audits = this.database.query('SELECT * FROM player_witness_report_audit ORDER BY sequence')
            .all() as AuditRow[];
        const count = this.database.query('SELECT COUNT(*) AS reports FROM player_witness_report')
            .get() as { reports: number };
        if (audits.length !== count.reports) return false;
        let previous = ZERO;
        for (const audit of audits) {
            const value = this.readReport(audit.report_id);
            if (!value || value.reportDigest !== hash(facts(value))
                || !DIGEST.test(value.actionAttestationDigest)) return false;
            const proof = verifyPlayerOnlyWitness(value.caseId, value.sourceCaseEventId,
                value.reporterUsername, this.sources);
            const source = this.sources.cases.getEvent(value.sourceCaseEventId);
            if (!proof || !source || source.eventDigest !== value.sourceCaseEventDigest
                || proof.observationId !== value.observationId
                || proof.witnessDecisionDigest !== value.witnessDecisionDigest
                || Date.parse(value.occurredAt) < Date.parse(source.recordedAt)
                || Date.parse(value.recordedAt) < Date.parse(value.occurredAt)) return false;
            const payload = { reportId: value.reportId, reportDigest: value.reportDigest,
                recordedAt: value.recordedAt };
            if (audit.previous_hash !== previous
                || audit.entry_hash !== hash({ previousHash: previous, payload })) return false;
            previous = audit.entry_hash;
        }
        return true;
    }
    private readReport(reportIdInput: string): PlayerWitnessReport | null {
        const row = this.database.query('SELECT * FROM player_witness_report WHERE report_id=?1')
            .get(id(reportIdInput, 'reportId')) as Row | null;
        return row ? report(row) : null;
    }
    private migrate(): void {
        const version = (this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > 1) throw new Error(`Player witness report schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE player_witness_report (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL UNIQUE,
                case_id TEXT NOT NULL,source_case_event_id TEXT NOT NULL,
                action_attestation_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
                reporter_username TEXT NOT NULL,source_case_event_digest TEXT NOT NULL,
                observation_id TEXT NOT NULL,witness_decision_digest TEXT NOT NULL,
                report_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                UNIQUE(source_case_event_id,reporter_username))`);
            this.database.run(`CREATE TABLE player_witness_report_audit (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL UNIQUE
                    REFERENCES player_witness_report(report_id),previous_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        });
        transaction.immediate();
    }
}
