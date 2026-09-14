import type Player from '#/engine/entity/Player.js';
import { exchangeSearch } from '#/engine/market/GrandExchange.js';
import ClientGameMessageHandler from '#/network/game/client/ClientGameMessageHandler.js';
import MarketSearch from '#/network/game/client/model/MarketSearch.js';
export default class MarketSearchHandler extends ClientGameMessageHandler<MarketSearch> {
    handle(message: MarketSearch, player: Player): boolean {
        return exchangeSearch(player, message.query, message.item);
    }
}
