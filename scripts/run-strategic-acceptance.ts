import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { ServerSecretStore } from '../server/control-plane/secret-store.js';
import { runNativeFoodIntegration } from '../server/gateway/admin/native-food-test-runtime.js';

const root = resolve(import.meta.dir, '..');
const { values } = parseArgs({ options: { provider: { type: 'string', default: 'scripted' } } });
if (values.provider !== 'scripted' && values.provider !== 'openai') throw new Error('Provider must be scripted or openai');
// Preflight does not retrieve a credential or make a network request.
if (values.provider === 'openai' && !await new ServerSecretStore(root).status('openai-api-key')) {
    console.error('real-LLM: not-tested; configure the local server credential in the admin UI'); process.exit(2);
}
const parent = join(root, '.local/experiments/si-b06'); mkdirSync(parent, { recursive: true });
const directory = join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${values.provider}-${randomUUID().slice(0, 8)}`);
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout;
const diff = Bun.spawnSync(['git', 'diff', 'HEAD', '--'], { cwd: root }).stdout;
const untracked = Bun.spawnSync(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: root });
if (untracked.exitCode) throw new Error('Cannot inventory source');
const files = untracked.stdout.toString().split('\0').filter(Boolean);
function packedFiles(directory: string) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        if (entry.isDirectory()) packedFiles(join(directory, entry.name));
        else if (entry.isFile()) files.push(join(directory, entry.name));
        else throw new Error('Non-regular packed source');
    }
}
packedFiles('server/engine/data/pack/server'); packedFiles('server/engine/data/pack/client');
for (const name of ['main_file_cache.dat', ...Array.from({ length: 5 }, (_, i) => `main_file_cache.idx${i}`)])
    files.push(join('server/engine/data/pack', name));
const hash = createHash('sha256').update(revision).update(diff);
const inputs = files.sort().map(file => { const digest = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
    hash.update(file).update(digest); return { file, digest }; });
process.env.SI_B06_OUTPUT = directory; process.env.SI_B06_PROVIDER = values.provider;
process.env.SI_B06_SOURCE_DIGEST = hash.digest('hex');
process.env.SI_B06_SOURCE_INFO = JSON.stringify({ revision: revision.toString().trim(), diffDigest: createHash('sha256').update(diff).digest('hex'),
    bun: Bun.version, sourceDigest: process.env.SI_B06_SOURCE_DIGEST, inputCount: inputs.length,
    inputInventoryDigest: createHash('sha256').update(JSON.stringify(inputs)).digest('hex') }, null, 2);
console.info(JSON.stringify({ directory, provider: values.provider, maximumUsd: 0.05, maximumCalls: 8 }));
await runNativeFoodIntegration('StrategicAcceptance.test.ts', 4, { testNamePattern: '^SI-B06', deadlineMs: 180000 });
const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
console.info(JSON.stringify(report, null, 2));
if ((values.provider === 'openai' ? report.realLlm : report.technical) !== 'pass') process.exitCode = 1;
