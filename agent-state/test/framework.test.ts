import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStateStore, AgentStateValidationError, buildCoreIdentity } from '../index.js';

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

