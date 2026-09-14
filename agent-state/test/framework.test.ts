import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { AgentStateStore, AgentStateValidationError, buildCoreIdentity, buildDecisionContext,
    planNextAction } from '../index.js';
import { SimulationClockStore } from '../../simulation-clock/index.js';

const directories: string[] = [];

function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-state-'));
    directories.push(directory);
    return join(directory, 'agents.sqlite');
}

function addIdentity(store: AgentStateStore) {
    return store.createIdentity({
        agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye the Prospector',
        background: 'A patient Varrock miner who wants to build a durable livelihood.',
        personalityTraits: ['patient', 'curious', 'frugal'], values: ['independence', 'craftsmanship']
    }, '2026-08-29T10:00:00.000Z');
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('persistent agent identity and goals', () => {
    test('survives reopening with the complete four-level goal hierarchy', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        const identity = addIdentity(store);
        expect(identity.playerUsername).toBe('ferrye14');
        store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Become economically independent' });
        store.createGoal('ferrye14', { goalId: 'ferrye.workshop', parentGoalId: 'ferrye.life', horizon: 'long-term', title: 'Own a productive workshop' });
        store.createGoal('ferrye14', { goalId: 'ferrye.capital', parentGoalId: 'ferrye.workshop', horizon: 'current', title: 'Accumulate starting capital' });
        store.createGoal('ferrye14', { goalId: 'ferrye.mine', parentGoalId: 'ferrye.capital', horizon: 'immediate', title: 'Mine and bank iron ore', priority: 80 });
        store.close();

        store = new AgentStateStore(path);
        const snapshot = store.getSnapshot('ferrye14');
        expect(snapshot?.identity.background).toContain('Varrock miner');
        expect(snapshot?.goals.map(goal => goal.horizon)).toEqual(['life', 'long-term', 'current', 'immediate']);
        expect(snapshot?.goals.every(goal => goal.revision === 1)).toBe(true);
        store.close();
    });

    test('rejects invalid hierarchy, duplicate active life goals and stale writes', () => {
        const store = new AgentStateStore(databasePath());
        const identity = addIdentity(store);
        expect(() => store.createGoal('ferrye14', { goalId: 'orphan', horizon: 'current', title: 'Orphan' }))
            .toThrow('current goals require a parent');
        store.createGoal('ferrye14', { goalId: 'life.one', horizon: 'life', title: 'First life goal' });
        expect(() => store.createGoal('ferrye14', { goalId: 'life.two', horizon: 'life', title: 'Second life goal' })).toThrow();
        store.updateIdentity('ferrye14', identity.revision, { displayName: 'Ferrye' });
        expect(() => store.updateIdentity('ferrye14', identity.revision, { displayName: 'Stale Ferrye' }))
            .toThrow('changed before update');
        store.close();
    });

    test('enforces parent ownership and exact horizon ordering', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createIdentity({ agentId: 'other', playerUsername: 'Other', displayName: 'Other',
            background: 'Another test agent.', personalityTraits: ['careful'] });
        store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Ferrye life' });
        expect(() => store.createGoal('other', { goalId: 'other.long', parentGoalId: 'ferrye.life',
            horizon: 'long-term', title: 'Wrong owner' })).toThrow('same agent');
        expect(() => store.createGoal('ferrye14', { goalId: 'ferrye.now', parentGoalId: 'ferrye.life',
            horizon: 'immediate', title: 'Skipped levels' })).toThrow('current goal');
        store.close();
    });

    test('does not end a parent while it has active children', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        const life = store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Life' },
            '2026-09-05T10:00:00.000Z');
        const long = store.createGoal('ferrye14', { goalId: 'ferrye.long', parentGoalId: life.goalId,
            horizon: 'long-term', title: 'Long term' }, '2026-09-05T10:01:00.000Z');
        expect(() => store.setGoalStatus(life.goalId, life.revision, 'completed')).toThrow('active child');
        expect(store.setGoalStatus(long.goalId, long.revision, 'completed',
            '2026-09-05T10:02:00.000Z').completedAt).not.toBeNull();
        expect(store.setGoalStatus(life.goalId, life.revision, 'completed',
            '2026-09-05T10:03:00.000Z').status).toBe('completed');
        expect(store.listGoalEvents('ferrye14')).toEqual([
            expect.objectContaining({ sequence: 1, goalId: 'ferrye.life', kind: 'created',
                previousStatus: null, status: 'active', previousRevision: null, revision: 1,
                occurredAt: '2026-09-05T10:00:00.000Z' }),
            expect.objectContaining({ sequence: 2, goalId: 'ferrye.long', kind: 'created',
                previousStatus: null, status: 'active', previousRevision: null, revision: 1,
                occurredAt: '2026-09-05T10:01:00.000Z' }),
            expect.objectContaining({ sequence: 3, goalId: 'ferrye.long', kind: 'status-changed',
                previousStatus: 'active', status: 'completed', previousRevision: 1, revision: 2,
                occurredAt: '2026-09-05T10:02:00.000Z' }),
            expect.objectContaining({ sequence: 4, goalId: 'ferrye.life', kind: 'status-changed',
                previousStatus: 'active', status: 'completed', previousRevision: 1, revision: 2,
                occurredAt: '2026-09-05T10:03:00.000Z' })
        ]);
        expect(store.listGoalEvents('ferrye14', '2026-09-05T10:01:30.000Z',
            '2026-09-05T10:02:30.000Z')).toHaveLength(1);
        store.close();
    });

    test('backfills and persists goal events on the shared simulation timeline', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        addIdentity(store);
        const goal = store.createGoal('ferrye14', { goalId: 'timeline.life', horizon: 'life',
            title: 'Build a durable life' }, '2026-09-05T10:01:00.000Z');
        expect(store.listGoalEvents('ferrye14')[0]?.simulationStamp).toBeNull();
        store.close();

        const clock = new SimulationClockStore(join(dirname(path), 'simulation.sqlite'));
        clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'normal', version: '1.0.0',
            seed: 'agent-goal-test', rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } },
        wallTime: '2026-09-05T11:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        store = new AgentStateStore(path, { store: clock, clockId: 'world', engineTick: () => 90 });
        const imported = store.listGoalEvents('ferrye14')[0]!;
        expect(imported.occurredAt).toBe('2026-09-05T10:01:00.000Z');
        expect(imported.simulationStamp).toMatchObject({ sequence: 1, engineTick: 90,
            wallTime: '2026-09-05T11:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        store.setGoalStatus(goal.goalId, goal.revision, 'completed', '2026-09-05T11:01:00.000Z');
        const events = store.listGoalEvents('ferrye14');
        expect(events.map(event => event.simulationStamp?.sequence)).toEqual([1, 2]);
        expect(events[1]?.simulationStamp?.simulationTime).toBe('2030-01-01T00:01:00.000Z');
        store.close();

        store = new AgentStateStore(path, { store: clock, clockId: 'world' });
        expect(store.listGoalEvents('ferrye14')).toEqual(events);
        expect(clock.get('world')?.nextEventSequence).toBe(3);
        store.close();
        clock.close();
    });

    test('backfills player-only lifecycle and derives age from simulation time', () => {
        const path = databasePath(); let store = new AgentStateStore(path);
        addIdentity(store);
        store.createIdentity({ agentId: 'varrock-forge', displayName: 'Varrock Forge',
            background: 'Institution without a biological lifecycle.', personalityTraits: ['prudent'],
            controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'varrock-forge',
                decisionIntervalMs: 300_000, maxDecisionsPerDay: 48,
                dailyLlmBudgetMicros: 0, dailyOperationalBudgetGp: 1_000 } });
        expect(store.getCharacterLifecycle('ferrye14')).toBeNull(); store.close();

        const clock = new SimulationClockStore(join(dirname(path), 'lifecycle-clock.sqlite'));
        clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'lifecycle-test',
            version: '1.0.0', seed: 'lifecycle-test',
            rate: { simulationMilliseconds: 2, wallMilliseconds: 1 } },
        wallTime: '2026-09-05T11:00:00.000Z', simulationTime: '2030-01-01T00:00:00.000Z' });
        store = new AgentStateStore(path, { store: clock, clockId: 'world' });
        const imported = store.getCharacterLifecycle('ferrye14')!;
        expect(imported).toMatchObject({ origin: 'imported', birthAtSimulationTime: null,
            createdAtSimulationTime: '2030-01-01T00:00:00.000Z', currentAgeSimulationMilliseconds: 0,
            status: 'active', revision: 1 });
        expect(store.getCharacterLifecycle('varrock-forge')).toBeNull();
        store.createIdentity({ agentId: 'new-player', playerUsername: 'Newplayer', displayName: 'New Player',
            background: 'Created after the simulation clock was available.', personalityTraits: ['new'] });
        expect(store.getCharacterLifecycle('new-player')).toMatchObject({ origin: 'created',
            createdAtSimulationTime: '2030-01-01T00:00:00.000Z', status: 'active' });
        const born = store.setCharacterBirth('ferrye14', imported.revision,
            '2020-01-01T00:00:00.000Z', 'born', '2026-09-05T11:00:10.000Z');
        expect(born).toMatchObject({ origin: 'born', birthAtSimulationTime: '2020-01-01T00:00:00.000Z',
            ageObservedAtSimulationTime: '2030-01-01T00:00:20.000Z', revision: 2 });
        const ageBefore = born.currentAgeSimulationMilliseconds;
        clock.observe('world', '2026-09-05T11:00:20.000Z');
        expect(store.getCharacterLifecycle('ferrye14')?.currentAgeSimulationMilliseconds)
            .toBe(ageBefore + 20_000);
        const observed = store.observeCharacterAge('ferrye14', born.revision,
            '2026-09-05T11:00:20.000Z');
        expect(observed).toMatchObject({ ageObservedAtSimulationTime: '2030-01-01T00:00:40.000Z',
            currentAgeSimulationMilliseconds: ageBefore + 20_000, revision: 3 });
        expect(() => store.setCharacterBirth('ferrye14', observed.revision,
            '2019-01-01T00:00:00.000Z')).toThrow('immutable');
        store.close(); clock.close();
    });

    test('persists an immutable LLM proposal and atomically consumes its one-use skill approval', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        const anchor = store.createGoal('ferrye14', { goalId: 'workshop', parentGoalId: 'life',
            horizon: 'long-term', title: 'Own a workshop' });
        store.setSkillKnowledge('ferrye14', { id: 'mining', version: '1.0.0' }, 'known', null);
        const proposal = store.createGoalProposal('ferrye14', { proposalId: 'proposal.one', runId: 'run.one',
            anchorGoalId: anchor.goalId, anchorGoalRevision: anchor.revision, reason: 'Build capital safely.',
            goals: [
                { goalId: 'capital', parentGoalId: 'workshop', horizon: 'current', title: 'Build capital' },
                { goalId: 'mine', parentGoalId: 'capital', horizon: 'immediate', title: 'Mine ore' }
            ], skill: { id: 'mining', version: '1.0.0' } }, '2026-08-31T10:00:00.000Z');
        expect(store.listGoalProposals('ferrye14')).toEqual([proposal]);
        const approved = store.approveGoalProposal(proposal.proposalId, proposal.revision, 'approval.one',
            '2026-08-31T10:05:00.000Z', '2026-08-31T10:01:00.000Z');
        expect(store.getGoal('mine')?.skill).toEqual({ id: 'mining', version: '1.0.0' });
        const running = store.startApprovedGoalProposal(proposal.proposalId, approved.revision,
            'approval.one', 'skill-run.one', '2026-08-31T10:02:00.000Z');
        expect(running).toMatchObject({ status: 'running', skillRunId: 'skill-run.one' });
        expect(() => store.startApprovedGoalProposal(proposal.proposalId, approved.revision,
            'approval.one', 'skill-run.two', '2026-08-31T10:02:01.000Z')).toThrow('already consumed');
        expect(store.finishGoalProposalRun('skill-run.one', true, 'Skill completed.',
            '2026-08-31T10:03:00.000Z')).toMatchObject({ status: 'completed', responseNote: 'Skill completed.' });
        store.close();
    });

    test('rolls back the complete proposed hierarchy if one goal collides', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        const anchor = store.createGoal('ferrye14', { goalId: 'workshop', parentGoalId: 'life',
            horizon: 'long-term', title: 'Own a workshop' });
        const proposal = store.createGoalProposal('ferrye14', { proposalId: 'proposal.collision',
            runId: 'run.collision', anchorGoalId: anchor.goalId, anchorGoalRevision: anchor.revision,
            reason: 'Test atomicity.', goals: [
                { goalId: 'capital', parentGoalId: 'workshop', horizon: 'current', title: 'Build capital' },
                { goalId: 'mine', parentGoalId: 'capital', horizon: 'immediate', title: 'Mine ore' }
            ] }, '2026-08-31T10:00:00.000Z');
        store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: 'workshop',
            horizon: 'current', title: 'A concurrent goal' });
        expect(() => store.approveGoalProposal(proposal.proposalId, proposal.revision, 'approval.collision',
            '2026-08-31T10:05:00.000Z', '2026-08-31T10:01:00.000Z')).toThrow();
        expect(store.getGoal('mine')).toBeNull();
        expect(store.getGoalProposal(proposal.proposalId)?.status).toBe('pending');
        store.close();
    });
});

