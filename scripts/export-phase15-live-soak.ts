import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildLiveSoakAcceptanceBundle } from '../server/gateway/admin/live-soak-acceptance.js';

const positional = process.argv.slice(2).filter(value => !value.startsWith('--'));
const outputIndex = process.argv.indexOf('--output');
const sessionPath = positional[0] ? resolve(positional[0]) : null;
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1] ? resolve(process.argv[outputIndex + 1]!) : null;

if (!sessionPath || !outputPath) {
    console.error('Usage: bun scripts/export-phase15-live-soak.ts <session.json> --output <acceptance.json>');
    process.exit(1);
}

const bundle = await buildLiveSoakAcceptanceBundle(sessionPath);
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, sessionId: bundle.manifest.sessionId,
    accepted: bundle.criteria.accepted, criteria: bundle.criteria, bundleDigest: bundle.bundleDigest }, null, 2));
if (!bundle.criteria.accepted) process.exitCode = 2;
