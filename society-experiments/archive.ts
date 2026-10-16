import { createHash, randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { digest } from '../external-trade/policy.js';
import { check } from '../external-trade/source.js';
import { validateLongExperimentPlan, type LongExperimentPlan } from './plan.js';

/** Local private archive, never a publishable/redacted dataset. No live-world overwrite operation. */
export const ARCHIVE_PROTOCOL = 'society-offline-archive-v1';
const stateRoots = ['.local/admin', '.local/agent-state', '.local/agent-skills', '.local/crime', '.local/economy', '.local/simulation',
    'server/engine/data/mods', 'server/engine/data/players', 'server/engine/data/config', 'server/engine/data/pack'];
const engineFiles = ['server/engine/db.sqlite', 'server/engine/data/market.sqlite'];
const required = ['package.json', 'config/simulation-clock.json', '.local/agent-state/agents.sqlite', '.local/simulation/simulation-clock.sqlite',
    '.local/simulation/world-genesis-runs.sqlite', '.local/simulation/society-integrity.sqlite', '.local/admin/experiment-parameters.sqlite'];
const maxFiles = 100000, maxBytes = 20 * 1024 ** 3;
export interface ArchiveFile { path: string; size: number; sha256: string }
export interface ArchiveManifest {
    protocol: typeof ARCHIVE_PROTOCOL; kind: 'baseline' | 'result'; createdAt: string; plan: LongExperimentPlan;
    sourceCommit: string; bunVersion: string; platform: string; sourceTreeDigest: string;
    files: ArchiveFile[]; sourceFiles: string[]; absentRoots: string[]; report: unknown; digest: string;
}
function safePath(path: string) {
    check(typeof path === 'string' && path.length > 0 && path.length < 500 && !/[\\:\x00-\x1f]/.test(path), 'Invalid archive path');
    check(path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
        && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'Unsafe archive path');
    check(!path.split('/').some(part => /^(?:\.env(?:\..*)?|bot\.env|secrets|node_modules|\.git)$/i.test(part)), 'Excluded private/runtime path');
    return path;
}
const slash = (path: string) => path.replaceAll('\\', '/');
function under(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)); }
function plain(path: string, directory?: boolean) {
    const stat = lstatSync(path);
    check(!stat.isSymbolicLink() && (directory === undefined ? stat.isDirectory() || stat.isFile() : directory ? stat.isDirectory() : stat.isFile()), 'Links and special files are not supported');
    check(stat.nlink <= 1 || stat.isDirectory(), 'Hard links are not supported');
    return stat;
}
/** Check every existing ancestor too, including junctions outside the immediate tree. */
function ancestors(path: string) {
    let current = resolve(path);
    while (true) { if (existsSync(current)) plain(current); const next = dirname(current); if (next === current) break; current = next; }
}
function fileHash(path: string) {
    plain(path, false); const fd = openSync(path, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
    finally { closeSync(fd); }
    return hash.digest('hex');
}
function command(root: string, args: string[]) {
    const result = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
    check(result.exitCode === 0, 'Archive requires an accessible Git checkout'); return result.stdout.toString();
}
function excluded(path: string) {
    return path.split('/').some(part => /^(?:\.env(?:\..*)?|bot\.env|secrets|node_modules|\.git)$/i.test(part))
        || /^(?:backups|\.local|bots)\//.test(path) || /^server\/engine\/(?:db\.sqlite|data\/(?:mods|players|pack|config|market\.sqlite))/.test(path);
}
function walk(root: string, prefix: string, result: string[]) {
    const path = join(root, prefix); if (!existsSync(path)) return;
    const stat = plain(path);
    if (stat.isFile()) { result.push(safePath(prefix)); check(result.length <= maxFiles, 'Archive file limit exceeded'); return; }
    for (const entry of readdirSync(path).sort()) {
        const next = `${prefix}/${entry}`;
        if (next.startsWith('.local/admin/') && /^(?:logs|skill-logs|secrets|trash|fixture-backups|world-mod-backups)(?:\/|$)/.test(next.slice(13))) continue;
        // Credentials are never copied; other unexpected files fail closed rather than being silently lost.
        safePath(next); walk(root, next, result);
    }
}
function inventory(root: string) {
    const sourceFiles = command(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0')
        .filter(path => path && !excluded(path) && existsSync(join(root, path))).map(safePath).sort();
    check(sourceFiles.includes('package.json'), 'Source checkout is incomplete');
    const paths = [...sourceFiles];
    for (const path of stateRoots) walk(root, path, paths);
    for (const path of engineFiles) for (const suffix of ['', '-wal', '-shm', '-journal']) walk(root, path + suffix, paths);
    const unique = [...new Set(paths)].sort(); check(unique.length <= maxFiles, 'Archive file limit exceeded');
    check(new Set(unique.map(path => path.toLowerCase())).size === unique.length, 'Duplicate/case-colliding source path');
    let bytes = 0;
    const files = unique.map(path => { ancestors(join(root, path)); const size = plain(join(root, path), false).size;
        bytes += size; check(bytes <= maxBytes, 'Archive byte limit exceeded'); return { path, size, sha256: fileHash(join(root, path)) }; });
    for (const path of required) check(unique.includes(path), `Required benchmark input missing: ${path}`);
    check(unique.some(path => path.startsWith('server/engine/data/players/')), 'Player saves required');
    check(unique.some(path => path.startsWith('server/engine/data/pack/')), 'Packed world cache required');
    return { files, sourceFiles, absentRoots: [...stateRoots, ...engineFiles].filter(path => !existsSync(join(root, path))),
        sourceTreeDigest: digest(files.filter(file => sourceFiles.includes(file.path))) };
}
function sqliteIntegrity(root: string, files: ArchiveFile[]) {
    for (const file of files.filter(file => /\.sqlite$/.test(file.path))) {
        let db: Database | undefined;
        try { db = new Database(join(root, file.path), { readonly: true, strict: true });
            const rows = db.query('PRAGMA quick_check').all() as Record<string, unknown>[];
            check(rows.length === 1 && Object.values(rows[0]!)[0] === 'ok', `SQLite integrity failed: ${file.path}`);
        } finally { if (db) { (db as Database & { clearQueryCache(): void }).clearQueryCache(); db.close(true); } }
    }
}
function newStage(destination: string) {
    ancestors(destination); check(!existsSync(destination), 'Destination already exists; overwrite is forbidden');
    plain(dirname(destination), true);
    const stage = join(dirname(destination), `.society-stage-${randomUUID()}`); mkdirSync(stage); return stage;
}
function discard(stage: string, parent: string) {
    check(under(parent, stage) && dirname(stage) === parent && stage.startsWith(join(parent, '.society-stage-')), 'Unsafe staging cleanup');
    ancestors(stage); rmSync(stage, { recursive: true, force: true });
}
function publish(stage: string, destination: string) {
    ancestors(destination); check(!existsSync(destination), 'Destination appeared during operation');
    // Reserve destination so rename cannot silently replace an empty directory created by another actor.
    mkdirSync(destination);
    try { renameSync(stage, join(destination, 'workspace')); }
    catch (error) { if (readdirSync(destination).length === 0) rmSync(destination); throw error; }
}
/** Required offline guard runs on both boundaries. Caller must stop ALL external writers, not only TCP listeners. */
export function captureSocietyArchive(options: { root: string; output: string; kind: 'baseline' | 'result'; plan: LongExperimentPlan;
    assertOffline(): void; readReport?(root: string): unknown; validateBaseline?(): void }) {
    const root = resolve(options.root), output = resolve(options.output), plan = validateLongExperimentPlan(options.plan);
    check(options.kind === 'baseline' || options.kind === 'result', 'Invalid archive kind');
    check(!under(output, root) && (!under(root, output) || slash(relative(root, output)).startsWith('backups/')), 'Use an external destination or backups/');
    ancestors(root); options.assertOffline();
    if (options.kind === 'baseline') options.validateBaseline?.();
    const report = options.kind === 'result' ? options.readReport?.(root) : null;
    // Even readonly SQLite can initialize WAL shared-memory files; finish native reads before hashing inputs.
    const before = inventory(root);
    if (options.kind === 'result') check(before.files.some(file => file.path === '.local/admin/long-experiments.sqlite') && report, 'Result requires native report and journal');
    const stage = newStage(output);
    try {
        const payload = join(stage, 'payload'); mkdirSync(payload);
        for (const file of before.files) { const target = join(payload, file.path); mkdirSync(dirname(target), { recursive: true });
            copyFileSync(join(root, file.path), target); check(fileHash(target) === file.sha256, 'Source changed while copying'); }
        // Quick-check may create/change SQLite SHM files. Do it in an expendable restore, never in the hashed payload.
        options.assertOffline(); check(digest(inventory(root)) === digest(before), 'Source changed during offline capture');
        const definition: Omit<ArchiveManifest, 'digest'> = { protocol: ARCHIVE_PROTOCOL, kind: options.kind, createdAt: new Date().toISOString(), plan,
            sourceCommit: command(root, ['rev-parse', 'HEAD']).trim(), bunVersion: Bun.version, platform: process.platform,
            ...before, report };
        const manifest: ArchiveManifest = { ...definition, digest: digest(definition) };
        const manifestText = JSON.stringify(manifest, null, 2) + '\n';
        check(Buffer.byteLength(manifestText) <= 32 * 1024 ** 2, 'Manifest too large');
        writeFileSync(join(stage, 'manifest.json'), manifestText, { flag: 'wx' });
        publish(stage, output); return manifest;
    } catch (error) { if (existsSync(stage)) discard(stage, dirname(output)); throw error; }
}
/** Layout is <bundle>/workspace/{manifest.json,payload/...}. No extracted path comes from an unchecked manifest. */
export function verifySocietyArchive(bundle: string): ArchiveManifest {
    ancestors(bundle); const root = join(resolve(bundle), 'workspace'); plain(root, true);
    plain(join(root, 'manifest.json'), false); check(lstatSync(join(root, 'manifest.json')).size <= 32 * 1024 ** 2, 'Manifest too large');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as ArchiveManifest;
    const { digest: hash, ...definition } = manifest;
    check(manifest.protocol === ARCHIVE_PROTOCOL && digest(definition) === hash, 'Archive manifest differs');
    validateLongExperimentPlan(manifest.plan);
    check(['baseline', 'result'].includes(manifest.kind) && /^[a-f0-9]{40,64}$/.test(manifest.sourceCommit)
        && typeof manifest.bunVersion === 'string' && typeof manifest.platform === 'string' && Number.isFinite(Date.parse(manifest.createdAt)), 'Invalid archive metadata');
    check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= maxFiles && Array.isArray(manifest.sourceFiles)
        && Array.isArray(manifest.absentRoots), 'Invalid archive inventory');
    const seen = new Set<string>(); let bytes = 0;
    for (const file of manifest.files) {
        safePath(file.path); const folded = file.path.toLowerCase(); check(!seen.has(folded), 'Duplicate/case-colliding archive path'); seen.add(folded);
        check(Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid archive file');
        bytes += file.size; check(bytes <= maxBytes, 'Archive byte limit exceeded');
        const path = join(root, 'payload', file.path); ancestors(path);
        check(plain(path, false).size === file.size && fileHash(path) === file.sha256, `Archive file differs: ${file.path}`);
    }
    for (const path of required) check(seen.has(path), `Required archived input missing: ${path}`);
    check(manifest.sourceFiles.every(path => { safePath(path); return !excluded(path) && seen.has(path.toLowerCase()); })
        && new Set(manifest.sourceFiles).size === manifest.sourceFiles.length, 'Invalid source inventory');
    check(digest(manifest.files.filter(file => manifest.sourceFiles.includes(file.path))) === manifest.sourceTreeDigest, 'Source tree differs');
    check(manifest.absentRoots.every(path => [...stateRoots, ...engineFiles].includes(path)
        && !manifest.files.some(file => file.path === path || file.path.startsWith(path + '/'))), 'Invalid missing-root inventory');
    const actual: string[] = []; walk(root, 'payload', actual);
    check(digest(actual.map(path => path.slice(8)).sort()) === digest(manifest.files.map(file => file.path).sort()), 'Unlisted payload files');
    return manifest;
}
/** Restores the entire checkout/state into <output>/workspace; credentials and installed dependencies are supplied separately. */
export function restoreSocietyArchive(bundle: string, outputPath: string) {
    const output = resolve(outputPath); check(!under(resolve(bundle), output) && !under(output, resolve(bundle)), 'Restore and archive overlap');
    const manifest = verifySocietyArchive(bundle), stage = newStage(output);
    try {
        for (const file of manifest.files) { const source = join(resolve(bundle), 'workspace/payload', file.path), target = join(stage, file.path);
            ancestors(source); mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
            check(fileHash(target) === file.sha256, 'Archive changed during restore'); }
        sqliteIntegrity(stage, manifest.files);
        publish(stage, output); return manifest;
    } catch (error) { if (existsSync(stage)) discard(stage, dirname(output)); throw error; }
}
