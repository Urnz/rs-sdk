import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore } from '../../../agent-state/store.js';
import { AgentMemoryIngestionLoop, ingestAgentMemories } from './agent-memory-ingestion.js';

const roots: string[] = [];
const runId = '12345678-1234-4234-8234-123456789abc';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'rs-agent-memory-ingestion-'));
    roots.push(root);
    const runRoot = join(root, 'runs');
    const databasePath = join(root, 'agents.sqlite');
    await mkdir(runRoot, { recursive: true });
    const store = new AgentStateStore(databasePath);
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'Automatic memory test agent.', personalityTraits: ['observant'] });
    store.close();
    return { root, runRoot, databasePath };
}

function journal(message = 'Finished mining and trading.', id = runId, minute = 0) {
    const skill = { id: 'economy.test', version: '1.0.0' };
    const timestamp = (second: number) => `2026-08-29T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
    return {
        runId: id, username: 'Ferrye14', skill, status: 'completed', reason: 'completed', message,
        operations: 2, durationMs: 2_500,
        events: [
            { runId: id, type: 'skill.started', timestamp: timestamp(0), skill },
            { runId: id, type: 'step.succeeded', timestamp: timestamp(1), skill,
                stepId: 'mine', operation: 'gather-loc', data: {
                    inventoryDelta: [{ id: 440, name: 'Iron ore', delta: 1, count: 1 }]
                } },
            { runId: id, type: 'step.succeeded', timestamp: timestamp(2), skill,
                stepId: 'trade', operation: 'trade-give-item', data: {
                    partner: 'Buyer1', gave: [{ id: 440, name: 'Iron ore', count: 1 }],
                    received: [{ id: 995, name: 'Coins', count: 75 }],
                    inventoryDelta: [{ id: 440, name: 'Iron ore', delta: -1, count: 0 },
                        { id: 995, name: 'Coins', delta: 75, count: 75 }]
                } },
            { runId: id, type: 'skill.completed', timestamp: timestamp(3), skill }
        ]
    };
}

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('automatic agent memory ingestion', () => {
    test('turns trusted skill outcomes and economic evidence into idempotent episodes', async () => {
        const { runRoot, databasePath } = await fixture();
        await writeFile(join(runRoot, `${runId}.json`), JSON.stringify(journal()));

        const first = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T10:01:00.000Z' });
        expect(first).toMatchObject({ scannedRuns: 1, matchedRuns: 1, createdEpisodes: 3,
            existingEpisodes: 0, createdRelationships: 1, skippedRuns: 0, errors: [] });
        const store = new AgentStateStore(databasePath);
        const episodes = store.listEpisodes('ferrye14');
        expect(episodes).toHaveLength(3);
        expect(episodes.map(item => item.kind)).toEqual(['outcome', 'economic', 'economic']);
        expect(episodes.find(item => item.externalKey === `skill-run:${runId}`)).toMatchObject({
            source: 'skill', trust: 'trusted', tags: ['automatic', 'skill-run', 'completed', 'economy.test']
        });
        expect(episodes.find(item => item.tags.includes('player-trade'))).toMatchObject({ actors: ['Buyer1'] });
        expect(store.getRelationship('ferrye14', 'buyer1')).toMatchObject({
            displayName: 'Buyer1', trust: 0, affinity: 0, familiarity: 5,
            agentOwesGp: 0, actorOwesGp: 0, tags: ['automatic', 'player-trade'], revision: 1
        });
        store.close();

        const second = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T10:02:00.000Z' });
        expect(second).toMatchObject({ createdEpisodes: 0, existingEpisodes: 3,
            createdRelationships: 0, updatedRelationships: 0, existingRelationships: 1, errors: [] });
        const reopened = new AgentStateStore(databasePath);
        expect(reopened.getRelationship('ferrye14', 'buyer1')?.revision).toBe(1);
        reopened.close();
    });

    test('skips unmatched players and rejects changed journal content instead of rewriting memory', async () => {
        const { runRoot, databasePath } = await fixture();
        await writeFile(join(runRoot, `${runId}.json`), JSON.stringify(journal()));
        await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T10:01:00.000Z' });
        await writeFile(join(runRoot, `${runId}.json`), JSON.stringify(journal('Journal was changed later.')));
        const changed = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T10:02:00.000Z' });
        expect(changed.errors.some(error => error.message.includes('external key collision'))).toBe(true);

        const unknownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        await writeFile(join(runRoot, `${unknownId}.json`), JSON.stringify({
            ...journal(), runId: unknownId, username: 'Unknown',
            events: journal().events.map(event => ({ ...event, runId: unknownId }))
        }));
        const skipped = await ingestAgentMemories({ databasePath, runRoot });
        expect(skipped.skippedRuns).toBe(1);
    });

    test('coalesces overlapping loop requests into one scan', async () => {
        const { runRoot, databasePath } = await fixture();
        const loop = new AgentMemoryIngestionLoop({ runRoot, databasePath });
        const first = loop.sync();
        const second = loop.sync();
        expect(first).toBe(second);
        await first;
        expect(loop.snapshot()).not.toBeNull();
    });

    test('consolidates repeated production at stable evidence thresholds and preserves history', async () => {
        const { runRoot, databasePath } = await fixture();
        const ids = [1, 2, 3, 4, 5].map(index =>
            `${String(index).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`);
        for (let index = 0; index < 3; index++) {
            await writeFile(join(runRoot, `${ids[index]}.json`), JSON.stringify(journal('Done.', ids[index], index)));
        }
        const first = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T11:00:00.000Z' });
        expect(first).toMatchObject({ createdKnowledge: 1, existingKnowledge: 0, blockedConsolidations: 0, errors: [] });
        let store = new AgentStateStore(databasePath);
        expect(store.listKnowledge('ferrye14', { status: 'active' })[0]).toMatchObject({
            source: 'consolidation', confidence: 60, object: 'item:440:Iron ore'
        });
        expect(store.listKnowledge('ferrye14', { status: 'active' })[0]?.evidenceEpisodeIds).toHaveLength(3);
        store.close();

        for (let index = 3; index < 5; index++) {
            await writeFile(join(runRoot, `${ids[index]}.json`), JSON.stringify(journal('Done.', ids[index], index)));
        }
        const second = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T12:00:00.000Z' });
        expect(second.createdKnowledge).toBe(1);
        store = new AgentStateStore(databasePath);
        const active = store.listKnowledge('ferrye14', { status: 'active' })[0]!;
        expect(active).toMatchObject({ confidence: 70, revision: 1 });
        expect(store.listKnowledge('ferrye14', { status: 'superseded' })[0]).toMatchObject({ confidence: 60, revision: 2 });
        const ruleKey = active.subject.replace('skill-output:', 'production.');
        expect(store.countConsolidationEvidence('ferrye14', ruleKey)).toBe(5);
        expect(active.evidenceEpisodeIds).toHaveLength(5);
        store.close();

        const third = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T13:00:00.000Z' });
        expect(third).toMatchObject({ createdKnowledge: 0, existingKnowledge: 1, errors: [] });
    });

    test('does not replace manually curated knowledge with automatic consolidation', async () => {
        const { runRoot, databasePath } = await fixture();
        const ids = [1, 2, 3].map(index =>
            `1000000${index}-0000-4000-8000-${String(index).padStart(12, '0')}`);
        for (let index = 0; index < 2; index++) {
            await writeFile(join(runRoot, `${ids[index]}.json`), JSON.stringify(journal('Done.', ids[index], index)));
        }
        await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T11:00:00.000Z' });
        const hash = createHash('sha256').update('economy.test@1.0.0|id:440').digest('hex').slice(0, 24);
        const store = new AgentStateStore(databasePath);
        store.createKnowledge('ferrye14', {
            knowledgeId: 'manual.iron-production', kind: 'procedure', subject: `skill-output:${hash}`,
            predicate: 'produces-item', object: 'The supervised iron workflow',
            summary: 'An administrator verified the preferred iron production procedure.',
            confidence: 95, tags: ['manual'], evidenceEpisodeIds: [], source: 'manual',
            validFrom: '2026-08-29T11:30:00.000Z'
        }, '2026-08-29T11:30:00.000Z');
        store.close();
        await writeFile(join(runRoot, `${ids[2]}.json`), JSON.stringify(journal('Done.', ids[2], 2)));

        const result = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T12:00:00.000Z' });
        expect(result).toMatchObject({ createdKnowledge: 0, blockedConsolidations: 1, errors: [] });
        const reopened = new AgentStateStore(databasePath);
        expect(reopened.listKnowledge('ferrye14', { status: 'active' })[0]).toMatchObject({
            knowledgeId: 'manual.iron-production', source: 'manual', confidence: 95
        });
        reopened.close();
    });

    test('adds trade evidence without inventing or lowering manually curated relationship values', async () => {
        const { runRoot, databasePath } = await fixture();
        const store = new AgentStateStore(databasePath);
        const curatedEvidence = store.createEpisode('ferrye14', { episodeId: 'manual.buyer-note',
            kind: 'interaction', summary: 'The buyer negotiated fairly.', source: 'manual',
            actors: ['Buyer1'], occurredAt: '2026-08-29T08:00:00.000Z' });
        store.setRelationship('ferrye14', null, { actorKey: 'Buyer1', displayName: 'Preferred buyer',
            trust: 55, affinity: 30, familiarity: 80, agentOwesGp: 900, actorOwesGp: 150,
            notes: 'Manually curated relationship.', tags: ['merchant'],
            evidenceEpisodeIds: [curatedEvidence.episodeId] }, '2026-08-29T09:00:00.000Z');
        store.close();
        const ids = [1, 2, 3].map(index =>
            `2000000${index}-0000-4000-8000-${String(index).padStart(12, '0')}`);
        for (let index = 0; index < ids.length; index++) {
            await writeFile(join(runRoot, `${ids[index]}.json`), JSON.stringify(journal('Done.', ids[index], index)));
        }

        const result = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T11:00:00.000Z' });
        expect(result).toMatchObject({ createdRelationships: 0, updatedRelationships: 1, errors: [] });
        const reopened = new AgentStateStore(databasePath);
        expect(reopened.getRelationship('ferrye14', 'buyer1')).toMatchObject({
            displayName: 'Preferred buyer', trust: 55, affinity: 30, familiarity: 80,
            agentOwesGp: 900, actorOwesGp: 150, notes: 'Manually curated relationship.',
            tags: ['merchant', 'automatic', 'player-trade'], revision: 2,
            lastInteractionAt: '2026-08-29T10:02:02.000Z'
        });
        expect(reopened.getRelationship('ferrye14', 'buyer1')?.evidenceEpisodeIds).toEqual([
            'manual.buyer-note', expect.stringMatching(/^economy\./),
            expect.stringMatching(/^economy\./), expect.stringMatching(/^economy\./)
        ]);
        reopened.close();
    });
});
