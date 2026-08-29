export const AGENT_STATE_SCHEMA_VERSION = 5 as const;

export type GoalHorizon = 'life' | 'long-term' | 'current' | 'immediate';
export type GoalStatus = 'active' | 'completed' | 'blocked' | 'abandoned';
export type AgentSkillKnowledgeStatus = 'known' | 'preferred' | 'blocked';
export type AgentEpisodeKind = 'observation' | 'action' | 'outcome' | 'interaction' | 'discovery' | 'economic';
export type AgentEpisodeSource = 'manual' | 'system' | 'skill' | 'planner';
export type AgentEpisodeTrust = 'trusted' | 'untrusted';
export type AgentKnowledgeKind = 'world' | 'economic' | 'route' | 'procedure';
export type AgentKnowledgeSource = 'manual' | 'system' | 'consolidation';
export type AgentKnowledgeStatus = 'active' | 'superseded' | 'disputed';

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

export interface AgentSnapshot {
    identity: AgentIdentity;
    goals: AgentGoal[];
    workingMemory: AgentWorkingMemory | null;
    knownSkills: AgentSkillKnowledge[];
}
