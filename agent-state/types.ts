export const AGENT_STATE_SCHEMA_VERSION = 2 as const;

export type GoalHorizon = 'life' | 'long-term' | 'current' | 'immediate';
export type GoalStatus = 'active' | 'completed' | 'blocked' | 'abandoned';

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

export interface AgentSnapshot {
    identity: AgentIdentity;
    goals: AgentGoal[];
    workingMemory: AgentWorkingMemory | null;
}
