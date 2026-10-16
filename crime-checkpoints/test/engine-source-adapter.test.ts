import { describe, expect, test } from 'bun:test';

import { checkpointEngineVerifiers, createCurrentCheckpointEngineSource, type EngineCheckpointDetectionEvent,
    type EngineCheckpointInspectionEvent, type TrustedCheckpointEngineSource } from '../engine-source-adapter.js';

const inspection: EngineCheckpointInspectionEvent = {
    sourceKind: 'completed-server-search', engineTick: 100, eventDigest: 'a'.repeat(64),
    sourceEvidenceDigest: 'a'.repeat(64), inspectionId: 'inspection-1', jurisdictionId: 'city',
    locationId: 'castle', checkpointId: 'gate', authorityId: 'guard', inspectorAgentId: 'guard-1',
    subjectAgentId: 'visitor-1', occurredAt: '2026-09-24T10:00:00.000Z'
};
const detection: EngineCheckpointDetectionEvent = {
    sourceKind: 'explicit-server-recognition', engineTick: 101, eventDigest: 'b'.repeat(64),
    sourceEvidenceDigest: 'b'.repeat(64), detectionId: 'detection-1', inspectionId: 'inspection-1',
    subjectAgentId: 'visitor-1', assetId: 'asset-1', result: 'recognized-stolen',
    occurredAt: '2026-09-24T10:00:01.000Z'
};

function verifiers(foundInspection: EngineCheckpointInspectionEvent | null = inspection,
    foundDetection: EngineCheckpointDetectionEvent | null = detection) {
    const source: TrustedCheckpointEngineSource = {
        getInspection: () => foundInspection,
        getDetection: () => foundDetection
    };
    return checkpointEngineVerifiers(source);
}

describe('checkpoint engine source adapter', () => {
    test('accepts only exact independently retrieved search and recognition facts', () => {
        const { verifyInspection, verifyDetection } = verifiers();
        expect(verifyInspection(inspection)).toBe(true);
        expect(verifyDetection(detection, inspection)).toBe(true);
    });

    test('missing or failed engine source fails closed', () => {
        const current = checkpointEngineVerifiers(createCurrentCheckpointEngineSource());
        expect(current.verifyInspection(inspection)).toBe(false);
        expect(current.verifyDetection(detection, inspection)).toBe(false);
        expect(verifiers(null, null).verifyInspection(inspection)).toBe(false);
        expect(verifiers(null, null).verifyDetection(detection, inspection)).toBe(false);
        const broken = checkpointEngineVerifiers({ getInspection: () => { throw new Error('audit chain'); },
            getDetection: () => { throw new Error('audit chain'); } });
        expect(broken.verifyInspection(inspection)).toBe(false);
        expect(broken.verifyDetection(detection, inspection)).toBe(false);
    });

    test('search identity, policy scope, actor and source digest cannot be rewritten', () => {
        const { verifyInspection } = verifiers();
        for (const changed of [{ checkpointId: 'other' }, { locationId: 'office' },
            { authorityId: 'other' }, { inspectorAgentId: 'guard-2' }, { subjectAgentId: 'visitor-2' },
            { occurredAt: '2026-09-24T10:00:01.000Z' }, { sourceEvidenceDigest: 'c'.repeat(64) }]) {
            expect(verifyInspection({ ...inspection, ...changed })).toBe(false);
        }
        expect(verifiers({ ...inspection, sourceKind: 'completed-server-search', engineTick: -1 })
            .verifyInspection(inspection)).toBe(false);
    });

    test('recognition cannot be grafted onto another search, subject or asset', () => {
        const { verifyDetection } = verifiers();
        for (const changed of [{ inspectionId: 'inspection-2' }, { subjectAgentId: 'visitor-2' },
            { assetId: 'asset-2' }, { result: 'not-recognized' as const },
            { sourceEvidenceDigest: 'c'.repeat(64) }]) {
            expect(verifyDetection({ ...detection, ...changed }, inspection)).toBe(false);
        }
        expect(verifiers(inspection, { ...detection, engineTick: 99 }).verifyDetection(detection, inspection)).toBe(false);
        expect(verifyDetection(detection, { ...inspection, subjectAgentId: 'other' })).toBe(false);
    });
});
