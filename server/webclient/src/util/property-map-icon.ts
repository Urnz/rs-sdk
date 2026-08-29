export const PROPERTY_MAPFUNCTION_ID: number = 50;
export const PROPERTY_MAP_ICON_SIZE: number = 15;

const OUTLINE: number = 0x2f2114;
const BOARD: number = 0xc89a3c;
const BOARD_LIGHT: number = 0xf0c866;
const POST: number = 0x76502a;

function fill(pixels: Int32Array, x: number, y: number, width: number, height: number, rgb: number): void {
    for (let py: number = y; py < y + height; py++) {
        for (let px: number = x; px < x + width; px++) {
            pixels[py * PROPERTY_MAP_ICON_SIZE + px] = rgb;
        }
    }
}

/** A small freestanding property sign for the world-map key and POI markers. */
export function createPropertyMapIconPixels(): Int32Array {
    const pixels: Int32Array = new Int32Array(PROPERTY_MAP_ICON_SIZE * PROPERTY_MAP_ICON_SIZE);

    fill(pixels, 1, 2, 13, 7, OUTLINE);
    fill(pixels, 2, 3, 11, 5, BOARD);
    fill(pixels, 3, 3, 9, 1, BOARD_LIGHT);

    // Dark "P" makes the marker distinct from the existing shop signs.
    fill(pixels, 5, 4, 1, 3, OUTLINE);
    fill(pixels, 6, 4, 3, 1, OUTLINE);
    fill(pixels, 8, 5, 1, 1, OUTLINE);
    fill(pixels, 6, 6, 3, 1, OUTLINE);

    fill(pixels, 6, 9, 3, 5, OUTLINE);
    fill(pixels, 7, 9, 1, 4, POST);
    fill(pixels, 4, 13, 7, 2, OUTLINE);
    fill(pixels, 5, 13, 5, 1, POST);

    return pixels;
}
