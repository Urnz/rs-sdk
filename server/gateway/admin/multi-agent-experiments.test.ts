import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentReplanCoordinator } from './replan-coordinator.js';
import { compareMultiAgentExperiments, MultiAgentExperimentStore, multiAgentExperimentDefinition,
    reconcileMultiAgentExperimentSkillRun, startMultiAgentExperiment,
    type MultiAgentExperimentCandidate, type MultiAgentExperimentEnvironment } from './multi-agent-experiments.js';
import type { EconomySnapshot } from './types.js';
import { adminPublicDir } from './paths.js';
import type { AdminSkillRun } from './skill-history.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function economy(timestamp: string, coins: number): EconomySnapshot {
    return { timestamp, bots: 2, online: 2, totalCoins: coins, totalXp: 2000,
        sessionXpGained: 0, totalXpPerHour: 0, averageTotalLevel: 10, itemStock: [] };
}

function candidate(agentId: string, avatar = agentId): MultiAgentExperimentCandidate {
    const position = agentId === 'agent-a' ? { x: 3200, z: 3400, level: 0 } : { x: 2900, z: 3150, level: 0 };
    return { agentId, role: 'player', subjectKind: 'player', identityPlayerUsername: avatar,
        avatarPlayerUsername: avatar, onlineFresh: true, avatarBaseline: { username: avatar, position,
            hitpoints: { current: 10, maximum: 10 }, runEnergy: 10_000,
            inventory: [{ id: 995, name: 'Coins', count: 100 }], equipment: [], bankKnown: true,
            bank: [{ id: 436, name: 'Copper ore', count: 5 }],
            skills: Array.from({ length: 19 }, (_, index) => ({ name: `Skill ${index}`,
                level: 10, baseLevel: 10, experience: 1_154 })) } };
}

function experimentEnvironment(diminishingXp = false): MultiAgentExperimentEnvironment {
    return { schemaVersion: 1, activeRevision: 7, capturedAt: '2026-09-01T09:59:59.000Z', mods: [
        { id: 'economy.diminishing-xp', version: '1.0.0', dataSchemaVersion: 1,
            enabled: diminishingXp, config: { recoveryMinutes: 30, minimumMultiplier: 0.2 } },
        { id: 'property.ownership', version: '1.0.0', dataSchemaVersion: 1,
            enabled: true, config: { welcomeMessage: 'Varrock' } }
    ] };
}

function goalSnapshots(agentIds: readonly string[], completedAgentId?: string) {
    return Object.fromEntries(agentIds.map(agentId => [agentId, [{ goalId: `${agentId}.earn`, horizon: 'immediate' as const,
        status: agentId === completedAgentId ? 'completed' as const : 'active' as const,
        revision: agentId === completedAgentId ? 2 : 1,
        updatedAt: agentId === completedAgentId
            ? '2026-09-01T10:00:03.000Z' : '2026-09-01T09:59:00.000Z',
        completedAt: agentId === completedAgentId ? '2026-09-01T10:00:03.000Z' : null }]]));
}

