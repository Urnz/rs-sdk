import type { AgentSkillReference, GoalHorizon } from '../agent-state/types.js';

export const LLM_RUNTIME_SCHEMA_VERSION = 1 as const;

export interface LlmRuntimeLimits {
    maxDurationMs: number;
    maxModelRequests: number;
    maxToolCalls: number;
    maxCostMicros: number;
}

export interface LlmRuntimeConfig {
    schemaVersion: typeof LLM_RUNTIME_SCHEMA_VERSION;
    enabled: boolean;
    provider: string;
    model: string;
    limits: LlmRuntimeLimits;
}

export interface AllowedAgentSkill extends AgentSkillReference {
    name: string;
    description: string;
}

export type LlmPlanningMode = 'execute-immediate-goal' | 'derive-immediate-goal';

export interface LlmGoalSummary {
    goalId: string;
    parentGoalId: string | null;
    horizon: GoalHorizon;
    title: string;
    description: string;
    priority: number;
}

export interface ProposedAgentGoal extends Omit<LlmGoalSummary, 'horizon'> {
    horizon: Exclude<GoalHorizon, 'life'>;
}

export interface LlmPlanningInput {
    agentId: string;
    mode: LlmPlanningMode;
    goal: { goalId: string; title: string; description: string };
    goalHierarchy: readonly LlmGoalSummary[];
    trustedContext: string;
    /** Chat, mod text and other external strings stay isolated as untrusted data. */
    untrustedText?: readonly string[];
    allowedSkills: readonly AllowedAgentSkill[];
    runId?: string;
}

export interface LlmProviderRequest {
    runId: string;
    agentId: string;
    model: string;
    mode: LlmPlanningMode;
    goal: LlmPlanningInput['goal'];
    goalHierarchy: readonly LlmGoalSummary[];
    trustedContext: string;
    untrustedText: readonly string[];
    tools: readonly [{
        name: 'execute_skill';
        description: string;
        allowedSkills: readonly AllowedAgentSkill[];
    }];
    instruction: string;
}

export interface LlmUsage {
    inputTokens?: number;
    outputTokens?: number;
    costMicros: number;
}

export interface LlmProviderResponse {
    output: unknown;
    usage: LlmUsage;
    providerRequestId?: string;
}

export interface LlmProvider {
    readonly id: string;
    complete(request: LlmProviderRequest, signal: AbortSignal): Promise<LlmProviderResponse>;
}

export type LlmDecision = {
    kind: 'execute-skill';
    goalId: string;
    skill: AgentSkillReference;
    reason: string;
} | {
    kind: 'propose-goal-plan';
    goalId: string;
    goals: ProposedAgentGoal[];
    skill: AgentSkillReference | null;
    reason: string;
} | {
    kind: 'abstain';
    goalId: string;
    reason: string;
};

export type LlmPlanStatus = 'proposed' | 'abstained' | 'rejected' | 'failed' | 'limit-reached' | 'stopped';

export interface LlmPlanResult {
    runId: string;
    agentId: string;
    status: LlmPlanStatus;
    decision: LlmDecision | null;
    approvalId: string | null;
    reason: string;
    usage: LlmUsage;
    durationMs: number;
}

export type LlmAuditEventType = 'run.started' | 'model.requested' | 'model.responded' | 'decision.proposed'
    | 'decision.abstained' | 'decision.rejected' | 'decision.approved' | 'tool.started' | 'tool.finished'
    | 'run.failed' | 'run.limit-reached' | 'run.stopped';

export interface LlmAuditEvent {
    runId: string;
    agentId: string;
    timestamp: string;
    type: LlmAuditEventType;
    provider: string;
    model: string;
    data?: Record<string, unknown>;
}

export interface LlmAuditSink {
    append(event: LlmAuditEvent): void | Promise<void>;
}

export interface ApprovedExecutionResult<T = unknown> {
    runId: string;
    status: 'completed' | 'failed' | 'stopped';
    result: T | null;
    reason: string;
}
