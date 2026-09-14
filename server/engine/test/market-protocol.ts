// Exercise the actual browser packet reader, including obsolete interface caches.
// Run from server/engine: bun test/market-protocol.ts
import { strict as assert } from 'node:assert';
const clientRoot = new URL('../../webclient/src/', import.meta.url);
await import(new URL('lite/dom-shim.ts', clientRoot).href);
const { Client } = await import(new URL('client/Client.ts', clientRoot).href);
const { default: IfType } = await import(new URL('config/IfType.ts', clientRoot).href);
const { default: Packet } = await import(new URL('io/Packet.ts', clientRoot).href);
const { ServerProt, ServerProtSizes } = await import(new URL('io/ServerProt.ts', clientRoot).href);
const frame = (opcode: number, payload: number[]) => [opcode, ...(ServerProtSizes[opcode] === -2 ? [payload.length >> 8, payload.length & 255] : ServerProtSizes[opcode] === -1 ? [payload.length] : []), ...payload];
const cases = [
    [ServerProt.IF_SETTEXT, [...Buffer.from('{"isOpen":true}'), 10]],
    [ServerProt.IF_SETHIDE, [1]],
    [ServerProt.IF_SETCOLOUR, [0, 0]],
    [ServerProt.IF_SETOBJECT, [0, 1, 0, 100]],
    [ServerProt.IF_SETPOSITION, [0, 0, 0, 0]],
    [ServerProt.UPDATE_INV_FULL, [0]]
] as const;
for (const [opcode, body] of cases) {
    const client = Object.create(Client.prototype);
    let offset = 0, logouts = 0;
    const data = Uint8Array.from([...frame(opcode, [255, 255, ...body]), ...frame(ServerProt.IF_SETTEXT, [0, 0, ...Buffer.from('Still connected'), 10])]);
    IfType.list = [{ text: '', layerId: 0 }];
    Object.assign(client, {
        in: new Packet(new Uint8Array(5000)), ptype: -1, randomIn: null, sideIcon: [0], activeIcon: 0,
        stream: { get available() { return data.length - offset; }, async readBytes(dst: Uint8Array, start: number, count: number) { dst.set(data.subarray(offset, offset + count), start); offset += count; } },
        logout: async () => { logouts++; }, addChat: () => {}
    });
    await client.tcpIn();
    assert.equal(logouts, 0, `Unknown component in packet ${opcode} must not log out the player`);
    await client.tcpIn();
    assert.equal(IfType.list[0].text, 'Still connected', 'The following packet stays aligned and applies normally');
}
console.log('PASS: stale/missing exchange components never disconnect or desynchronize the native client.');
