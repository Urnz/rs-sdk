import { afterEach, describe, expect, test } from 'bun:test';
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

function journal(message = 'Finished mining and trading.') {
    const skill = { id: 'economy.test', version: '1.0.0' };
    return {
        runId, username: 'Ferrye14', skill, status: 'completed', reason: 'completed', message,
        operations: 2, durationMs: 2_500,
        events: [
            { runId, type: 'skill.started', timestamp: '2026-08-29T10:00:00.000Z', skill },
            { runId, type: 'step.succeeded', timestamp: '2026-08-29T10:00:01.000Z', skill,
                stepId: 'mine', operation: 'gather-loc', data: {
                    inventoryDelta: [{ id: 440, name: 'Iron ore', delta: 1, count: 1 }]
                } },
            { runId, type: 'step.succeeded', timestamp: '2026-08-29T10:00:02.000Z', skill,
                stepId: 'trade', operation: 'trade-give-item', data: {
                    partner: 'Buyer1', gave: [{ id: 440, name: 'Iron ore', count: 1 }],
                    received: [{ id: 995, name: 'Coins', count: 75 }],
                    inventoryDelta: [{ id: 440, name: 'Iron ore', delta: -1, count: 0 },
                        { id: 995, name: 'Coins', delta: 75, count: 75 }]
                } },
            { runId, type: 'skill.completed', timestamp: '2026-08-29T10:00:03.000Z', skill }
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
            existingEpisodes: 0, skippedRuns: 0, errors: [] });
        const store = new AgentStateStore(databasePath);
        const episodes = store.listEpisodes('ferrye14');
        expect(episodes).toHaveLength(3);
        expect(episodes.map(item => item.kind)).toEqual(['outcome', 'economic', 'economic']);
        expect(episodes.find(item => item.externalKey === `skill-run:${runId}`)).toMatchObject({
            source: 'skill', trust: 'trusted', tags: ['automatic', 'skill-run', 'completed', 'economy.test']
        });
        expect(episodes.find(item => item.tags.includes('player-trade'))).toMatchObject({ actors: ['Buyer1'] });
        store.close();

        const second = await ingestAgentMemories({ databasePath, runRoot, now: '2026-08-29T10:02:00.000Z' });
        expect(second).toMatchObject({ createdEpisodes: 0, existingEpisodes: 3, errors: [] });
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
});
