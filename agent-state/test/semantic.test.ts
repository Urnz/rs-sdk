import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore, buildDecisionContext, retrieveSemanticMemory } from '../index.js';
import type { AgentKnowledge } from '../types.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-semantic-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

function createAgent(store: AgentStateStore, id = 'ferrye14') {
    store.createIdentity({ agentId: id, playerUsername: id, displayName: id,
        background: 'A persistent semantic test agent.', personalityTraits: ['curious'] });
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('semantic memory persistence', () => {
    test('persists evidence-backed knowledge and keeps external ingestion idempotent', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        createAgent(store);
        const goal = store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Build a livelihood' });
        const evidence = store.createEpisode('ferrye14', { episodeId: 'episode.bank-route', kind: 'discovery',
            summary: 'Walked from the mine to the east bank.', source: 'skill', trust: 'trusted',
            occurredAt: '2026-08-29T10:00:00.000Z' });
        const input = {
            knowledgeId: 'knowledge.bank-route', kind: 'route' as const, subject: 'Varrock east iron mine',
            predicate: 'nearest-bank', object: 'Varrock east bank',
            summary: 'The east bank is the nearest verified bank for this mine.', confidence: 85,
            goalIds: [goal.goalId], tags: ['varrock', 'mining'], evidenceEpisodeIds: [evidence.episodeId],
            source: 'consolidation' as const, externalKey: 'consolidation:route:1',
            validFrom: '2026-08-29T10:00:00.000Z'
        };
        const created = store.createKnowledge('ferrye14', input, '2026-08-29T10:05:00.000Z');
        const replay = store.createKnowledge('ferrye14', { ...input, knowledgeId: 'knowledge.replay' });
        expect(replay.knowledgeId).toBe(created.knowledgeId);
        expect(store.countKnowledge('ferrye14')).toBe(1);
        expect(() => store.createKnowledge('ferrye14', { ...input, knowledgeId: 'knowledge.collision',
            object: 'Varrock west bank' })).toThrow('external key collision');
        store.close();

        store = new AgentStateStore(path);
        expect(store.listKnowledge('ferrye14')).toEqual([expect.objectContaining({
            subject: 'Varrock east iron mine', evidenceEpisodeIds: ['episode.bank-route'], status: 'active'
        })]);
        store.close();
    });

    test('supersedes a fact atomically while preserving history and rejecting ambiguous active facts', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        const base = store.createKnowledge('ferrye14', { knowledgeId: 'ore.price.old', kind: 'economic',
            subject: 'Iron ore', predicate: 'observed-price', object: '100 gp', summary: 'Iron ore sold for 100 gp.',
            confidence: 60, source: 'manual', validFrom: '2026-08-20T00:00:00.000Z' }, '2026-08-20T00:00:00.000Z');
        expect(() => store.createKnowledge('ferrye14', { knowledgeId: 'ore.price.conflict', kind: 'economic',
            subject: 'iron ORE', predicate: 'OBSERVED-PRICE', object: '110 gp', summary: 'A conflicting active price.',
            source: 'manual', validFrom: '2026-08-21T00:00:00.000Z' })).toThrow();
        const replacement = store.createKnowledge('ferrye14', { knowledgeId: 'ore.price.new', kind: 'economic',
            subject: 'Iron ore', predicate: 'observed-price', object: '110 gp', summary: 'Iron ore now sells for 110 gp.',
            confidence: 75, source: 'manual', supersedesId: base.knowledgeId,
            validFrom: '2026-08-21T00:00:00.000Z' }, '2026-08-21T00:00:00.000Z');
        expect(replacement.status).toBe('active');
        expect(store.getKnowledge(base.knowledgeId)).toMatchObject({ status: 'superseded', revision: 2 });
        expect(store.listKnowledge('ferrye14', { status: 'active' }).map(item => item.knowledgeId))
            .toEqual(['ore.price.new']);
        store.close();
    });

    test('rejects cross-agent goals and evidence plus invalid validity windows', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        createAgent(store, 'other');
        const goal = store.createGoal('other', { goalId: 'other.life', horizon: 'life', title: 'Other life' });
        const evidence = store.createEpisode('other', { episodeId: 'other.evidence', kind: 'observation',
            summary: 'Other observation.', source: 'manual', occurredAt: '2026-08-29T10:00:00.000Z' });
        const base = { knowledgeId: 'invalid.fact', kind: 'world' as const, subject: 'Varrock', predicate: 'has-bank',
            object: 'true', summary: 'Varrock has a bank.', source: 'manual' as const,
            validFrom: '2026-08-29T10:00:00.000Z' };
        expect(() => store.createKnowledge('ferrye14', { ...base, goalIds: [goal.goalId] })).toThrow('same agent');
        expect(() => store.createKnowledge('ferrye14', { ...base, evidenceEpisodeIds: [evidence.episodeId] }))
            .toThrow('same agent');
        expect(() => store.createKnowledge('ferrye14', { ...base, validUntil: '2026-08-29T09:00:00.000Z' }))
            .toThrow('later than validFrom');
        store.close();
    });
});

