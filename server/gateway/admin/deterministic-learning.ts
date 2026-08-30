import { resolveSkillForCapability, type SkillResolution } from '../../../agent-skills/capability-gaps.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { planNextAction, type PlannerDecision } from '../../../agent-state/planner.js';
import type { AgentGoal, AgentSkillKnowledge } from '../../../agent-state/types.js';
import { agentStateDbPath } from './paths.js';
import { resolveAdminSkillForAgent, type AdminAgentSkillCatalogOptions,
    type AdminSkillSummary } from './skill-catalog.js';
import { learnAdminSkill } from './skill-learning.js';

export interface DeterministicLearningResult {
    resolution: SkillResolution;
    learned: boolean;
    assigned: boolean;
    decision: PlannerDecision;
}

function reference(value: { id: string; version: string }): string {
    return `${value.id}@${value.version}`;
}

export async function resolveLearnAndPlan(agentId: string, goal: AgentGoal,
    catalog: readonly AdminSkillSummary[], knownSkills: readonly AgentSkillKnowledge[], options: {
        agentPath?: string;
        catalog?: AdminAgentSkillCatalogOptions;
        now?: string;
    } = {}): Promise<DeterministicLearningResult | null> {
    if (goal.horizon !== 'immediate' || goal.status !== 'active') return null;
    const knownByReference = new Map(knownSkills.map(item => [reference(item.skill), item]));
    const candidates = catalog.filter(skill => {
        const knowledge = knownByReference.get(skill.reference);
        if (knowledge?.status === 'blocked') return false;
        return knowledge?.status === 'known' || knowledge?.status === 'preferred'
            || skill.policy.kind === 'common' || skill.policy.kind === 'public';
    });
    const resolution = goal.skill
        ? (() => {
            const skill = candidates.find(item => item.reference === reference(goal.skill!));
            if (!skill) return null;
            const learned = knownByReference.has(skill.reference);
            return { skill: { id: skill.id, version: skill.version, name: skill.name,
                description: skill.description, tags: skill.tags, status: 'verified' as const, visibility: 'shared' as const },
            source: learned ? 'known' as const : 'shared-library' as const,
            knowledge: learned ? 'learned' as const : 'unlearned' as const,
            requiresLearning: !learned, score: Number.MAX_SAFE_INTEGER, matchedTerms: [] };
        })()
        : resolveSkillForCapability({ title: goal.title, description: goal.description }, candidates.map(skill => ({
            id: skill.id, version: skill.version, name: skill.name, description: skill.description,
            tags: skill.tags, status: 'verified' as const, visibility: 'shared' as const
        })), knownSkills.map(item => ({ ...item.skill, status: item.status })));
    if (!resolution) return null;

    const selected = catalog.find(skill => skill.reference === reference(resolution.skill));
    if (!selected) return null;
    let learned = false;
    if (resolution.requiresLearning) {
        if (selected.policy.kind !== 'common' && selected.policy.kind !== 'public') return null;
        const candidate = await resolveAdminSkillForAgent(selected.reference, agentId, options.catalog);
        const result = await learnAdminSkill(agentId, candidate.definition, {
            agentPath: options.agentPath, learningPath: options.catalog?.learningPath,
            policy: candidate.policy, now: options.now
        });
        learned = result.created || result.knowledgeCreated;
    }

    const path = options.agentPath ?? agentStateDbPath;
    const store = new AgentStateStore(path);
    try {
        let currentGoal = store.getGoal(goal.goalId);
        if (!currentGoal || currentGoal.agentId !== agentId.toLocaleLowerCase('en-US')) return null;
        let assigned = false;
        if (reference(currentGoal.skill ?? { id: 'none', version: 'none' }) !== reference(resolution.skill)) {
            try {
                currentGoal = store.setGoalSkill(agentId, currentGoal.goalId, currentGoal.revision, resolution.skill,
                    options.now);
                assigned = true;
            } catch (error) {
                currentGoal = store.getGoal(goal.goalId);
                if (!currentGoal || !currentGoal.skill
                    || reference(currentGoal.skill) !== reference(resolution.skill)) throw error;
            }
        }
        const snapshot = store.getSnapshot(agentId)!;
        const decision = planNextAction(snapshot, { now: options.now,
            availableSkills: catalog.map(skill => ({ id: skill.id, version: skill.version })) });
        return { resolution, learned, assigned, decision };
    } finally { store.close(); }
}
