import ClientGameProtCategory from '#/network/game/client/ClientGameProtCategory.js';

/** Custody still drains protocol/heartbeat traffic, but no user or restricted gameplay handler runs. */
export function custodyPacketAllowed(restricted: boolean, category: ClientGameProtCategory): boolean {
    return !restricted || category === ClientGameProtCategory.CLIENT_EVENT;
}
