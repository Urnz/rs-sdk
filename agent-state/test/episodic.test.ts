import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore, buildDecisionContext, retrieveEpisodicMemory } from '../index.js';
import type { AgentEpisode } from '../types.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-episodes-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

function createAgent(store: AgentStateStore, id = 'ferrye14') {
    store.createIdentity({ agentId: id, playerUsername: id, displayName: id,
        background: 'A persistent test agent.', personalityTraits: ['careful'] });
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('episodic memory persistence', () => {
    test('persists goal-linked events across reopening and keeps external events idempotent', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        createAgent(store);
        const goal = store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Build a life' });
        const input = {
            episodeId: 'episode.first', kind: 'discovery' as const, summary: 'Found iron south of Varrock.',
            details: 'The rocks are close to the east bank.', importance: 75, goalIds: [goal.goalId],
            actors: ['Ferrye14'], tags: ['mining', 'varrock'], source: 'skill' as const, trust: 'trusted' as const,
            externalKey: 'skill-run:123', occurredAt: '2026-08-29T10:00:00.000Z'
        };
        const created = store.createEpisode('ferrye14', input, '2026-08-29T10:01:00.000Z');
        const replay = store.createEpisode('ferrye14', { ...input, episodeId: 'episode.replayed' });
        expect(replay.episodeId).toBe(created.episodeId);
        expect(store.countEpisodes('ferrye14')).toBe(1);
        expect(() => store.createEpisode('ferrye14', { ...input, episodeId: 'episode.collision',
            summary: 'A different event.' })).toThrow('external key collision');
        store.close();

        store = new AgentStateStore(path);
        expect(store.listEpisodes('ferrye14')).toEqual([expect.objectContaining({
            summary: 'Found iron south of Varrock.', goalIds: ['ferrye.life'], tags: ['mining', 'varrock']
        })]);
        store.close();
    });

    test('rejects cross-agent goals, invalid lifetimes and unbounded payloads', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        createAgent(store, 'other');
        const otherGoal = store.createGoal('other', { goalId: 'other.life', horizon: 'life', title: 'Other life' });
        const base = { episodeId: 'episode.invalid', kind: 'observation' as const, summary: 'Observed something.',
            source: 'manual' as const, occurredAt: '2026-08-29T10:00:00.000Z' };
        expect(() => store.createEpisode('ferrye14', { ...base, goalIds: [otherGoal.goalId] }))
            .toThrow('same agent');
        expect(() => store.createEpisode('ferrye14', { ...base, expiresAt: '2026-08-29T09:00:00.000Z' }))
            .toThrow('later than occurredAt');
        expect(() => store.createEpisode('ferrye14', { ...base, tags: Array.from({ length: 13 }, (_, i) => `tag${i}`) }))
            .toThrow('at most 12');
        store.close();
    });

    test('previews and prunes only expired episodes that have no durable references', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        const base = { kind: 'interaction' as const, source: 'manual' as const,
            occurredAt: '2026-08-28T10:00:00.000Z', expiresAt: '2026-08-29T10:00:00.000Z' };
        store.createEpisode('ferrye14', { ...base, episodeId: 'expired.eligible', summary: 'Temporary detail.' });
        const protectedEpisode = store.createEpisode('ferrye14', { ...base, episodeId: 'expired.protected',
            summary: 'Durable evidence.', externalKey: 'external:durable-evidence' });
        store.createEpisode('ferrye14', { ...base, episodeId: 'future.episode', summary: 'Not expired yet.',
            expiresAt: '2026-09-10T10:00:00.000Z' });
        store.createKnowledge('ferrye14', { knowledgeId: 'knowledge.protected', kind: 'world',
            subject: 'retention', predicate: 'keeps', object: 'evidence', summary: 'Keep its evidence.',
            source: 'manual', evidenceEpisodeIds: [protectedEpisode.episodeId],
            validFrom: '2026-08-28T10:00:00.000Z' });
        const relationship = store.setRelationship('ferrye14', null, { actorKey: 'buyer1', displayName: 'Buyer1',
            evidenceEpisodeIds: [protectedEpisode.episodeId] });
        store.createCommitment('ferrye14', { commitmentId: 'commitment.protected', actorKey: relationship.actorKey,
            direction: 'owed-by-agent', description: 'Preserve the promise.',
            evidenceEpisodeIds: [protectedEpisode.episodeId] });
        store.recordConsolidationEvidence('ferrye14', { ruleKey: 'retention.test', evidenceKey: 'evidence:test',
            episodeId: protectedEpisode.episodeId, occurredAt: protectedEpisode.occurredAt });

        const preview = store.previewEpisodeRetention('ferrye14', '2026-08-30T10:00:00.000Z');
        expect(preview).toMatchObject({ expiredCount: 2, eligibleCount: 1, protectedCount: 1, truncated: false });
        expect(preview.candidates.find(item => item.episodeId === 'expired.protected')?.protectionReasons).toEqual([
            'semantic-evidence', 'relationship-evidence', 'commitment-evidence',
            'consolidation-evidence', 'external-source'
        ]);

        const pruned = store.pruneExpiredEpisodes('ferrye14', '2026-08-30T10:00:00.000Z');
        expect(pruned.deletedEpisodeIds).toEqual(['expired.eligible']);
        expect(store.getEpisode('expired.eligible')).toBeNull();
        expect(store.getEpisode('expired.protected')).not.toBeNull();
        expect(store.getEpisode('future.episode')).not.toBeNull();
        expect(store.pruneExpiredEpisodes('ferrye14', '2026-08-30T10:00:00.000Z').deletedEpisodeIds).toEqual([]);
        expect(() => store.previewEpisodeRetention('ferrye14', 'not-a-date')).toThrow('ISO timestamp');
        store.close();
    });
});

