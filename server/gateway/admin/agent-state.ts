import { AgentStateStore } from '../../../agent-state/store.js';
import { buildDecisionContext } from '../../../agent-state/context.js';
import { planNextAction } from '../../../agent-state/planner.js';
import type { AgentSkillKnowledgeStatus, AgentSkillReference, CreateAgentGoal, CreateAgentIdentity,
    GoalStatus, UpdateAgentIdentity } from '../../../agent-state/types.js';
import { agentStateDbPath } from './paths.js';
import { listAdminSkills } from './skill-catalog.js';

function useStore<T>(path: string, callback: (store: AgentStateStore) => T): T {
    const store = new AgentStateStore(path);
    try { return callback(store); }
    finally { store.close(); }
}

export async function listAdminAgents(path = agentStateDbPath) {
    const skills = await listAdminSkills();
    const availableSkills = skills.map(skill => ({ id: skill.id, version: skill.version }));
    const agents = useStore(path, store => store.listIdentities().map(identity => {
        const snapshot = store.getSnapshot(identity.agentId)!;
        return {
            ...snapshot,
            decisionContext: buildDecisionContext(snapshot, { maxCharacters: 2400 }),
            planner: planNextAction(snapshot, { availableSkills })
        };
    }));
    return { agents, skills, generatedAt: new Date().toISOString() };
}

export function createAdminAgent(input: CreateAgentIdentity, path = agentStateDbPath) {
    return useStore(path, store => store.createIdentity(input));
}

export function updateAdminAgent(agentId: string, expectedRevision: number, patch: UpdateAgentIdentity,
    path = agentStateDbPath) {
    return useStore(path, store => store.updateIdentity(agentId, expectedRevision, patch));
}

export function createAdminAgentGoal(agentId: string, input: CreateAgentGoal, path = agentStateDbPath) {
    return useStore(path, store => store.createGoal(agentId, input));
}

export function updateAdminAgentGoalStatus(agentId: string, goalId: string, expectedRevision: number,
    status: GoalStatus, path = agentStateDbPath) {
    return useStore(path, store => {
        const goal = store.getGoal(goalId);
        if (!goal || goal.agentId !== agentId.toLowerCase()) throw new Error('A cél nem ehhez az agenthez tartozik.');
        return store.setGoalStatus(goalId, expectedRevision, status);
    });
}

export function updateAdminAgentSkill(agentId: string, skill: AgentSkillReference,
    status: AgentSkillKnowledgeStatus, expectedRevision: number | null, path = agentStateDbPath) {
    return useStore(path, store => store.setSkillKnowledge(agentId, skill, status, expectedRevision));
}

