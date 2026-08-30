import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SkillRunResult } from '../../agent-skills/types.js';
import { AgentStateStore, observeLiveState, runLivePlannerCycle, type LiveWorldState } from '../index.js';

const directories: string[] = [];
const skill = { id: 'mining.varrock-east.copper-to-bank', version: '1.0.0' };

function createStore(): AgentStateStore {
    const directory = mkdtempSync(join(tmpdir(), 'rs-agent-live-'));
    directories.push(directory);
    const store = new AgentStateStore(join(directory, 'agents.sqlite'));
    store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'A test miner.', personalityTraits: ['patient'] });
    store.createGoal('ferrye14', { goalId: 'life.main', horizon: 'life', title: 'Prosper' });
    store.createGoal('ferrye14', { goalId: 'long.main', parentGoalId: 'life.main', horizon: 'long-term', title: 'Build capital' });
    store.createGoal('ferrye14', { goalId: 'current.main', parentGoalId: 'long.main', horizon: 'current', title: 'Mine' });
    store.createGoal('ferrye14', { goalId: 'now.main', parentGoalId: 'current.main', horizon: 'immediate',
        title: 'Mine copper', skill });
    store.setSkillKnowledge('ferrye14', skill, 'known', null);
    return store;
}

function liveState(name = 'Ferrye14'): LiveWorldState {
    return {
        inGame: true,
        player: { name, combatLevel: 50, hp: 40, maxHp: 50, x: 50, z: 50,
            worldX: 3285, worldZ: 3367, level: 0, runEnergy: 75, runWeight: 0,
            animId: -1, spotanimId: -1, combat: { inCombat: false, targetIndex: -1,
                targetType: 'none', lastDamageTick: -1 }, isDead: false, lifeId: 1,
            respawnCount: 0, lastDeathTick: null },
        inventory: [{ slot: 0, id: 1275, name: 'Rune pickaxe', count: 1, optionsWithIndex: [] }],
        dialog: { isOpen: false, options: [], isWaiting: false },
        bank: { isOpen: false, items: [], noteMode: false },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] },
        trade: undefined,
        modalOpen: false,
        nearbyNpcs: [], nearbyLocs: [], gameMessages: []
    };
}

function completedRun(): SkillRunResult {
    return { runId: '11111111-1111-4111-8111-111111111111', skill, status: 'completed', reason: 'completed',
        message: 'Done', operations: 5, durationMs: 1000, events: [] };
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('live deterministic agent cycle', () => {
    test('converts bounded live state into working memory', () => {
        const observed = observeLiveState(liveState(), '2026-08-29T12:00:00.000Z');
        expect(observed.summary).toContain('(3285, 3367, 0), idle');
        expect(observed.location).toEqual({ x: 3285, z: 3367, level: 0 });
        expect(observed.observations).toContain('Inventory 1/28: Rune pickaxe');
        expect(observed.observations.length).toBeLessThanOrEqual(12);
    });

    test('observes, plans and invokes the exact verified skill once', async () => {
        const store = createStore();
        const calls: typeof skill[] = [];
        const cycle = await runLivePlannerCycle({ store, agentId: 'ferrye14', state: liveState(),
            availableSkills: [skill], now: '2026-08-29T12:00:00.000Z',
            executeSkill: async reference => { calls.push(reference); return completedRun(); } });
        expect(cycle.decision.kind).toBe('execute-skill');
        expect(cycle.execution?.status).toBe('completed');
        expect(calls).toEqual([skill]);
        expect(store.getWorkingMemory('ferrye14')?.location?.x).toBe(3285);
        store.close();
    });

    test('dry-run observes and plans without executing', async () => {
        const store = createStore();
        const cycle = await runLivePlannerCycle({ store, agentId: 'ferrye14', state: liveState(),
            availableSkills: [skill], now: '2026-08-29T12:00:00.000Z' });
        expect(cycle.decision.kind).toBe('execute-skill');
        expect(cycle.execution).toBeNull();
        store.close();
    });

    test('refuses to control a player that does not belong to the agent', async () => {
        const store = createStore();
        await expect(runLivePlannerCycle({ store, agentId: 'ferrye14', state: liveState('SomeoneElse'),
            availableSkills: [skill], now: '2026-08-29T12:00:00.000Z', executeSkill: async () => completedRun() }))
            .rejects.toThrow('only its bound avatar ferrye14');
        expect(store.getWorkingMemory('ferrye14')).toBeNull();
        store.close();
    });
});
