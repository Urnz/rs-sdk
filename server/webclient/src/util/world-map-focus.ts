export interface WorldMapFocus {
    x: number;
    z: number;
}

export function remapWorldMapZ(z: number): number {
    const mapSquareZ = z >> 6;
    if (mapSquareZ >= 144) return z - (82 << 6);
    if (mapSquareZ >= 70 && mapSquareZ <= 76) return z + (10 << 6);
    return z;
}

export function worldTileToMapFocus(
    x: number,
    z: number,
    mapOriginX: number,
    mapOriginZ: number,
    mapHeight: number
): WorldMapFocus {
    return {
        x: x - mapOriginX,
        z: mapOriginZ + mapHeight - remapWorldMapZ(z)
    };
}
