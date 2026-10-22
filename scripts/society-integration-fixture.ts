import { parseArgs } from 'node:util';
import { existsSync, symlinkSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadIntegrationFixture, integrationWorldId } from '../society-integration/fixture.js';
import { preflightIntegrationDefinition, readIntegrationBaseline, FOOD_TRIAL_STATE } from '../society-integration/bootstrap.js';
import { verifyNativeIntegrationSeal } from '../society-integration/baseline.js';
import { createIntegrationWorkspace, createFoodTrialWorkspace, captureIntegrationBaseline, verifyIntegrationBaseline, restoreIntegrationBaseline,
    captureIntegrationResult, verifyIntegrationResult, restoreIntegrationResult } from '../society-integration/archive.js';

const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { root: { type: 'string' },
    output: { type: 'string' }, bundle: { type: 'string' }, fixture: { type: 'string', default: 'config/fixtures/society-lobster-four-v1.json' },
    offline: { type: 'boolean', default: false } } });
const root = resolve(values.root ?? join(import.meta.dir, '..')), command = positionals[0] ?? 'preflight';
const fixture = loadIntegrationFixture(resolve(root, values.fixture));
function offline(target: string) {
    if (!values.offline) throw new Error('Explicit --offline is required; stop all writers before creating/capturing a baseline');
    if (process.platform !== 'win32') throw new Error('Use a platform-specific offline probe; the supplied probe supports Windows');
    const probe = Bun.spawnSync(['pwsh', '-NoProfile', '-File', join(import.meta.dir, 'assert-society-offline.ps1'), '-Root', target, '-CallerPid', String(process.pid)], { stdout: 'pipe', stderr: 'pipe' });
    if (probe.exitCode !== 0) throw new Error(`Offline probe failed: ${probe.stderr.toString()}`);
}
if (command === 'preflight') {
    const definition = await preflightIntegrationDefinition(root, fixture);
    const baseline = existsSync(join(root, '.local/simulation/integration-fixture.json')) ? readIntegrationBaseline(root, fixture) : null;
    const seal = baseline ? verifyNativeIntegrationSeal(root, fixture).digest : null;
    console.log(JSON.stringify({ ...definition, baseline, nativeSeal: seal }, null, 2));
    if (!definition.executableSkillsReady) process.exitCode = 2;
} else if (command === 'create' || command === 'create-food-trials') {
    if (!values.output) throw new Error('Create requires a NEW --output directory');
    const trial = command === 'create-food-trials';
    if (!trial) {
        const definition = await preflightIntegrationDefinition(root, fixture);
        if (!definition.executableSkillsReady) throw new Error(`Verified skills are not ready: ${definition.errors.join('; ')}`);
    }
    const created = await (trial ? createFoodTrialWorkspace : createIntegrationWorkspace)({ sourceRoot: root, output: values.output, fixture, assertOffline: offline,
        progress: (phase, completed, total) => console.error(JSON.stringify({ scope: 'integration-provisioning', phase, completed, total })),
        bootstrapNative: async stage => {
            const links: string[] = [];
            try {
                for (const path of ['node_modules', 'server/engine/node_modules', 'server/webclient/node_modules']) if (existsSync(join(root, path))) {
                    const link = join(stage, path); symlinkSync(join(root, path), link, process.platform === 'win32' ? 'junction' : 'dir'); links.push(link);
                }
                const child = Bun.spawn([process.execPath, join(stage, 'scripts/integration-native-bootstrap.ts'), ...(trial ? ['--food-trials'] : [])], { cwd: join(stage, 'server/engine'),
                    env: { ...process.env, CONTROL_PLANE_SERVER_ID: integrationWorldId(fixture), MANAGED_WORKSPACE: stage,
                        ENGINE_ADMIN_URL: 'http://127.0.0.1:65530', GATEWAY_URL: 'ws://127.0.0.1:65531',
                        PLAYER_CHECKPOINT_DATABASE: 'data/player-checkpoints.sqlite', GE_DATABASE: 'data/player-checkpoints.sqlite', TRADE_EVIDENCE_DB: 'data/mods/trade-evidence.sqlite',
                        PLAYER_ESCROW_SHARED_CHECKPOINT: 'true', NODE_SHOP_ECONOMY_MODE: 'closed-society', NODE_XPRATE: '1' },
                    stdout: 'inherit', stderr: 'inherit' });
                let expired = false;
                const deadline = setTimeout(() => { expired = true; child.kill(); }, 90_000);
                let exit: number;
                try { exit = await child.exited; } finally { clearTimeout(deadline); }
                if (expired || exit !== 0) throw new Error(`Native staged fixture bootstrap ${expired ? 'timed out' : 'failed'}; unpublished workspace discarded`);
                return trial ? JSON.parse(readFileSync(join(stage, FOOD_TRIAL_STATE), 'utf8')) : readIntegrationBaseline(stage, fixture);
            } finally { for (const link of links.reverse()) unlinkSync(link); }
        } });
    console.log(JSON.stringify(created, null, 2));
} else if (command === 'capture') {
    if (!values.output) throw new Error('Capture requires --output'); console.log(JSON.stringify(captureIntegrationBaseline(root, values.output, fixture, offline), null, 2));
} else if (command === 'verify') {
    if (!values.bundle) throw new Error('Verify requires --bundle'); const result = verifyIntegrationBaseline(values.bundle);
    console.log(JSON.stringify({ digest: result.digest, fixtureDigest: result.fixture.digest, nativeReRead: 'requires restore' }, null, 2));
} else if (command === 'restore') {
    if (!values.bundle || !values.output) throw new Error('Restore requires --bundle and a NEW --output directory');
    console.log(JSON.stringify(restoreIntegrationBaseline(values.bundle, values.output), null, 2));
} else if (command === 'capture-result') {
    if (!values.output) throw new Error('Result capture requires a NEW --output directory');
    console.log(JSON.stringify(captureIntegrationResult(root, values.output, fixture, offline), null, 2));
} else if (command === 'verify-result') {
    if (!values.bundle) throw new Error('Result verification requires --bundle');
    const result = verifyIntegrationResult(values.bundle);
    console.log(JSON.stringify({ digest: result.digest, nativeReportDigest: result.result.report.digest,
        liveAcceptance: result.result.liveAcceptance }, null, 2));
} else if (command === 'restore-result') {
    if (!values.bundle || !values.output) throw new Error('Result restore requires --bundle and a NEW --output directory');
    console.log(JSON.stringify(restoreIntegrationResult(values.bundle, values.output), null, 2));
} else throw new Error('Commands: preflight, create, create-food-trials, capture, verify, restore, capture-result, verify-result, restore-result');
