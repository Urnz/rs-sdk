import type { AgentSnapshot, GoalHorizon } from './types.js';

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

