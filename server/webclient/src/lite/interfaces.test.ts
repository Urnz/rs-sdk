// Two bots in one process must not share interface state.
//
// `IfType.list` is static and the interface packets mutate its components in
// place, so before per-client tables existed, N LiteClients in a process wrote
// their inventories into the same arrays and read back whichever bot's packet
// landed last - silently, with plausible-looking state. This test drives the real
// packet path (dispatch of UPDATE_INV_FULL) rather than the table API, so it fails
// if a future handler writes to `IfType.list` directly instead of via ifMutable().
//
// Requires the local emulator's interface archive; LITE_TEST_ORIGIN can select
// another local origin. Cache-loading failures fail the suite instead of skipping.

import { beforeAll, describe, expect, test } from 'bun:test';

import './dom-shim.js';

import IfType from '#/config/IfType.js';
import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { loadCache } from './cache.js';
import { LiteClient } from './LiteClient.js';
import { dispatch } from './protocol/incoming.js';

import { LITE_TEST_ORIGIN as ORIGIN, LITE_TEST_CACHE as CACHE_DIR } from './test-cache-config.js';

/** The inventory tab's component id - what UPDATE_INV_FULL targets in game. */
const INV_COMPONENT = 3214;


beforeAll(async () => {
    try {
        await loadCache({ origin: ORIGIN, cacheDir: CACHE_DIR, quiet: true });
    } catch (error) {
        throw new Error(`Local Lite test cache unavailable at ${ORIGIN}; start scripts/start-local.ps1 -NoBot`, { cause: error });
    }
}, 60_000);

/** A LiteClient with no socket: nothing below touches the connection. */
function makeClient(name: string): LiteClient {
    return new LiteClient({
        connection: { out: Packet.alloc(1), isClosed: false } as never,
        locIndex: {} as never,
        username: name,
        password: 'x'
    });
}

/** UPDATE_INV_FULL body: component id, slot count, then (objId, count) per slot. */
function invPacket(componentId: number, items: Array<[number, number]>): Packet {
    const buf = Packet.alloc(1);
    buf.p2(componentId);
    buf.p1(items.length);
    for (const [id, count] of items) {
        buf.p2(id);
        buf.p1(count);
    }
    const size = buf.pos;
    buf.pos = 0;
    return Object.assign(buf, { psize: size });
}

describe('per-client interface tables', () => {
    test('two clients keep separate inventories', () => {
        const a = makeClient('bota');
        const b = makeClient('botb');

        const aPacket = invPacket(INV_COMPONENT, [
            [1351, 1],
            [1511, 7]
        ]);
        const bPacket = invPacket(INV_COMPONENT, [[995, 42]]);

        dispatch(a, ServerProt.UPDATE_INV_FULL, aPacket, aPacket.pos + 8);
        dispatch(b, ServerProt.UPDATE_INV_FULL, bPacket, bPacket.pos + 8);

        const aInv = a.ifType(INV_COMPONENT);
        const bInv = b.ifType(INV_COMPONENT);

        expect(aInv).not.toBe(bInv);
        expect(Array.from(aInv.linkObjType!.slice(0, 3))).toEqual([1351, 1511, 0]);
        expect(Array.from(aInv.linkObjNumber!.slice(0, 3))).toEqual([1, 7, 0]);
        expect(Array.from(bInv.linkObjType!.slice(0, 3))).toEqual([995, 0, 0]);
        expect(Array.from(bInv.linkObjNumber!.slice(0, 3))).toEqual([42, 0, 0]);
    });

    test('client methods activate their own table', () => {
        const a = makeClient('bota');
        const b = makeClient('botb');

        const aPacket = invPacket(INV_COMPONENT, [[1351, 1]]);
        dispatch(a, ServerProt.UPDATE_INV_FULL, aPacket, aPacket.pos + 8);
        expect(IfType.list).toBe(a.interfaces.list);

        // Any method on b repoints the static, so bridge code that reads
        // IfType.list directly during that call sees b's components.
        b.isDialogOpen();
        expect(IfType.list).toBe(b.interfaces.list);

        a.ifType(INV_COMPONENT);
        expect(IfType.list).toBe(a.interfaces.list);
    });

    test('untouched components stay shared, not copied', () => {
        const a = makeClient('bota');
        const b = makeClient('botb');

        const packet = invPacket(INV_COMPONENT, [[1351, 1]]);
        dispatch(a, ServerProt.UPDATE_INV_FULL, packet, packet.pos + 8);

        expect(a.interfaces.clonedCount).toBe(1);
        // Some other component is still the same object in both tables.
        const untouched = INV_COMPONENT + 1;
        expect(a.ifType(untouched)).toBe(b.ifType(untouched));
    });
});
