import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { loadIntegrationFixture } from '../society-integration/fixture.js';
import { inspectD1Feasibility } from '../society-integration/live-preflight.js';
import { offlineArchiveIO as io } from '../society-experiments/archive.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';

const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    root: { type: 'string' }, fixture: { type: 'string', default: 'config/fixtures/society-lobster-four-v1.json' },
    plan: { type: 'string', default: 'config/fixtures/society-lobster-four-d1-plan-v1.json' }, output: { type: 'string' }
} });
if (positionals.length !== 1 || positionals[0] !== 'preflight') throw new Error('Usage: bun scripts/society-integration-live.ts preflight [--root PATH] [--fixture PATH] [--plan PATH] [--output .local/verification/NEW.json]');
const root = resolve(values.root ?? join(import.meta.dir, '..')); io.ancestors(root);
const fixture = loadIntegrationFixture(resolve(root, values.fixture));
const planPath = resolve(root, values.plan), planText = readFileSync(planPath, 'utf8');
const nativePaths = ['.local/agent-state/agents.sqlite', '.local/economy/businesses.sqlite', '.local/economy/institution-treasury.sqlite',
    '.local/economy/food-commerce.sqlite', '.local/economy/housing.sqlite', '.local/simulation/simulation-clock.sqlite',
    '.local/simulation/food-needs.sqlite', '.local/simulation/society-integrity.sqlite', '.local/admin/properties.sqlite',
    '.local/admin/fixture-bootstrap.sqlite', '.local/admin/replan-inbox.sqlite', 'server/engine/data/player-checkpoints.sqlite',
    'server/engine/data/mods/trade-evidence.sqlite', 'server/engine/data/mods/player-action-rewards.sqlite',
    'server/engine/data/mods/player-health-evidence.sqlite'];
const paths = [...nativePaths.flatMap(p => [p, `${p}-wal`, `${p}-shm`]), '.local/simulation/integration-fixture.json',
    '.local/simulation/integration-native-seal.json', ...fixture.avatars.map(a => `server/engine/data/players/${a.username}.sav`)];
const inventory = () => paths.map(path => {
    if (!existsSync(join(root, path))) return { path, sha256: null };
    io.ancestors(join(root, path)); return { path, sha256: io.fileHash(join(root, path)) };
});
const before = inventory(), report = await inspectD1Feasibility(root, fixture, JSON.parse(planText));
if (JSON.stringify(before) !== JSON.stringify(inventory()) || readFileSync(planPath, 'utf8') !== planText)
    throw new Error('Native state or candidate plan changed during D1 preflight; no stable observation');
const body = { protocol: 'society-integration-d1-preflight-record-v1', recordedAt: new Date().toISOString(),
    report, planFileSha256: createHash('sha256').update(planText).digest('hex'), nativeBefore: before, nativeSourcesUnchanged: true };
const record = { ...body, digest: digest(body) };
if (values.output) {
    const base = join(root, '.local/verification'), output = resolve(root, values.output), child = relative(base, output);
    if (!child || child.startsWith('..') || isAbsolute(child) || !child.endsWith('.json') || child.includes('/') || child.includes('\\'))
        throw new Error('D1 evidence output must be a NEW JSON file directly under .local/verification');
    for (const parent of [join(root, '.local'), base]) {
        if (!existsSync(parent)) mkdirSync(parent);
        io.ancestors(parent);
    }
    writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(record, null, 2));
process.exitCode = 2; // This static report never replaces native live admission.
