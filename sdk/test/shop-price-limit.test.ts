import { describe, expect, test } from 'bun:test';
import { BotActions } from '../actions.js';

describe('bounded shop price execution', () => {
    test('rechecks a live unit-price ceiling between every purchased item', async () => {
        const inventory: Array<{ slot: number; id: number; name: string; count: number; optionsWithIndex: never[] }> = [];
        const shopItem = { slot: 0, id: 2347, name: 'Hammer', count: 10,
            baseCost: 5, buyPrice: 5, sellPrice: 2 };
        let packets = 0;
        const state = { shop: { isOpen: true, title: 'Tools', shopItems: [shopItem], playerItems: [] },
            inventory };
        const sdk = {
            getState: () => state,
            getInventory: () => inventory,
            sendShopBuy: async () => {
                packets++;
                inventory[0] = { slot: 0, id: shopItem.id, name: shopItem.name,
                    count: (inventory[0]?.count ?? 0) + 1, optionsWithIndex: [] };
                shopItem.count--;
                shopItem.buyPrice = 15;
                return { success: true, message: 'dispatched' };
            },
            waitForCondition: async (predicate: (value: typeof state) => boolean) => {
                if (!predicate(state)) throw new Error('condition not met');
                return state;
            }
        } as any;

        const result = await new BotActions(sdk).buyFromShop('Hammer', 3, { maxUnitPriceGp: 10 });
        expect(result).toMatchObject({ success: false, partial: true, reason: 'unit_price_limit',
            requestedAmount: 3, amountBought: 1 });
        expect(packets).toBe(1);
    });
});