describe('episodic retrieval', () => {
    const episode = (id: string, patch: Partial<AgentEpisode> = {}): AgentEpisode => ({
        episodeId: id, agentId: 'ferrye14', kind: 'observation', summary: id, details: '', importance: 50,
        goalIds: [], actors: [], tags: [], source: 'system', trust: 'trusted', externalKey: null,
        occurredAt: '2026-08-20T12:00:00.000Z', expiresAt: null, createdAt: '2026-08-20T12:00:00.000Z', ...patch
    });

    test('ranks by goal, text, actor, importance and recency while excluding unsafe memories', () => {
        const episodes = [
            episode('goal-match', { summary: 'Mined iron near Varrock.', importance: 60,
                goalIds: ['ferrye.mine'], actors: ['Horvik'], tags: ['mining'] }),
            episode('recent-unrelated', { importance: 90, occurredAt: '2026-08-29T11:00:00.000Z' }),
            episode('untrusted', { importance: 100, trust: 'untrusted', goalIds: ['ferrye.mine'] }),
            episode('expired', { importance: 100, goalIds: ['ferrye.mine'], expiresAt: '2026-08-28T00:00:00.000Z' })
        ];
        const result = retrieveEpisodicMemory(episodes, { now: '2026-08-29T12:00:00.000Z',
            goalIds: ['ferrye.mine'], actors: ['horvik'], tags: ['mining'], query: 'iron Varrock', limit: 4 });
        expect(result.map(item => item.episode.episodeId)).toEqual(['goal-match', 'recent-unrelated']);
        expect(result[0]?.reasons).toContain('goal:1');
        expect(retrieveEpisodicMemory(episodes, { now: '2026-08-29T12:00:00.000Z',
            goalIds: ['ferrye.mine'], includeUntrusted: true }).some(item => item.episode.episodeId === 'untrusted')).toBe(true);
    });

    test('is deterministic and adds only explicitly retrieved episodes to bounded context', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        const snapshot = store.getSnapshot('ferrye14')!;
        const memories = [episode('a', { summary: 'Remembered market price.' }), episode('b', { importance: 80 })];
        const first = retrieveEpisodicMemory(memories, { now: '2026-08-29T12:00:00.000Z' });
        const second = retrieveEpisodicMemory([...memories].reverse(), { now: '2026-08-29T12:00:00.000Z' });
        expect(first).toEqual(second);
        const context = buildDecisionContext(snapshot, { now: '2026-08-29T12:00:00.000Z',
            episodicMemories: [first[0]!.episode], maxCharacters: 800 });
        expect(context).toContain('Relevant episodic memories');
        expect(context).toContain(first[0]!.episode.summary);
        expect(context).not.toContain(first[1]!.episode.summary);
        expect(context.length).toBeLessThanOrEqual(800);
        store.close();
    });
});