describe('core identity context', () => {
    test('is deterministic, priority ordered and bounded', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createGoal('ferrye14', { goalId: 'life.main', horizon: 'life', title: 'Build an independent life' });
        store.createGoal('ferrye14', { goalId: 'long.workshop', parentGoalId: 'life.main', horizon: 'long-term', title: 'Own a workshop' });
        store.createGoal('ferrye14', { goalId: 'current.capital', parentGoalId: 'long.workshop', horizon: 'current', title: 'Save 100,000 coins' });
        store.createGoal('ferrye14', { goalId: 'now.ore', parentGoalId: 'current.capital', horizon: 'immediate', title: 'Bank iron', priority: 90 });
        store.createGoal('ferrye14', { goalId: 'now.food', parentGoalId: 'current.capital', horizon: 'immediate', title: 'Buy food', priority: 40 });
        const snapshot = store.getSnapshot('ferrye14')!;
        const context = buildCoreIdentity(snapshot);
        expect(context.indexOf('Bank iron')).toBeLessThan(context.indexOf('Buy food'));
        expect(buildCoreIdentity(snapshot)).toBe(context);
        const bounded = buildCoreIdentity(snapshot, 240);
        expect(bounded.length).toBeLessThanOrEqual(240);
        expect(bounded).toEndWith('[truncated]');
        store.close();
    });

    test('validates identity fields before persistence', () => {
        const store = new AgentStateStore(databasePath());
        expect(() => store.createIdentity({ agentId: 'Bad ID!', playerUsername: 'Name', displayName: '',
            background: '', personalityTraits: [] })).toThrow(AgentStateValidationError);
        expect(store.listIdentities()).toHaveLength(0);
        store.close();
    });
});

