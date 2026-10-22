import { AgentStateStore } from '../../../agent-state/store.js';
import type { LivelihoodAction, LivelihoodJournalEntry } from '../../../agent-state/livelihood.js';
import { workUuid } from '../../../business-work/binding.js';
import { canonicalSkillParameters } from '../../../agent-state/skill-binding.js';
import { loadLlmRuntimeConfig } from './llm-settings.js';
import { resolveAdminSkillForAgent } from './skill-catalog.js';
import { evaluateAutonomousSkillPolicy, ROUTINE_AUTONOMOUS_OPERATIONS } from './replan-runtime.js';
import { evaluateAuthorizationEnvelope } from './authorization-envelope.js';
import { bindAutonomousSkillParameters, classifySkillFailure } from './autonomous-skill-binding.js';
import { materializeLivelihoodGoal } from './goal-templates.js';
import { delegateBusinessPlayerAction, startAdminPlayerActionRequest, finishAdminPlayerActionRun } from './agent-state.js';
import type { BotSupervisor } from './supervisor.js';
import type { ReplanOutcome } from './replan-coordinator.js';
import type { GatewayAgentReplanOptions } from './replan-runtime.js';
import type { GatewayBotSnapshot } from './types.js';

export async function dispatchLivelihoodSkill(entry: LivelihoodJournalEntry & { action: Extract<LivelihoodAction, { kind: 'skill' }> },
    supervisor: BotSupervisor, gatewayBots: () => Map<string, GatewayBotSnapshot>,
    options: GatewayAgentReplanOptions & { agentPath: string }): Promise<ReplanOutcome> {
    const use = <T>(fn: (s: AgentStateStore) => T): T => { const s = new AgentStateStore(options.agentPath, options.simulationClock);
        try { return fn(s); } finally { s.close(); } };
    const reject = (reason: string): ReplanOutcome => ({ runId: entry.eventId, status: 'input-required', reason });
    const { action: a, agentId } = entry;
    const profile = use(s => s.getControlProfile(agentId)), identity = use(s => s.getIdentity(agentId));
    const avatar = profile?.avatarPlayerUsername;
    if (!avatar || profile.role !== 'player' || identity?.playerUsername !== avatar) return reject('Exact avatar required');
    const bot = [...gatewayBots().entries()].find(([name]) => name.toLowerCase() === avatar)?.[1];
    if (!bot?.state?.player || bot.status !== 'active' || bot.controllers > 0 || bot.state.player.isDead
        || Date.now() - bot.lastStateReceivedAt > 5000 || supervisor.activeSkillSnapshot(avatar)) return reject('Avatar busy or stale');
    const known = use(s => s.getSkillKnowledge(agentId, a.skill));
    if (!known || !['known', 'preferred'].includes(known.status)) return reject('Exact skill is not known');
    let candidate;
    try { candidate = await resolveAdminSkillForAgent(`${a.skill.id}@${a.skill.version}`, agentId, options.skillCatalog); }
    catch { return reject('Exact skill is not independently verified and published'); }
    const config = (await loadLlmRuntimeConfig(options.llmConfigPath ? {
        defaultConfigPath: options.llmConfigPath, overrideConfigPath: `${options.llmConfigPath}.override` } : {})).config;
    const policy = evaluateAutonomousSkillPolicy(config.autonomousExecution, candidate.definition);
    if (!policy.allowed) return reject(policy.reason);
    const binding = bindAutonomousSkillParameters(candidate.definition, [{ ...a.binding, skill: a.skill }]);
    const envelope = evaluateAuthorizationEnvelope(policy.authorization!, candidate.definition, binding.parameters);
    if (!envelope.allowed) return reject(envelope.reason);
    // The dispatch has a stable identity even if the process dies before startSkill acknowledges it.
    const runId = workUuid(`livelihood:${entry.actionId}`);
    const goalId = a.goalId ?? use(s => materializeLivelihoodGoal(s, entry));
    if (a.goalId) {
        const goal = use(s => s.listGoals(agentId, 'active').find(g => g.goalId === a.goalId));
        const execution = use(s => s.getGoalExecution(a.goalId!));
        if (!goal || goal.skill?.id !== a.skill.id || goal.skill.version !== a.skill.version || !execution
            || JSON.stringify(execution.binding.parameters) !== JSON.stringify(binding.parameters)
            || execution.binding.sourceId !== binding.sourceId || execution.binding.sourceKind !== binding.sourceKind)
            return reject('Approved supply goal changed');
    }
    use(s => s.reserveDecisionOperationalBudget(entry.eventId, envelope.reservedGp, policy.authorization!.maxGpPerDay ?? 0));
    const enrollment = use(s => s.getAutonomyEnrollment(agentId));
    if (!enrollment || enrollment.status !== 'running' || !enrollment.leaseExpiresAt
        || Date.parse(enrollment.leaseExpiresAt) <= Date.now() || use(s => s.getAutonomyControl().emergencyStop))
        return reject('Live autonomy lease required');
    let request = a.binding.sourceKind === 'work-order' ? use(s => s.getPlayerActionRequest(a.binding.sourceId)) : null;
    if (a.binding.sourceKind === 'work-order' && (!request || request.assigneeAgentId !== agentId
        || JSON.stringify(canonicalSkillParameters(request.parameters)) !== JSON.stringify(binding.parameters)
        || request.skill.id !== a.skill.id || request.skill.version !== a.skill.version)) return reject('Work binding changed');
    if (request?.status === 'pending' || request?.status === 'accepted')
        request = delegateBusinessPlayerAction(request.requestId, runId, options.agentPath).request;
    else if (request?.status === 'approved' && request.approvalId)
        request = startAdminPlayerActionRequest(request.requestId, agentId, request.revision, request.approvalId, runId, options.agentPath);
    else if (request) return reject('Work already started or terminal');
    use(s => s.recordSkillDispatch({ runId, decisionId: entry.eventId, agentId, goalId, skill: a.skill, binding,
        policyId: enrollment.policyId, policyVersion: enrollment.policyVersion }));
    try {
        const process = await supervisor.startSkill(avatar, `${a.skill.id}@${a.skill.version}`, binding.parameters, { runId,
            runtimeAuthorization: { operations: policy.authorization!.operations ?? ROUTINE_AUTONOMOUS_OPERATIONS, itemNames: policy.authorization!.itemNames ?? [],
                partners: policy.authorization!.partners ?? [], maxQuantity: policy.authorization!.maxQuantity ?? 28,
                maxUnitPriceGp: policy.authorization!.maxUnitPriceGp ?? 0, maxGpPerRun: policy.authorization!.maxGpPerRun ?? 0 } });
        return { runId: process.runId, status: 'executing', reason: 'Exact deterministic livelihood skill dispatched.' };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        use(s => s.recordSkillRunOutcome(runId, 'failed', classifySkillFailure(undefined, detail), detail));
        if (request?.runId === runId) finishAdminPlayerActionRun(runId, false, `Skill start failed: ${detail}`, options.agentPath);
        throw error;
    }
}
