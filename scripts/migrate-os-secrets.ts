import { resolve } from 'node:path';
import { migrateWorkspaceSecrets } from '../server/gateway/admin/secret-migration.js';

// No secret arguments or read/export operation. Run with affected workers stopped.
if (process.argv.length > 3) throw new Error('Usage: bun scripts/migrate-os-secrets.ts [workspace]');
try {
    const result = await migrateWorkspaceSecrets(resolve(process.argv[2] ?? '.'), undefined, process.env);
    console.log(JSON.stringify({ ok: true, ...result }));
} catch {
    console.error('Secret migration stopped. Legacy sources were retained until their OS-vault writes were verified; check conflicts and compatible source version.');
    process.exitCode = 1;
}
