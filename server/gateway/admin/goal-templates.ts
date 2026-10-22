import type { AgentAutonomyEnrollment, AgentGoal, CreateAgentGoal } from '../../../agent-state/types.js';
import type { AgentStateStore } from '../../../agent-state/store.js';
import type { LivelihoodJournalEntry, LivelihoodAction } from '../../../agent-state/livelihood.js';
import { createHash } from 'node:crypto';

export interface AllowedGoalTemplate {
    templateId: string;
    version: string;
    policyId: string;
    policyVersion: string;
    parentGoalId: string;
    goal: Omit<CreateAgentGoal, 'parentGoalId'>;
}

const PROTO_TEMPLATES: readonly AllowedGoalTemplate[] = [...([
    ['vrcopper1.copper', 'vrcopper1.run', 'Complete one copper shop cycle', 'mining.varrock-east.copper-to-general-store'],
    ['vrcopper2.stock', 'vrcopper2.run', 'Bank one copper load', 'mining.varrock-east.copper-to-bank'],
    ['vriron1.iron', 'vriron1.run', 'Complete one iron shop cycle', 'mining.varrock-east.iron-to-general-store'],
    ['vrsmith1.daggers', 'vrsmith1.run', 'Smith one bounded dagger batch', 'production.varrock.bronze-daggers'],
    ['vrworker1.available', 'vrworker1.run', 'Bank one copper load', 'mining.varrock-east.copper-to-bank']
] as const).map(([parentGoalId, goalId, title, skillId]): AllowedGoalTemplate => ({
    templateId: `proto.${goalId}`, version: '1.0.0', policyId: 'private-local-default', policyVersion: '1.0.0',
    parentGoalId, goal: { goalId, horizon: 'immediate', title, description: 'Policy-approved bounded livelihood cycle.',
        priority: 70, skill: { id: skillId, version: '1.0.0' }, execution: { policy: 'recurring', cooldownMs: 60_000,
            binding: { sourceKind: 'goal', sourceId: goalId, parameters: {} } } }
})), {
    templateId: 'proto.vrtrader1.run', version: '1.0.0', policyId: 'private-local-default', policyVersion: '1.0.0',
    parentGoalId: 'vrtrader1.hammers', goal: { goalId: 'vrtrader1.run', horizon: 'immediate',
        title: 'Buy one bounded hammer batch', description: 'Policy-approved one-time tool procurement.', priority: 70,
        skill: { id: 'shopping.lumbridge.buy-hammers', version: '1.0.0' }, execution: { policy: 'one-shot',
            binding: { sourceKind: 'goal', sourceId: 'vrtrader1.run', parameters: { 'target-items': 1 } } } }
}];

/** Returns only a source-controlled, exact-version template; arbitrary goal chains are never synthesized here. */
export function selectAllowedGoalTemplate(goals: readonly AgentGoal[], enrollment: AgentAutonomyEnrollment,
    templates: readonly AllowedGoalTemplate[] = PROTO_TEMPLATES): AllowedGoalTemplate | null {
    if (goals.some(goal => goal.status === 'active' && goal.horizon === 'immediate')) return null;
    return templates.find(template => template.policyId === enrollment.policyId
        && template.policyVersion === enrollment.policyVersion
        && goals.some(goal => goal.goalId === template.parentGoalId && goal.status === 'active'
            && goal.horizon === 'current')
        && !goals.some(goal => goal.goalId === template.goal.goalId)) ?? null;
}

/** One fixed hierarchy, keyed by identity rather than an avatar name or profession class. */
export function materializeLivelihoodGoal(store: AgentStateStore,
    entry: LivelihoodJournalEntry & { action: Extract<LivelihoodAction, { kind: 'skill' }> }): string {
    const prefix = `livelihood.${createHash('sha256').update(entry.agentId).digest('hex').slice(0, 24)}`;
    let parentGoalId: string | null = null;
    for (const horizon of ['life', 'long-term', 'current'] as const) {
        const goalId = `${prefix}.${horizon}`;
        const goals = store.listGoals(entry.agentId);
        // A supplied livelihood goal may already belong to an approved life tree.
        // Keep that unique active root and its supply branch; attach the bounded
        // routine branch without inventing a second active life goal.
        const existing = horizon === 'life' ? goals.find(g => g.horizon === 'life' && g.status === 'active')
            ?? goals.find(g => g.goalId === goalId) : goals.find(g => g.goalId === goalId);
        if (existing && existing.status !== 'active') throw new Error('Livelihood goal hierarchy is inactive');
        if (existing && existing.parentGoalId !== parentGoalId) throw new Error('Livelihood goal hierarchy parent differs');
        if (!existing) store.createGoal(entry.agentId, { goalId, parentGoalId, horizon, priority: 80,
            title: 'Maintain a sustainable local livelihood', description: 'Fixed society-livelihood policy hierarchy.' });
        parentGoalId = existing?.goalId ?? goalId;
    }
    const goalId = `${entry.actionId}.skill`;
    if (!store.listGoals(entry.agentId).some(g => g.goalId === goalId)) store.createGoal(entry.agentId, {
        goalId, parentGoalId, horizon: 'immediate', priority: 100, title: 'Complete the selected bounded routine step',
        description: entry.reason, skill: entry.action.skill,
        execution: { policy: 'one-shot', binding: entry.action.binding }
    });
    return goalId;
}
