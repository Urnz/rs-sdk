import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { offlineArchiveIO as io, type ArchiveFile } from '../society-experiments/archive.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { check, inspectIntegrationReferences, integrationWorldId, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';
import { bootstrapIntegrationStage, bootstrapFoodTrialStage, readIntegrationBaseline, INTEGRATION_STATE, FOOD_TRIAL_STATE, type IntegrationBootstrapPorts } from './bootstrap.js';
import { nativeInventory, verifyNativeIntegrationSeal } from './baseline.js';
import { stageSurvivalConfiguration } from '../needs/survival-config.js';
import { stageIntegrationSites } from './native-sites.js';
import { stageIntegrationRuntime } from './runtime-config.js';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { reportNativeIntegration } from '../society-metrics/integration-report.js';
import { nativeIntegrationOptions } from '../society-metrics/integration-sources.js';

const PROTOCOL = 'society-integration-offline-v1';
const RESULT_PROTOCOL = 'society-integration-result-offline-v1';
const state = ['.local/agent-state', '.local/economy', '.local/simulation', '.local/agent-skills', 'server/engine/data/mods', 'server/engine/data/players'];
const adminFiles = ['.local/admin/properties.sqlite', '.local/admin/fixture-bootstrap.sqlite'];
const checkpoint = 'server/engine/data/player-checkpoints.sqlite';
function forbidden(path: string) {
    return path.split('/').some(part => /^(?:\.git|node_modules|bots|backups|secrets|logs|trash|\.env(?:\..*)?|bot\.env)$/i.test(part))
        || /\.(?:pem|key|pfx|p12)$/i.test(path) || /(?:api[-_]?key|credentials|password)\.(?:txt|sqlite|db|json)$/i.test(path)
        || path === 'server/engine/db.sqlite';
}
function walk(root: string, prefix: string, paths: string[]) {
    if (!existsSync(join(root, prefix))) return;
    check(!forbidden(prefix), `Credential/private path cannot enter an integration baseline: ${prefix}`);
    io.safePath(prefix); const stat = io.plain(join(root, prefix));
    if (stat.isFile()) { paths.push(prefix); check(paths.length <= 100000, 'Integration archive file limit'); return; }
    for (const name of readdirSync(join(root, prefix)).sort()) walk(root, `${prefix}/${name}`, paths);
}
function records(root: string, paths: string[]): ArchiveFile[] {
    const names = [...new Set(paths)].sort();
    check(new Set(names.map(p => p.toLowerCase())).size === names.length, 'Case-colliding integration archive paths');
    let bytes = 0;
    return names.map(path => { io.safePath(path); check(!forbidden(path), 'Credential/private archive input'); io.ancestors(join(root, path));
        const size = io.plain(join(root, path), false).size; bytes += size; check(bytes <= 20 * 1024 ** 3, 'Integration archive byte limit');
        return { path, size, sha256: io.fileHash(join(root, path)) }; });
}
function sourcePaths(root: string) {
    return io.command(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(path => path && !forbidden(path)
        && !path.startsWith('.local/') && !path.startsWith('server/engine/data/') && existsSync(join(root, path)));
}
function copy(source: string, target: string, files: ArchiveFile[]) {
    for (const file of files) { const destination = join(target, file.path); mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(source, file.path), destination); check(io.fileHash(destination) === file.sha256, 'Integration source changed during copy'); }
}
/** Provision ONLY a new workspace. Any failure discards its unpublished stage; source and older worlds are never reset. */
interface WorkspaceOptions { sourceRoot: string; output: string; fixture: IntegrationFixture;
    ports?: IntegrationBootstrapPorts; bootstrapNative?(root: string, fixture: IntegrationFixture): Promise<unknown>; assertOffline(root: string): void;
    progress?(phase: string, completed?: number, total?: number): void }
/** Bounded independent file copies keep Windows per-file I/O from serializing
 * the complete source tree. Every destination still has its exact hash checked;
 * all workers settle before a failed stage can be discarded. */
