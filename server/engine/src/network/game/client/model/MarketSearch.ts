import ClientGameMessage from '#/network/game/client/ClientGameMessage.js';
import ClientGameProtCategory from '#/network/game/client/ClientGameProtCategory.js';
/** Text filter or selection of the actual item displayed by the client. */
export default class MarketSearch extends ClientGameMessage {
    category = ClientGameProtCategory.USER_EVENT;
    constructor(
        readonly query: string,
        readonly item: number = 0
    ) {
        super();
    }
}
