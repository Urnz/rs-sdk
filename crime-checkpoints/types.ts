/** A checkpoint grants permission to inspect, never automatic inventory knowledge. */
export interface CheckpointInspectionRule {
    jurisdictionId: string;
    locationId: string;
    checkpointId: string;
    permission: 'allow' | 'deny';
    authorityId: string;
}

export interface CheckpointInspectionPolicy {
    schemaVersion: 1;
    policyId: string;
    version: string;
    effectiveFrom: string;
    expiresAt: string | null;
    rules: CheckpointInspectionRule[];
    digest: string;
}

/** Server-side search/inspection fact; entering a location is not one. */
export interface CheckpointInspectionEvidence {
    inspectionId: string;
    jurisdictionId: string;
    locationId: string;
    checkpointId: string;
    authorityId: string;
    inspectorAgentId: string;
    subjectAgentId: string;
    occurredAt: string;
    sourceEvidenceDigest: string;
}

/** Explicit observation of a recognized asset, not a provenance or heat lookup. */
export interface CheckpointDetectionEvidence {
    detectionId: string;
    inspectionId: string;
    subjectAgentId: string;
    assetId: string;
    result: 'recognized-stolen' | 'not-recognized';
    occurredAt: string;
    sourceEvidenceDigest: string;
}

export type CheckpointInspectionVerifier = (evidence: Readonly<CheckpointInspectionEvidence>) => boolean;
export type CheckpointDetectionVerifier = (evidence: Readonly<CheckpointDetectionEvidence>,
    inspection: Readonly<CheckpointInspectionEvidence>) => boolean;

/** No legal conclusion, guilt, inventory scan or sanction is represented here. */
export type CheckpointExposure = {
    exposed: false;
    assetId: null;
    inspectionId: null;
    detectionId: null;
    policyDigest: string;
} | {
    exposed: true;
    assetId: string;
    inspectionId: string;
    detectionId: string;
    policyDigest: string;
};
