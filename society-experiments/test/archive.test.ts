import { afterEach, expect, test } from 'bun:test';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { digest } from '../../external-trade/policy.js';
import { captureSocietyArchive, restoreSocietyArchive, verifySocietyArchive } from '../archive.js';
import type { ArchiveManifest } from '../archive.js';
import type { LongExperimentPlan } from '../plan.js';
import { transitionBenchmarkClock } from '../benchmark-clock.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadSimulationClockRuntimeConfig } from '../../simulation-clock/config.js';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const plan: LongExperimentPlan = { schemaVersion: 1, sessionId: 'benchmark-test', label: 'Technical archive test', summary: 'No empirical society claim.',
    genesisResultId: 'genesis.test', genesisResultDigest: 'a'.repeat(64), parameterProfileId: 'baseline', parameterProfileVersion: '1.0.0',
    parameterProfileDigest: 'b'.repeat(64), attributeBudgetPolicyId: 'default-npc-attributes', attributeAllocationPolicyId: 'default-npc-allocation',
    expectedConditionDigest: 'c'.repeat(64), expectedInitialStateDigest: 'd'.repeat(64), warmupSimulationMilliseconds: 0,
    evaluationSimulationMilliseconds: 86400000, bucketSimulationMilliseconds: 3600000, cadenceSimulationMilliseconds: 1800000,
    maximumGapSimulationMilliseconds: 3600000, maximumWaveWallMilliseconds: 3600000, maximumWallMilliseconds: 172800000 };
