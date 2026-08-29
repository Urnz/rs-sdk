export const AGENT_STATE_SCHEMA_VERSION = 8 as const;

export type GoalHorizon = 'life' | 'long-term' | 'current' | 'immediate';
export type GoalStatus = 'active' | 'completed' | 'blocked' | 'abandoned';
export type AgentSkillKnowledgeStatus = 'known' | 'preferred' | 'blocked';
export type AgentEpisodeKind = 'observation' | 'action' | 'outcome' | 'interaction' | 'discovery' | 'economic';
export type AgentEpisodeSource = 'manual' | 'system' | 'skill' | 'planner';
export type AgentEpisodeTrust = 'trusted' | 'untrusted';
export type AgentKnowledgeKind = 'world' | 'economic' | 'route' | 'procedure';
export type AgentKnowledgeSource = 'manual' | 'system' | 'consolidation';
export type AgentKnowledgeStatus = 'active' | 'superseded' | 'disputed';
export type AgentCommitmentDirection = 'owed-by-agent' | 'owed-to-agent';
export type AgentCommitmentStatus = 'open' | 'fulfilled' | 'broken' | 'cancelled';
export type AgentEconomicActorKind = 'player' | 'business' | 'faction';
export type AgentEconomicActorRole = 'self' | 'owner' | 'manager' | 'member' | 'beneficiary';
export type AgentEconomicActorLinkSource = 'identity' | 'admin' | 'system';

export interface AgentSkillReference {
    id: string;
    version: string;
}

