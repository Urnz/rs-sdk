import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateCheckpointInspectionPolicy } from '../policy.js';
import { CheckpointEvidenceLedger } from '../evidence-ledger.js';
import type { CheckpointDetectionEvidence, CheckpointInspectionEvidence } from '../types.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const policy = validateCheckpointInspectionPolicy({ schemaVersion: 1, policyId: 'city-checkpoints',
    version: '1.0.0', effectiveFrom: '2030-01-01T00:00:00.000Z', expiresAt: null,
    rules: [{ jurisdictionId: 'city', locationId: 'castle', checkpointId: 'gate',
        authorityId: 'city-guard', permission: 'allow' }] });
const inspection: CheckpointInspectionEvidence = { inspectionId: 'inspection-1', jurisdictionId: 'city',
    locationId: 'castle', checkpointId: 'gate', authorityId: 'city-guard', inspectorAgentId: 'guard-1',
    subjectAgentId: 'visitor-1', occurredAt: '2030-01-01T10:00:00.000Z', sourceEvidenceDigest: 'a'.repeat(64) };
const detection: CheckpointDetectionEvidence = { detectionId: 'detection-1', inspectionId: 'inspection-1',
    subjectAgentId: 'visitor-1', assetId: 'asset-1', result: 'recognized-stolen',
    occurredAt: '2030-01-01T10:00:01.000Z', sourceEvidenceDigest: 'b'.repeat(64) };
const recorded = '2030-01-01T10:00:02.000Z';
function setup() {
    const root = mkdtempSync(join(tmpdir(), 'checkpoint-ledger-')); roots.push(root);
    const path = join(root, 'ledger.sqlite');
    return { path, ledger: new CheckpointEvidenceLedger(path) };
}

describe('trusted checkpoint evidence ledger', () => {
    test('persists independent inspection and detection and replays exact source idempotently', () => {
        const { path, ledger } = setup();
        try {
            expect(ledger.recordInspection(inspection, policy, () => true, recorded)).toEqual(inspection);
            expect(ledger.recordDetection(detection, () => true, recorded)).toEqual(detection);
            expect(ledger.recordInspection(inspection, policy, () => true, '2030-01-01T10:01:00.000Z'))
                .toEqual(inspection);
            expect(ledger.recordDetection(detection, () => true, '2030-01-01T10:01:00.000Z'))
                .toEqual(detection);
            expect(ledger.listDetections('inspection-1')).toEqual([detection]);
            expect(ledger.verifyAuditChain()).toBeTrue();
            const reopened = new CheckpointEvidenceLedger(path);
            try { expect(reopened.getInspection('inspection-1')).toEqual(inspection);
                expect(reopened.getDetection('detection-1')).toEqual(detection); }
            finally { reopened.close(); }
        } finally { ledger.close(); }
    });
    test('projects exposure only from recorded matching policy and freshly verified sources', () => {
        const { ledger } = setup();
        try {
            ledger.recordInspection(inspection, policy, () => true, recorded);
            expect(ledger.projectExposure('inspection-1', 'detection-1', policy,
                () => true, () => true).exposed).toBeFalse();
            ledger.recordDetection(detection, () => true, recorded);
            expect(ledger.projectExposure('inspection-1', 'detection-1', policy).exposed).toBeFalse();
            expect(ledger.projectExposure('inspection-1', 'detection-1', policy,
                () => false, () => true).exposed).toBeFalse();
            expect(ledger.projectExposure('inspection-1', 'detection-1', policy,
                () => true, () => true)).toMatchObject({ exposed: true, assetId: 'asset-1' });
            const otherPolicy = validateCheckpointInspectionPolicy({ schemaVersion: 1,
                policyId: 'city-checkpoints', version: '1.0.1',
                effectiveFrom: '2030-01-01T00:00:00.000Z', expiresAt: null, rules: policy.rules });
            expect(() => ledger.projectExposure('inspection-1', 'detection-1', otherPolicy,
                () => true, () => true)).toThrow('policy digest mismatch');
        } finally { ledger.close(); }
    });
    test('requires trusted server evidence, permitted scope and real inspection before detection', () => {
        const { ledger } = setup();
        try {
            expect(() => ledger.recordInspection(inspection, policy, undefined, recorded)).toThrow('not trusted');
            expect(() => ledger.recordInspection({ ...inspection, checkpointId: 'side-door' }, policy,
                () => true, recorded)).toThrow('not permitted');
            expect(() => ledger.recordInspection({ ...inspection, authorityId: 'foreign-guard' }, policy,
                () => true, recorded)).toThrow('not permitted');
            expect(() => ledger.recordDetection(detection, () => true, recorded)).toThrow('persisted inspection');
            ledger.recordInspection(inspection, policy, () => true, recorded);
            expect(() => ledger.recordDetection(detection, undefined, recorded)).toThrow('not trusted');
            expect(() => ledger.recordDetection(detection, () => true, '2030-01-01T10:00:01.000Z'))
                .toThrow('subject or chronology');
            expect(() => ledger.recordDetection({ ...detection, subjectAgentId: 'other-visitor' },
                () => true, recorded)).toThrow('subject or chronology');
            expect(() => ledger.recordDetection({ ...detection, occurredAt: '2030-01-01T09:59:59.000Z' },
                () => true, recorded)).toThrow('subject or chronology');
            expect(ledger.getDetection('detection-1')).toBeNull();
        } finally { ledger.close(); }
    });
    test('rejects changed replay and duplicate trusted source', () => {
        const { ledger } = setup();
        try {
            ledger.recordInspection(inspection, policy, () => true, recorded);
            expect(() => ledger.recordInspection({ ...inspection, inspectorAgentId: 'guard-2' }, policy,
                () => true, recorded)).toThrow('reused');
            expect(() => ledger.recordInspection({ ...inspection, inspectionId: 'inspection-2' }, policy,
                () => true, recorded)).toThrow('UNIQUE constraint');
            ledger.recordDetection(detection, () => true, recorded);
            expect(() => ledger.recordDetection({ ...detection, assetId: 'asset-2' }, () => true, recorded))
                .toThrow('reused');
            expect(() => ledger.recordDetection({ ...detection, detectionId: 'detection-2' }, () => true,
                recorded)).toThrow('UNIQUE constraint');
        } finally { ledger.close(); }
    });
    test('fails closed on payload or chain tampering and on unsupported schema', () => {
        const first = setup();
        try {
            first.ledger.recordInspection(inspection, policy, () => true, recorded);
            const raw = new Database(first.path, { strict: true });
            try { raw.run("UPDATE checkpoint_evidence SET source_digest=?1 WHERE evidence_id='inspection-1'",
                ['c'.repeat(64)]); }
            finally { raw.close(true); }
            expect(first.ledger.verifyAuditChain()).toBeFalse();
            expect(() => first.ledger.getInspection('inspection-1')).toThrow('audit chain');
            expect(() => first.ledger.recordDetection(detection, () => true, recorded)).toThrow('audit chain');
        } finally { first.ledger.close(); }
        const second = setup();
        second.ledger.close();
        const raw = new Database(second.path, { strict: true });
        try { raw.run('PRAGMA user_version = 2'); } finally { raw.close(true); }
        expect(() => new CheckpointEvidenceLedger(second.path)).toThrow('newer than supported');
    });
});