describe('working memory', () => {
    test('migrates a v1 identity database without losing its agent', () => {
        const path = databasePath();
        const legacy = new Database(path, { create: true, strict: true });
        legacy.run(`CREATE TABLE agent_identity (
            agent_id TEXT PRIMARY KEY, player_username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
            background TEXT NOT NULL, personality_traits TEXT NOT NULL, agent_values TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1))`);
        legacy.run(`CREATE TABLE agent_goal (
            goal_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id) ON DELETE RESTRICT,
            parent_goal_id TEXT REFERENCES agent_goal(goal_id) ON DELETE RESTRICT,
            horizon TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
            priority INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            completed_at TEXT, revision INTEGER NOT NULL)`);
        legacy.run(`INSERT INTO agent_identity VALUES
            ('legacy', 'legacy', 'Legacy agent', 'Existing identity', '["careful"]', '[]',
            '2026-08-29T10:00:00.000Z', '2026-08-29T10:00:00.000Z', 1)`);
        legacy.run(`INSERT INTO agent_goal VALUES
            ('legacy.life', 'legacy', NULL, 'life', 'Legacy life goal', '', 'active', 50,
            '2026-08-29T10:00:00.000Z', '2026-08-29T10:00:00.000Z', NULL, 1)`);
        legacy.run('PRAGMA user_version = 1');
        legacy.close(true);

        const store = new AgentStateStore(path);
        expect(store.getIdentity('legacy')?.displayName).toBe('Legacy agent');
        expect(store.listEconomicActorLinks('legacy')).toEqual([expect.objectContaining({
            actorKind: 'player', actorId: 'legacy', role: 'self', source: 'identity'
        })]);
        expect(store.listGoalEvents('legacy')).toEqual([expect.objectContaining({
            goalId: 'legacy.life', kind: 'imported', status: 'active', revision: 1,
            occurredAt: '2026-08-29T10:00:00.000Z'
        })]);
        expect(store.setWorkingMemory('legacy', null, {
            summary: 'Migrated safely', observedAt: '2026-08-29T12:00:00.000Z'
        }).revision).toBe(1);
        store.close();
    });

    test('persists a bounded current situation and protects concurrent updates', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        addIdentity(store);
        const first = store.setWorkingMemory('ferrye14', null, {
            summary: 'Mining east of Varrock with free inventory space.',
            currentActivity: 'mining iron ore',
            location: { x: 3285, z: 3367, level: 0, region: 'Varrock east mine' },
            observations: ['Three iron rocks are reachable', 'Inventory has 12 free slots'],
            observedAt: '2026-08-29T12:00:00.000Z'
        }, '2026-08-29T12:00:01.000Z');
        expect(first.revision).toBe(1);
        store.close();

        store = new AgentStateStore(path);
        expect(store.getSnapshot('ferrye14')?.workingMemory?.location?.x).toBe(3285);
        const second = store.setWorkingMemory('ferrye14', first.revision, {
            summary: 'Inventory is full and the agent is ready to bank.',
            currentActivity: 'walking to bank', observations: ['Inventory is full'],
            observedAt: '2026-08-29T12:02:00.000Z'
        });
        expect(second.revision).toBe(2);
        expect(second.location).toBeNull();
        expect(() => store.setWorkingMemory('ferrye14', first.revision, {
            summary: 'Stale update', observedAt: '2026-08-29T12:03:00.000Z'
        })).toThrow('changed before update');
        store.close();
    });

    test('includes only fresh working memory in the bounded decision context', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.setWorkingMemory('ferrye14', null, {
            summary: 'Standing beside the east Varrock bank.', currentActivity: null,
            location: { x: 3253, z: 3421, level: 0 }, observations: ['Bank door is open'],
            observedAt: '2026-08-29T12:00:00.000Z'
        });
        const snapshot = store.getSnapshot('ferrye14')!;
        const fresh = buildDecisionContext(snapshot, { now: '2026-08-29T12:04:00.000Z' });
        expect(fresh).toContain('Current situation: Standing beside');
        expect(fresh).toContain('Location: 3253,3421,0');
        const stale = buildDecisionContext(snapshot, { now: '2026-08-29T12:06:00.001Z' });
        expect(stale).not.toContain('Current situation:');
        expect(buildDecisionContext(snapshot, { now: '2026-08-29T12:04:00.000Z', maxCharacters: 240 }).length)
            .toBeLessThanOrEqual(240);
        store.close();
    });

    test('rejects invalid coordinates, timestamps and oversized observations', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        expect(() => store.setWorkingMemory('ferrye14', null, {
            summary: 'Invalid location', location: { x: -1, z: 1, level: 8 },
            observations: Array.from({ length: 13 }, (_, index) => `observation ${index}`), observedAt: 'not-a-date'
        })).toThrow(AgentStateValidationError);
        expect(store.getWorkingMemory('ferrye14')).toBeNull();
        store.close();
    });
});

