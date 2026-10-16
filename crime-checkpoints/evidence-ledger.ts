import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { checkpointInspectionPolicyDigest, projectCheckpointExposure,
    validateCheckpointInspectionPolicy } from './policy.js';
import type { CheckpointDetectionEvidence, CheckpointDetectionVerifier, CheckpointInspectionEvidence,
    CheckpointExposure, CheckpointInspectionPolicy, CheckpointInspectionVerifier } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/, DIGEST = /^[0-9a-f]{64}$/, ZERO = '0'.repeat(64);
type Kind = 'inspection' | 'detection';
type Entry = { kind: Kind; evidence: CheckpointInspectionEvidence | CheckpointDetectionEvidence;
    policyDigest: string | null; recordedAt: string; evidenceDigest: string };
type Row = { sequence: number; kind: Kind; evidence_id: string; source_digest: string; evidence_json: string;
    policy_digest: string | null; recorded_at: string; evidence_digest: string; previous_hash: string;
    entry_hash: string };

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${field} is invalid`);
    return value;
}
function exact(value: unknown, keys: string[], field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error(`${field} fields are invalid`);
    return value as Record<string, unknown>;
}
function inspection(value: CheckpointInspectionEvidence): CheckpointInspectionEvidence {
    const input = exact(value, ['inspectionId', 'jurisdictionId', 'locationId', 'checkpointId', 'authorityId',
        'inspectorAgentId', 'subjectAgentId', 'occurredAt', 'sourceEvidenceDigest'], 'Inspection');
    return { inspectionId: identifier(input.inspectionId, 'inspectionId'),
        jurisdictionId: identifier(input.jurisdictionId, 'jurisdictionId'),
        locationId: identifier(input.locationId, 'locationId'), checkpointId: identifier(input.checkpointId, 'checkpointId'),
        authorityId: identifier(input.authorityId, 'authorityId'),
        inspectorAgentId: identifier(input.inspectorAgentId, 'inspectorAgentId'),
        subjectAgentId: identifier(input.subjectAgentId, 'subjectAgentId'),
        occurredAt: time(input.occurredAt, 'occurredAt'),
        sourceEvidenceDigest: digest(input.sourceEvidenceDigest, 'sourceEvidenceDigest') };
}
function detection(value: CheckpointDetectionEvidence): CheckpointDetectionEvidence {
    const input = exact(value, ['detectionId', 'inspectionId', 'subjectAgentId', 'assetId', 'result', 'occurredAt',
        'sourceEvidenceDigest'], 'Detection');
    if (input.result !== 'recognized-stolen' && input.result !== 'not-recognized')
        throw new Error('Detection result is invalid');
    return { detectionId: identifier(input.detectionId, 'detectionId'),
        inspectionId: identifier(input.inspectionId, 'inspectionId'),
        subjectAgentId: identifier(input.subjectAgentId, 'subjectAgentId'),
        assetId: identifier(input.assetId, 'assetId'), result: input.result,
        occurredAt: time(input.occurredAt, 'occurredAt'),
        sourceEvidenceDigest: digest(input.sourceEvidenceDigest, 'sourceEvidenceDigest') };
}
function validatedPolicy(policy: CheckpointInspectionPolicy): void {
    const { digest: supplied, ...definition } = policy;
    if (digest(supplied, 'policy.digest') !== checkpointInspectionPolicyDigest(definition))
        throw new Error('Checkpoint policy digest mismatch');
    validateCheckpointInspectionPolicy(definition);
}
function fromRow(row: Row): Entry {
    const parsed: unknown = JSON.parse(row.evidence_json);
    const evidence = row.kind === 'inspection' ? inspection(parsed as CheckpointInspectionEvidence)
        : row.kind === 'detection' ? detection(parsed as CheckpointDetectionEvidence)
            : (() => { throw new Error('Invalid checkpoint evidence kind'); })();
    return { kind: row.kind, evidence, policyDigest: row.policy_digest, recordedAt: row.recorded_at,
        evidenceDigest: row.evidence_digest };
}

/** Separate append-only evidence ledger. Only trusted server event verifiers may authorize writes. */
export class CheckpointEvidenceLedger {
    private readonly database: Database;
    constructor(path: string) {
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        try { this.migrate(); } catch (error) { this.database.close(true); throw error; }
    }
    close(): void { this.database.close(true); }
    getInspection(inspectionId: string): CheckpointInspectionEvidence | null {
        this.assertChain();
        const row = this.find('inspection', identifier(inspectionId, 'inspectionId'));
        return row ? fromRow(row).evidence as CheckpointInspectionEvidence : null;
    }
    getDetection(detectionId: string): CheckpointDetectionEvidence | null {
        this.assertChain();
        const row = this.find('detection', identifier(detectionId, 'detectionId'));
        return row ? fromRow(row).evidence as CheckpointDetectionEvidence : null;
    }
    listDetections(inspectionId: string): CheckpointDetectionEvidence[] {
        this.assertChain();
        const key = identifier(inspectionId, 'inspectionId');
        return (this.database.query("SELECT * FROM checkpoint_evidence WHERE kind='detection' ORDER BY sequence")
            .all() as Row[]).map(fromRow).map(value => value.evidence as CheckpointDetectionEvidence)
            .filter(value => value.inspectionId === key);
    }
    /** Read-only projection: the recorded policy must be the one supplied, and sources are reverified. */
    projectExposure(inspectionId: string, detectionId: string, policy: CheckpointInspectionPolicy,
        verifyInspection?: CheckpointInspectionVerifier,
        verifyDetection?: CheckpointDetectionVerifier): CheckpointExposure {
        this.assertChain();
        validatedPolicy(policy);
        const inspected = this.find('inspection', identifier(inspectionId, 'inspectionId'));
        if (inspected && inspected.policy_digest !== policy.digest)
            throw new Error('Checkpoint inspection policy digest mismatch');
        const detected = this.find('detection', identifier(detectionId, 'detectionId'));
        return projectCheckpointExposure(policy,
            inspected ? fromRow(inspected).evidence as CheckpointInspectionEvidence : null,
            detected ? fromRow(detected).evidence as CheckpointDetectionEvidence : null,
            verifyInspection, verifyDetection);
    }
    recordInspection(input: CheckpointInspectionEvidence, policy: CheckpointInspectionPolicy,
        verify?: CheckpointInspectionVerifier, recordedAtInput = new Date().toISOString()): CheckpointInspectionEvidence {
        const value = inspection(input), recordedAt = time(recordedAtInput, 'recordedAt');
        this.assertChain();
        validatedPolicy(policy);
        if (Date.parse(recordedAt) < Date.parse(value.occurredAt)) throw new Error('Inspection cannot predate source');
        const rule = policy.rules.find(rule => rule.jurisdictionId === value.jurisdictionId
            && rule.locationId === value.locationId && rule.checkpointId === value.checkpointId);
        if (!rule || rule.permission !== 'allow' || rule.authorityId !== value.authorityId
            || Date.parse(value.occurredAt) < Date.parse(policy.effectiveFrom)
            || policy.expiresAt !== null && Date.parse(value.occurredAt) >= Date.parse(policy.expiresAt))
            throw new Error('Inspection is not permitted by checkpoint policy');
        if (!verify?.(Object.freeze({ ...value }))) throw new Error('Inspection source is not trusted');
        this.insert('inspection', value.inspectionId, value.sourceEvidenceDigest, value, policy.digest, recordedAt);
        return value;
    }
    recordDetection(input: CheckpointDetectionEvidence, verify?: CheckpointDetectionVerifier,
        recordedAtInput = new Date().toISOString()): CheckpointDetectionEvidence {
        const value = detection(input), recordedAt = time(recordedAtInput, 'recordedAt');
        this.assertChain();
        const source = this.find('inspection', value.inspectionId);
        if (!source) throw new Error('Detection requires persisted inspection');
        const inspected = fromRow(source).evidence as CheckpointInspectionEvidence;
        if (value.subjectAgentId !== inspected.subjectAgentId
            || Date.parse(value.occurredAt) < Date.parse(inspected.occurredAt)
            || Date.parse(recordedAt) < Date.parse(source.recorded_at)
            || Date.parse(recordedAt) < Date.parse(value.occurredAt))
            throw new Error('Detection subject or chronology does not match inspection');
        if (!verify?.(Object.freeze({ ...value }), Object.freeze({ ...inspected })))
            throw new Error('Detection source is not trusted');
        this.insert('detection', value.detectionId, value.sourceEvidenceDigest, value, null, recordedAt);
        return value;
    }
    verifyAuditChain(): boolean {
        try {
            const rows = this.database.query('SELECT * FROM checkpoint_evidence ORDER BY sequence').all() as Row[];
            let previous = ZERO;
            const inspections = new Map<string, { evidence: CheckpointInspectionEvidence; recordedAt: string }>();
            const ids = new Set<string>();
            const sources = new Set<string>();
            for (const row of rows) {
                const entry = fromRow(row), value = entry.evidence;
                const evidenceId = row.kind === 'inspection' ? (value as CheckpointInspectionEvidence).inspectionId
                    : (value as CheckpointDetectionEvidence).detectionId;
                if (row.evidence_id !== evidenceId || row.source_digest !== value.sourceEvidenceDigest
                    || row.recorded_at !== time(row.recorded_at, 'recordedAt')
                    || Date.parse(row.recorded_at) < Date.parse(value.occurredAt)
                    || row.kind === 'inspection' && !DIGEST.test(row.policy_digest ?? '')
                    || row.kind === 'detection' && row.policy_digest !== null) return false;
                const payload = { kind: row.kind, evidence: value, policyDigest: row.policy_digest };
                if (row.evidence_digest !== hash(payload) || row.previous_hash !== previous
                    || row.entry_hash !== hash({ previousHash: previous, evidenceDigest: row.evidence_digest,
                        recordedAt: row.recorded_at })) return false;
                const key = `${row.kind}\0${evidenceId}`, sourceKey = `${row.kind}\0${row.source_digest}`;
                if (ids.has(key) || sources.has(sourceKey)) return false;
                ids.add(key); sources.add(sourceKey);
                if (row.kind === 'inspection') inspections.set(evidenceId,
                    { evidence: value as CheckpointInspectionEvidence, recordedAt: row.recorded_at });
                else {
                    const detected = value as CheckpointDetectionEvidence;
                    const inspected = inspections.get(detected.inspectionId);
                    if (!inspected || inspected.evidence.subjectAgentId !== detected.subjectAgentId
                        || Date.parse(detected.occurredAt) < Date.parse(inspected.evidence.occurredAt)
                        || Date.parse(row.recorded_at) < Date.parse(inspected.recordedAt)) return false;
                }
                previous = row.entry_hash;
            }
            return true;
        } catch { return false; }
    }
    private assertChain(): void {
        if (!this.verifyAuditChain()) throw new Error('Checkpoint evidence audit chain is invalid');
    }
    private find(kind: Kind, evidenceId: string): Row | null {
        return this.database.query('SELECT * FROM checkpoint_evidence WHERE kind=?1 AND evidence_id=?2')
            .get(kind, evidenceId) as Row | null;
    }
    private insert(kind: Kind, evidenceId: string, sourceDigest: string,
        evidence: CheckpointInspectionEvidence | CheckpointDetectionEvidence,
        policyDigest: string | null, recordedAt: string): void {
        const payload = { kind, evidence, policyDigest }, evidenceDigest = hash(payload);
        const existing = this.find(kind, evidenceId);
        if (existing) {
            if (existing.evidence_digest !== evidenceDigest) throw new Error('Checkpoint evidence id was reused');
            return;
        }
        const transaction = this.database.transaction(() => {
            const previous = (this.database.query('SELECT entry_hash FROM checkpoint_evidence ORDER BY sequence DESC LIMIT 1')
                .get() as { entry_hash: string } | null)?.entry_hash ?? ZERO;
            const entryHash = hash({ previousHash: previous, evidenceDigest, recordedAt });
            this.database.run(`INSERT INTO checkpoint_evidence(kind,evidence_id,source_digest,evidence_json,
                policy_digest,recorded_at,evidence_digest,previous_hash,entry_hash)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`, [kind, evidenceId, sourceDigest,
                JSON.stringify(evidence), policyDigest, recordedAt, evidenceDigest, previous, entryHash]);
        });
        transaction.immediate();
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Checkpoint evidence schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        this.database.transaction(() => {
            this.database.run(`CREATE TABLE checkpoint_evidence(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL CHECK(kind IN ('inspection','detection')),
                evidence_id TEXT NOT NULL,source_digest TEXT NOT NULL,evidence_json TEXT NOT NULL,
                policy_digest TEXT,recorded_at TEXT NOT NULL,evidence_digest TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,
                UNIQUE(kind,evidence_id),UNIQUE(kind,source_digest))`);
            this.database.run('PRAGMA user_version = 1');
        }).immediate();
    }
}
