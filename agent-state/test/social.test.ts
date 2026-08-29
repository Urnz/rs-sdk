import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore, buildDecisionContext, retrieveSocialMemory } from '../index.js';
import type { AgentCommitment, AgentRelationship } from '../types.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-social-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

function createAgent(store: AgentStateStore, id = 'ferrye14') {
    store.createIdentity({ agentId: id, playerUsername: id, displayName: id,
        background: 'A persistent social test agent.', personalityTraits: ['loyal'] });
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('relationship persistence', () => {
    test('persists evidence-backed directional debt and protects concurrent updates', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        createAgent(store);
        const evidence = store.createEpisode('ferrye14', { episodeId: 'trade.with.horvik', kind: 'interaction',
            summary: 'Horvik supplied a rune pickaxe on credit.', source: 'manual', trust: 'trusted',
            actors: ['Horvik'], occurredAt: '2026-08-29T10:00:00.000Z' });
        const created = store.setRelationship('ferrye14', null, { actorKey: 'Horvik', displayName: 'Horvik',
            trust: 40, affinity: 10, familiarity: 35, agentOwesGp: 32_000, actorOwesGp: 0,
            notes: 'Reliable smith and creditor.', tags: ['merchant'], evidenceEpisodeIds: [evidence.episodeId],
            lastInteractionAt: '2026-08-29T10:00:00.000Z' }, '2026-08-29T10:01:00.000Z');
        expect(created.actorKey).toBe('horvik');
        const updated = store.setRelationship('ferrye14', created.revision, { ...created,
            trust: 45, familiarity: 40 }, '2026-08-29T10:02:00.000Z');
        expect(updated).toMatchObject({ trust: 45, agentOwesGp: 32_000, revision: 2 });
        expect(() => store.setRelationship('ferrye14', created.revision, { ...created, trust: 0 }))
            .toThrow('changed before update');
        store.close();

        store = new AgentStateStore(path);
        expect(store.listRelationships('ferrye14')).toEqual([expect.objectContaining({
            actorKey: 'horvik', evidenceEpisodeIds: ['trade.with.horvik'], agentOwesGp: 32_000
        })]);
        store.close();
    });

    test('rejects self-relationships and evidence owned by another agent', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        createAgent(store, 'other');
        const evidence = store.createEpisode('other', { episodeId: 'other.social', kind: 'interaction',
            summary: 'Other agent interaction.', source: 'manual', occurredAt: '2026-08-29T10:00:00.000Z' });
        expect(() => store.setRelationship('ferrye14', null, { actorKey: 'Ferrye14', displayName: 'Self' }))
            .toThrow('with itself');
        expect(() => store.setRelationship('ferrye14', null, { actorKey: 'Horvik', displayName: 'Horvik',
            evidenceEpisodeIds: [evidence.episodeId] })).toThrow('same agent');
        store.close();
    });
});

describe('social commitments', () => {
    test('requires a relationship and keeps resolved commitments immutable', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        expect(() => store.createCommitment('ferrye14', { commitmentId: 'promise.missing', actorKey: 'Horvik',
            direction: 'owed-by-agent', description: 'Repay the pickaxe.' })).toThrow('existing relationship');
        store.setRelationship('ferrye14', null, { actorKey: 'Horvik', displayName: 'Horvik' });
        const promise = store.createCommitment('ferrye14', { commitmentId: 'promise.repay', actorKey: 'Horvik',
            direction: 'owed-by-agent', description: 'Repay the rune pickaxe loan.', valueGp: 32_000,
            dueAt: '2026-09-05T12:00:00.000Z' }, '2026-08-29T12:00:00.000Z');
        expect(promise).toMatchObject({ status: 'open', actorKey: 'horvik', valueGp: 32_000 });
        const fulfilled = store.setCommitmentStatus(promise.commitmentId, promise.revision, 'fulfilled',
            '2026-09-01T12:00:00.000Z');
        expect(fulfilled.resolvedAt).toBe('2026-09-01T12:00:00.000Z');
        expect(() => store.setCommitmentStatus(promise.commitmentId, fulfilled.revision, 'broken'))
            .toThrow('cannot change status');
        store.close();
    });
});