function skillRun(runId: string, username: string, status: AdminSkillRun['status'] = 'completed'): AdminSkillRun {
    const skillId = username === 'agent-a' ? 'test.mine-copper' : 'test.fish-lobster';
    const resource = username === 'agent-a'
        ? { id: 436, name: 'Copper ore', target: 'Copper rocks', x: 3200, z: 3400 }
        : { id: 377, name: 'Raw lobster', target: 'Fishing spot', x: 2900, z: 3150 };
    return { runId, username, skill: { id: skillId, version: '1.0.0' }, status,
        reason: status === 'completed' ? 'Cycle completed.' : 'Cycle failed.', message: '', operations: 4,
        durationMs: 1_000, startedAt: '2026-09-01T10:00:01.000Z', finishedAt: '2026-09-01T10:00:02.000Z',
        events: [
            { runId, type: 'step.succeeded', timestamp: '2026-09-01T10:00:01.100Z',
                skill: { id: skillId, version: '1.0.0' }, stepId: 'travel', operation: 'walk-to',
                data: { destination: { x: resource.x, z: resource.z, tolerance: 3 } } },
            { runId, type: 'step.succeeded', timestamp: '2026-09-01T10:00:01.500Z',
                skill: { id: skillId, version: '1.0.0' }, stepId: 'gather', operation: 'gather-loc',
                data: { target: { kind: username === 'agent-a' ? 'loc' : 'npc', name: resource.target },
                    inventoryDelta: [{ id: resource.id, name: resource.name, count: 1, delta: 1 }] } },
            ...(username === 'agent-a' ? [{ runId, type: 'step.succeeded' as const,
                timestamp: '2026-09-01T10:00:01.800Z', skill: { id: skillId, version: '1.0.0' },
                stepId: 'sell', operation: 'sell-to-shop' as const, data: { amountSold: 1,
                    inventoryDelta: [{ id: resource.id, name: resource.name, count: 0, delta: -1 },
                        { id: 995, name: 'Coins', count: 10, delta: 10 }] } }] : [])
        ] };
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
    expect(html).toContain('id="multi-agent-comparison-form"');
    expect(script).toContain('/api/admin/multi-agent-experiments');
    expect(script).toContain('input[name="experimentAgentId"]:checked');
    expect(script).toContain('metrics.economicEventSummary.producedItems');
    expect(script).toContain('metrics.skillConcentration');
    expect(script).toContain('metrics?.participantResults');
    expect(script).toContain('metrics.uniqueTargets');
    expect(script).toContain('metrics.actualGoalChanges');
    expect(script).toContain('goal.outcome');
    expect(script).toContain('result.skillEvidenceRegions');
    expect(script).toContain('metrics.activityTimeline');
    expect(script).toContain('/api/admin/multi-agent-experiments/compare');
    expect(html).toContain('id="skill-draft-list"');
    expect(script).toContain('/api/admin/skill-drafts');
    expect(script).toContain('data-action="skill-draft-run"');
});

