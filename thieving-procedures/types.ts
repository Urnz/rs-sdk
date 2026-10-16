export type ThievingProcedureKind = 'pickpocket' | 'lockpick-door' | 'container-theft' | 'property-burglary';
export type ThievingProcedureResult = 'succeeded' | 'failed' | 'blocked';
export type ThievingProcedureEffect = 'none' | 'item-transfer' | 'lock-opened' | 'entry-completed';

export interface ThievingTarget {
    kind: 'npc' | 'loc';
    typeId: number;
    instanceIndex: number | null;
    name: string;
    x: number;
    z: number;
    level: number;
}

export interface ThievingItemDelta {
    itemId: number;
    itemName: string;
    quantity: number;
}

/** Exact server evidence. Client/SDK observations must never implement this verifier boundary. */
export interface ThievingOutcomeEvidence {
    evidenceId: string;
    procedureId: string;
    procedureVersion: string;
    procedureKind: ThievingProcedureKind;
    actorAgentId: string;
    playerUsername: string;
    target: ThievingTarget;
    result: ThievingProcedureResult;
    effect: ThievingProcedureEffect;
    transferredItems: ThievingItemDelta[];
    thievingXpDelta: number;
    startedAtEngineTick: number;
    endedAtEngineTick: number;
    sourceEventId: string;
    sourceEvidenceDigest: string;
    occurredAt: string;
}

export interface ThievingOutcomeReceipt extends ThievingOutcomeEvidence {
    receiptId: string;
    receiptDigest: string;
    recordedAt: string;
}

export type ThievingDiscoverySource = 'direct-witness' | 'guard-line-of-sight' | 'alarm'
    | 'physical-trace' | 'owner-loss-report';
export type ActorIdentification = 'none' | 'direct' | 'inferred';

/** Observer-facing discovery. It intentionally does not inherit the world-truth actor automatically. */
export interface ThievingDiscoveryEvidence {
    evidenceId: string;
    outcomeReceiptId: string;
    source: ThievingDiscoverySource;
    observerAgentId: string | null;
    actorIdentification: ActorIdentification;
    suspectAgentId: string | null;
    facts: string[];
    sourceEvidenceDigest: string;
    occurredAt: string;
}

export interface ThievingDiscoveryObservation extends ThievingDiscoveryEvidence {
    observationId: string;
    observationDigest: string;
    recordedAt: string;
}

export type ThievingOutcomeVerifier = (evidence: ThievingOutcomeEvidence) => boolean;
export type ThievingDiscoveryVerifier = (evidence: ThievingDiscoveryEvidence,
    outcome: ThievingOutcomeReceipt) => boolean;
