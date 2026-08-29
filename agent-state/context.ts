import type { AgentEpisode, AgentKnowledge, AgentSnapshot, GoalHorizon } from './types.js';
import type { SocialMemoryEntry } from './retrieval.js';

const LABELS: Record<GoalHorizon, string> = {
    life: 'Life goal', 'long-term': 'Long-term goals', current: 'Current goals', immediate: 'Immediate tasks'
};

export function buildCoreIdentity(snapshot: AgentSnapshot, maxCharacters = 1600): string {
    if (!Number.isInteger(maxCharacters) || maxCharacters < 240 || maxCharacters > 8000) {
        throw new Error('Core identity character limit must be an integer from 240 to 8000');
    }
    const identity = snapshot.identity;
    const lines = [
        `Identity: ${identity.displayName} (${identity.agentId}; player ${identity.playerUsername})`,
        `Background: ${identity.background}`,
        `Traits: ${identity.personalityTraits.join(', ')}`
    ];
    if (identity.values.length) lines.push(`Values: ${identity.values.join(', ')}`);
    for (const horizon of ['life', 'long-term', 'current', 'immediate'] as GoalHorizon[]) {
        const goals = snapshot.goals.filter(item => item.status === 'active' && item.horizon === horizon)
            .sort((a, b) => b.priority - a.priority || a.goalId.localeCompare(b.goalId));
        if (goals.length) lines.push(`${LABELS[horizon]}: ${goals.map(item => item.title).join('; ')}`);
    }
    const full = lines.join('\n');
    if (full.length <= maxCharacters) return full;
    return `${full.slice(0, maxCharacters - 15).trimEnd()}\n[truncated]`;
}

export interface DecisionContextOptions {
    now?: string;
    maxCharacters?: number;
    workingMemoryMaxAgeMs?: number;
    episodicMemories?: readonly AgentEpisode[];
    semanticMemories?: readonly AgentKnowledge[];
    socialMemories?: readonly SocialMemoryEntry[];
}

export function buildDecisionContext(snapshot: AgentSnapshot, options: DecisionContextOptions = {}): string {
    const maxCharacters = options.maxCharacters ?? 2400;
    const maxAge = options.workingMemoryMaxAgeMs ?? 5 * 60_000;
    if (!Number.isInteger(maxCharacters) || maxCharacters < 240 || maxCharacters > 12000) {
        throw new Error('Decision context character limit must be an integer from 240 to 12000');
    }
    if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 24 * 60 * 60_000) {
        throw new Error('Working memory maximum age must be between 0 and 24 hours');
    }
    const now = Date.parse(options.now ?? new Date().toISOString());
    if (Number.isNaN(now)) throw new Error('Decision context now must be an ISO timestamp');
    const parts = [buildCoreIdentity(snapshot, Math.min(maxCharacters, 8000))];
    const memory = snapshot.workingMemory;
    if (memory && now - Date.parse(memory.observedAt) >= 0 && now - Date.parse(memory.observedAt) <= maxAge) {
        const location = memory.location
            ? `${memory.location.x},${memory.location.z},${memory.location.level}${memory.location.region ? ` (${memory.location.region})` : ''}`
            : 'unknown';
        parts.push(`Current situation: ${memory.summary}`);
        parts.push(`Activity: ${memory.currentActivity ?? 'idle'}`);
        parts.push(`Location: ${location}`);
        if (memory.observations.length) parts.push(`Recent observations: ${memory.observations.join('; ')}`);
    }
    if (options.episodicMemories?.length) {
        const memories = options.episodicMemories.slice(0, 12).map(item => {
            const links = [item.goalIds.length ? `goals=${item.goalIds.join(',')}` : '',
                item.actors.length ? `actors=${item.actors.join(',')}` : ''].filter(Boolean).join('; ');
            return `${item.occurredAt}: ${item.summary}${links ? ` [${links}]` : ''}`;
        });
        parts.push(`Relevant episodic memories:\n- ${memories.join('\n- ')}`);
    }
    if (options.semanticMemories?.length) {
        const knowledge = options.semanticMemories.slice(0, 12)
            .map(item => `${item.subject} ${item.predicate} ${item.object} (confidence ${item.confidence}): ${item.summary}`);
        parts.push(`Relevant semantic knowledge:\n- ${knowledge.join('\n- ')}`);
    }
    if (options.socialMemories?.length) {
        const relationships = options.socialMemories.slice(0, 12).map(item => {
            const relation = item.relationship;
            const open = item.commitments.filter(commitment => commitment.status === 'open');
            const debts = [`agent owes ${relation.agentOwesGp} gp`, `${relation.displayName} owes ${relation.actorOwesGp} gp`];
            return `${relation.displayName}: trust ${relation.trust}, affinity ${relation.affinity}, familiarity ${relation.familiarity}; `
                + `${debts.join(', ')}${open.length ? `; open commitments: ${open.map(entry => entry.description).join('; ')}` : ''}`;
        });
        parts.push(`Relevant social memory:\n- ${relationships.join('\n- ')}`);
    }
    const full = parts.join('\n');
    if (full.length <= maxCharacters) return full;
    return `${full.slice(0, maxCharacters - 15).trimEnd()}\n[truncated]`;
}
