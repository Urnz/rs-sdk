import type { CheckpointEvidenceLedger } from './evidence-ledger.js';
import { checkpointEngineVerifiers, type TrustedCheckpointEngineSource } from './engine-source-adapter.js';
import type { CheckpointDetectionEvidence, CheckpointInspectionEvidence,
    CheckpointInspectionPolicy } from './types.js';

/** Copies only exact, re-verifiable engine facts into the independent checkpoint ledger. */
export function recordEngineCheckpointInspection(inspectionId: string, source: TrustedCheckpointEngineSource,
    ledger: CheckpointEvidenceLedger, policy: CheckpointInspectionPolicy,
    recordedAt = new Date().toISOString()): CheckpointInspectionEvidence {
    const event = source.getInspection(inspectionId);
    if (!event) throw new Error('Checkpoint engine inspection was not found');
    const evidence: CheckpointInspectionEvidence = { inspectionId: event.inspectionId,
        jurisdictionId: event.jurisdictionId, locationId: event.locationId, checkpointId: event.checkpointId,
        authorityId: event.authorityId, inspectorAgentId: event.inspectorAgentId,
        subjectAgentId: event.subjectAgentId, occurredAt: event.occurredAt,
        sourceEvidenceDigest: event.eventDigest };
    return ledger.recordInspection(evidence, policy, checkpointEngineVerifiers(source).verifyInspection, recordedAt);
}

export function recordEngineCheckpointDetection(detectionId: string, source: TrustedCheckpointEngineSource,
    ledger: CheckpointEvidenceLedger, recordedAt = new Date().toISOString()): CheckpointDetectionEvidence {
    const event = source.getDetection(detectionId);
    if (!event) throw new Error('Checkpoint engine detection was not found');
    const evidence: CheckpointDetectionEvidence = { detectionId: event.detectionId,
        inspectionId: event.inspectionId, subjectAgentId: event.subjectAgentId, assetId: event.assetId,
        result: event.result, occurredAt: event.occurredAt, sourceEvidenceDigest: event.eventDigest };
    return ledger.recordDetection(evidence, checkpointEngineVerifiers(source).verifyDetection, recordedAt);
}
