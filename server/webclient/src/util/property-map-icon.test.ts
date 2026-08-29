import { describe, expect, test } from 'bun:test';
import { createPropertyMapIconPixels, PROPERTY_MAPFUNCTION_ID, PROPERTY_MAP_ICON_SIZE } from './property-map-icon';

describe('property world-map icon', () => {
    test('uses the first free custom map-function slot', () => {
        expect(PROPERTY_MAPFUNCTION_ID).toBe(50);
    });

    test('creates a transparent 15x15 sign with visible board and post pixels', () => {
        const pixels = createPropertyMapIconPixels();

        expect(pixels.length).toBe(PROPERTY_MAP_ICON_SIZE ** 2);
        expect(pixels[0]).toBe(0);
        expect(pixels[3 * 15 + 3]).not.toBe(0);
        expect(pixels[10 * 15 + 7]).not.toBe(0);
        expect(pixels[14 * 15 + 4]).not.toBe(0);
    });
});
