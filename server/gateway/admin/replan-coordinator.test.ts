import { describe, expect, test } from 'bun:test';
import { AgentReplanCoordinator, type ReplanRecord } from './replan-coordinator.js';
import type { EconomySnapshot } from './types.js';

function coordinator() {
    const records: ReplanRecord[] = [];
    const planned: string[] = [];
    const value = new AgentReplanCoordinator({
        resolveAgentId: async player => player.toLowerCase() === 'ferrye14' ? 'agent-14' : null,
        listAgentIds: async () => ['agent-14', 'agent-15'],
        plan: async (agentId, event) => {
            planned.push(`${agentId}:${event.type}`);
            return { runId: event.eventId, status: 'proposed', reason: 'planned' };
        },
        append: record => { records.push(record); }
    }, undefined, 1000, 10);
    return { value, records, planned };
}

function economy(timestamp: string, coins: number, items: number): EconomySnapshot {
    return { timestamp, bots: 2, online: 2, totalCoins: coins, totalXp: 0, sessionXpGained: 0,
        totalXpPerHour: 0, averageTotalLevel: 1, itemStock: [{ id: 1, name: 'Item', count: items }] };
}

describe('gateway LLM replan coordinator', () => {
    test('routes a completed skill once and preserves its auditable outcome', async () => {
        const { value, records, planned } = coordinator();
        const event = { eventId: 'event-1', agentId: 'agent-14', type: 'skill-finished' as const,
            sourceKey: 'run-1', occurredAt: '2026-08-30T10:00:00.000Z', summary: 'Skill completed.' };
        await value.submit(event, '2026-08-30T10:00:01.000Z');
        await value.submit(event, '2026-08-30T10:00:10.000Z');
        expect(planned).toEqual(['agent-14:skill-finished']);
        expect(records.map(record => record.gate.reason)).toEqual(['accepted', 'duplicate']);
        expect(records[0]?.outcome?.status).toBe('proposed');
    });

    test('turns new trade requests and death transitions into domain events, not state-tick plans', async () => {
        const { value, planned } = coordinator();
        const player = { lifeId: 1, isDead: false, lastDeathTick: null } as any;
        value.observeWorldState('Ferrye14', { tick: 1, player, gameMessages: [] });
        value.observeWorldState('Ferrye14', { tick: 2, player, gameMessages: [] });
        value.observeWorldState('Ferrye14', { tick: 3, player,
            gameMessages: [{ tick: 3, type: 4, sender: 'Trader', text: 'Trader wishes to trade with you.' } as any] });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(planned).toEqual(['agent-14:offer-received']);

        value.observeWorldState('Ferrye14', { tick: 4,
            player: { ...player, isDead: true, lastDeathTick: 4 }, gameMessages: [] });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(planned).toContain('agent-14:unexpected-world-event');
    });

    test('fans out only significant aggregate economic changes', async () => {
        const { value, planned } = coordinator();
        await value.observeEconomy(economy('2026-08-30T10:00:00.000Z', 100, 10));
        await value.observeEconomy(economy('2026-08-30T10:00:10.000Z', 150, 15));
        expect(planned).toHaveLength(0);
        await value.observeEconomy(economy('2026-08-30T10:00:20.000Z', 1200, 30));
        expect(planned).toEqual(['agent-14:significant-economic-change', 'agent-15:significant-economic-change']);
    });
});
