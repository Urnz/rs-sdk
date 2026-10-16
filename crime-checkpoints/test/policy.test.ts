import { describe, expect, test } from 'bun:test';

import { projectCheckpointExposure, validateCheckpointInspectionPolicy } from '../index.js';
import type { CheckpointDetectionEvidence, CheckpointInspectionEvidence, CheckpointInspectionPolicy } from '../index.js';

const evidenceDigest = 'a'.repeat(64);
function policy(): CheckpointInspectionPolicy {
    return validateCheckpointInspectionPolicy({ schemaVersion: 1, policyId: 'checkpoint-policy', version: '1.0.0',
        effectiveFrom: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z',
        rules: [{ jurisdictionId: 'city', locationId: 'castle', checkpointId: 'north-gate',
            permission: 'allow', authorityId: 'city-guard' },
        { jurisdictionId: 'city', locationId: 'office', checkpointId: 'desk',
            permission: 'deny', authorityId: 'city-guard' }] });
}
function inspection(): CheckpointInspectionEvidence {
    return { inspectionId: 'inspection-1', jurisdictionId: 'city', locationId: 'castle',
        checkpointId: 'north-gate', authorityId: 'city-guard', inspectorAgentId: 'guard-1',
        subjectAgentId: 'visitor-1', occurredAt: '2026-06-01T10:00:00.000Z', sourceEvidenceDigest: evidenceDigest };
}
function detection(): CheckpointDetectionEvidence {
    return { detectionId: 'detection-1', inspectionId: 'inspection-1', subjectAgentId: 'visitor-1',
        assetId: 'asset-1', result: 'recognized-stolen', occurredAt: '2026-06-01T10:00:01.000Z',
        sourceEvidenceDigest: evidenceDigest };
}
const trustedInspection = () => true;
const trustedDetection = () => true;
function exposure(inspectionEvidence: CheckpointInspectionEvidence | null,
    detectionEvidence: CheckpointDetectionEvidence | null, currentPolicy = policy(),
    verifyInspection: (() => boolean) | undefined = trustedInspection,
    verifyDetection: (() => boolean) | undefined = trustedDetection) {
    return projectCheckpointExposure(currentPolicy, inspectionEvidence, detectionEvidence,
        verifyInspection, verifyDetection);
}

describe('checkpoint inspection policy', () => {
    test('only a permitted, witnessed inspection with separate positive detection exposes a recognized asset', () => {
        expect(exposure(inspection(), detection())).toEqual({ exposed: true, assetId: 'asset-1',
            inspectionId: 'inspection-1', detectionId: 'detection-1', policyDigest: policy().digest });
    });

    test('mere presence or inspection without detection exposes nothing', () => {
        expect(exposure(null, null).exposed).toBe(false);
        expect(exposure(inspection(), null)).toMatchObject({ exposed: false, assetId: null });
        expect(exposure(null, detection())).toMatchObject({ exposed: false, assetId: null });
    });

    test('a different gate, location, jurisdiction or denied checkpoint cannot inspect', () => {
        for (const changes of [
            { checkpointId: 'side-door' }, { locationId: 'unconfigured-castle' },
            { jurisdictionId: 'foreign' }, { locationId: 'office', checkpointId: 'desk' }
        ]) expect(exposure({ ...inspection(), ...changes }, detection())).toMatchObject({ exposed: false, assetId: null });
    });

    test('authority mismatch and expired or premature policy cannot inspect', () => {
        expect(exposure({ ...inspection(), authorityId: 'other-guard' }, detection()).exposed).toBe(false);
        expect(exposure({ ...inspection(), occurredAt: '2025-12-31T23:59:59.000Z' }, detection()).exposed).toBe(false);
        expect(exposure({ ...inspection(), occurredAt: '2027-01-01T00:00:00.000Z' }, detection()).exposed).toBe(false);
    });

    test('a negative detection or one for another search, subject or earlier time exposes nothing', () => {
        for (const changes of [{ result: 'not-recognized' as const }, { inspectionId: 'inspection-2' },
            { subjectAgentId: 'visitor-2' }, { occurredAt: '2026-06-01T09:59:59.000Z' }])
            expect(exposure(inspection(), { ...detection(), ...changes })).toMatchObject({ exposed: false, assetId: null });
    });

    test('missing or failing independent source verifiers fail closed', () => {
        expect(projectCheckpointExposure(policy(), inspection(), detection(), undefined, trustedDetection).exposed).toBe(false);
        expect(projectCheckpointExposure(policy(), inspection(), detection(), trustedInspection, undefined).exposed).toBe(false);
        expect(exposure(inspection(), detection(), policy(), () => false, trustedDetection).exposed).toBe(false);
        expect(exposure(inspection(), detection(), policy(), trustedInspection, () => false).exposed).toBe(false);
    });

    test('tampered policy, duplicate rules and unsupported schema fail closed', () => {
        const altered = policy();
        altered.rules[0]!.permission = 'deny';
        expect(() => exposure(inspection(), detection(), altered)).toThrow('digest mismatch');
        const definition = { schemaVersion: 1, policyId: 'policy', version: '1.0.0',
            effectiveFrom: '2026-01-01T00:00:00.000Z', expiresAt: null,
            rules: [{ jurisdictionId: 'city', locationId: 'castle', checkpointId: 'gate',
                permission: 'allow', authorityId: 'guard' }] };
        expect(() => validateCheckpointInspectionPolicy({ ...definition, rules: [...definition.rules,
            { ...definition.rules[0] }] })).toThrow('unique');
        expect(() => validateCheckpointInspectionPolicy({ ...definition, schemaVersion: 2 })).toThrow();
    });

    test('malformed inspection or detection evidence fails closed', () => {
        expect(() => exposure({ ...inspection(), sourceEvidenceDigest: 'not-a-digest' }, detection())).toThrow();
        expect(() => exposure(inspection(), { ...detection(), assetId: '' })).toThrow();
        expect(() => exposure(inspection(), { ...detection(), occurredAt: 'yesterday' })).toThrow();
    });
});
