import { join, resolve } from 'node:path';

import { migrateLegacyTreasuryExternalCredits } from '../server/gateway/admin/institution-treasury-migration.js';
import { institutionTreasuryDbPath } from '../server/gateway/admin/paths.js';

if (!process.argv.includes('--confirm-stopped'))
    throw new Error('Refusing offline treasury migration without --confirm-stopped');
const prefix = '--backup=';
const backup = resolve(process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
    ?? join('.local', 'migrations', 'treasury-external-credit',
        new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')));
console.log(JSON.stringify(migrateLegacyTreasuryExternalCredits(institutionTreasuryDbPath, backup), null, 2));
