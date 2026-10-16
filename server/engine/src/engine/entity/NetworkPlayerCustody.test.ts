import { describe, expect, test } from 'bun:test';

import ClientGameProtCategory from '#/network/game/client/ClientGameProtCategory.js';
import { custodyPacketAllowed } from '#/mods/PlayerCustodyPacketPolicy.js';

describe('custody packet restriction', () => {
    test('drains client protocol traffic but blocks every gameplay category', () => {
        expect(custodyPacketAllowed(false, ClientGameProtCategory.USER_EVENT)).toBeTrue();
        expect(custodyPacketAllowed(true, ClientGameProtCategory.CLIENT_EVENT)).toBeTrue();
        expect(custodyPacketAllowed(true, ClientGameProtCategory.USER_EVENT)).toBeFalse();
        expect(custodyPacketAllowed(true, ClientGameProtCategory.RESTRICTED_EVENT)).toBeFalse();
    });
});
