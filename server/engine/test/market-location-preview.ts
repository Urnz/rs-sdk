// Native packed scenery preview, no running game or player account required.
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Jimp } from 'jimp';
import { strict as assert } from 'node:assert';
const clientRoot = new URL('../../webclient/src/', import.meta.url);
await import(new URL('lite/dom-shim.ts', clientRoot).href);
const { ItemViewer } = await import(new URL('viewer/ItemViewer.ts', clientRoot).href);
const viewer = new ItemViewer();
viewer.initFromData(
    { config: readFileSync('data/pack/client/config'), textures: readFileSync('data/pack/client/textures'), versionlist: readFileSync('data/pack/client/versionlist'), ondemand: readFileSync('data/pack/ondemand.zip') },
    { lazyModels: true }
);
const ids = new Map(
    readFileSync('../content/pack/loc.pack', 'utf8')
        .trim()
        .split('\n')
        .map(line => {
            const [id, name] = line.split('=');
            return [name, Number(id)] as const;
        })
);
const out = resolve('../../screenshots/grand-exchange');
mkdirSync(out, { recursive: true });
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['grand_exchange_booth', 'bankbooth']) {
    const sprite = viewer.renderLocSprite(ids.get(name)!, 256, 256, 256, 224, 0x38382e);
    if (!sprite) throw Error('No model: ' + name);
    const rgba = Buffer.alloc(sprite.data.length * 4);
    sprite.data.forEach((rgb: number, i: number) => {
        rgba[i * 4] = (rgb >> 16) & 255;
        rgba[i * 4 + 1] = (rgb >> 8) & 255;
        rgba[i * 4 + 2] = rgb & 255;
        rgba[i * 4 + 3] = 255;
    });
    await new Jimp({ width: 256, height: 256, data: rgba }).write(`${out}/${name}.png`);
}

// Render the actual packed bank scene with roofs removed (level 0), using the
// game's scene builder, terrain, scenery and NPC models, not a layout mockup.
const { default: ClientBuild } = await import(new URL('client/ClientBuild.ts', clientRoot).href);
const { default: Scene } = await import(new URL('dash3d/World.ts', clientRoot).href);
const { default: CollisionMap } = await import(new URL('dash3d/CollisionMap.ts', clientRoot).href);
const { default: NpcType } = await import(new URL('config/NpcType.ts', clientRoot).href);
const { default: Model } = await import(new URL('dash3d/Model.ts', clientRoot).href);
const { default: Pix2D } = await import(new URL('graphics/Pix2D.ts', clientRoot).href);
const { default: Pix3D } = await import(new URL('dash3d/Pix3D.ts', clientRoot).href);
const { default: JagFile } = await import(new URL('io/JagFile.ts', clientRoot).href);
const { default: Packet } = await import(new URL('io/Packet.ts', clientRoot).href);
const { Int32Array3d, Uint8Array3d } = await import(new URL('util/Arrays.ts', clientRoot).href);
const { unzipSync, gunzipSync } = await import('fflate');
const heights = new Int32Array3d(4, 105, 105),
    flags = new Uint8Array3d(4, 104, 104);
const build = new ClientBuild(104, 104, heights, flags),
    scene = new Scene(heights, 104, 4, 104);