describe('known skills and deterministic planner', () => {
    const miningSkill = { id: 'mining.varrock-east.copper-to-bank', version: '1.0.0' };

    function plannedStore(): AgentStateStore {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        store.createGoal('ferrye14', { goalId: 'life.main', horizon: 'life', title: 'Build an independent life' });
        store.createGoal('ferrye14', { goalId: 'long.workshop', parentGoalId: 'life.main',
            horizon: 'long-term', title: 'Own a workshop' });
        store.createGoal('ferrye14', { goalId: 'current.capital', parentGoalId: 'long.workshop',
            horizon: 'current', title: 'Build capital' });
        store.createGoal('ferrye14', { goalId: 'now.mine', parentGoalId: 'current.capital',
            horizon: 'immediate', title: 'Mine copper', priority: 80, skill: miningSkill });
        store.setWorkingMemory('ferrye14', null, { summary: 'Ready in Varrock.',
            location: { x: 3285, z: 3367, level: 0 }, observedAt: '2026-08-29T12:00:00.000Z' });
        return store;
    }

    test('persists versioned skill knowledge with optimistic updates', () => {
        const path = databasePath();
        let store = new AgentStateStore(path);
        addIdentity(store);
        const learned = store.setSkillKnowledge('ferrye14', miningSkill, 'known', null,
            '2026-08-29T11:00:00.000Z');
        expect(learned.revision).toBe(1);
        expect(() => store.setSkillKnowledge('ferrye14', miningSkill, 'preferred', null)).toThrow('changed before update');
        const preferred = store.setSkillKnowledge('ferrye14', miningSkill, 'preferred', learned.revision);
        expect(preferred.status).toBe('preferred');
        store.close();
        store = new AgentStateStore(path);
        expect(store.listSkillKnowledge('ferrye14')).toEqual([expect.objectContaining({
            skill: miningSkill, status: 'preferred', revision: 2
        })]);
        store.close();
    });

    test('selects the highest-priority immediate goal byte-for-byte deterministically', () => {
        const store = plannedStore();
        store.createGoal('ferrye14', { goalId: 'now.lower', parentGoalId: 'current.capital',
            horizon: 'immediate', title: 'Lower priority task', priority: 20,
            skill: { id: 'shopping.lumbridge.buy-hammers', version: '1.0.0' } });
        store.setSkillKnowledge('ferrye14', miningSkill, 'known', null);
        const snapshot = store.getSnapshot('ferrye14')!;
        const options = { now: '2026-08-29T12:01:00.000Z', availableSkills: [miningSkill] };
        const first = planNextAction(snapshot, options);
        expect(first.kind).toBe('execute-skill');
        expect(first.goalId).toBe('now.mine');
        expect(first.skill).toEqual(miningSkill);
        expect(planNextAction(snapshot, options)).toEqual(first);
        store.close();
    });

    test('uses a bounded seed to spread equal-priority immediate alternatives reproducibly', () => {
        const store = plannedStore();
        const fishingSkill = { id: 'fishing.karamja.lobster-to-draynor-bank', version: '1.0.0' };
        store.createGoal('ferrye14', { goalId: 'now.fish', parentGoalId: 'current.capital',
            horizon: 'immediate', title: 'Fish lobsters', priority: 80, skill: fishingSkill });
        store.setSkillKnowledge('ferrye14', miningSkill, 'known', null);
        store.setSkillKnowledge('ferrye14', fishingSkill, 'known', null);
        const snapshot = store.getSnapshot('ferrye14')!;
        const base = { now: '2026-08-29T12:01:00.000Z', availableSkills: [miningSkill, fishingSkill] };
        const first = planNextAction(snapshot, { ...base, selectionSeed: 'economy-run-17' });
        expect(planNextAction(snapshot, { ...base, selectionSeed: 'economy-run-17' })).toEqual(first);
        const selected = new Set(Array.from({ length: 40 }, (_, index) =>
            planNextAction(snapshot, { ...base, selectionSeed: `economy-run-${index}` }).goalId));
        expect(selected).toEqual(new Set(['now.mine', 'now.fish']));
        expect(() => planNextAction(snapshot, { ...base, selectionSeed: '' })).toThrow('selection seed');
        store.close();
    });

    test('fails closed for stale observations and unknown or blocked skills', () => {
        const store = plannedStore();
        let snapshot = store.getSnapshot('ferrye14')!;
        expect(planNextAction(snapshot, { now: '2026-08-29T12:06:00.000Z' }).kind).toBe('refresh-state');
        expect(planNextAction(snapshot, { now: '2026-08-29T12:01:00.000Z' }).reason).toContain('not learned');
        const learned = store.setSkillKnowledge('ferrye14', miningSkill, 'known', null);
        snapshot = store.getSnapshot('ferrye14')!;
        expect(planNextAction(snapshot, { now: '2026-08-29T12:01:00.000Z' }).reason).toContain('trusted catalog');
        store.setSkillKnowledge('ferrye14', miningSkill, 'blocked', learned.revision);
        snapshot = store.getSnapshot('ferrye14')!;
        expect(planNextAction(snapshot, { now: '2026-08-29T12:01:00.000Z', availableSkills: [miningSkill] }).reason)
            .toContain('blocked');
        store.close();
    });

    test('assigns a resolved skill only to an active immediate goal with an optimistic revision', () => {
        const store = plannedStore();
        const goal = store.getGoal('now.mine')!;
        const replacement = { id: 'mining.varrock-east.iron-to-bank', version: '1.0.0' };
        const assigned = store.setGoalSkill('ferrye14', goal.goalId, goal.revision, replacement,
            '2026-08-29T12:01:00.000Z');
        expect(assigned).toMatchObject({ skill: replacement, revision: goal.revision + 1 });
        expect(store.listGoalEvents('ferrye14').find(event => event.kind === 'skill-assigned')).toMatchObject({ goalId: goal.goalId,
            kind: 'skill-assigned', previousStatus: 'active', status: 'active',
            previousRevision: goal.revision, revision: goal.revision + 1, skill: replacement });
        expect(() => store.setGoalSkill('ferrye14', goal.goalId, goal.revision, miningSkill)).toThrow('changed');
        expect(() => store.setGoalSkill('other', assigned.goalId, assigned.revision, miningSkill)).toThrow();
        store.close();
    });

    test('does not demand an observation when no immediate goal exists', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        expect(planNextAction(store.getSnapshot('ferrye14')!, { now: '2026-08-29T12:01:00.000Z' }).kind)
            .toBe('no-immediate-goal');
        store.close();
    });
});