describe('persistent multi-agent experiment runner', () => {
    test('dispatches isolated agents concurrently and persists auditable shared-world snapshots', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-multi-agent-experiment-'));
        directories.push(root);
        const store = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        let active = 0;
        let maximumActive = 0;
        const selectionSeeds = new Set<string | undefined>();
        const runIds = new Map([['agent-a', '11111111-1111-4111-8111-111111111111'],
            ['agent-b', '22222222-2222-4222-8222-222222222222']]);
        const coordinator = new AgentReplanCoordinator({
            resolveAgentId: async () => null,
            listAgentIds: async () => [],
            plan: async (agentId, event) => {
                selectionSeeds.add(event.selectionSeed);
                active++;
                maximumActive = Math.max(maximumActive, active);
                await Bun.sleep(15);
                active--;
                return { runId: runIds.get(agentId)!, status: 'executing',
                    decision: { kind: 'execute-skill', agentId, goalId: `${agentId}.earn` },
                    reason: `Accepted ${event.sourceKey}` };
            },
            append: () => undefined
        });
        let snapshotCalls = 0;
        let goalSnapshotCalls = 0;
        const started = await startMultiAgentExperiment({ label: 'Copper cohort', seed: 'world-42',
            summary: 'Start one bounded mining cycle for each agent.', agentIds: ['agent-a', 'agent-b'] }, {
            coordinator, store,
            listCandidates: async () => [candidate('agent-a'), candidate('agent-b')],
            worldModEnvironment: async () => experimentEnvironment(),
            goalSnapshots: async ids => goalSnapshots(ids, goalSnapshotCalls++ === 0 ? undefined : 'agent-a'),
            economySnapshot: async () => economy(`2026-09-01T10:00:0${snapshotCalls}.000Z`, 100 + snapshotCalls++ * 10)
        }, '2026-09-01T10:00:00.000Z');

        expect(started.run.status).toBe('running');
        expect(started.run.environment.mods.find(mod => mod.id === 'economy.diminishing-xp')?.enabled).toBeFalse();
        expect(started.run.environmentDigest).toHaveLength(64);
        expect(started.run.participants.every(item => item.status === 'pending')).toBeTrue();
        const dispatched = await started.completion;
        expect(maximumActive).toBe(2);
        expect(selectionSeeds).toEqual(new Set(['world-42']));
        expect(dispatched.status).toBe('running');
        expect(dispatched.baselineEconomy.totalCoins).toBe(100);
        expect(dispatched.dispatchEconomy?.totalCoins).toBe(110);
        expect(dispatched.finalEconomy).toBeNull();
        expect(dispatched.participants.map(item => item.agentId).sort()).toEqual(['agent-a', 'agent-b']);
        expect(dispatched.participants.every(item => item.status === 'executing' && item.record?.gate.accepted)).toBeTrue();
        expect(store.recordWorldObservation('agent-a', { x: 3264, z: 3400, level: 0 },
            '2026-09-01T10:01:01.500Z')).toBe(1);
        expect(store.recordWorldObservation('agent-a', { x: 3265, z: 3401, level: 0 },
            '2026-09-01T10:01:01.600Z')).toBe(0);
        expect(store.recordWorldObservation('unrelated', { x: 3200, z: 3400, level: 0 },
            '2026-09-01T10:00:01.700Z')).toBe(0);

        const dependencies = { store,
            goalSnapshots: async (ids: readonly string[]) => goalSnapshots(ids, 'agent-a'),
            economySnapshot: async () => economy(`2026-09-01T10:00:0${snapshotCalls}.000Z`, 100 + snapshotCalls++ * 10) };
        const first = await reconcileMultiAgentExperimentSkillRun(runIds.get('agent-a')!,
            skillRun(runIds.get('agent-a')!, 'agent-a'), true, 'Process completed.', dependencies,
            '2026-09-01T10:00:02.000Z');
        expect(first?.status).toBe('running');
        expect(snapshotCalls).toBe(2);
        const completed = await reconcileMultiAgentExperimentSkillRun(runIds.get('agent-b')!,
            skillRun(runIds.get('agent-b')!, 'agent-b'), true, 'Process completed.', dependencies,
            '2026-09-01T10:01:03.000Z');
        expect(completed?.status).toBe('completed');
        expect(completed?.finalEconomy?.totalCoins).toBe(120);
        expect(completed?.metrics).toMatchObject({ totalCoinsDelta: 20, totalXpDelta: 0,
            completedParticipants: 2, unsuccessfulParticipants: 0, durationMs: 63_000,
            economicEvents: 3, economicEventSummary: { producedItems: 2, shopTransactions: 1, netCoins: 10 },
            grossIncomeGp: 10, grossSpendingGp: 0,
            marketPrices: [{ side: 'sell', itemId: 436, itemName: 'Copper ore', quantity: 1,
                totalCoins: 10, weightedAverageUnitPrice: 10, transactions: 1 }],
            uniqueSkills: 2, skillConcentration: 0.5,
            skillRuns: [{ skillId: 'test.fish-lobster', runs: 1 }, { skillId: 'test.mine-copper', runs: 1 }],
            uniqueTargets: 2, uniqueRegions: 3, goalLinkedRuns: 2, successfulGoalRuns: 2,
            actualGoalChanges: 1, actualGoalsCompleted: 1,
            activityTimeline: [{ minute: 0, startedAt: '2026-09-01T10:00:00.000Z',
                endedAt: '2026-09-01T10:01:00.000Z', evidenceAgentIds: ['agent-a', 'agent-b'],
                economicEvents: 3, grossIncomeGp: 10, grossSpendingGp: 0,
                producedItems: 2, consumedItems: 0, newRegions: 2 },
            { minute: 1, startedAt: '2026-09-01T10:01:00.000Z', endedAt: '2026-09-01T10:01:03.000Z',
                evidenceAgentIds: ['agent-a'], economicEvents: 0, grossIncomeGp: 0, grossSpendingGp: 0,
                producedItems: 0, consumedItems: 0, newRegions: 1 }],
            participantResults: expect.arrayContaining([
                expect.objectContaining({ agentId: 'agent-a', goalId: 'agent-a.earn', netCoins: 10,
                    grossIncomeGp: 10, grossSpendingGp: 0,
                    producedItems: 1, shopTransactions: 1, targets: ['loc:copper rocks'],
                    regions: ['0:50,53', '0:51,53'], skillEvidenceRegions: ['50,53'],
                    activityTimeline: [expect.objectContaining({ minute: 0, economicEvents: 2,
                        grossIncomeGp: 10, producedItems: 1, newRegions: 1 }),
                    expect.objectContaining({ minute: 1, economicEvents: 0, newRegions: 1 })],
                    goalProgress: expect.objectContaining({ outcome: 'completed', changed: true,
                        completedDuringExperiment: true }) }),
                expect.objectContaining({ agentId: 'agent-b', goalId: 'agent-b.earn', netCoins: 0,
                    producedItems: 1, targets: ['npc:fishing spot'], regions: ['0:45,49'],
                    skillEvidenceRegions: ['45,49'],
                    activityTimeline: [expect.objectContaining({ minute: 0, economicEvents: 1,
                        grossIncomeGp: 0, producedItems: 1, newRegions: 1 })],
                    goalProgress: expect.objectContaining({ outcome: 'unchanged', changed: false,
                        completedDuringExperiment: false }) })
            ]) });
        expect(completed?.participants.find(item => item.agentId === 'agent-a')).toMatchObject({
            baselineGoals: [{ goalId: 'agent-a.earn', status: 'active', revision: 1 }],
            finalGoals: [{ goalId: 'agent-a.earn', status: 'completed', revision: 2 }]
        });
        expect(completed?.participants.every(item => item.status === 'completed' && item.skillRun)).toBeTrue();
        const treatment = JSON.parse(JSON.stringify(completed)) as NonNullable<typeof completed>;
        treatment.experimentId = 'treatment-run';
        treatment.environment = experimentEnvironment(true);
        treatment.metrics!.totalXpDelta = 125;
        const comparison = compareMultiAgentExperiments(completed!, treatment);
        expect(comparison).toMatchObject({ controlExperimentId: completed!.experimentId,
            treatmentExperimentId: 'treatment-run', seed: 'world-42',
            environmentDifference: { modId: 'economy.diminishing-xp', controlEnabled: false, treatmentEnabled: true },
            treatmentMinusControl: { totalXpDelta: 125 } });
        const tamperedBaseline = JSON.parse(JSON.stringify(treatment)) as NonNullable<typeof completed>;
        tamperedBaseline.participants[0]!.baselineAvatarDigest = 'different';
        expect(() => compareMultiAgentExperiments(completed!, tamperedBaseline)).toThrow('digest is invalid');
        const changedBaseline = JSON.parse(JSON.stringify(treatment)) as NonNullable<typeof completed>;
        changedBaseline.participants[0]!.baselineAvatar!.inventory[0]!.count++;
        changedBaseline.participants[0]!.baselineAvatarDigest = createHash('sha256')
            .update(JSON.stringify({ schemaVersion: 1, ...changedBaseline.participants[0]!.baselineAvatar }))
            .digest('hex');
        expect(() => compareMultiAgentExperiments(completed!, changedBaseline)).toThrow('identical avatar baselines');
        treatment.environment.mods[1]!.config.welcomeMessage = 'Falador';
        expect(() => compareMultiAgentExperiments(completed!, treatment)).toThrow('differ only');
        const replay = await reconcileMultiAgentExperimentSkillRun(runIds.get('agent-b')!,
            skillRun(runIds.get('agent-b')!, 'agent-b'), true, 'Duplicate process event.', dependencies,
            '2026-09-01T10:01:04.000Z');
        expect(replay).toEqual(completed);
        expect(snapshotCalls).toBe(3);
        store.close();

        const reopened = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        expect(reopened.get(completed!.experimentId)).toEqual(completed);
        reopened.close();
    });

    test('fails closed when a successful process has no valid skill journal', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-multi-agent-no-journal-'));
        directories.push(root);
        const store = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        const runIds = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
        let index = 0;
        const coordinator = new AgentReplanCoordinator({ resolveAgentId: async () => null,
            listAgentIds: async () => [], plan: async () => ({ runId: runIds[index++]!, status: 'executing', reason: 'Started.' }),
            append: () => undefined });
        const dependencies = { coordinator, store,
            listCandidates: async () => [candidate('agent-a'), candidate('agent-b')],
            worldModEnvironment: async () => experimentEnvironment(),
            goalSnapshots: async (ids: readonly string[]) => goalSnapshots(ids),
            economySnapshot: async () => economy('2026-09-01T10:00:00.000Z', 100) };
        const started = await startMultiAgentExperiment({ label: 'Journal check', seed: 'seed',
            summary: 'Require authoritative journals.', agentIds: ['agent-a', 'agent-b'] }, dependencies);
        const dispatched = await started.completion;
        for (const id of runIds) await reconcileMultiAgentExperimentSkillRun(id, null, true,
            'Process exited with code 0 but journal is absent.', dependencies);
        const completed = store.get(dispatched.experimentId)!;
        expect(completed.status).toBe('completed-with-errors');
        expect(completed.metrics?.unsuccessfulParticipants).toBe(2);
        expect(completed.participants.every(item => item.status === 'failed' && item.skillRun === null)).toBeTrue();
        store.close();
    });

    test('fails preflight before persistence for shared avatars, offline agents, or institutions', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-multi-agent-preflight-'));
        directories.push(root);
        const store = new MultiAgentExperimentStore(join(root, 'experiments.sqlite'));
        const coordinator = new AgentReplanCoordinator({ resolveAgentId: async () => null,
            listAgentIds: async () => [], plan: async () => ({ runId: 'never', status: 'skipped', reason: 'never' }),
            append: () => undefined });
        const dependencies = { coordinator, store,
            worldModEnvironment: async () => experimentEnvironment(),
            goalSnapshots: async (ids: readonly string[]) => goalSnapshots(ids),
            economySnapshot: async () => economy('2026-09-01T10:00:00.000Z', 0) };
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Duplicate avatar test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies,
            listCandidates: async () => [candidate('agent-a', 'same-player'), candidate('agent-b', 'same-player')] }))
            .rejects.toThrow('cannot share avatar');
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Offline test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies, listCandidates: async () => [
            candidate('agent-a'), { ...candidate('agent-b'), onlineFresh: false }] }))
            .rejects.toThrow('fresh online');
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Position test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies, listCandidates: async () => [
            candidate('agent-a'), { ...candidate('agent-b'), avatarBaseline: null }] }))
            .rejects.toThrow('avatar baseline');
        await expect(startMultiAgentExperiment({ label: 'Invalid', seed: 'seed', summary: 'Institution test.',
            agentIds: ['agent-a', 'agent-b'] }, { ...dependencies, listCandidates: async () => [
            candidate('agent-a'), { ...candidate('agent-b'), role: 'institution', subjectKind: 'business',
                identityPlayerUsername: null, avatarPlayerUsername: null }] }))
            .rejects.toThrow('exact player-avatar');
        expect(store.list()).toHaveLength(0);
        store.close();
    });
});
