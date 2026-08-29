import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { AgentStateStore, AgentStateValidationError, buildCoreIdentity, buildDecisionContext,
    planNextAction } from '../index.js';

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
        const life = store.createGoal('ferrye14', { goalId: 'ferrye.life', horizon: 'life', title: 'Life' });
        const long = store.createGoal('ferrye14', { goalId: 'ferrye.long', parentGoalId: life.goalId,
            horizon: 'long-term', title: 'Long term' });
        expect(() => store.setGoalStatus(life.goalId, life.revision, 'completed')).toThrow('active child');
        expect(store.setGoalStatus(long.goalId, long.revision, 'completed').completedAt).not.toBeNull();
        expect(store.setGoalStatus(life.goalId, life.revision, 'completed').status).toBe('completed');
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
        legacy.run('PRAGMA user_version = 1');
        legacy.close(true);

        const store = new AgentStateStore(path);
        expect(store.getIdentity('legacy')?.displayName).toBe('Legacy agent');
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

    test('does not demand an observation when no immediate goal exists', () => {
        const store = new AgentStateStore(databasePath());
        addIdentity(store);
        expect(planNextAction(store.getSnapshot('ferrye14')!, { now: '2026-08-29T12:01:00.000Z' }).kind)
            .toBe('no-immediate-goal');
        store.close();
    });
});
