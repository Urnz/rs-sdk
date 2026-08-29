import { buildDecisionContext, type DecisionContextOptions } from '../agent-state/context.js';
import type { AgentSnapshot } from '../agent-state/types.js';
import type { AllowedAgentSkill, LlmPlanningInput } from './types.js';

export interface BuildLlmPlanningInputOptions {
    availableSkills: readonly AllowedAgentSkill[];
    context?: DecisionContextOptions;
    untrustedText?: readonly string[];
    runId?: string;
}

export function buildLlmPlanningInput(snapshot: AgentSnapshot,
    options: BuildLlmPlanningInputOptions): LlmPlanningInput {
    const goal = snapshot.goals.filter(item => item.status === 'active' && item.horizon === 'immediate')
        .sort((left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0];
    if (!goal) throw new Error(`Agent ${snapshot.identity.agentId} has no active immediate goal`);

    const now = Date.parse(options.context?.now ?? new Date().toISOString());
    const maxAge = options.context?.workingMemoryMaxAgeMs ?? 5 * 60_000;
    const observedAt = snapshot.workingMemory ? Date.parse(snapshot.workingMemory.observedAt) : Number.NaN;
    const memoryAge = now - observedAt;
    if (!snapshot.workingMemory || Number.isNaN(memoryAge) || memoryAge < 0 || memoryAge > maxAge) {
        throw new Error(`Agent ${snapshot.identity.agentId} needs a fresh working-memory observation before LLM planning`);
    }

    const known = new Set(snapshot.knownSkills.filter(item => item.status !== 'blocked')
        .map(item => `${item.skill.id}@${item.skill.version}`));
    const allowedSkills = options.availableSkills.filter(skill => known.has(`${skill.id}@${skill.version}`));
    const episodic = options.context?.episodicMemories ?? [];
    const trustedEpisodes = episodic.filter(item => item.trust === 'trusted');
    const untrustedEpisodes = episodic.filter(item => item.trust === 'untrusted')
        .map(item => `Episode ${item.occurredAt}: ${item.summary}. ${item.details}`.slice(0, 1000));
    const context = { ...options.context, episodicMemories: trustedEpisodes };

    return {
        agentId: snapshot.identity.agentId,
        goal: { goalId: goal.goalId, title: goal.title, description: goal.description },
        trustedContext: buildDecisionContext(snapshot, context),
        untrustedText: [...(options.untrustedText ?? []), ...untrustedEpisodes],
        allowedSkills,
        runId: options.runId
    };
}
