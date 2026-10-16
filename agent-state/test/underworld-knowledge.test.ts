import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../store.js';
import { projectObserverUnderworldKnowledge } from '../underworld-knowledge.js';

const directories: string[] = [];
const stores: AgentStateStore[] = [];
const now = '2026-09-24T12:00:00.000Z';
function createStore(): AgentStateStore {
    const directory = mkdtempSync(join(tmpdir(), 'underworld-knowledge-'));
    directories.push(directory);
    const store = new AgentStateStore(join(directory, 'agents.sqlite'));
    stores.push(store);
    return store;
}
function createAgent(store: AgentStateStore, agentId: string): void {
    store.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
        background: 'Local test agent.', personalityTraits: ['curious'] });
}
afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('observer-scoped underworld knowledge', () => {
    test('shows only the observer’s own evidence-backed contact without certifying a fence', () => {
        const store = createStore();
        createAgent(store, 'observer');
        createAgent(store, 'other');
        const episode = store.createEpisode('observer', { episodeId: 'observer.met-horvik',
            kind: 'interaction', summary: 'A meeting.', source: 'manual', trust: 'trusted',
            actors: ['Horvik'], occurredAt: '2026-09-23T12:00:00.000Z' });
        store.setRelationship('observer', null, { actorKey: 'Horvik', displayName: 'Horvik',
            familiarity: 30, trust: 12, evidenceEpisodeIds: [episode.episodeId],
            tags: ['fence'], notes: 'I heard this person buys stolen goods.' });
        store.createKnowledge('observer', { knowledgeId: 'observer.claim', kind: 'economic',
            subject: 'Horvik', predicate: 'underworld-counterparty', object: 'fence',
            summary: 'Someone said Horvik is a fence.', source: 'manual',
            evidenceEpisodeIds: [episode.episodeId], validFrom: '2026-09-23T12:00:00.000Z' });
        store.setRelationship('other', null, { actorKey: 'Secret', displayName: 'Secret', tags: ['fence'] });
        const result = projectObserverUnderworldKnowledge(store, 'observer', now);
        expect(result.contacts).toEqual([{
            actorKey: 'horvik', relationshipRevision: 1, familiarity: 30, subjectiveTrust: 12,
            directEpisodeIds: ['observer.met-horvik'], semanticKnowledgeIds: ['observer.claim'],
            blockers: ['underworld-claim-not-attested']
        }]);
        expect(result.blocker).toBe('underworld-claim-not-attested');
        expect(JSON.stringify(result)).not.toContain('Secret');
        expect(JSON.stringify(result)).not.toContain('stolen goods');
    });

    test('does not promote tags, text, expired or unrelated evidence', () => {
        const store = createStore();
        createAgent(store, 'observer');
        const unrelated = store.createEpisode('observer', { episodeId: 'observer.unrelated',
            kind: 'interaction', summary: 'Fence in the village.', source: 'manual', trust: 'trusted',
            actors: ['Someone else'], tags: ['fence'], occurredAt: '2026-09-23T12:00:00.000Z' });
        const untrusted = store.createEpisode('observer', { episodeId: 'observer.rumour',
            kind: 'interaction', summary: 'Rumour about Horvik.', source: 'manual', trust: 'untrusted',
            actors: ['Horvik'], occurredAt: '2026-09-23T12:00:00.000Z' });
        const expired = store.createEpisode('observer', { episodeId: 'observer.old',
            kind: 'interaction', summary: 'Old meeting.', source: 'manual', trust: 'trusted', actors: ['Horvik'],
            occurredAt: '2026-09-01T12:00:00.000Z', expiresAt: '2026-09-20T12:00:00.000Z' });
        store.setRelationship('observer', null, { actorKey: 'Horvik', displayName: 'Horvik', tags: ['fence'],
            evidenceEpisodeIds: [unrelated.episodeId, untrusted.episodeId, expired.episodeId] });
        const result = projectObserverUnderworldKnowledge(store, 'observer', now);
        expect(result.contacts[0]).toMatchObject({ directEpisodeIds: [], semanticKnowledgeIds: [],
            blockers: ['no-direct-episode-evidence', 'underworld-claim-not-attested'] });
    });

    test('requires an existing observer and canonical observation time', () => {
        const store = createStore();
        expect(() => projectObserverUnderworldKnowledge(store, 'missing', now)).toThrow('does not exist');
        createAgent(store, 'observer');
        expect(() => projectObserverUnderworldKnowledge(store, 'observer', 'not-a-date')).toThrow('canonical ISO');
    });
});
