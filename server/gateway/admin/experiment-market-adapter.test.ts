import { describe, expect, test } from 'bun:test';
import { buildExperimentMarketWorldModEntry, verifyExperimentMarketWorldMod } from './experiment-market-adapter.js';
import { validateExperimentParameterProfile } from './experiment-parameters.js';
import type { WorldModView } from './world-mods.js';

function profile() {
    return validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.0', label: 'Baseline',
        description: '', origin: 'manual', parameters: { xpRewards: [], respawns: [], finishedProducts: [],
            marketPrices: [{ itemId: 436, itemName: 'Copper ore', buyGp: 3, sellGp: 1 }] } },
    '2026-01-01T00:00:00.000Z');
}

describe('experiment market world-mod adapter', () => {
    test('builds exact provenance and canonical prices for the world mod', () => {
        const source = profile();
        expect(buildExperimentMarketWorldModEntry(source)).toEqual({ enabled: true, config: {
            profileId: source.profileId, profileVersion: source.version, profileDigest: source.digest,
            pricesJson: '[{"itemId":436,"itemName":"Copper ore","buyGp":3,"sellGp":1}]'
        } });
    });

    test('refuses a profile without market prices', () => {
        const source = validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.1',
            label: 'No market', description: '', origin: 'manual', parameters: { xpRewards: [], marketPrices: [],
                finishedProducts: [], respawns: [{ targetKey: 'loc:2090', ticks: 80 }] } },
        '2026-01-01T00:00:00.000Z');
        expect(() => buildExperimentMarketWorldModEntry(source)).toThrow('nem tartalmaz piaci árat');
    });

    test('requires exact active engine readback', () => {
        const source = profile();
        const expected = buildExperimentMarketWorldModEntry(source);
        const view = { id: 'experiment.market-calibration', status: 'active', active: expected,
            requested: expected } as unknown as WorldModView;
        expect(verifyExperimentMarketWorldMod(source, [view])).toBe(view);
        const stale = structuredClone(view);
        stale.active!.config.pricesJson = '[]';
        expect(() => verifyExperimentMarketWorldMod(source, [stale])).toThrow('exact');
    });
});
