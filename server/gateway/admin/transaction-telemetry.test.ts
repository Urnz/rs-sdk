import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SkillEvent, SkillOperationName } from '../../../agent-skills/types';
import { EconomyEventStore, extractEconomyEvents, readEconomyEvents,
    summarizeEconomyEvents, summarizeMarketCoinFlow, summarizeMarketPrices } from './transaction-telemetry';

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
        expect(summarizeMarketCoinFlow(events)).toEqual({ grossIncomeGp: 25, grossSpendingGp: 10 });
        expect(summarizeMarketPrices(events)).toEqual([{ side: 'buy', itemId: 2347, itemName: 'Hammer',
            quantity: 2, totalCoins: 10, weightedAverageUnitPrice: 5, transactions: 1 }]);
    });

    test('uses weighted shop prices and ignores directionally invalid observations', () => {
        const base = extractEconomyEvents(run);
        expect(summarizeMarketPrices([...base,
            { ...base[3]!, id: 'second-buy', itemsIn: [{ id: 2347, name: 'Hammer', quantity: 3 }],
                coinsDelta: -21 },
            { ...base[3]!, id: 'sell', kind: 'shop-sell', itemsIn: [],
                itemsOut: [{ id: 436, name: 'Copper ore', quantity: 2 }], coinsDelta: 18 },
            { ...base[3]!, id: 'invalid-direction', coinsDelta: 10 }
        ])).toEqual([
            { side: 'buy', itemId: 2347, itemName: 'Hammer', quantity: 5, totalCoins: 31,
                weightedAverageUnitPrice: 6.2, transactions: 2 },
            { side: 'sell', itemId: 436, itemName: 'Copper ore', quantity: 2, totalCoins: 18,
                weightedAverageUnitPrice: 9, transactions: 1 }
        ]);
    });

    test('keeps a pure GP player trade as trusted income without inventing an item price', () => {
        const coinTrade = extractEconomyEvents({ runId, username: 'ferrye14', skillId: 'economy.test',
            events: [operationEvent('trade-give-item', { partner: 'payer', gave: [],
                received: [{ id: 995, name: 'Coins', count: 40 }],
                inventoryDelta: [{ id: 995, name: 'Coins', count: 140, delta: 40 }] }, 5)] });
        expect(coinTrade).toHaveLength(1);
        expect(coinTrade[0]).toMatchObject({ kind: 'player-trade', counterparty: 'payer',
            itemsIn: [], itemsOut: [], coinsDelta: 40 });
        expect(summarizeMarketCoinFlow(coinTrade)).toEqual({ grossIncomeGp: 40, grossSpendingGp: 0 });
        expect(summarizeMarketPrices(coinTrade)).toEqual([]);
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
        expect(result.ingestion).toEqual({ createdRuns: 1, replayedRuns: 0, rejectedRuns: 0 });
        const replay = await readEconomyEvents({ root, username: 'ferrye14', kind: 'shop-buy' });
        expect(replay.events).toEqual(result.events);
        expect(replay.ingestion).toEqual({ createdRuns: 0, replayedRuns: 1, rejectedRuns: 0 });
        await writeFile(join(root, `${runId}.json`), JSON.stringify({
            runId, username: 'Ferrye14', skill: { id: run.skillId, version: '1.0.0' },
            events: run.events.slice(0, 1)
        }));
        const rejected = await readEconomyEvents({ root, username: 'ferrye14', kind: 'shop-buy' });
        expect(rejected.events).toEqual(result.events);
        expect(rejected.ingestion).toEqual({ createdRuns: 0, replayedRuns: 0, rejectedRuns: 1 });
    });

    test('persists replayable events and rejects a changed run id without rewriting history', async () => {
        const root = await mkdtemp(join(tmpdir(), 'economy-ledger-'));
        temporaryRoots.push(root);
        const path = join(root, 'events.sqlite');
        const ledger = new EconomyEventStore(path);
        expect(ledger.ingest(run, '2026-08-27T10:01:00.000Z')).toEqual({ created: true, eventCount: 5 });
        expect(ledger.ingest(run, '2026-08-27T10:02:00.000Z')).toEqual({ created: false, eventCount: 5 });
        expect(ledger.replay(runId)).toEqual({ events: extractEconomyEvents(run),
            summary: summarizeEconomyEvents(extractEconomyEvents(run)) });
        expect(() => ledger.ingest({ ...run, events: run.events.slice(0, 1) }))
            .toThrow('changed after ingestion');
        expect(ledger.query({ username: 'FERRYE14' }).events).toHaveLength(5);
        ledger.close();

        const reopened = new EconomyEventStore(path);
        expect(reopened.replay(runId).events).toEqual(extractEconomyEvents(run));
        reopened.close();
    });
});