describe('semantic retrieval', () => {
    const fact = (id: string, patch: Partial<AgentKnowledge> = {}): AgentKnowledge => ({
        knowledgeId: id, agentId: 'ferrye14', kind: 'world', subject: id, predicate: 'is', object: 'known',
        summary: id, confidence: 50, goalIds: [], tags: [], evidenceEpisodeIds: [], source: 'system', status: 'active',
        supersedesId: null, externalKey: null, validFrom: '2026-08-01T00:00:00.000Z', validUntil: null,
        createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', revision: 1, ...patch
    });

    test('ranks confidence and goal/tag/text relevance while excluding invalid knowledge', () => {
        const entries = [
            fact('route', { kind: 'route', subject: 'Karamja lobster dock', predicate: 'bank-route',
                object: 'Draynor bank via Port Sarim', summary: 'Use the ferry then walk to Draynor.',
                confidence: 70, goalIds: ['ferrye.fish'], tags: ['lobster', 'banking'] }),
            fact('generic', { confidence: 95, updatedAt: '2026-08-28T00:00:00.000Z' }),
            fact('superseded', { confidence: 100, status: 'superseded', goalIds: ['ferrye.fish'] }),
            fact('expired', { confidence: 100, validUntil: '2026-08-20T00:00:00.000Z', goalIds: ['ferrye.fish'] }),
            fact('disputed', { confidence: 100, status: 'disputed', goalIds: ['ferrye.fish'] })
        ];
        const result = retrieveSemanticMemory(entries, { now: '2026-08-29T00:00:00.000Z',
            goalIds: ['ferrye.fish'], tags: ['lobster'], query: 'Karamja ferry Draynor bank', limit: 5 });
        expect(result.map(item => item.knowledge.knowledgeId)).toEqual(['route', 'generic']);
        expect(result[0]?.reasons).toContain('goal:1');
        expect(retrieveSemanticMemory(entries, { now: '2026-08-29T00:00:00.000Z',
            goalIds: ['ferrye.fish'], includeDisputed: true }).some(item => item.knowledge.knowledgeId === 'disputed')).toBe(true);
    });

    test('is deterministic and includes only selected semantic facts in bounded context', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        const snapshot = store.getSnapshot('ferrye14')!;
        const entries = [fact('a', { summary: 'Bank route A.' }), fact('b', { confidence: 80, summary: 'Bank route B.' })];
        const first = retrieveSemanticMemory(entries, { now: '2026-08-29T00:00:00.000Z' });
        const second = retrieveSemanticMemory([...entries].reverse(), { now: '2026-08-29T00:00:00.000Z' });
        expect(first).toEqual(second);
        const context = buildDecisionContext(snapshot, { now: '2026-08-29T00:00:00.000Z',
            semanticMemories: [first[0]!.knowledge], maxCharacters: 800 });
        expect(context).toContain('Relevant semantic knowledge');
        expect(context).toContain(first[0]!.knowledge.summary);
        expect(context).not.toContain(first[1]!.knowledge.summary);
        expect(context.length).toBeLessThanOrEqual(800);
        store.close();
    });
});
