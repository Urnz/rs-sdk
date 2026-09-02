import { createHash } from 'node:crypto';
import type { AgentGoal, AgentSkillKnowledge, AgentSkillReference, AgentSnapshot } from './types.js';

export type PlannerDecisionKind = 'execute-skill' | 'refresh-state' | 'no-immediate-goal' | 'skill-unavailable';

export interface PlannerDecision {
    kind: PlannerDecisionKind;
    agentId: string;
    goalId: string | null;
    skill: AgentSkillReference | null;
    reason: string;
    decisionKey: string;
}

export interface PlannerOptions {
    now?: string;
    workingMemoryMaxAgeMs?: number;
    availableSkills?: readonly AgentSkillReference[];
    selectionSeed?: string;
}

export function selectImmediateGoal(snapshot: AgentSnapshot, selectionSeed?: string): AgentGoal | null {
    if (selectionSeed !== undefined && (typeof selectionSeed !== 'string'
        || !selectionSeed.trim() || selectionSeed.length > 128)) {
        throw new Error('Planner selection seed must contain 1-128 characters');
    }
    const immediate = snapshot.goals.filter(goal => goal.status === 'active' && goal.horizon === 'immediate')
        .sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId));
    const highest = immediate[0]?.priority;
    if (highest === undefined || !selectionSeed) return immediate[0] ?? null;
    return immediate.filter(goal => goal.priority === highest).sort((left, right) => {
        const leftHash = createHash('sha256').update(`${selectionSeed}\0${left.goalId}`).digest('hex');
        const rightHash = createHash('sha256').update(`${selectionSeed}\0${right.goalId}`).digest('hex');
        return leftHash.localeCompare(rightHash) || left.goalId.localeCompare(right.goalId);
    })[0] ?? null;
}

function key(snapshot: AgentSnapshot, kind: PlannerDecisionKind, goal: AgentGoal | null,
    knowledge: AgentSkillKnowledge | null): string {
    return [snapshot.identity.agentId, `identity:${snapshot.identity.revision}`,
        `memory:${snapshot.workingMemory?.revision ?? 0}`, `goal:${goal?.goalId ?? 'none'}:${goal?.revision ?? 0}`,
        `skill:${knowledge?.skill.id ?? 'none'}@${knowledge?.skill.version ?? 'none'}:${knowledge?.revision ?? 0}`, kind].join('|');
}

export function planNextAction(snapshot: AgentSnapshot, options: PlannerOptions = {}): PlannerDecision {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const maxAge = options.workingMemoryMaxAgeMs ?? 5 * 60_000;
    if (Number.isNaN(now)) throw new Error('Planner now must be an ISO timestamp');
    if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 24 * 60 * 60_000) {
        throw new Error('Planner working memory maximum age must be between 0 and 24 hours');
    }
    const selected = selectImmediateGoal(snapshot, options.selectionSeed);
    if (!selected) {
        return { kind: 'no-immediate-goal', agentId: snapshot.identity.agentId, goalId: null, skill: null,
            reason: 'The agent has no active immediate goal.', decisionKey: key(snapshot, 'no-immediate-goal', null, null) };
    }
    const memoryAge = snapshot.workingMemory ? now - Date.parse(snapshot.workingMemory.observedAt) : Number.POSITIVE_INFINITY;
    if (!snapshot.workingMemory || memoryAge < 0 || memoryAge > maxAge) {
        return { kind: 'refresh-state', agentId: snapshot.identity.agentId, goalId: selected?.goalId ?? null,
            skill: null, reason: 'A fresh working-memory observation is required before planning.',
            decisionKey: key(snapshot, 'refresh-state', selected, null) };
    }
    if (!selected.skill) {
        return { kind: 'skill-unavailable', agentId: snapshot.identity.agentId, goalId: selected.goalId, skill: null,
            reason: 'The selected immediate goal has no assigned agent skill.',
            decisionKey: key(snapshot, 'skill-unavailable', selected, null) };
    }
    const knowledge = snapshot.knownSkills.find(item => item.skill.id === selected.skill!.id
        && item.skill.version === selected.skill!.version) ?? null;
    if (!knowledge || knowledge.status === 'blocked') {
        return { kind: 'skill-unavailable', agentId: snapshot.identity.agentId, goalId: selected.goalId,
            skill: selected.skill, reason: knowledge ? 'The assigned agent skill is blocked.' : 'The agent has not learned the assigned skill.',
            decisionKey: key(snapshot, 'skill-unavailable', selected, knowledge) };
    }
    const available = options.availableSkills?.some(skill => skill.id === selected.skill!.id
        && skill.version === selected.skill!.version) ?? false;
    if (!available) {
        return { kind: 'skill-unavailable', agentId: snapshot.identity.agentId, goalId: selected.goalId,
            skill: selected.skill, reason: 'The assigned skill version is not available in the trusted catalog.',
            decisionKey: key(snapshot, 'skill-unavailable', selected, knowledge) };
    }
    return { kind: 'execute-skill', agentId: snapshot.identity.agentId, goalId: selected.goalId,
        skill: selected.skill, reason: `${options.selectionSeed ? 'Execute the seeded highest-priority immediate alternative' : 'Execute the highest-priority immediate goal'} using ${selected.skill.id}@${selected.skill.version}.`,
        decisionKey: key(snapshot, 'execute-skill', selected, knowledge) };
}
