import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { migrateLegacyPlayerEscrowAuthority } from '../server/engine/src/mods/PlayerEscrowAuthorityMigration.js';

const args = new Set(process.argv.slice(2));
if (!args.has('--confirm-stopped')) {
    throw new Error('Refusing offline escrow migration without --confirm-stopped');
}
const value = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    return resolve(process.argv.slice(2).find(argument => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback);
};
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
const legacyPath = value('legacy', 'server/engine/data/mods/player-inventory-escrow.sqlite');
const targetPath = value('target', 'server/engine/data/market.sqlite');
const backupDirectory = value('backup', join('.local', 'migrations', 'player-escrow-authority', stamp));
if (!existsSync(legacyPath) || !existsSync(targetPath)) throw new Error('Migration source or target is absent');
console.log(JSON.stringify(migrateLegacyPlayerEscrowAuthority(legacyPath, targetPath, backupDirectory), null, 2));
