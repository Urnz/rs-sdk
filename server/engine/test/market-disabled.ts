// Isolated process: real packed world with GE disabled, using temporary saves only.
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
const dir = mkdtempSync(join(tmpdir(), 'ge-disabled-'));
process.env.GE_ENABLED = 'false';
process.env.GE_DATABASE = join(dir, 'market.sqlite');
const { default: Environment } = await import('../src/util/Environment.js');
const { default: World } = await import('../src/engine/World.js');
const { default: LocType } = await import('../src/cache/config/LocType.js');
const { default: NpcType } = await import('../src/cache/config/NpcType.js');
const { default: Component } = await import('../src/cache/config/Component.js');
const { default: Packet } = await import('../src/io/Packet.js');
const { PlayerLoading } = await import('../src/engine/entity/PlayerLoading.js');
const { isMapBlocked } = await import('../src/engine/GameMap.js');
const { MarketStore, marketStore, playerSaveStore } = await import('../src/engine/market/MarketStore.js');
const { openExchange, exchangeButton, exchangeCount, exchangeSearch, tickExchange } = await import('../src/engine/market/GrandExchange.js');
const { handleMarket } = await import('../src/web/pages/market.js');
const { default: LocAddChange } = await import('../src/network/game/server/model/LocAddChange.js');
try {
    assert.equal(Environment.GE_ENABLED, false);
    World.reload();
    World.gameMap.init();
    assert.equal(World.getLoc(3180, 3443, 0, LocType.getId('grand_exchange_booth')), null);
    assert(World.getLoc(3180, 3443, 0, LocType.getId('banktable')), 'Disabled GE restores the original table');
    for (const z of [3443, 3444]) assert(isMapBlocked(3180, z, 0), 'Original table collision remains');
    assert(![...World.npcs].some(n => n.type === NpcType.getId('grand_exchange_teller')));
    for (const x of [3180, 3181]) for (const z of [3439, 3440]) assert(!isMapBlocked(x, z, 0), 'Removed stall has no collision');
    const p = PlayerLoading.load('disabledtest', new Packet(new Uint8Array()), null);
    p.x = 3182; p.z = 3439; p.level = 0;
    const packets: unknown[] = [];
    p.write = packet => { packets.push(packet); };
    World.gameMap.getZone(3180, 3443, 0).writeFullFollows(p);
    assert(packets.some(packet => packet instanceof LocAddChange && packet.loc === LocType.getId('banktable')), 'Clients receive the original bank table');
    const messages: string[] = [];
    p.messageGame = message => { messages.push(message); };
    openExchange(p, 3180, 3443);
    assert(messages.includes('Grand Exchange is not available on this server.'));
    assert.equal(p.modalMain, -1);
    assert.equal(exchangeButton(p, Component.getId('grand_exchange:buy')), true);
    assert.equal(exchangeCount(p, 10), false);
    assert.equal(exchangeSearch(p, 'logs'), false);
    tickExchange(p);
    const plainSave = p.save();
    assert(PlayerLoading.verify(new Packet(plainSave)));
    assert.equal(PlayerLoading.load(p.username, new Packet(plainSave), null).x, 3182);
    assert.equal(playerSaveStore(), undefined);
    assert.throws(() => marketStore(), /not available/);
    for (const path of ['/market', '/market/', '/api/market/items', '/api/market/items/1511', '/api/market/items/1511/history', '/api/market/offers']) {
        for (const method of ['GET', 'POST']) {
            const url = new URL('http://localhost' + path);
            const response = handleMarket(new Request(url, { method }), url)!;
            assert.equal(response.status, 503);
            assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.equal((await response.json()).reason, 'ge_unavailable');
        }
    }
    const url = new URL('http://localhost/api/market/status');
    assert.equal((await handleMarket(new Request(url), url)!.json()).enabled, false);
    assert.equal(handleMarket(new Request('http://localhost/'), new URL('http://localhost/')), null);
    assert(!existsSync(process.env.GE_DATABASE), 'No database created by disabled-world gameplay or HTTP');

    // Prior participants keep ledger recovery and later gameplay across the toggle.
    const seed = new MarketStore(process.env.GE_DATABASE);
    p.x = 3200;
    seed.checkpoint(p.username, p.save(), true);
    seed.db.close();
    const recovered = PlayerLoading.load(p.username, new Packet(plainSave), null);
    assert.equal(recovered.x, 3200, 'Recover the latest atomic checkpoint even with GE off');
    recovered.x = 3210;
    recovered.save();
    Environment.GE_ENABLED = true;
    assert.equal(PlayerLoading.load(p.username, new Packet(plainSave), null).x, 3210, 'Re-enabling cannot roll back progress made with GE off');
    assert.equal((await handleMarket(new Request(url), url)!.json()).enabled, true);
    console.log('Disabled GE: world, original table restoration, handlers, HTTP, ordinary saves and checkpoint recovery passed.');
} finally {
    playerSaveStore()?.db.close();
    rmSync(dir, { recursive: true, force: true });
    await Promise.all([World.loginThread.terminate(), World.friendThread.terminate(), World.loggerThread.terminate()]);
}
