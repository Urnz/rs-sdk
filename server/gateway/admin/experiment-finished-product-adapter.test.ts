import { describe, expect, test } from 'bun:test';
import { buildExperimentFinishedProductWorldModEntry, evaluateExperimentFinishedProducts,
    verifyExperimentFinishedProductWorldMod } from './experiment-finished-product-adapter.js';
import { validateExperimentParameterProfile } from './experiment-parameters.js';
import type { MultiAgentExperimentEnvironment } from './multi-agent-experiments.js';
import type { EconomySnapshot } from './types.js';
import type { WorldModView } from './world-mods.js';

function profile() {
    return validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.0', label: 'Baseline',
        description: '', origin: 'manual', parameters: { xpRewards: [], respawns: [], marketPrices: [],
            finishedProducts: [
                { itemId: 1205, itemName: 'Bronze dagger', valueGp: 16 },
                { itemId: 1277, itemName: 'Bronze sword', valueGp: 25 }
            ] } }, '2026-01-01T00:00:00.000Z');
}

function economy(itemStock: EconomySnapshot['itemStock']): EconomySnapshot {
    return { timestamp: '2026-01-01T00:00:00.000Z', bots: 2, online: 2, totalCoins: 0, totalXp: 0,
        sessionXpGained: 0, totalXpPerHour: 0, averageTotalLevel: 1, itemStock };
}

function environment(enabled = true): MultiAgentExperimentEnvironment {
    const source = profile();
    const entry = buildExperimentFinishedProductWorldModEntry(source);
    return { schemaVersion: 1, activeRevision: 1, capturedAt: '2026-01-01T00:00:00.000Z', mods: [{
        id: 'experiment.finished-product-valuation', version: '1.0.0', dataSchemaVersion: 1,
        enabled, config: entry.config
    }] };
}

describe('experiment finished-product valuation adapter', () => {
    test('builds exact provenance and requires active engine readback', () => {
        const source = profile();
        const expected = buildExperimentFinishedProductWorldModEntry(source);
        expect(expected.config.productsJson).toBe('[{"itemId":1205,"itemName":"Bronze dagger","valueGp":16},{"itemId":1277,"itemName":"Bronze sword","valueGp":25}]');
        const view = { id: 'experiment.finished-product-valuation', status: 'active', active: expected,
            requested: expected } as unknown as WorldModView;
        expect(verifyExperimentFinishedProductWorldMod(source, [view])).toBe(view);
        view.active!.config.productsJson = '[]';
        expect(() => verifyExperimentFinishedProductWorldMod(source, [view])).toThrow('exact');
    });

    test('values positive and negative stock deltas without changing gameplay prices', () => {
        const result = evaluateExperimentFinishedProducts(profile(), environment(),
            economy([{ id: 1205, name: 'Bronze dagger', count: 2 }, { id: 1277, name: 'Bronze sword', count: 4 }]),
            economy([{ id: 1205, name: 'Bronze dagger', count: 5 }, { id: 1277, name: 'Bronze sword', count: 2 }]));
        expect(result).toMatchObject({ grossProducedValueGp: 48, grossConsumedValueGp: 50,
            netValueDeltaGp: -2, products: [
                { itemId: 1205, unitValueGp: 16, countDelta: 3, valueDeltaGp: 48 },
                { itemId: 1277, unitValueGp: 25, countDelta: -2, valueDeltaGp: -50 }
            ] });
    });

    test('returns unavailable for a disabled adapter and rejects a mismatched active profile', () => {
        expect(evaluateExperimentFinishedProducts(profile(), environment(false), economy([]), economy([]))).toBeNull();
        const mismatched = environment();
        mismatched.mods[0]!.config.profileDigest = 'f'.repeat(64);
        expect(() => evaluateExperimentFinishedProducts(profile(), mismatched, economy([]), economy([])))
            .toThrow('nem egyezik');
    });

    test('refuses profiles without finished-product values', () => {
        const source = validateExperimentParameterProfile({ profileId: 'economy.baseline', version: '1.0.1',
            label: 'No products', description: '', origin: 'manual', parameters: { xpRewards: [], marketPrices: [],
                finishedProducts: [], respawns: [{ targetKey: 'loc:2090', ticks: 80 }] } },
        '2026-01-01T00:00:00.000Z');
        expect(() => buildExperimentFinishedProductWorldModEntry(source)).toThrow('nem tartalmaz késztermékértéket');
    });
});
