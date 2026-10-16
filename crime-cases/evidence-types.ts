export type CrimeEvidenceKind = 'direct-identification' | 'physical-trace' | 'possession';

/** Possession is an observation of a holder, not an allegation of theft. */
export interface PossessionObservation {
    observationId: string;
    caseId: string;
    assetId: string;
    holderAgentId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}

export interface CrimeEvidenceEntry {
    evidenceId: string;
    caseId: string;
    kind: CrimeEvidenceKind;
    sourceId: string;
    sourceDigest: string;
    suspectAgentId: string | null;
    assetId: string | null;
    occurredAt: string;
    recordedAt: string;
    evidenceDigest: string;
}

export interface LegalFindingRequest {
    findingId: string;
    caseId: string;
    jurisdictionId: string;
    suspectAgentId: string;
    conclusion: 'responsible' | 'not-proven';
    evidenceIds: string[];
    policyId: string;
    policyDigest: string;
    authorityEvidenceDigest: string;
    occurredAt: string;
}

export interface LegalFinding extends LegalFindingRequest {
    findingDigest: string;
    recordedAt: string;
}

/** Internal legal history, not a reputation score or a current sanction. */
export interface JurisdictionCriminalRecord {
    suspectAgentId: string;
    jurisdictionId: string;
    responsibleFindings: LegalFinding[];
}

/** Must attest the observed holder, asset and case linkage from trusted inspection evidence. */
export type PossessionVerifier = (observation: Readonly<PossessionObservation>) => boolean;
/** Must verify jurisdiction, effective policy, authority and the actual adjudication. */
export type LegalFindingVerifier = (request: Readonly<LegalFindingRequest>,
    evidence: ReadonlyArray<Readonly<CrimeEvidenceEntry>>) => boolean;