describe('social retrieval', () => {
    const relationship = (actorKey: string, patch: Partial<AgentRelationship> = {}): AgentRelationship => ({
        agentId: 'ferrye14', actorKey, displayName: actorKey, trust: 0, affinity: 0, familiarity: 10,
        agentOwesGp: 0, actorOwesGp: 0, notes: '', tags: [], evidenceEpisodeIds: [], lastInteractionAt: null,
        createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', revision: 1, ...patch
    });
    const commitment = (id: string, actorKey: string, patch: Partial<AgentCommitment> = {}): AgentCommitment => ({
        commitmentId: id, agentId: 'ferrye14', actorKey, direction: 'owed-by-agent', description: id,
        status: 'open', valueGp: null, dueAt: null, evidenceEpisodeIds: [], createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z', resolvedAt: null, revision: 1, ...patch
    });

    test('ranks actor, tags, text, debt and open commitments deterministically', () => {
        const entries = [
            { relationship: relationship('horvik', { displayName: 'Horvik', trust: 60, familiarity: 70,
                agentOwesGp: 32_000, notes: 'Varrock smith', tags: ['merchant'] }),
            commitments: [commitment('repay.pickaxe', 'horvik', { description: 'Repay the rune pickaxe.' })] },
            { relationship: relationship('stranger', { familiarity: 90 }), commitments: [] }
        ];
        const first = retrieveSocialMemory(entries, { actors: ['Horvik'], tags: ['merchant'],
            query: 'Varrock rune pickaxe', limit: 2 });
        const second = retrieveSocialMemory([...entries].reverse(), { actors: ['Horvik'], tags: ['merchant'],
            query: 'Varrock rune pickaxe', limit: 2 });
        expect(first).toEqual(second);
        expect(first[0]?.relationship.actorKey).toBe('horvik');
        expect(first[0]?.reasons).toEqual(expect.arrayContaining(['actor:1', 'debt:1', 'open-commitments:1']));
    });

    test('adds only selected relationships and open commitments to bounded context', () => {
        const store = new AgentStateStore(databasePath());
        createAgent(store);
        const snapshot = store.getSnapshot('ferrye14')!;
        const selected = { relationship: relationship('horvik', { displayName: 'Horvik', trust: 50 }),
            commitments: [commitment('repay', 'horvik', { description: 'Repay 32000 gp.' }),
                commitment('old', 'horvik', { description: 'Already done.', status: 'fulfilled' })] };
        const context = buildDecisionContext(snapshot, { socialMemories: [selected], maxCharacters: 800 });
        expect(context).toContain('Relevant social memory');
        expect(context).toContain('Repay 32000 gp.');
        expect(context).not.toContain('Already done.');
        expect(context.length).toBeLessThanOrEqual(800);
        store.close();
    });

    test('ranks interaction freshness and active-goal text independently from working-memory text', () => {
        const entries = [
            { relationship: relationship('lobster-buyer', { notes: 'Buys lobster near the Karamja ferry.',
                lastInteractionAt: '2026-01-01T00:00:00.000Z' }), commitments: [] },
            { relationship: relationship('recent-stranger', {
                lastInteractionAt: '2026-08-29T11:00:00.000Z' }), commitments: [] }
        ];
        const recentFirst = retrieveSocialMemory(entries, { now: '2026-08-29T12:00:00.000Z' });
        expect(recentFirst[0]?.relationship.actorKey).toBe('recent-stranger');
        expect(recentFirst[0]?.reasons).toContain('recency:30');
        const goalFirst = retrieveSocialMemory(entries, { now: '2026-08-29T12:00:00.000Z',
            query: 'standing idle', goalQuery: 'Sell lobster near Karamja ferry' });
        expect(goalFirst[0]?.relationship.actorKey).toBe('lobster-buyer');
        expect(goalFirst[0]?.reasons).toContain('goal:4');
    });
});
