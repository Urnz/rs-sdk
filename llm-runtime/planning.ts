import { buildDecisionContext, type DecisionContextOptions } from '../agent-state/context.js';
import type { AgentSnapshot } from '../agent-state/types.js';
import { urgentSelfCareGoal, selectImmediateGoal } from '../agent-state/planner.js';
import type { AllowedAgentSkill, LlmPlanningInput } from './types.js';
import type { PlayerStrategyAlternative } from './types.js';

export interface BuildLlmPlanningInputOptions {
    strategy?: { parentGoalId: string; alternatives: readonly PlayerStrategyAlternative[]; trustedContext?: string };
    availableSkills: readonly AllowedAgentSkill[];
    context?: DecisionContextOptions;
    untrustedText?: readonly string[];
    runId?: string;
    trustedContext?: string;
}

export function buildLlmPlanningInput(snapshot: AgentSnapshot,
    options: BuildLlmPlanningInputOptions): LlmPlanningInput {
    const active = snapshot.goals.filter(item => item.status === 'active');
    if (options.strategy && !active.some(g => g.goalId === options.strategy!.parentGoalId && g.horizon === 'current' && g.objective))
        throw new Error('Strategy planning requires the exact active current state objective');
    const depth = { life: 0, 'long-term': 1, current: 2, immediate: 3 } as const;
    const urgent = urgentSelfCareGoal(snapshot, options.context?.now);
    const immediate = urgent ? active.find(item => item.horizon === 'immediate' && item.parentGoalId === urgent.goalId
        && !item.stateEvaluation?.needsReplan)
        : selectImmediateGoal(snapshot, undefined, options.context?.now);
    const replan = active.filter(g => g.horizon === 'immediate' && g.stateEvaluation?.needsReplan)
        .sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId))[0];
    const parent = replan ? active.find(g => g.goalId === replan.parentGoalId) : null;
    const goal = (options.strategy ? active.find(g => g.goalId === options.strategy!.parentGoalId && g.horizon === 'current' && g.objective) : null)
        ?? immediate ?? urgent ?? parent ?? active.filter(g => g.horizon !== 'immediate').sort((left, right) => depth[right.horizon] - depth[left.horizon]
        || right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0];
    if (!goal) throw new Error(`Agent ${snapshot.identity.agentId} has no active strategic goal`);

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
        mode: options.strategy ? 'choose-player-strategy' : immediate ? 'execute-immediate-goal' : 'derive-immediate-goal',
        ...(options.strategy ? { alternatives: options.strategy.alternatives } : {}),
        goal: { goalId: goal.goalId, title: goal.title, description: goal.description },
        goalHierarchy: active.sort((left, right) => depth[left.horizon] - depth[right.horizon]
            || right.priority - left.priority || left.goalId.localeCompare(right.goalId)).map(item => ({
            goalId: item.goalId, parentGoalId: item.parentGoalId, horizon: item.horizon,
            title: item.title, description: item.description, priority: item.priority
        })),
        trustedContext: options.trustedContext === undefined
            ? buildDecisionContext(snapshot, context)
            : options.trustedContext.length <= 12_000 ? options.trustedContext
                : (() => { throw new Error('Trusted context exceeds 12000 characters'); })(),
        untrustedText: [...(options.untrustedText ?? []), ...untrustedEpisodes],
        allowedSkills,
        runId: options.runId
    };
}
