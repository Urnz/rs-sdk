import { describe, expect, test } from 'bun:test';
import { applyExperimentRespawnTicks, experimentRespawnSelectors,
    parseExperimentRespawnConfig } from './ExperimentRespawn.js';

function config(targetsJson: string) {
    return parseExperimentRespawnConfig({ profileId: 'economy.baseline', profileVersion: '1.0.0',
        profileDigest: 'b'.repeat(64), targetsJson });
}

describe('experiment respawn calibration adapter', () => {
    test('prefers an exact coordinate selector over the type-wide selector', () => {
        const context = { kind: 'loc' as const, targetId: 2090, level: 0, x: 3285, z: 3367 };
        expect(experimentRespawnSelectors(context)).toEqual(['loc:2090:0:3285:3367', 'loc:2090']);
        const parsed = config(JSON.stringify([
            { targetKey: 'loc:2090', ticks: 100 },
            { targetKey: 'loc:2090:0:3285:3367', ticks: 25 }
        ]));
        expect(applyExperimentRespawnTicks(80, context, parsed)).toEqual({
            scheduledTicks: 25, selector: 'loc:2090:0:3285:3367'
        });
    });

    test('preserves the already resolved vanilla timer when no selector matches', () => {
        const parsed = config('[{"targetKey":"npc:1","ticks":50}]');
        expect(applyExperimentRespawnTicks(77,
            { kind: 'obj', targetId: 436, level: 0, x: 3200, z: 3200 }, parsed))
            .toEqual({ scheduledTicks: 77, selector: null });
    });

    test('rejects symbolic, duplicate and out-of-range target definitions', () => {
        expect(() => config('[{"targetKey":"loc:copper-rocks","ticks":50}]')).toThrow('selector');
        expect(() => config('[{"targetKey":"npc:1","ticks":50},{"targetKey":"npc:1","ticks":60}]')).toThrow('duplicate');
        expect(() => config('[{"targetKey":"obj:436","ticks":0}]')).toThrow('ticks');
    });
});