export interface AgentIdentity {
    schemaVersion: typeof AGENT_STATE_SCHEMA_VERSION;
    agentId: string;
    playerUsername: string;
    displayName: string;
    background: string;
    personalityTraits: string[];
    values: string[];
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface CreateAgentIdentity {
    agentId: string;
    playerUsername: string;
    displayName: string;
    background: string;
    personalityTraits: string[];
    values?: string[];
}

export interface UpdateAgentIdentity {
    playerUsername?: string;
    displayName?: string;
    background?: string;
    personalityTraits?: string[];
    values?: string[];
}

export interface AgentGoal {
    goalId: string;
    agentId: string;
    parentGoalId: string | null;
    horizon: GoalHorizon;
    title: string;
    description: string;
    status: GoalStatus;
    priority: number;
    skill: AgentSkillReference | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    revision: number;
}

export interface CreateAgentGoal {
    goalId: string;
    parentGoalId?: string | null;
    horizon: GoalHorizon;
    title: string;
    description?: string;
    priority?: number;
    skill?: AgentSkillReference | null;
}

export interface AgentLocation {
    x: number;
    z: number;
    level: number;
    region?: string;
}

export interface AgentWorkingMemory {
    agentId: string;
    summary: string;
    currentActivity: string | null;
    location: AgentLocation | null;
    observations: string[];
    observedAt: string;
    updatedAt: string;
    revision: number;
}

export interface SetAgentWorkingMemory {
    summary: string;
    currentActivity?: string | null;
    location?: AgentLocation | null;
    observations?: string[];
    observedAt: string;
}

export interface AgentSkillKnowledge {
    agentId: string;
    skill: AgentSkillReference;
    status: AgentSkillKnowledgeStatus;
    learnedAt: string;
    updatedAt: string;
    revision: number;
}

export interface AgentEpisode {
    episodeId: string;
    agentId: string;
    kind: AgentEpisodeKind;
    summary: string;
    details: string;
    importance: number;
    goalIds: string[];
    actors: string[];
    tags: string[];
    source: AgentEpisodeSource;
    trust: AgentEpisodeTrust;
    externalKey: string | null;
    occurredAt: string;
    expiresAt: string | null;
    createdAt: string;
}

export interface CreateAgentEpisode {
    episodeId: string;
    kind: AgentEpisodeKind;
    summary: string;
    details?: string;
    importance?: number;
    goalIds?: string[];
    actors?: string[];
    tags?: string[];
    source: AgentEpisodeSource;
    trust?: AgentEpisodeTrust;
    externalKey?: string | null;
    occurredAt: string;
    expiresAt?: string | null;
}

export interface AgentEpisodeListOptions {
    limit?: number;
    offset?: number;
    kind?: AgentEpisodeKind;
}

export type AgentEpisodeProtectionReason = 'semantic-evidence' | 'relationship-evidence'
    | 'commitment-evidence' | 'consolidation-evidence' | 'external-source';

export interface AgentEpisodeRetentionCandidate {
    episodeId: string;
    occurredAt: string;
    expiresAt: string;
    protectionReasons: AgentEpisodeProtectionReason[];
    eligible: boolean;
}

export interface AgentEpisodeRetentionPreview {
    agentId: string;
    asOf: string;
    expiredCount: number;
    eligibleCount: number;
    protectedCount: number;
    truncated: boolean;
    candidates: AgentEpisodeRetentionCandidate[];
}

export interface AgentEpisodePruneResult extends AgentEpisodeRetentionPreview {
    deletedEpisodeIds: string[];
}

export interface AgentKnowledge {
    knowledgeId: string;
    agentId: string;
    kind: AgentKnowledgeKind;
    subject: string;
    predicate: string;
    object: string;
    summary: string;
    confidence: number;
    goalIds: string[];
    tags: string[];
    evidenceEpisodeIds: string[];
    source: AgentKnowledgeSource;
    status: AgentKnowledgeStatus;
    supersedesId: string | null;
    externalKey: string | null;
    validFrom: string;
    validUntil: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface CreateAgentKnowledge {
    knowledgeId: string;
    kind: AgentKnowledgeKind;
    subject: string;
    predicate: string;
    object: string;
    summary: string;
    confidence?: number;
    goalIds?: string[];
    tags?: string[];
    evidenceEpisodeIds?: string[];
    source: AgentKnowledgeSource;
    supersedesId?: string | null;
    externalKey?: string | null;
    validFrom: string;
    validUntil?: string | null;
}

export interface AgentKnowledgeListOptions {
    limit?: number;
    offset?: number;
    status?: AgentKnowledgeStatus;
    kind?: AgentKnowledgeKind;
}

export interface AgentRelationship {
    agentId: string;
    actorKey: string;
    displayName: string;
    trust: number;
    affinity: number;
    familiarity: number;
    agentOwesGp: number;
    actorOwesGp: number;
    notes: string;
    tags: string[];
    evidenceEpisodeIds: string[];
    lastInteractionAt: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface SetAgentRelationship {
    actorKey: string;
    displayName: string;
    trust?: number;
    affinity?: number;
    familiarity?: number;
    agentOwesGp?: number;
    actorOwesGp?: number;
    notes?: string;
    tags?: string[];
    evidenceEpisodeIds?: string[];
    lastInteractionAt?: string | null;
}

export interface AgentCommitment {
    commitmentId: string;
    agentId: string;
    actorKey: string;
    direction: AgentCommitmentDirection;
    description: string;
    status: AgentCommitmentStatus;
    valueGp: number | null;
    dueAt: string | null;
    evidenceEpisodeIds: string[];
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
    revision: number;
}

export interface CreateAgentCommitment {
    commitmentId: string;
    actorKey: string;
    direction: AgentCommitmentDirection;
    description: string;
    valueGp?: number | null;
    dueAt?: string | null;
    evidenceEpisodeIds?: string[];
}

export interface AgentEconomicActorLink {
    agentId: string;
    actorKind: AgentEconomicActorKind;
    actorId: string;
    role: AgentEconomicActorRole;
    source: AgentEconomicActorLinkSource;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export interface SetAgentEconomicActorLink {
    actorKind: AgentEconomicActorKind;
    actorId: string;
    role: AgentEconomicActorRole;
    source?: Exclude<AgentEconomicActorLinkSource, 'identity'>;
}

export interface AgentMoneyAsset {
    balanceGp: number;
    observedAt: string;
    source: 'live' | 'save';
    freshness: 'fresh' | 'stale';
}

export interface AgentPropertyAsset {
    propertyId: string;
    displayName: string;
    type: string;
    region: string;
    acquiredAt: string | null;
    stateVersion: number;
    owner: { kind: AgentEconomicActorKind; id: string };
}

export interface AgentFinancialPosition {
    receivablesGp: number;
    liabilitiesGp: number;
    openCommitmentReceivablesGp: number;
    openCommitmentLiabilitiesGp: number;
}

export interface AgentAssetPortfolio {
    observedAt: string;
    actorLinks: AgentEconomicActorLink[];
    money: AgentMoneyAsset | null;
    properties: AgentPropertyAsset[];
    financialPosition: AgentFinancialPosition;
    unavailableSources: string[];
}

export interface AgentConsolidationEvidence {
    agentId: string;
    ruleKey: string;
    evidenceKey: string;
    episodeId: string;
    occurredAt: string;
    createdAt: string;
}

export interface CreateAgentConsolidationEvidence {
    ruleKey: string;
    evidenceKey: string;
    episodeId: string;
    occurredAt: string;
}

export interface AgentSnapshot {
    identity: AgentIdentity;
    goals: AgentGoal[];
    workingMemory: AgentWorkingMemory | null;
    knownSkills: AgentSkillKnowledge[];
}
