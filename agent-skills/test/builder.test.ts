import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillBuilderService, type SkillBuilderProvider, type SkillBuilderProviderResponse } from '../builder.js';
import { CapabilityGapStore } from '../capability-gaps.js';
import { FileSkillStore } from '../store.js';

const directories: string[] = [];
const policy = { maxAttemptsPerGap: 3, maxCostMicrosPerGap: 1000, cooldownMs: 60_000, maxDurationMs: 1000 };

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function harness(replies: Array<SkillBuilderProviderResponse | Error>) {
    const root = await mkdtemp(join(tmpdir(), 'rs-skill-builder-'));
    directories.push(root);
    const gaps = new CapabilityGapStore(join(root, 'gaps.json'));
    const requests: unknown[] = [];
    const provider: SkillBuilderProvider = { id: 'scripted-builder', build: async request => {
        requests.push(structuredClone(request));
        const reply = replies.shift();
        if (!reply) throw new Error('No scripted builder response');
        if (reply instanceof Error) throw reply;
        return structuredClone(reply);
    } };
    return { root, gaps, requests, provider, service: new SkillBuilderService('skill-builder', gaps,
        new FileSkillStore(join(root, 'skills')), provider, policy) };
}

function proposal(extra: Record<string, unknown> = {}) {
    return { id: 'mining.varrock.copper', version: '0.1.0', name: 'Mine Varrock copper',
        description: 'Walk to copper rocks, mine copper ore, and deposit it in the bank.', tags: ['mining', 'banking'],
        parameters: {}, limits: { timeoutMs: 120000, maxOperations: 20 },
        preconditions: [{ condition: 'inventory-free-slots-at-least', arguments: { slots: 1 } }],
        steps: [
            { kind: 'operation', id: 'walk-mine', operation: 'walk-to', arguments: { x: 3285, z: 3367 } },
            { kind: 'operation', id: 'mine-copper', operation: 'gather-loc',
                arguments: { name: 'Rocks', option: 'Mine', item: 'Copper ore', skill: 'Mining' } },
            { kind: 'operation', id: 'open-bank', operation: 'open-bank', arguments: {} },
            { kind: 'operation', id: 'deposit-copper', operation: 'deposit-item',
                arguments: { name: 'Copper ore', amount: -1 } }
        ], ...extra };
}

const response = (value = proposal(), costMicros = 125): SkillBuilderProviderResponse => ({
    proposal: value, usage: { costMicros }, providerRequestId: 'builder-request-1'
});

describe('bounded Skill Builder service', () => {
    test('claims a gap, accepts only a declarative proposal, and persists an agent draft', async () => {
        const value = await harness([response()]);
        await value.gaps.report({ agentId: 'miner1', goalId: 'mine-copper', title: 'Mine and bank copper' });
        const result = await value.service.runNext([], '2026-08-30T14:00:00.000Z');

        expect(result).toMatchObject({ status: 'draft-created', draft: { status: 'draft',
            provenance: { authorKind: 'agent', authorId: 'skill-builder' }, sharing: { visibility: 'shared' } },
        gap: { status: 'draft', builderAttempts: 1, builderCostMicros: 125,
            draftSkill: { id: 'mining.varrock.copper', version: '0.1.0' } } });
        expect(value.requests[0]).toMatchObject({ allowedOperations: expect.arrayContaining(['walk-to', 'gather-loc']),
            gap: { title: 'Mine and bank copper' } });
        expect(await readdir(join(value.root, 'skills', 'shared'))).toEqual(['mining.varrock.copper@0.1.0.skill.json']);
    });

    test('keeps one exclusive build while more agents subscribe to the same gap', async () => {
        let release!: (value: SkillBuilderProviderResponse) => void;
        const waiting = new Promise<SkillBuilderProviderResponse>(resolve => { release = resolve; });
        const value = await harness([]);
        const provider: SkillBuilderProvider = { id: 'waiting-builder', build: async () => waiting };
        const firstService = new SkillBuilderService('skill-builder-a', value.gaps,
            new FileSkillStore(join(value.root, 'skills')), provider, policy);
        const secondService = new SkillBuilderService('skill-builder-b', value.gaps,
            new FileSkillStore(join(value.root, 'skills')), provider, policy);
        await value.gaps.report({ agentId: 'miner1', goalId: 'mine-copper', title: 'Mine and bank copper' });

        const first = firstService.runNext([], '2026-08-30T14:00:00.000Z');
        await new Promise(resolve => setTimeout(resolve, 10));
        await value.gaps.report({ agentId: 'miner2', goalId: 'mine-copper-too', title: 'Mine and bank copper' });
        const second = await secondService.runNext([], '2026-08-30T14:00:01.000Z');
        release(response());

        expect(second.status).toBe('idle');
        expect((await first).status).toBe('draft-created');
        expect((await value.gaps.list())[0]?.requesters).toHaveLength(2);
    });

    test('rejects provider-controlled security fields instead of persisting them', async () => {
        const value = await harness([response(proposal({ script: 'run arbitrary JavaScript' }))]);
        await value.gaps.report({ agentId: 'miner1', goalId: 'mine-copper', title: 'Mine and bank copper' });
        const result = await value.service.runNext([], '2026-08-30T14:00:00.000Z');

        expect(result).toMatchObject({ status: 'failed', retryable: false,
            gap: { status: 'rejected', builderAttempts: 1 } });
        expect(result.status === 'failed' ? result.reason : '').toContain('unsupported fields: script');
        await expect(readdir(join(value.root, 'skills', 'shared'))).rejects.toThrow();
    });

    test('records transient failures and enforces cooldown before retrying the gap', async () => {
        const value = await harness([new Error('temporary provider outage'), response()]);
        await value.gaps.report({ agentId: 'miner1', goalId: 'mine-copper', title: 'Mine and bank copper' });
        const failed = await value.service.runNext([], '2026-08-30T14:00:00.000Z');
        const cooling = await value.service.runNext([], '2026-08-30T14:00:30.000Z');
        const retried = await value.service.runNext([], '2026-08-30T14:01:01.000Z');

        expect(failed).toMatchObject({ status: 'failed', retryable: true,
            gap: { status: 'open', builderAttempts: 1, lastBuilderError: 'temporary provider outage' } });
        expect(cooling.status).toBe('idle');
        expect(retried).toMatchObject({ status: 'draft-created', gap: { builderAttempts: 2 } });
    });
});
