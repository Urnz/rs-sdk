import { describe, expect, test } from 'bun:test';
import { parseExperimentMarketConfig, resolveExperimentMarketPrice } from './ExperimentMarket.js';

function config(pricesJson: string) {
    return parseExperimentMarketConfig({ profileId: 'economy.baseline', profileVersion: '1.0.0',
        profileDigest: 'c'.repeat(64), pricesJson });
}

describe('experiment shop market adapter', () => {
    test('keeps buy and sell prices independent, including an explicit zero', () => {
        const parsed = config('[{"itemId":436,"itemName":"Copper ore","buyGp":3,"sellGp":0}]');
        expect(resolveExperimentMarketPrice(436, 'buy', parsed)).toBe(3);
        expect(resolveExperimentMarketPrice(436, 'sell', parsed)).toBe(0);
        expect(resolveExperimentMarketPrice(438, 'buy', parsed)).toBeNull();
    });

    test('uses null as direction-specific vanilla fallback', () => {
        const parsed = config('[{"itemId":436,"itemName":"Copper ore","buyGp":null,"sellGp":2}]');
        expect(resolveExperimentMarketPrice(436, 'buy', parsed)).toBeNull();
        expect(resolveExperimentMarketPrice(436, 'sell', parsed)).toBe(2);
    });

    test('rejects duplicate items, missing directions and unsafe prices', () => {
        expect(() => config('[{"itemId":436,"itemName":"Copper ore","buyGp":1,"sellGp":1},{"itemId":436,"itemName":"Copper ore","buyGp":2,"sellGp":2}]')).toThrow('Duplicate');
        expect(() => config('[{"itemId":436,"itemName":"Copper ore","buyGp":null,"sellGp":null}]')).toThrow('needs');
        expect(() => config('[{"itemId":436,"itemName":"Copper ore","buyGp":-1,"sellGp":1}]')).toThrow('price');
    });
});
