// Render the actual 274 interface/client drawing code with disposable market fixtures.
// Run from server/engine: bun test/market-preview.ts [output-directory]
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Jimp } from 'jimp';
import { strict as assert } from 'node:assert';
const temp = mkdtempSync(join(tmpdir(), 'ge-preview-'));
process.env.GE_DATABASE = join(temp, 'market.sqlite');
const out = resolve(process.argv[2] ?? '../../screenshots/grand-exchange');
mkdirSync(out, { recursive: true });
const { default: World } = await import('../src/engine/World.js');
const { default: Component } = await import('../src/cache/config/Component.js');
const { default: InvType } = await import('../src/cache/config/InvType.js');
const { default: ObjType } = await import('../src/cache/config/ObjType.js');
const { default: Packet } = await import('../src/io/Packet.js');
const { PlayerLoading } = await import('../src/engine/entity/PlayerLoading.js');
const { openExchange, exchangeButton, exchangeSearch } = await import('../src/engine/market/GrandExchange.js');
const { marketStore } = await import('../src/engine/market/MarketStore.js');
try {
    World.reload();
    const clientRoot = new URL('../../webclient/src/', import.meta.url);
    // Dynamic imports preserve the webclient package's #/ aliases.
    await import(new URL('lite/dom-shim.ts', clientRoot).href);
    const { ItemViewer } = await import(new URL('viewer/ItemViewer.ts', clientRoot).href);
    const viewer = new ItemViewer();
    viewer.initFromData(
        {
            config: readFileSync('data/pack/client/config'),
            textures: readFileSync('data/pack/client/textures'),
            versionlist: readFileSync('data/pack/client/versionlist'),
            ondemand: readFileSync('data/pack/ondemand.zip')
        },
        { lazyModels: true }
    );
    const { default: ClientObjType } = await import(new URL('config/ObjType.ts', clientRoot).href);
    const { default: IfType } = await import(new URL('config/IfType.ts', clientRoot).href);
    const { default: JagFile } = await import(new URL('io/JagFile.ts', clientRoot).href);
    const { default: PixFont } = await import(new URL('graphics/PixFont.ts', clientRoot).href);
    const { default: Pix2D } = await import(new URL('graphics/Pix2D.ts', clientRoot).href);
    const { default: Pix3D } = await import(new URL('dash3d/Pix3D.ts', clientRoot).href);
    const { MarketSearchInput } = await import(new URL('client/MarketSearchInput.ts', clientRoot).href);
    const { Client } = await import(new URL('client/Client.ts', clientRoot).href);
    const jag = (name: string) => new JagFile(readFileSync(`data/pack/client/${name}`));
    const title = jag('title');
    const fonts = ['p11_full', 'p12_full', 'b12_full', 'q8_full'].map((name, i) => PixFont.depack(title, name, i === 3));
    IfType.init(jag('interface'), null, fonts);
    const client = Object.create(Client.prototype);
    Object.assign(client, { p11: fonts[0], overMainComId: -1, overSideComId: -1, overChatComId: -1, objDragArea: 0, selectedArea: 0 });
    const player = PlayerLoading.load('gepreview', new Packet(new Uint8Array()), null);
    player.x = 3182;
    player.z = 3439;
    player.write = (message: any) => {
        const c = IfType.list[message.component];
        if (message.component === undefined) return;
        assert(c, `Server update references missing client component ${message.component}`);
        switch (message.constructor.name) {
            case 'IfSetText':
                c.text = message.text;
                break;
            case 'IfSetObject': {
                const obj = ClientObjType.list(message.obj);
                c.model1Type = 4;
                c.model1Id = message.obj;
                c.modelXAn = obj.xan2d;
                c.modelYAn = obj.yan2d;
                c.modelZoom = Math.floor((obj.zoom2d * 100) / message.scale);
                break;
            }
            case 'IfSetHide':
                c.hide = message.hidden;
                break;
            case 'IfSetPosition':
                c.x = message.x;
                c.y = message.y;
                break;
            case 'IfSetColour': {
                const n = message.colour;
                c.colour = (((n >> 10) & 31) << 19) | (((n >> 5) & 31) << 11) | ((n & 31) << 3);
                break;
            }
            case 'UpdateInvFull':
                c.linkObjType.fill(0);
                c.linkObjNumber.fill(0);
                message.inv.items.forEach((item: any, i: number) => {
                    if (item) {
                        c.linkObjType[i] = item.id + 1;
                        c.linkObjNumber[i] = item.count;
                    }
                });
                break;
        }
    };
    const save = async (name: string) => {
        const pixels = new Int32Array(512 * 334);
        Pix2D.setPixels(pixels, 512, 334);
        Pix3D.setRenderClipping();
        client.drawInterface(IfType.list[Component.getId('grand_exchange')], 0, 0, 0);
        const rgba = Buffer.alloc(pixels.length * 4);
        pixels.forEach((rgb: number, i: number) => {
            rgba[i * 4] = (rgb >> 16) & 255;
            rgba[i * 4 + 1] = (rgb >> 8) & 255;
            rgba[i * 4 + 2] = rgb & 255;
            rgba[i * 4 + 3] = 255;
        });
        await new Jimp({ width: 512, height: 334, data: rgba }).write(join(out, name + '.png') as `${string}.png`);
    };
    openExchange(player, 3180, 3439);
    await save('empty');
    // Isolated visual fixtures, never connected to a game world or normal ledger.
    const fixtures = [
        ['ashes', 'buy', 1000, 3, 400, 'cancelled'],
        ['rune_sword', 'sell', 1, 554, 1, 'completed'],
        ['eye_of_newt', 'buy', 498, 5, 0, 'open'],
        ['bucket_water', 'sell', 200, 31, 80, 'open']
    ];
    for (let i = 0; i < fixtures.length; i++) {
        const [name, side, quantity, price, filled, state] = fixtures[i];
        const id = ObjType.getId(String(name));
        if (id < 0) throw Error('Unknown fixture ' + name);
        marketStore()
            .db.query('INSERT INTO offers(owner,slot,item,side,quantity,price,remaining,filled,state,created,gross,tax,items,coins) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(
                player.username,
                i,
                id,
                side as string,
                quantity as number,
                price as number,
                state === 'open' ? (quantity as number) - (filled as number) : 0,
                filled as number,
                state as string,
                Date.now(),
                (filled as number) * (price as number),
                side === 'sell' ? Math.floor(((filled as number) * (price as number)) / 20) : 0,
                side === 'buy' ? (filled as number) : 0,
                side === 'sell' ? (filled as number) * (price as number) - Math.floor(((filled as number) * (price as number)) / 20) : state === 'cancelled' ? ((quantity as number) - (filled as number)) * (price as number) : 0
            );
    }
    exchangeButton(player, Component.getId('grand_exchange:home'));
    await save('offers');
    exchangeButton(player, Component.getId('grand_exchange:slot3_view'));
    await save('detail');
    for (const [slot, name] of [[0, 'detail-cancelled'], [1, 'detail-completed'], [2, 'detail-buy']] as const) {
        exchangeButton(player, Component.getId('grand_exchange:home'));
        exchangeButton(player, Component.getId(`grand_exchange:slot${slot}_view`));
        await save(name);
    }
    exchangeButton(player, Component.getId('grand_exchange:home'));
    exchangeButton(player, Component.getId('grand_exchange:slot4_buy'));
    // Exercise the real client's keyboard routing and mouse hit testing on packed UI.
    client.mainModalId = Component.getId('grand_exchange');
    client.dialogInputOpen = false;
    client.marketSearchInput = new MarketSearchInput(
        (query: string, item: number) => {
            assert(exchangeSearch(player, query, item));
        },
        () => player.closeModal()
    );
    const type = async (query: string) => {
        client.marketSearchInput.sync(IfType.list, client.mainModalId);
        client.marketSearchInput.click(Component.getId('grand_exchange:search_clear'));
        const keys = [...query].map(char => char.charCodeAt(0)).concat(13);
        client.pollKey = () => keys.shift() ?? -1;
        await client.handleInputKey();
        client.marketSearchInput.sync(IfType.list, client.mainModalId);
    };
    await type('rune');
    await save('search');
    await type('rscim');
    await save('search-alias');
    Object.assign(client, { menuNumEntries: 0, menuAction: [], menuParamA: [], menuParamB: [], menuParamC: [], menuOption: [] });
    client.addComponentOptions(IfType.list[client.mainModalId], 38, 138, 0, 0, 0);
    const last = client.menuNumEntries - 1;
    assert.equal(client.menuParamC[last], Component.getId('grand_exchange:result0_select'), 'Thumbnail is the default left-click action');
    client.doAction(last);
    assert.equal(IfType.list[Component.getId('grand_exchange:offer_name')].text, 'Rune scimitar');
    assert(IfType.list[Component.getId('grand_exchange:offer_sell_quantity')].hide, 'Buy quantity hides All');
    client.menuNumEntries = 0;
    client.addComponentOptions(IfType.list[client.mainModalId], 216, 219, 0, 0, 0);
    assert(!client.menuParamC.slice(0, client.menuNumEntries).includes(Component.getId('grand_exchange:offer_qty_all')), 'Hidden All has no mouse action');
    await save('search-selected');
    client.marketSearchInput.sync(IfType.list, client.mainModalId);
    exchangeButton(player, Component.getId('grand_exchange:row6'));
    await type('unobtainium');
    await save('search-empty');
    exchangeButton(player, Component.getId('grand_exchange:home'));
    player.invAdd(InvType.getId('inv'), ObjType.getId('rune_scimitar'), 1);
    exchangeButton(player, Component.getId('grand_exchange:slot4_sell'));
    exchangeSearch(player, 'rscim');
    exchangeSearch(player, 'rscim', ObjType.getId('rune_scimitar'));
    assert(!IfType.list[Component.getId('grand_exchange:offer_sell_quantity')].hide, 'Sell quantity shows All');
    client.menuNumEntries = 0;
    client.addComponentOptions(IfType.list[client.mainModalId], 216, 219, 0, 0, 0);
    assert.equal(client.menuParamC[client.menuNumEntries - 1], Component.getId('grand_exchange:offer_qty_all'), 'Sell All is clickable');
    await save('sell-offer');
    exchangeButton(player, Component.getId('grand_exchange:home'));
    exchangeButton(player, Component.getId('grand_exchange:slot3_view'));
    for (const [x, name] of [[80, 'view_collect'], [240, 'view_notes'], [410, 'view_cancel']] as const) {
        client.menuNumEntries = 0;
        client.addComponentOptions(IfType.list[client.mainModalId], x, 272, 0, 0, 0);
        assert.equal(client.menuParamC[client.menuNumEntries - 1], Component.getId(`grand_exchange:${name}`), `${name} is the default mouse action`);
    }
    console.log('Native client renders written to ' + out);
} finally {
    marketStore().db.close();
    rmSync(temp, { recursive: true, force: true });
    await Promise.all([World.loginThread.terminate(), World.friendThread.terminate(), World.loggerThread.terminate()]);
}
