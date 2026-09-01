import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentReplanCoordinator } from './replan-coordinator.js';
import { MultiAgentExperimentStore, multiAgentExperimentDefinition,
    startMultiAgentExperiment, type MultiAgentExperimentCandidate } from './multi-agent-experiments.js';
import type { EconomySnapshot } from './types.js';
import { adminPublicDir } from './paths.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function economy(timestamp: string, coins: number): EconomySnapshot {
    return { timestamp, bots: 2, online: 2, totalCoins: coins, totalXp: 2000,
        sessionXpGained: 0, totalXpPerHour: 0, averageTotalLevel: 10, itemStock: [] };
}

function candidate(agentId: string, avatar = agentId): MultiAgentExperimentCandidate {
    return { agentId, role: 'player', subjectKind: 'player', identityPlayerUsername: avatar,
        avatarPlayerUsername: avatar, onlineFresh: true };
}

describe('seeded multi-agent experiment definition', () => {
    test('is input-order independent while retaining a deterministic seeded dispatch order', () => {
        const first = multiAgentExperimentDefinition({ label: 'Copper cohort', seed: 'world-42',
            summary: 'Compare two miners.', agentIds: ['agent-b', 'agent-a'] });
        const second = multiAgentExperimentDefinition({ label: 'Copper cohort', seed: 'world-42',
            summary: 'Compare two miners.', agentIds: ['agent-a', 'agent-b'] });
        expect(first.digest).toBe(second.digest);
        expect(first.orderedAgentIds).toEqual(second.orderedAgentIds);
        expect(new Set(first.orderedAgentIds)).toEqual(new Set(['agent-a', 'agent-b']));
    });
});

test('admin UI exposes a separate multi-agent experiment tab and bounded participant selection', async () => {
    const [html, script] = await Promise.all([
        readFile(join(adminPublicDir, 'index.html'), 'utf8'),
        readFile(join(adminPublicDir, 'admin.js'), 'utf8')
    ]);
    expect(html).toContain('data-tab="experiments"');
    expect(html).toContain('id="multi-agent-experiment-form"');
    expect(html).toContain('id="multi-agent-candidate-list"');
    expect(html).toContain('id="multi-agent-experiment-list"');
    expect(script).toContain('/api/admin/multi-agent-experiments');
    expect(script).toContain('input[name="experimentAgentId"]:checked');
});

describe('persistent multi-agent experiment runner', () => {
    test('dispatches isolated agents concurrently and persists auditable shared-world snapshots', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-multi-agent-experiment-'));
        directories.push(root);
        const store = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        let active = 0;
        let maximumActive = 0;
        const coordinator = new AgentReplanCoordinator({
            resolveAgentId: async () => null,
            listAgentIds: async () => [],
            plan: async (agentId, event) => {
                active++;
                maximumActive = Math.max(maximumActive, active);
                await Bun.sleep(15);
                active--;
                return { runId: `skill-${agentId}`, status: 'executing',
                    decision: { kind: 'execute-skill', agentId }, reason: `Accepted ${event.sourceKey}` };
            },
            append: () => undefined
        });
        let snapshotCalls = 0;
        const started = await startMultiAgentExperiment({ label: 'Copper cohort', seed: 'world-42',
            summary: 'Start one bounded mining cycle for each agent.', agentIds: ['agent-a', 'agent-b'] }, {
            coordinator, store,
            listCandidates: async () => [candidate('agent-a'), candidate('agent-b')],
            economySnapshot: async () => economy(`2026-09-01T10:00:0${snapshotCalls}.000Z`, 100 + snapshotCalls++ * 10)
        }, '2026-09-01T10:00:00.000Z');

        expect(started.run.status).toBe('running');
        expect(started.run.participants.every(item => item.status === 'pending')).toBeTrue();
        const completed = await started.completion;
        expect(maximumActive).toBe(2);
        expect(completed.status).toBe('completed');
        expect(completed.baselineEconomy.totalCoins).toBe(100);
        expect(completed.dispatchEconomy?.totalCoins).toBe(110);
        expect(completed.participants.map(item => item.agentId).sort()).toEqual(['agent-a', 'agent-b']);
        expect(completed.participants.every(item => item.status === 'executing' && item.record?.gate.accepted)).toBeTrue();
        store.close();

        const reopened = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        expect(reopened.get(completed.experimentId)).toEqual(completed);
        reopened.close();
    });

    test('fails preflight before persistence for shared avatars, offline agents, or institutions', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-multi-agent-preflight-'));
        directories.push(root);
        const store = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        const coordinator = new AgentReplanCoordinator({ resolveAgentId: async () => null,
            listAgentIds: async () => [], plan: async () => ({ runId: 'never', status: 'skipped', reason: 'never' }),
            append: () => undefined });
        const dependencies = { coordinator, store, economySnapshot: async () => economy('2026-09-01T10:00:00.000Z', 0) };
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Duplicate avatar test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies,
            listCandidates: async () => [candidate('agent-a', 'same-player'), candidate('agent-b', 'same-player')] }))
            .rejects.toThrow('cannot share avatar');
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Offline test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies, listCandidates: async () => [
            candidate('agent-a'), { ...candidate('agent-b'), onlineFresh: false }] }))
            .rejects.toThrow('fresh online');
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Institution test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies, listCandidates: async () => [
            candidate('agent-a'), { ...candidate('agent-b'), role: 'institution', subjectKind: 'business',
                identityPlayerUsername: null, avatarPlayerUsername: null }] }))
            .rejects.toThrow('exact player-avatar');
        expect(store.list()).toHaveLength(0);
        store.close();
    });
});
