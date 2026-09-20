import { describe, expect, test } from 'bun:test';

import {
    automaticShopRestockAllowed,
    legacyShopAllowed,
    parseShopEconomyMode
} from './ShopEconomyPolicy.js';
import { createDefaultWorldConfig, migrateFromLegacyEnv, normalizeWorldConfig } from '../util/WorldConfig.js';

describe('ShopEconomyPolicy', () => {
    test('preserves the classic emulator shop in legacy mode', () => {
        const mode = parseShopEconomyMode('legacy');

        expect(legacyShopAllowed(mode)).toBe(true);
        expect(automaticShopRestockAllowed(mode)).toBe(true);
    });

    test('blocks unfunded transactions and automatic stock creation in a closed society', () => {
        const mode = parseShopEconomyMode('closed-society');

        expect(legacyShopAllowed(mode)).toBe(false);
        expect(automaticShopRestockAllowed(mode)).toBe(false);
    });

    test('rejects unknown modes instead of silently enabling legacy shops', () => {
        expect(() => parseShopEconomyMode('closed')).toThrow('Invalid shop economy mode');
        expect(() => parseShopEconomyMode(undefined)).toThrow('Invalid shop economy mode');
    });

    test('keeps existing worlds compatible and accepts a persistent closed-society setting', () => {
        expect(createDefaultWorldConfig().node.shopEconomyMode).toBe('legacy');
        expect(normalizeWorldConfig({ node: { shopEconomyMode: 'closed-society' } }).node.shopEconomyMode).toBe('closed-society');
        expect(() => normalizeWorldConfig({ node: { shopEconomyMode: 'typo' } })).toThrow('Invalid shop economy mode');
    });

    test('supports the restart-only legacy environment override', () => {
        const config = migrateFromLegacyEnv(createDefaultWorldConfig(), { NODE_SHOP_ECONOMY_MODE: 'closed-society' });

        expect(config.node.shopEconomyMode).toBe('closed-society');
    });
});