function put(root: string, path: string, content: string | Buffer) { const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content); }
function git(root: string, ...args: string[]) { const result = Bun.spawnSync(['git', '-C', root, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString()); return result.stdout.toString(); }
function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'society-archive-')); directories.push(directory);
    const root = join(directory, 'original'), bundle = join(directory, 'bundle'), output = join(directory, 'restored'); mkdirSync(root);
    put(root, '.gitignore', '.local/\n.env\nserver/engine/data/\n'); put(root, 'package.json', '{"name":"archive-test"}\n');
    put(root, 'config/simulation-clock.json', '{}'); put(root, 'config/benchmark-policy.json', '{"value":1}'); put(root, 'source.ts', 'export const version = 1;\n');
    git(root, 'init', '-q'); git(root, 'add', '.'); git(root, '-c', 'user.name=Archive Test', '-c', 'user.email=archive@example.invalid', 'commit', '-qm', 'technical fixture');
    put(root, 'source.ts', 'export const version = 2;\n'); put(root, 'untracked.ts', 'export const changed = true;\n');
    put(root, '.env', 'SECRET=excluded'); put(root, '.local/admin/secrets/key.txt', 'excluded'); put(root, '.local/admin/logs/ignored.txt', 'not state');
    put(root, '.local/admin/world-mod-state.json', '{"revision":42}'); put(root, '.local/admin/diminishing-xp-state.json', '{"xp":7}');
    put(root, 'server/engine/data/players/main/ada.sav', Buffer.from([0, 1, 255])); put(root, 'server/engine/data/pack/server/script.dat', 'packed bytes');
    for (const name of ['.local/agent-state/agents.sqlite', '.local/simulation/simulation-clock.sqlite', '.local/simulation/world-genesis-runs.sqlite',
        '.local/simulation/society-integrity.sqlite', '.local/admin/experiment-parameters.sqlite', '.local/economy/businesses.sqlite', 'server/engine/data/market.sqlite']) {
        const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); const db = new Database(path, { create: true });
        try { db.run('CREATE TABLE evidence(value TEXT)'); db.run("INSERT INTO evidence VALUES('preserved')"); }
        finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
    }
    return { directory, root, bundle, output, capture: (assertOffline = () => {}) => captureSocietyArchive({ root, output: bundle, kind: 'baseline', plan, assertOffline }) };
}
function rewrite(bundle: string, change: (manifest: ArchiveManifest) => void) {
    const path = join(bundle, 'workspace/manifest.json'), manifest = JSON.parse(readFileSync(path, 'utf8')) as ArchiveManifest;
    change(manifest); const { digest: _old, ...definition } = manifest; manifest.digest = digest(definition); writeFileSync(path, JSON.stringify(manifest));
}
test('offline archive roundtrip includes dirty/untracked code, cache, saves and society state, excludes credentials', () => {
    const f = fixture(), manifest = f.capture(); expect(verifySocietyArchive(f.bundle)).toEqual(manifest);
    expect(manifest.sourceFiles).toContain('untracked.ts'); expect(manifest.absentRoots).toContain('.local/crime');
    restoreSocietyArchive(f.bundle, f.output); const restored = join(f.output, 'workspace');
    for (const file of manifest.files) expect(readFileSync(join(restored, file.path))).toEqual(readFileSync(join(f.root, file.path)));
    expect(readFileSync(join(restored, 'source.ts'), 'utf8')).toContain('version = 2');
    expect(existsSync(join(restored, '.env'))).toBe(false); expect(existsSync(join(restored, '.local/admin/secrets/key.txt'))).toBe(false);
    expect(existsSync(join(restored, '.git'))).toBe(false); expect(verifySocietyArchive(f.bundle).digest).toBe(manifest.digest);
});
test('tampered payload is rejected before restore creates a destination', () => {
    const f = fixture(); f.capture(); put(join(f.bundle, 'workspace/payload'), 'source.ts', 'tampered');
    expect(() => restoreSocietyArchive(f.bundle, f.output)).toThrow('differs'); expect(existsSync(f.output)).toBe(false);
});
test.each(['../escape', 'C:/escape', 'config/x:stream', 'config/CON.json', 'config/x.', '.local/admin/secrets/key.txt'])('unsafe manifest path is rejected: %s', path => {
    const f = fixture(); f.capture(); rewrite(f.bundle, manifest => { manifest.files[0]!.path = path; });
    expect(() => restoreSocietyArchive(f.bundle, f.output)).toThrow(); expect(existsSync(f.output)).toBe(false);
});
test('case collisions and unlisted payload files are rejected', () => {
    const f = fixture(); f.capture(); rewrite(f.bundle, manifest => { const file = manifest.files.find(file => file.path === 'source.ts')!; manifest.files.push({ ...file, path: 'SOURCE.ts' }); });
    expect(() => verifySocietyArchive(f.bundle)).toThrow('case-colliding');
    const g = fixture(); g.capture(); put(join(g.bundle, 'workspace/payload'), 'extra.ts', 'unlisted'); expect(() => verifySocietyArchive(g.bundle)).toThrow('Unlisted');
    const h = fixture(); put(h.root, 'SOURCE.ts', 'case alias');
    const blob = git(h.root, 'rev-parse', 'HEAD:source.ts').trim(); git(h.root, 'update-index', '--add', '--cacheinfo', `100644,${blob},SOURCE.ts`);
    expect(() => h.capture()).toThrow('case-colliding source'); expect(existsSync(h.bundle)).toBe(false);
});
test('offline refusal and mid-capture mutation publish no partial archive', () => {
    const f = fixture(); expect(() => f.capture(() => { throw new Error('writer active'); })).toThrow('writer active'); expect(existsSync(f.bundle)).toBe(false);
    let calls = 0; expect(() => f.capture(() => { if (++calls === 2) put(f.root, 'source.ts', 'changed during copy'); })).toThrow('Source changed');
    expect(existsSync(f.bundle)).toBe(false); expect(readdirSync(f.directory).filter(name => name.startsWith('.society-stage-'))).toEqual([]);
});
test('existing restore/capture destinations are preserved', () => {
    const f = fixture(); f.capture(); mkdirSync(f.output); put(f.output, 'sentinel', 'keep');
    expect(() => restoreSocietyArchive(f.bundle, f.output)).toThrow('already exists'); expect(readFileSync(join(f.output, 'sentinel'), 'utf8')).toBe('keep');
    expect(() => f.capture()).toThrow('already exists');
});
test('junctions, symlinks and hard links cannot escape the snapshot', () => {
    const f = fixture(), external = join(f.directory, 'external'); mkdirSync(external); put(external, 'private.txt', 'private');
    symlinkSync(external, join(f.root, '.local/economy/outside'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => f.capture()).toThrow('Links');
    const g = fixture(); linkSync(join(g.root, 'source.ts'), join(g.root, 'linked.ts')); expect(() => g.capture()).toThrow('Hard links');
});
test('corrupt SQLite is rejected without publishing a restored checkout', () => {
    const f = fixture(); put(f.root, '.local/economy/businesses.sqlite', 'not a database'); f.capture();
    expect(() => restoreSocietyArchive(f.bundle, f.output)).toThrow(); expect(existsSync(f.output)).toBe(false);
    expect(readdirSync(f.directory).filter(name => name.startsWith('.society-stage-'))).toEqual([]);
});
test('missing mandatory state fails closed and does not fabricate databases', () => {
    const f = fixture(); rmSync(join(f.root, '.local/agent-state/agents.sqlite'));
    expect(() => f.capture()).toThrow('Required benchmark input missing'); expect(existsSync(f.bundle)).toBe(false);
    expect(existsSync(join(f.root, '.local/agent-state/agents.sqlite'))).toBe(false);
});
test('WAL sidecars preserve committed evidence not checkpointed into the main file', () => {
    const f = fixture(), path = join(f.directory, 'wal.sqlite'), db = new Database(path, { create: true });
    const copies = join(f.directory, 'copies'); mkdirSync(copies);
    try { db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA wal_autocheckpoint=0'); db.run('CREATE TABLE proof(value INTEGER)'); db.run('INSERT INTO proof VALUES(42)');
        for (const suffix of ['', '-wal', '-shm']) copyFileSync(path + suffix, join(copies, 'state.sqlite' + suffix));
    } finally { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); }
    for (const suffix of ['', '-wal', '-shm']) copyFileSync(join(copies, 'state.sqlite' + suffix), join(f.root, '.local/economy/wal.sqlite' + suffix));
    const manifest = f.capture(); expect(manifest.files.some(file => file.path.endsWith('wal.sqlite-wal'))).toBe(true);
    restoreSocietyArchive(f.bundle, f.output);
    const restored = new Database(join(f.output, 'workspace/.local/economy/wal.sqlite'), { readonly: true });
    try { expect(restored.query('SELECT value FROM proof').get()).toEqual({ value: 42 }); }
    finally { (restored as Database & { clearQueryCache(): void }).clearQueryCache(); restored.close(true); }
    expect(verifySocietyArchive(f.bundle).digest).toBe(manifest.digest);
});
test('CLI verifies/restores a baseline and refuses capture without an offline assertion', () => {
    const f = fixture(); f.capture();
    const cli = resolveCli();
    const invoke = (...args: string[]) => Bun.spawnSync([process.execPath, cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const verified = invoke('--command', 'verify', '--bundle', f.bundle); expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout.toString()).nativeEvidenceVerified).toBe(false);
    const restored = invoke('--command', 'restore', '--bundle', f.bundle, '--output', f.output); expect(restored.exitCode).toBe(0);
    expect(JSON.parse(restored.stdout.toString()).restored).toBe(join(f.output, 'workspace'));
    const refused = invoke('--command', 'capture', '--root', f.root, '--plan', 'absent.json', '--output', join(f.directory, 'forbidden'));
    expect(refused.exitCode).not.toBe(0); expect(refused.stderr.toString()).toContain('--offline');
    expect(existsSync(join(f.directory, 'forbidden'))).toBe(false);
});
function resolveCli() { return join(import.meta.dir, '../../scripts/society-benchmark.ts'); }
test('native pause/resume freezes the archived clock across a long offline interval and rejects missing clocks', () => {
    const f = fixture(), configPath = join(f.root, 'config/simulation-clock.json'), clockPath = join(f.root, '.local/simulation/simulation-clock.sqlite');
    copyFileSync(join(import.meta.dir, '../../config/simulation-clock.json'), configPath); rmSync(clockPath);
    expect(() => transitionBenchmarkClock(f.root, 'pause')).toThrow(); expect(existsSync(clockPath)).toBe(false);
    const config = loadSimulationClockRuntimeConfig(configPath), store = new SimulationClockStore(clockPath);
    try { store.create({ clockId: config.clockId, profile: config.profile, wallTime: '2030-01-01T00:00:00.000Z', simulationTime: config.initialSimulationTime }); }
    finally { store.close(); }
    const paused = transitionBenchmarkClock(f.root, 'pause', '2030-01-01T00:01:00.000Z');
    const resumed = transitionBenchmarkClock(f.root, 'resume', '2030-02-01T00:00:00.000Z');
    expect(resumed.lastSimulationTime).toBe(paused.lastSimulationTime); expect(resumed.status).toBe('running');
    expect(resumed.revision).toBe(paused.revision + 1);
});
