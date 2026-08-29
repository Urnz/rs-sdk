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
