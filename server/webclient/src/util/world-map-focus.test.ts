import { describe, expect, test } from 'bun:test';
import { remapWorldMapZ, worldTileToMapFocus } from './world-map-focus';

describe('admin world map focus coordinates', () => {
    test('converts an overworld tile into MapView focus space', () => {
        expect(worldTileToMapFocus(3222, 3218, 28 << 6, 44 << 6, 44 << 6)).toEqual({
            x: 1430,
            z: 2414
        });
    });

    test('uses the same underground remapping as the rendered world map', () => {
        expect(remapWorldMapZ(145 << 6)).toBe(63 << 6);
        expect(remapWorldMapZ(72 << 6)).toBe(82 << 6);
    });
});
