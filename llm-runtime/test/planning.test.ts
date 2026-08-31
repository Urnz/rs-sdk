import { describe, expect, test } from 'bun:test';
import type { AgentEpisode, AgentSnapshot } from '../../agent-state/types.js';
import { buildLlmPlanningInput } from '../planning.js';

const snapshot = {
        identity: { schemaVersion: 12, agentId: 'ferrye14', playerUsername: 'ferrye14', displayName: 'Ferrye',
        background: 'A miner.', personalityTraits: ['patient'], values: ['independence'], createdAt: '2026-08-29T12:00:00.000Z',
        updatedAt: '2026-08-29T12:00:00.000Z', revision: 1 },
    goals: [{ goalId: 'mine', agentId: 'ferrye14', parentGoalId: null, horizon: 'immediate', title: 'Mine ore',
        description: 'Bank iron ore.', status: 'active', priority: 90, skill: null, createdAt: '2026-08-29T12:00:00.000Z',
        updatedAt: '2026-08-29T12:00:00.000Z', completedAt: null, revision: 1 }],
    workingMemory: { agentId: 'ferrye14', summary: 'At Varrock East.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: ['Rune pickaxe equipped'],
        observedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', revision: 1 },
    knownSkills: [
        { agentId: 'ferrye14', skill: { id: 'mining', version: '1.0.0' }, status: 'known',
            learnedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', revision: 1 },
        { agentId: 'ferrye14', skill: { id: 'fishing', version: '1.0.0' }, status: 'blocked',
            learnedAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z', revision: 1 }
    ]
} satisfies AgentSnapshot;

function episode(trust: 'trusted' | 'untrusted'): AgentEpisode {
    return { episodeId: trust, agentId: 'ferrye14', kind: 'observation', summary: `${trust} memory`, details: 'details',
        importance: 50, goalIds: ['mine'], actors: [], tags: [], source: 'system', trust, externalKey: null,
        occurredAt: '2026-08-29T12:00:00.000Z', expiresAt: null, createdAt: '2026-08-29T12:00:00.000Z' };
}

describe('LLM planning input', () => {
    test('selects the immediate goal and exposes only known, non-blocked catalog skills', () => {
        const result = buildLlmPlanningInput(snapshot, { availableSkills: [
            { id: 'mining', version: '1.0.0', name: 'Mining', description: 'Mine and bank ore.' },
            { id: 'fishing', version: '1.0.0', name: 'Fishing', description: 'Fish lobster.' },
            { id: 'unknown', version: '1.0.0', name: 'Unknown', description: 'Not learned.' }
        ], context: { now: '2026-08-29T12:00:00.000Z', episodicMemories: [episode('trusted'), episode('untrusted')] } });
        expect(result.goal.goalId).toBe('mine');
        expect(result.mode).toBe('execute-immediate-goal');
        expect(result.allowedSkills.map(item => item.id)).toEqual(['mining']);
        expect(result.trustedContext).toContain('trusted memory');
        expect(result.trustedContext).not.toContain('untrusted memory');
        expect(result.untrustedText?.[0]).toContain('untrusted memory');
    });

    test('uses the deepest active strategic goal when no immediate goal exists', () => {
        const strategic = { ...snapshot, goals: [
            { ...snapshot.goals[0]!, goalId: 'life', horizon: 'life' as const, title: 'Become wealthy' },
            { ...snapshot.goals[0]!, goalId: 'workshop', parentGoalId: 'life', horizon: 'long-term' as const,
                title: 'Buy the Varrock workshop' }
        ] } satisfies AgentSnapshot;
        const result = buildLlmPlanningInput(strategic, { availableSkills: [
            { id: 'mining', version: '1.0.0', name: 'Mining', description: 'Mine and bank ore.' }
        ], context: { now: '2026-08-29T12:00:00.000Z' } });
        expect(result.mode).toBe('derive-immediate-goal');
        expect(result.goal.goalId).toBe('workshop');
        expect(result.goalHierarchy.map(goal => goal.goalId)).toEqual(['life', 'workshop']);
    });

    test('refuses to plan from missing or stale working memory', () => {
        expect(() => buildLlmPlanningInput({ ...snapshot, workingMemory: null }, { availableSkills: [],
            context: { now: '2026-08-29T12:00:00.000Z' } })).toThrow('fresh working-memory');
        expect(() => buildLlmPlanningInput(snapshot, { availableSkills: [],
            context: { now: '2026-08-29T12:10:00.000Z' } })).toThrow('fresh working-memory');
    });
});
