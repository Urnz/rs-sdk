export type ReintegrationEvent = {
    eventId: string;
    subjectAgentId: string;
    worldProfileId: string;
    occurredAt: string;
    sourceEvidenceDigest: string;
} & ({ kind: 'restitution-completed'; claimId: string; victimActorId: string }
    | { kind: 'compensation-paid'; paymentId: string; recipientActorId: string }
    | { kind: 'community-service-completed'; serviceOrderId: string; jurisdictionId: string }
    | { kind: 'sentence-completed'; sentenceId: string; jurisdictionId: string }
    | { kind: 'forgiveness-granted'; caseId: string; forgiverActorId: string }
    | { kind: 'religious-penance-completed'; riteId: string; institutionId: string });

export type ReintegrationEventKind = ReintegrationEvent['kind'];
export type ReintegrationProjection = 'reputation' | 'moral-standing';

export interface ReintegrationRule {
    eventKind: ReintegrationEventKind;
    projection: ReintegrationProjection;
    /** A bounded, positive change; not a universal score or legal sanction. */
    delta: number;
}

export interface ReintegrationPolicy {
    schemaVersion: 1;
    policyId: string;
    version: string;
    worldProfileId: string;
    effectiveFrom: string;
    expiresAt: string | null;
    rules: ReintegrationRule[];
    digest: string;
}

export type ReintegrationAudience = { kind: 'observer'; observerAgentId: string; worldProfileId: string }
    | { kind: 'community'; communityId: string; worldProfileId: string }
    | { kind: 'moral-standing'; worldProfileId: string };

/** Separate, source-attested proof that this particular observer/community learned the event. */
export interface ReintegrationKnowledge {
    knowledgeId: string;
    eventId: string;
    audience: Exclude<ReintegrationAudience, { kind: 'moral-standing' }>;
    learnedAt: string;
    sourceEvidenceDigest: string;
}

export type ReintegrationEventVerifier = (event: Readonly<ReintegrationEvent>) => boolean;
export type ReintegrationKnowledgeVerifier = (knowledge: Readonly<ReintegrationKnowledge>,
    event: Readonly<ReintegrationEvent>) => boolean;

export type ReintegrationAdjustment = {
    applied: false;
    delta: 0;
    policyDigest: string;
} | {
    applied: true;
    delta: number;
    subjectAgentId: string;
    audience: ReintegrationAudience;
    eventId: string;
    knowledgeId: string | null;
    policyDigest: string;
};

export interface AppliedReintegrationAdjustment {
    adjustmentId: string;
    projection: ReintegrationProjection;
    subjectAgentId: string;
    audience: ReintegrationAudience;
    eventId: string;
    eventKind: ReintegrationEventKind;
    sourceEvidenceDigest: string;
    knowledgeId: string | null;
    delta: number;
    valueBefore: number;
    valueAfter: number;
    policyDigest: string;
    appliedAt: string;
    adjustmentDigest: string;
}

export interface ReintegrationStanding {
    projection: ReintegrationProjection;
    subjectAgentId: string;
    audience: ReintegrationAudience;
    value: number;
    adjustmentIds: string[];
    sourceEventIds: string[];
}

export interface ReintegrationDescriptor {
    viewerAgentId: string;
    targetAgentId: string;
    description: 'Known completed reform effort';
    sourceEventIds: string[];
    adjustmentIds: string[];
}
