import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SkillEvent, SkillOperationName } from '../../../agent-skills/types';
import { extractEconomyEvents, readEconomyEvents, summarizeEconomyEvents } from './transaction-telemetry';

const runId = '12345678-1234-4234-8234-123456789abc';

function operationEvent(operation: SkillOperationName, data: Record<string, unknown>, ordinal: number): SkillEvent {
    return {
        runId,
        type: 'step.succeeded',
        timestamp: `2026-08-27T10:00:0${ordinal}.000Z`,
        skill: { id: 'economy.test', version: '1.0.0' },
        stepId: `step-${ordinal}`,
        operation,
        data
    };
}

const run = {
    runId,
    username: 'ferrye14',
    skillId: 'economy.test',
    events: [
        operationEvent('gather-loc', {
            inventoryDelta: [{ id: 436, name: 'Copper ore', count: 1, delta: 1 }]
        }, 1),
        operationEvent('smith-at-anvil', {
            inventoryDelta: [
                { id: 436, name: 'Copper ore', count: 0, delta: -1 },
                { id: 1205, name: 'Bronze dagger', count: 1, delta: 1 }
            ]
        }, 2),
        operationEvent('buy-from-shop', {
            amountBought: 2,
            inventoryDelta: [
                { id: 2347, name: 'Hammer', count: 2, delta: 2 },
                { id: 995, name: 'Coins', count: 90, delta: -10 }
            ]
        }, 3),
        operationEvent('trade-give-item', {
            partner: 'receiver1',
            gave: [{ id: 1205, name: 'Bronze dagger', count: 1 }],
            received: [{ id: 995, name: 'Coins', count: 25 }],
            inventoryDelta: [
                { id: 1205, name: 'Bronze dagger', count: 0, delta: -1 },
                { id: 995, name: 'Coins', count: 115, delta: 25 }
            ]
        }, 4)
    ]
};

describe('transaction telemetry', () => {
    const temporaryRoots: string[] = [];
    afterEach(async () => {
        for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
    });

    test('classifies production, consumption, shop, and player trade events from structured evidence', () => {
        const events = extractEconomyEvents(run);
        expect(events.map(event => event.kind)).toEqual([
            'production', 'production', 'consumption', 'shop-buy', 'player-trade'
        ]);
        expect(events[0]?.itemsIn).toEqual([{ id: 436, name: 'Copper ore', quantity: 1 }]);
        expect(events[3]).toMatchObject({ coinsDelta: -10, itemsIn: [{ id: 2347, name: 'Hammer', quantity: 2 }] });
        expect(events[4]).toMatchObject({ counterparty: 'receiver1', coinsDelta: 25 });
        expect(summarizeEconomyEvents(events)).toEqual({
            producedItems: 2, consumedItems: 1, shopTransactions: 1, playerTrades: 1, netCoins: 15
        });
    });

    test('reads immutable run journals, filters them, and ignores malformed files', async () => {
        const root = await mkdtemp(join(tmpdir(), 'economy-events-'));
        temporaryRoots.push(root);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, `${runId}.json`), JSON.stringify({
            runId, username: 'Ferrye14', skill: { id: run.skillId, version: '1.0.0' }, events: run.events
        }));
        await writeFile(join(root, 'not-a-run.json'), '{broken');
        const result = await readEconomyEvents({ root, username: 'FERRYE14', kind: 'shop-buy' });
        expect(result.events).toHaveLength(1);
        expect(result.events[0]?.kind).toBe('shop-buy');
        expect(result.summary.shopTransactions).toBe(1);
    });
});
