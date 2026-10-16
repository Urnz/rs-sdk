export type CrimeCaseEventKind = 'discovery-recorded' | 'suspect-identified';

/** Case knowledge is derived from a persisted observation, never from the hidden offender field. */
export interface CrimeCaseEvent {
    eventId: string;
    caseId: string;
    kind: CrimeCaseEventKind;
    outcomeReceiptId: string;
    observationId: string;
    observationDigest: string;
    observerAgentId: string | null;
    suspectAgentId: string | null;
    identification: 'none' | 'direct' | 'inferred';
    occurredAt: string;
    eventDigest: string;
    recordedAt: string;
}

export interface CrimeCaseState {
    caseId: string;
    outcomeReceiptId: string;
    discoveryObservationIds: string[];
    identifications: Array<{ observationId: string; suspectAgentId: string;
        identification: 'direct' | 'inferred'; observerAgentId: string | null }>;
    /** A case event is not a legal finding. */
    legalFinding: null;
}

/** A viewer's own verified observation, not a conviction or personality trait. */
export interface WitnessSuspectDescription {
    viewerAgentId: string;
    targetAgentId: string;
    description: 'Personally identified as a suspect during a theft';
    sourceCaseEventIds: string[];
}
