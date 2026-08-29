import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createAdminAgent,
    createAdminAgentEpisode,
    createAdminAgentGoal,
    createAdminAgentKnowledge,
    listAdminAgents,
    updateAdminAgent,
    updateAdminAgentGoalStatus,
    updateAdminAgentSkill
} from './agent-state';
import { AgentStateStore } from '../../../agent-state/store';

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
        const store = new AgentStateStore(path);
        store.setWorkingMemory('ferrye14', null, {
            summary: 'Ferrye készen áll a következő feladatra.', currentActivity: 'Idle',
            location: { x: 3253, z: 3421, level: 0 }, observations: ['A bot online.'],
            observedAt: new Date().toISOString()
        });
        store.close();

        const result = await listAdminAgents(path);
        expect(result.agents).toHaveLength(1);
        expect(result.agents[0]?.identity.displayName).toBe('Ferrye, a bányász');
        expect(result.agents[0]?.goals).toHaveLength(4);
        expect(result.agents[0]?.knownSkills[0]?.status).toBe('preferred');
        expect(result.agents[0]?.episodeCount).toBe(1);
        expect(result.agents[0]?.relevantEpisodes[0]?.episode.episodeId).toBe('ferrye.iron-memory');
        expect(result.agents[0]?.knowledgeCount).toBe(1);
        expect(result.agents[0]?.relevantKnowledge[0]?.knowledge.knowledgeId).toBe('ferrye.bank-route');
        expect(result.agents[0]?.planner).toMatchObject({
            kind: 'execute-skill', skill: { id: skill!.id, version: skill!.version }
        });
        expect(result.agents[0]?.decisionContext).toContain('Ferrye, a bányász');
        expect(result.agents[0]?.decisionContext).toContain('A varrocki vasérc');
        expect(result.agents[0]?.decisionContext).toContain('legközelebbi ismert bank');
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
    });
});
