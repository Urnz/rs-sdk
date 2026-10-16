import { resolve } from 'node:path';

import { MarketStore } from '../server/engine/src/engine/market/MarketStore.js';
import { openSharedPlayerEscrowAuthority } from '../server/engine/src/mods/SharedPlayerEscrowAuthority.js';

const value = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return resolve(process.argv.slice(2).find(argument => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback);
};
const legacyPath = value('legacy', 'server/engine/data/mods/player-inventory-escrow.sqlite');
const targetPath = value('target', 'server/engine/data/market.sqlite');
const market = new MarketStore(targetPath);
const authority = openSharedPlayerEscrowAuthority(legacyPath, targetPath, () => market);
try {
    console.log(JSON.stringify({ ok: authority.verifySharedAuditChain(), liveEscrowRecords: authority.list().length,
        targetPath }, null, 2));
} finally { authority.close(); market.db.close(true); }
