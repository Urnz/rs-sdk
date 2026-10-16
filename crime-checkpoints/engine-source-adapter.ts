import type { CheckpointDetectionEvidence, CheckpointDetectionVerifier,
    CheckpointInspectionEvidence, CheckpointInspectionVerifier } from './types.js';
import { getCheckpointEvidenceStore } from '../server/engine/src/mods/CheckpointEvidenceStore.js';

/** A completed server-script search, not a proximity or inventory snapshot. */
export interface EngineCheckpointInspectionEvent extends CheckpointInspectionEvidence {
    sourceKind: 'completed-server-search';
    engineTick: number;
    /** Digest of the independent engine event, verified by the source store. */
    eventDigest: string;
}

/** A distinct server-side recognition observation made during that search. */
export interface EngineCheckpointDetectionEvent extends CheckpointDetectionEvidence {
    sourceKind: 'explicit-server-recognition';
    engineTick: number;
    eventDigest: string;
}

/** Implementations must read an append-only, chain-verified engine event store. */
export interface TrustedCheckpointEngineSource {
    getInspection(inspectionId: string): EngineCheckpointInspectionEvent | null;
    getDetection(detectionId: string): EngineCheckpointDetectionEvent | null;
}

/** Production source is the engine-owned append-only search/recognition journal. */
export function createCurrentCheckpointEngineSource(): TrustedCheckpointEngineSource {
    return Object.freeze({
        getInspection: (inspectionId: string) => getCheckpointEvidenceStore().getInspection(inspectionId),
        getDetection: (detectionId: string) => getCheckpointEvidenceStore().getDetection(detectionId)
    });
}

const DIGEST = /^[0-9a-f]{64}$/;

function matchingInspection(source: EngineCheckpointInspectionEvent, evidence: CheckpointInspectionEvidence): boolean {
    return source.sourceKind === 'completed-server-search' && Number.isSafeInteger(source.engineTick)
        && source.engineTick >= 0 && DIGEST.test(source.eventDigest)
        && source.eventDigest === evidence.sourceEvidenceDigest
        && source.sourceEvidenceDigest === evidence.sourceEvidenceDigest
        && source.inspectionId === evidence.inspectionId
        && source.jurisdictionId === evidence.jurisdictionId && source.locationId === evidence.locationId
        && source.checkpointId === evidence.checkpointId && source.authorityId === evidence.authorityId
        && source.inspectorAgentId === evidence.inspectorAgentId && source.subjectAgentId === evidence.subjectAgentId
        && source.occurredAt === evidence.occurredAt;
}

function matchingDetection(source: EngineCheckpointDetectionEvent, evidence: CheckpointDetectionEvidence): boolean {
    return source.sourceKind === 'explicit-server-recognition' && Number.isSafeInteger(source.engineTick)
        && source.engineTick >= 0 && DIGEST.test(source.eventDigest)
        && source.eventDigest === evidence.sourceEvidenceDigest
        && source.sourceEvidenceDigest === evidence.sourceEvidenceDigest
        && source.detectionId === evidence.detectionId && source.inspectionId === evidence.inspectionId
        && source.subjectAgentId === evidence.subjectAgentId && source.assetId === evidence.assetId
        && source.result === evidence.result && source.occurredAt === evidence.occurredAt;
}

/**
 * Bridges a separately trusted engine store to the checkpoint ledger's verifier callbacks.
 * An absent source, mismatched fact, or failed store read never authenticates a claim.
 * This adapter does not create engine events or classify an item as stolen.
 */
export function checkpointEngineVerifiers(source: TrustedCheckpointEngineSource): {
    verifyInspection: CheckpointInspectionVerifier;
    verifyDetection: CheckpointDetectionVerifier;
} {
    return {
        verifyInspection: evidence => {
            try {
                const event = source.getInspection(evidence.inspectionId);
                return event !== null && matchingInspection(event, evidence);
            } catch { return false; }
        },
        verifyDetection: (evidence, inspection) => {
            if (evidence.inspectionId !== inspection.inspectionId
                || evidence.subjectAgentId !== inspection.subjectAgentId) return false;
            try {
                const event = source.getDetection(evidence.detectionId);
                return event !== null && matchingDetection(event, evidence)
                    && event.engineTick >= (source.getInspection(inspection.inspectionId)?.engineTick ?? Infinity);
            } catch { return false; }
        }
    };
}
