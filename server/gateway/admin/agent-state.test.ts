import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    approveAdminPlayerActionRequest,
    createAdminAgent,
    createAdminAgentCommitment,
    createAdminAgentEpisode,
    createAdminAgentGoal,
    createAdminAgentKnowledge,
    createAdminPlayerActionRequest,
    finishAdminPlayerActionRun,
    listAdminAgents,
    pruneAdminAgentEpisodes,
    reconcileAdminPlayerActionRun,
    startAdminPlayerActionRequest,
    updateAdminAgent,
    updateAdminAgentCommitmentStatus,
    updateAdminAgentGoalStatus,
    updateAdminAgentRelationship,
    updateAdminPlayerActionRequest,
    updateAdminAgentSkill
} from './agent-state';
import { AgentStateStore } from '../../../agent-state/store';
import type { BotCatalogEntry } from './types';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-admin-agent-state-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('admin agent-state service', () => {
    test('exposes the institution work queue to both bounded agent views', async () => {
        const path = databasePath();
        createAdminAgent({ agentId: 'forge', displayName: 'Forge', background: 'Workshop.',
            personalityTraits: ['prudent'], controlProfile: { role: 'institution', subjectKind: 'business',
                subjectId: 'forge', decisionIntervalMs: 60_000, maxDecisionsPerDay: 24,
                dailyLlmBudgetMicros: 100_000, dailyOperationalBudgetGp: 10_000 } }, path);
        createAdminAgent({ agentId: 'worker', playerUsername: 'Worker', displayName: 'Worker',
            background: 'Miner.', personalityTraits: ['reliable'] }, path);
        updateAdminAgentSkill('worker', { id: 'varrock-east-mining', version: '1.0.0' }, 'known', null, path);
        const request = createAdminPlayerActionRequest('forge', { requestId: 'forge.iron-job',
            assigneeAgentId: 'worker', skill: { id: 'varrock-east-mining', version: '1.0.0' },
            parameters: {}, objective: 'Bank one load of iron.', rewardGp: 500 }, path);
        const initial = await listAdminAgents(path);
        expect(initial.agents.find(agent => agent.identity.agentId === 'forge')?.outgoingPlayerActions)
            .toEqual([expect.objectContaining({ requestId: request.requestId, status: 'pending' })]);
        const worker = initial.agents.find(agent => agent.identity.agentId === 'worker')!;
        expect(worker.incomingPlayerActions).toEqual([expect.objectContaining({ requesterAgentId: 'forge' })]);
        expect(worker.decisionContext).toContain('Player action queue:');
        expect(worker.decisionContext).toContain('forge.iron-job');
        const accepted = updateAdminPlayerActionRequest(request.requestId, 'worker', request.revision,
            'accepted', 'Accepted.', path);
        const approvalId = '11111111-1111-4111-8111-111111111111';
        const runId = '22222222-2222-4222-8222-222222222222';
        const approved = approveAdminPlayerActionRequest(request.requestId, 'worker', accepted.revision,
            approvalId, new Date(Date.now() + 60_000).toISOString(), path);
        const running = startAdminPlayerActionRequest(request.requestId, 'worker', approved.revision,
            approvalId, runId, path);
        expect(running).toMatchObject({ status: 'running', runId });
        const timestamp = new Date().toISOString();
        writeFileSync(join(dirname(path), `${runId}.json`), JSON.stringify({
            runId, username: 'worker', skill: { id: 'varrock-east-mining', version: '1.0.0' },
            status: 'completed', reason: 'completed', message: 'One load banked.', operations: 4,
            durationMs: 2_000, events: [
                { runId, type: 'skill.started', timestamp,
                    skill: { id: 'varrock-east-mining', version: '1.0.0' } },
                { runId, type: 'skill.completed', timestamp,
                    skill: { id: 'varrock-east-mining', version: '1.0.0' } }
            ]
        }));
        expect(await reconcileAdminPlayerActionRun(runId, false, 'Fallback failure.', path, dirname(path)))
            .toMatchObject({ status: 'completed', runId,
                responseNote: expect.stringContaining('One load banked.') });
    });

    test('builds a complete editable snapshot and executable planner preview', async () => {
        const path = databasePath();
        const identity = createAdminAgent({
            agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Varrock bányásza.', personalityTraits: ['türelmes'], values: ['önállóság']
        }, path);
        const catalog = await listAdminAgents(path);
        const skill = catalog.skills[0];
        expect(skill).toBeDefined();

        const life = createAdminAgentGoal('ferrye14', {
            goalId: 'ferrye.life', horizon: 'life', title: 'Önálló élet'
        }, path);
        const long = createAdminAgentGoal('ferrye14', {
            goalId: 'ferrye.trade', parentGoalId: life.goalId, horizon: 'long-term', title: 'Saját vállalkozás'
        }, path);
        const current = createAdminAgentGoal('ferrye14', {
            goalId: 'ferrye.capital', parentGoalId: long.goalId, horizon: 'current', title: 'Tőkegyűjtés'
        }, path);
        createAdminAgentGoal('ferrye14', {
            goalId: 'ferrye.work', parentGoalId: current.goalId, horizon: 'immediate', title: 'Dolgozz',
            priority: 80, skill: { id: skill!.id, version: skill!.version }
        }, path);
        updateAdminAgentSkill('ferrye14', { id: skill!.id, version: skill!.version }, 'preferred', null, path);
        updateAdminAgent('ferrye14', identity.revision, { displayName: 'Ferrye, a bányász' }, path);
        const memory = createAdminAgentEpisode('ferrye14', {
            episodeId: 'ferrye.iron-memory', kind: 'discovery', summary: 'A varrocki vasérc közel van a bankhoz.',
            importance: 80, goalIds: ['ferrye.work'], tags: ['mining', 'varrock'], actors: [],
            source: 'manual', occurredAt: new Date().toISOString()
        }, path);
        createAdminAgentKnowledge('ferrye14', {
            knowledgeId: 'ferrye.bank-route', kind: 'route', subject: 'Varrock east iron mine',
            predicate: 'nearest-bank', object: 'Varrock east bank',
            summary: 'A varrocki keleti bank a legközelebbi ismert bank.', confidence: 85,
            goalIds: ['ferrye.work'], tags: ['mining', 'varrock'], evidenceEpisodeIds: [memory.episodeId],
            source: 'manual', validFrom: new Date().toISOString()
        }, path);
        updateAdminAgentRelationship('ferrye14', null, { actorKey: 'Horvik', displayName: 'Horvik',
            trust: 55, affinity: 20, familiarity: 65, agentOwesGp: 32_000, actorOwesGp: 0,
            notes: 'Megbízható varrocki kovács.', tags: ['merchant'], evidenceEpisodeIds: [memory.episodeId],
            lastInteractionAt: new Date().toISOString() }, path);
        createAdminAgentCommitment('ferrye14', { commitmentId: 'ferrye.repay-horvik', actorKey: 'Horvik',
            direction: 'owed-by-agent', description: 'Fizesse vissza a rune pickaxe árát.', valueGp: 32_000,
            evidenceEpisodeIds: [memory.episodeId] }, path);
        const store = new AgentStateStore(path);
        store.setWorkingMemory('ferrye14', null, {
            summary: 'Ferrye készen áll a következő feladatra.', currentActivity: 'Idle',
            location: { x: 3253, z: 3421, level: 0 }, observations: ['A bot online.'],
            observedAt: new Date().toISOString()
        });
        store.close();

        const result = await listAdminAgents(path, {
            observedAt: '2026-08-29T12:00:00.000Z',
            bots: [{ username: 'ferrye14', coins: 68_000, status: 'active',
                lastActivityAt: '2026-08-29T11:59:59.000Z', saveSavedAt: null } as BotCatalogEntry],
            properties: [{ propertyId: 'varrock.east-workshop', displayName: 'Varrock East Workshop',
                description: 'Workshop', type: 'workshop', location: { x: 3253, z: 3421, level: 0, region: 'Varrock' },
                purchasePrice: 25_000, state: { status: 'owned', owner: { kind: 'player', id: 'ferrye14' },
                    acquiredAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z', version: 2 } }]
        });
        expect(result.agents).toHaveLength(1);
        expect(result.agents[0]?.identity.displayName).toBe('Ferrye, a bányász');
        expect(result.agents[0]?.controlProfile).toMatchObject({ role: 'player', subjectKind: 'player',
            subjectId: 'ferrye14', avatarPlayerUsername: 'ferrye14' });
        expect(result.agents[0]?.goals).toHaveLength(4);
        expect(result.agents[0]?.knownSkills[0]?.status).toBe('preferred');
        expect(result.agents[0]?.skillRelationships.find(entry => entry.reference.id === skill!.id)).toMatchObject({
            exists: true, access: 'accessible', knowledge: 'preferred', executable: true
        });
        expect(result.agents[0]?.skillRelationships.some(entry => entry.knowledge === 'unlearned')).toBeTrue();
        expect(result.agents[0]?.episodeCount).toBe(1);
        expect(result.agents[0]?.relevantEpisodes[0]?.episode.episodeId).toBe('ferrye.iron-memory');
        expect(result.agents[0]?.knowledgeCount).toBe(1);
        expect(result.agents[0]?.relevantKnowledge[0]?.knowledge.knowledgeId).toBe('ferrye.bank-route');
        expect(result.agents[0]?.relationships[0]?.relationship.actorKey).toBe('horvik');
        expect(result.agents[0]?.relevantRelationships[0]?.commitments[0]?.commitmentId).toBe('ferrye.repay-horvik');
        expect(result.agents[0]?.assets.money?.balanceGp).toBe(68_000);
        expect(result.agents[0]?.assets.properties[0]?.propertyId).toBe('varrock.east-workshop');
        expect(result.agents[0]?.planner).toMatchObject({
            kind: 'execute-skill', skill: { id: skill!.id, version: skill!.version }
        });
        expect(result.agents[0]?.decisionContext).toContain('Ferrye, a bányász');
        expect(result.agents[0]?.decisionContext).toContain('Control role: player');
        expect(result.agents[0]?.decisionContext).toContain('A varrocki vasérc');
        expect(result.agents[0]?.decisionContext).toContain('legközelebbi ismert bank');
        expect(result.agents[0]?.decisionContext).toContain('Fizesse vissza a rune pickaxe');
        expect(result.agents[0]?.decisionContext).toContain('Varrock East Workshop');
    });

    test('enforces agent ownership and optimistic revisions through the admin boundary', () => {
        const path = databasePath();
        const identity = createAdminAgent({
            agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Varrock bányásza.', personalityTraits: ['türelmes']
        }, path);
        const goal = createAdminAgentGoal('ferrye14', {
            goalId: 'ferrye.life', horizon: 'life', title: 'Önálló élet'
        }, path);

        expect(() => updateAdminAgent('ferrye14', identity.revision + 1, { displayName: 'Elavult írás' }, path))
            .toThrow('changed before update');
        expect(() => updateAdminAgentGoalStatus('other', goal.goalId, goal.revision, 'completed', path))
            .toThrow('nem ehhez az agenthez');
        expect(updateAdminAgentGoalStatus('ferrye14', goal.goalId, goal.revision, 'completed', path).status)
            .toBe('completed');
        updateAdminAgentRelationship('ferrye14', null, { actorKey: 'Horvik', displayName: 'Horvik' }, path);
        const commitment = createAdminAgentCommitment('ferrye14', { commitmentId: 'promise.test', actorKey: 'Horvik',
            direction: 'owed-to-agent', description: 'Deliver ore.' }, path);
        expect(() => updateAdminAgentCommitmentStatus('other', commitment.commitmentId, commitment.revision,
            'fulfilled', path)).toThrow('nem ehhez az agenthez');
        expect(updateAdminAgentCommitmentStatus('ferrye14', commitment.commitmentId, commitment.revision,
            'fulfilled', path).status).toBe('fulfilled');
    });

    test('exposes retention preview and prunes only eligible expired memories', async () => {
        const path = databasePath();
        createAdminAgent({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'Retention test agent.', personalityTraits: ['careful'] }, path);
        createAdminAgentEpisode('ferrye14', { episodeId: 'expired.admin', kind: 'observation',
            summary: 'Temporary admin observation.', source: 'manual', occurredAt: '2026-08-20T10:00:00.000Z',
            expiresAt: '2026-08-21T10:00:00.000Z' }, path);

        const before = await listAdminAgents(path);
        expect(before.agents[0]?.retention).toMatchObject({ expiredCount: 1, eligibleCount: 1, protectedCount: 0 });
        const result = pruneAdminAgentEpisodes('ferrye14', path, '2026-08-30T10:00:00.000Z');
        expect(result.deletedEpisodeIds).toEqual(['expired.admin']);
        const after = await listAdminAgents(path);
        expect(after.agents[0]?.retention.expiredCount).toBe(0);
    });
});
