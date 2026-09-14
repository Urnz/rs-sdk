import Packet from '#/io/Packet.js';
import ClientGameMessageDecoder from '#/network/game/client/ClientGameMessageDecoder.js';
import ClientGameProt from '#/network/game/client/ClientGameProt.js';
import MarketSearch from '#/network/game/client/model/MarketSearch.js';
export default class MarketSearchDecoder extends ClientGameMessageDecoder<MarketSearch> {
    prot = ClientGameProt.MARKET_SEARCH;
    decode(buf: Packet) {
        return new MarketSearch(buf.gjstr(), buf.g2());
    }
}