ClientBuild.lowMem = false;
ClientBuild.hueOff = 0;
ClientBuild.ligOff = 0;
const collisions = [new CollisionMap(), new CollisionMap(), new CollisionMap(), new CollisionMap()];
const zip = unzipSync(readFileSync('data/pack/ondemand.zip'));
const index = new Packet(new JagFile(readFileSync('data/pack/client/versionlist')).read('map_index')!);
const maps: { x: number; z: number; land: number; loc: number }[] = [];
while (index.pos < index.data.length) {
    const coord = index.g2(),
        land = index.g2(),
        loc = index.g2();
    index.g1();
    const x = coord >> 8,
        z = coord & 255;
    if (x >= 49 && x <= 50 && z >= 53 && z <= 54) maps.push({ x, z, land, loc });
}
for (const m of maps) build.loadGround(gunzipSync(zip[`4.${m.land}`]), 3136, 3392, (m.x - 49) * 64, (m.z - 53) * 64);
for (const m of maps) build.loadLocations(gunzipSync(zip[`4.${m.loc}`]), (m.x - 49) * 64, (m.z - 53) * 64, scene, collisions);
build.finishBuild(scene, collisions);
assert(
    scene.squares[0][44][51]?.sprites.some((sprite: any) => sprite && ((sprite.typecode >> 14) & 32767) === ids.get('grand_exchange_booth')),
    'The client map uses the existing bank table for the exchange'
);
let npcSection = false;
for (const line of readFileSync('../content/maps/m49_53.jm2', 'utf8').split('\n')) {
    if (line.startsWith('====')) {
        npcSection = line.includes('NPC');
        continue;
    }
    if (!npcSection || !line.startsWith('0 ')) continue;
    const [coords, id] = line.split(': ');
    const [, x, z] = coords.split(' ').map(Number);
    if (x < 44 || x > 52 || z < 41 || z > 55) continue;
    assert(Number(id) < NpcType.idx.length, 'NPC is available in the client cache');
    const model = NpcType.list(Number(id)).getTempModel(-1, -1, null);
    if (model) {
        const copy = Model.copyForAnim(model, true, true, false);
        copy.faceColourA = model.faceColourA;
        copy.faceColourB = model.faceColourB;
        copy.faceColourC = model.faceColourC;
        copy.calcBoundingCylinder();
        scene.addDynamic(0, x * 128 + 64, heights[0][x][z], z * 128 + 64, copy, 1, 0, 60, false);
    }
}
// A close view of the teller also verifies the new NPC's packed appearance.
const tellerId = Number(
    readFileSync('../content/pack/npc.pack', 'utf8')
        .split('\n')
        .find(line => line.endsWith('=grand_exchange_teller'))!
        .split('=')[0]
);
const tellerType = NpcType.list(tellerId);
assert.equal(tellerType.name, 'Grand Exchange teller');
assert.equal(tellerType.op[0], 'Exchange');
const tellerModel = tellerType.getTempModel(-1, -1, null)!;
const portrait = new Int32Array(180 * 240);
Pix2D.setPixels(portrait, 180, 240);
Pix3D.setRenderClipping();
Pix2D.fillRect(0, 0, 180, 240, 0x38382e);
tellerModel.objRender(0, 0, 0, 0, 0, Math.floor(tellerModel.minY / 2), Math.floor((tellerModel.minY * 512) / (240 * 0.8)));
const portraitRgba = Buffer.alloc(portrait.length * 4);
portrait.forEach((rgb: number, i: number) => {
    portraitRgba[i * 4] = (rgb >> 16) & 255;
    portraitRgba[i * 4 + 1] = (rgb >> 8) & 255;
    portraitRgba[i * 4 + 2] = rgb & 255;
    portraitRgba[i * 4 + 3] = 255;
});
await new Jimp({ width: 180, height: 240, data: portraitRgba }).write(`${out}/teller.png`);
const w = 800,
    h = 650,
    pixels = new Int32Array(w * h);
Pix2D.setPixels(pixels, w, h);
Pix3D.setRenderClipping();
Pix3D.lowDetail = false;
const distance = new Int32Array(9);
for (let i = 0; i < 9; i++) {
    const angle = i * 32 + 143;
    distance[i] = ((angle * 3 + 600) * Pix3D.sinTable[angle]) >> 16;
}
Scene.resetVisCalc(distance, 500, 1200, w, h);
scene.renderAll(48 * 128, heights[0][48][48] - 1350, 48 * 128 - 1350, 0, 0, 256);
const rgba = Buffer.alloc(pixels.length * 4);
pixels.forEach((rgb: number, i: number) => {
    rgba[i * 4] = (rgb >> 16) & 255;
    rgba[i * 4 + 1] = (rgb >> 8) & 255;
    rgba[i * 4 + 2] = rgb & 255;
    rgba[i * 4 + 3] = 255;
});
await new Jimp({ width: w, height: h, data: rgba }).write(`${out}/west-bank.png`);
console.log('Native booth and bank scene previews written to ' + out);