async function copyWorkspaceSources(source: string, stage: string, files: ArchiveFile[], progress?: WorkspaceOptions['progress']) {
    let next = 0, completed = 0, failure: unknown = null;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
        while (next < files.length && !failure) {
            const file = files[next++]!;
            try {
                const destination = join(stage, file.path); mkdirSync(dirname(destination), { recursive: true });
                await copyFile(join(source, file.path), destination); io.plain(destination, false);
                const hash = createHash('sha256');
                for await (const chunk of createReadStream(destination)) hash.update(chunk);
                check(hash.digest('hex') === file.sha256, 'Integration source changed during copy');
                completed++; if (completed % 1000 === 0 || completed === files.length) progress?.('copy', completed, files.length);
            } catch (error) { failure ??= error; }
        }
    }));
    if (failure) throw failure;
}
export async function createIntegrationWorkspace(options: WorkspaceOptions) { return createWorkspace(options, false); }
export async function createFoodTrialWorkspace(options: WorkspaceOptions) { return createWorkspace(options, true); }
/** Normal verified genesis over reduced packed runtime inputs, for thin founder diagnostics only.
 * It is explicitly barred from final baseline/result archiving below. */
export async function createFounderStageWorkspace(options: WorkspaceOptions) {
    check(options.fixture.founderBaseline,'Packed founder stage requires its exact founder definition');
    return createWorkspace(options,false,true);
}
async function createWorkspace(options: WorkspaceOptions, trial: boolean, founderStage=false) {
    const root = resolve(options.sourceRoot), output = resolve(options.output), fixture = validateIntegrationFixture(options.fixture);
    check(!io.under(output, root) && (!io.under(root, output) || relative(root, output).replaceAll('\\', '/').startsWith('backups/')), 'Use an external output or backups/');
    io.ancestors(root); options.assertOffline(root);
    options.progress?.('inventory');
    // Trials execute the already packed content. Raw content sources, documentation
    // and test suites are not runtime inputs; the integration baseline still keeps
    // the complete source inventory for later result restoration.
    const sources = sourcePaths(root).filter(path => !(trial||founderStage) || (!/^(?:docs|wiki|learnings|\.github|\.codex|\.gemini)\//.test(path)
        && (!path.startsWith('server/content/') || /^server\/content\/maps\/[^/]+\.csv$/.test(path))
        && !/(?:^|\/)(?:test|__tests__|integration-tests)\//.test(path) && !/\.test\.[cm]?[jt]sx?$/.test(path)));
    const paths = [...sources]; walk(root, 'server/engine/data/pack', paths);
    walk(root, 'server/engine/data/raw', paths);
    walk(root, '.local/agent-skills/shared', paths);
    const before = records(root, paths), stage = io.newStage(output);
    try {
        options.progress?.('copy', 0, before.length);
        await copyWorkspaceSources(root, stage, before, options.progress);
        writeFileSync(join(stage, '.integration-stage.json'), JSON.stringify({ fixtureDigest: fixture.digest }), { flag: 'wx' });
        // Native subprocesses use this canonical path; record the selected definition in the new clone.
        mkdirSync(join(stage, 'config/fixtures'), { recursive: true });
        writeFileSync(join(stage, 'config/fixtures/society-lobster-four-v1.json'), JSON.stringify(fixture, null, 2) + '\n');
        if (fixture.survival) stageSurvivalConfiguration(stage, fixture.survival.mode, fixture.clock.profile.seed);
        if (fixture.nativeSiteProfile) stageIntegrationSites(stage, fixture);
        const runtimeMarker = fixture.nativeSiteProfile && !trial ? stageIntegrationRuntime(stage, fixture) : null;
        check(options.ports || options.bootstrapNative, 'Native integration bootstrap adapter required');
        options.progress?.('bootstrap');
        const receipt = options.ports ? await (trial ? bootstrapFoodTrialStage : bootstrapIntegrationStage)(stage, fixture, options.ports)
            : await options.bootstrapNative!(stage, fixture);
        if (trial) check(existsSync(join(stage, FOOD_TRIAL_STATE)) && !existsSync(join(stage, INTEGRATION_STATE))
            && !existsSync(join(stage, '.local/simulation/integration-native-seal.json')), 'Trial provisioning must not emit integration evidence');
        options.progress?.('verify-source');
        options.assertOffline(root); check(digest(records(root, paths)) === digest(before), 'Source changed during integration bootstrap');
        const generated = [...(fixture.survival ? ['config/survival-profile.json'] : []), ...(fixture.nativeSiteProfile ? ['config/integration-sites-profile.json'] : []),
            ...(runtimeMarker ? [runtimeMarker] : [])];
        const effective = records(stage, [...paths, ...generated, 'server/engine/data/config/world.json']);
        writeFileSync(join(stage, '.local/simulation/integration-source.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: io.command(root, ['rev-parse', 'HEAD']).trim(),
            ...founderStage?{sourceProfile:'packed-founder-stage-v1',finalBaselineEligible:false}:{},
            bunVersion: Bun.version, platform: process.platform, files: effective, sourceFiles: [...sources, ...generated], inputSourceDigest: digest(before), digest: digest(effective) }, null, 2) + '\n', { flag: 'wx' });
        io.publish(stage, output); options.progress?.('published'); return { workspace: join(output, 'workspace'), receipt };
    } catch (error) { if (existsSync(stage)) io.discard(stage, dirname(output)); throw error; }
}
interface IntegrationArchive {
    protocol: typeof PROTOCOL; fixture: IntegrationFixture; baseline: unknown; sourceCommit: string; bunVersion: string; platform: string;
    files: ArchiveFile[]; sourceFiles: string[]; sourceTreeDigest: string; digest: string;
}
function inventory(root: string, sourceFiles: string[]) {
    const paths = [...sourceFiles, INTEGRATION_STATE, '.local/simulation/integration-source.json', 'server/engine/data/config/world.json'];
    for (const prefix of [...state, ...adminFiles, checkpoint]) walk(root, prefix, paths);
    for (const suffix of ['-wal', '-shm', '-journal']) for (const database of [checkpoint, ...adminFiles]) walk(root, `${database}${suffix}`, paths);
    const files = records(root, paths);
    for (const path of [checkpoint, '.local/agent-state/agents.sqlite', '.local/simulation/food-needs.sqlite', '.local/simulation/society-integrity.sqlite', ...adminFiles])
        check(files.some(file => file.path === path), `Required integration native source missing: ${path}`);
    check(files.some(file => file.path.startsWith('server/engine/data/pack/')), 'Native packed cache missing');
    return files;
}
export function captureIntegrationBaseline(rootInput: string, outputInput: string, fixture: IntegrationFixture, assertOffline: (root: string) => void) {
    const root = resolve(rootInput), output = resolve(outputInput);
    check(!io.under(root, output) && !io.under(output, root), 'Baseline output and workspace overlap');
    io.ancestors(root); assertOffline(root);
    const baseline = readIntegrationBaseline(root, fixture); verifyNativeIntegrationSeal(root, fixture);
    const source = JSON.parse(readFileSync(join(root, '.local/simulation/integration-source.json'), 'utf8'));
    check(!fixture.founderBaseline&&source.sourceProfile!=='packed-founder-stage-v1',
        'Reduced founder stage is ineligible for final baseline capture; create a complete-source run definition');
    check(source.digest === digest(source.files), 'Bootstrap source manifest differs');
    check(digest(records(root, source.files.map((file: ArchiveFile) => file.path))) === digest(source.files), 'Source/config/cache changed since bootstrap');
    const before = inventory(root, source.files.map((file: ArchiveFile) => file.path)), stage = io.newStage(output);
    try {
        mkdirSync(join(stage, 'payload')); copy(root, join(stage, 'payload'), before);
        assertOffline(root); check(digest(inventory(root, source.files.map((file: ArchiveFile) => file.path))) === digest(before), 'Native baseline changed during capture');
        const body = { protocol: PROTOCOL, fixture: validateIntegrationFixture(fixture), baseline, sourceCommit: source.sourceCommit,
            bunVersion: source.bunVersion, platform: source.platform, files: before, sourceFiles: source.sourceFiles,
            sourceTreeDigest: digest(before.filter(file => source.sourceFiles.includes(file.path))) };
        const manifest = { ...body, digest: digest(body) };
        writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); io.publish(stage, output); return manifest;
    } catch (error) { if (existsSync(stage)) io.discard(stage, dirname(output)); throw error; }
}
function verifyArchive<T extends Omit<IntegrationArchive, 'protocol' | 'baseline'>>(bundleInput: string, protocol: string): T {
    const root = join(resolve(bundleInput), 'workspace'); io.ancestors(root);
    const path = join(root, 'manifest.json'); check(io.plain(path, false).size <= 32 * 1024 ** 2, 'Oversized integration manifest');
    const manifest = JSON.parse(readFileSync(path, 'utf8')), { digest: hash, ...body } = manifest;
    check(manifest.protocol === protocol && digest(body) === hash, 'Integration archive manifest differs'); validateIntegrationFixture(manifest.fixture);
    check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 100000
        && Array.isArray(manifest.sourceFiles) && /^[a-f0-9]{40,64}$/.test(manifest.sourceCommit), 'Invalid integration archive metadata');
    const actual: string[] = []; for (const name of readdirSync(join(root, 'payload')).sort()) walk(join(root, 'payload'), name, actual);
    // Walk uses portable relative paths; inspect the payload without inventing authority from a saved report.
    const listed: string[] = manifest.files.map((file: ArchiveFile) => file.path);
    for (const file of manifest.files) { io.safePath(file.path); check(!forbidden(file.path) && Number.isSafeInteger(file.size) && file.size >= 0
        && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid integration archive entry'); }
    check(digest(records(join(root, 'payload'), listed)) === digest(manifest.files), 'Integration payload changed');
    check(new Set(listed.map(p => p.toLowerCase())).size === listed.length, 'Duplicate integration archive entry');
    check(manifest.sourceFiles.every((path: string) => listed.includes(path)), 'Integration source inventory is incomplete');
    check(new Set(manifest.sourceFiles).size === manifest.sourceFiles.length, 'Duplicate integration source path');
    check(manifest.sourceTreeDigest === digest(manifest.files.filter((file: ArchiveFile) => manifest.sourceFiles.includes(file.path))), 'Integration source tree differs');
    check(digest(actual.map(p => p.replace(/^\.\//, '')).sort()) === digest([...listed].sort()),
        `Unlisted integration payload files: ${actual.filter(path => !listed.includes(path)).join(', ')}`);
    return manifest;
}
export function verifyIntegrationBaseline(bundleInput: string): IntegrationArchive {
    return verifyArchive<IntegrationArchive>(bundleInput, PROTOCOL);
}
export function restoreIntegrationBaseline(bundle: string, outputInput: string) {
    const output = resolve(outputInput); check(!io.under(resolve(bundle), output) && !io.under(output, resolve(bundle)), 'Restore overlaps integration archive');
    const manifest = verifyIntegrationBaseline(bundle), stage = io.newStage(output);
    try {
        copy(join(resolve(bundle), 'workspace/payload'), stage, manifest.files); io.sqliteIntegrity(stage, manifest.files);
        check(digest(readIntegrationBaseline(stage, manifest.fixture)) === digest(manifest.baseline), 'Restored native baseline identity differs');
        verifyNativeIntegrationSeal(stage, manifest.fixture);
        io.publish(stage, output); return { workspace: join(output, 'workspace'), manifest };
    } catch (error) { if (existsSync(stage)) io.discard(stage, dirname(output)); throw error; }
}

/** Reads a frozen progressed world without migrating/observing its clock or
 * adopting it as a fresh genesis. An incomplete metrics verdict stays incomplete. */
export function readIntegrationResult(root: string, input: IntegrationFixture) {
    const fixture = validateIntegrationFixture(input); inspectIntegrationReferences(root, fixture);
    const receipt = JSON.parse(readFileSync(join(root, INTEGRATION_STATE), 'utf8'));
    const seal = JSON.parse(readFileSync(join(root, '.local/simulation/integration-native-seal.json'), 'utf8'));
    const { digest: sealDigest, ...sealBody } = seal;
    check(receipt.fixtureDigest === fixture.digest && receipt.worldId === integrationWorldId(fixture)
        && seal.fixtureDigest === fixture.digest && seal.receiptDigest === digest(receipt) && sealDigest === digest(sealBody), 'Result genesis provenance differs');
    const db = new OwnedDatabase(join(root, '.local/simulation/simulation-clock.sqlite'), { readonly: true, strict: true });
    let clock: { clock_id: string; profile_digest: string; profile_json: string; status: string; last_simulation_ms: number };
    try { clock = db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(fixture.clock.clockId) as typeof clock; }
    finally { db.close(true); }
    check(clock && clock.status === 'paused' && clock.profile_digest === simulationClockProfileDigest(fixture.clock.profile)
        && digest(JSON.parse(clock.profile_json)) === digest(fixture.clock.profile)
        && clock.last_simulation_ms > Date.parse(fixture.clock.initialSimulationTime), 'Result requires a paused progressed clock with its original profile');
    const scope = { fromSimulationTime: fixture.clock.initialSimulationTime, toSimulationTime: new Date(clock.last_simulation_ms).toISOString(),
        clockId: fixture.clock.clockId, clockProfileDigest: clock.profile_digest, actorAgentIds: fixture.avatars.map(a => a.agentId) };
    const report = reportNativeIntegration(scope, { ...nativeIntegrationOptions(root), worldId: receipt.worldId,
        nativeFoodCheckpointPath: join(root, checkpoint), nativeFoodTradePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite') });
    return { artifactKind: 'progressed-native-result' as const, fixtureDigest: fixture.digest, genesisSealDigest: sealDigest,
        receiptDigest: digest(receipt), scope, native: nativeInventory(root), report,
        liveAcceptance: 'not-established-by-archive' as const };
}
interface IntegrationResultArchive extends Omit<IntegrationArchive, 'protocol' | 'baseline'> {
    protocol: typeof RESULT_PROTOCOL; result: ReturnType<typeof readIntegrationResult>;
}
/** Every writer must already be stopped; the paused end boundary is explicit.
 * Existing inputs/archives are never overwritten or repaired by this path. */
export function captureIntegrationResult(rootInput: string, outputInput: string, fixture: IntegrationFixture, assertOffline: (root: string) => void) {
    fixture = validateIntegrationFixture(fixture);
    const root = resolve(rootInput), output = resolve(outputInput);
    check(!io.under(root, output) && !io.under(output, root), 'Result output and workspace overlap');
    io.ancestors(root); assertOffline(root);
    const source = JSON.parse(readFileSync(join(root, '.local/simulation/integration-source.json'), 'utf8'));
    check(!fixture.founderBaseline&&source.sourceProfile!=='packed-founder-stage-v1',
        'Reduced founder stage is ineligible for final result capture; create a complete-source run definition');
    const result = readIntegrationResult(root, fixture);
    check(source.digest === digest(source.files), 'Bootstrap source manifest differs');
    const paths = source.files.map((file: ArchiveFile) => file.path);
    check(digest(records(root, paths)) === digest(source.files), 'Source/config/cache changed since bootstrap');
    const before = inventory(root, paths), stage = io.newStage(output);
    try {
        const payload = join(stage, 'payload'); mkdirSync(payload); copy(root, payload, before);
        io.sqliteIntegrity(payload, before);
        check(digest(readIntegrationResult(payload, fixture)) === digest(result), 'Copied native result differs');
        assertOffline(root); check(digest(inventory(root, paths)) === digest(before), 'Native result changed during capture');
        // Readonly SQLite may rebuild WAL shared-memory indexes in the copy.
        // Seal its final bytes, after readers close, rather than source SHM bytes.
        const files = inventory(payload, paths);
        const body = { protocol: RESULT_PROTOCOL, fixture, result, sourceCommit: source.sourceCommit, bunVersion: source.bunVersion,
            platform: source.platform, files, sourceFiles: source.sourceFiles,
            sourceTreeDigest: digest(files.filter(file => source.sourceFiles.includes(file.path))) };
        const manifest = { ...body, digest: digest(body) };
        const json = JSON.stringify(manifest, null, 2) + '\n'; check(Buffer.byteLength(json) <= 32 * 1024 ** 2, 'Oversized integration manifest');
        writeFileSync(join(stage, 'manifest.json'), json, { flag: 'wx' });
        io.publish(stage, output); return manifest;
    } catch (error) { if (existsSync(stage)) io.discard(stage, dirname(output)); throw error; }
}
export function verifyIntegrationResult(bundleInput: string): IntegrationResultArchive {
    const manifest = verifyArchive<IntegrationResultArchive>(bundleInput, RESULT_PROTOCOL);
    // SQLite readonly readers may alter WAL SHM indexes. Never open a sealed
    // archive database: reread an expendable, owned copy instead.
    const parent = resolve(tmpdir()), stage = io.newStage(join(parent, `result-verify-${randomUUID()}`));
    try {
        const payload = join(resolve(bundleInput), 'workspace/payload'); copy(payload, stage, manifest.files);
        io.sqliteIntegrity(stage, manifest.files);
        check(digest(readIntegrationResult(stage, manifest.fixture)) === digest(manifest.result), 'Archived native result/report differs');
        check(digest(records(payload, manifest.files.map(file => file.path))) === digest(manifest.files), 'Integration payload changed during verification');
        return manifest;
    } finally { io.discard(stage, parent); }
}
export function restoreIntegrationResult(bundle: string, outputInput: string) {
    const output = resolve(outputInput); check(!io.under(resolve(bundle), output) && !io.under(output, resolve(bundle)), 'Restore overlaps integration archive');
    const manifest = verifyIntegrationResult(bundle), stage = io.newStage(output);
    try {
        copy(join(resolve(bundle), 'workspace/payload'), stage, manifest.files); io.sqliteIntegrity(stage, manifest.files);
        check(digest(readIntegrationResult(stage, manifest.fixture)) === digest(manifest.result), 'Restored native result/report differs');
        io.publish(stage, output); return { workspace: join(output, 'workspace'), manifest };
    } catch (error) { if (existsSync(stage)) io.discard(stage, dirname(output)); throw error; }
}
