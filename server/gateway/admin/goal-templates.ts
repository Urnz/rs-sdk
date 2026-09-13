import type { AgentAutonomyEnrollment, AgentGoal, CreateAgentGoal } from '../../../agent-state/types.js';

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
