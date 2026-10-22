import { test, expect } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { offlineArchiveIO as io } from '../../../society-experiments/archive.js';
import { societyMinimumDigest as digest } from '../../../society-minimum/policy.js';
import { INTEGRATION_ACCEPTANCE_CASES, buildIntegrationRegressionBundle, verifyIntegrationRegressionBundle, type IntegrationRegressionCase } from '../../../society-integration/acceptance.js';
import { loadIntegrationFixture, integrationWorldId } from '../../../society-integration/fixture.js';

const source = resolve(import.meta.dir, '../../..');
test('SI-A14 common four-avatar native adapter acceptance reopens the exact SI-A13 baseline in independent processes', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'si-a14-isolated-')), fixture = loadIntegrationFixture(join(source, 'config/fixtures/society-lobster-four-v1.json'));
    const capability = join(parent, 'test-workspace-owner'); writeFileSync(capability, parent);
    const links: string[] = [];
    function runtime(root: string) {
        for (const relative of ['node_modules', 'server/engine/node_modules', 'server/webclient/node_modules']) if (existsSync(join(source, relative))) {
            const link = join(root, relative); mkdirSync(resolve(link, '..'), { recursive: true }); symlinkSync(join(source, relative), link, 'junction'); links.push(link);
        }
        const key = join(root, 'server/engine/data/config/private.pem'); mkdirSync(resolve(key, '..'), { recursive: true });
        writeFileSync(key, generateKeyPairSync('rsa', { modulusLength: 512, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey, { flag: 'wx' });
        return () => { unlinkSync(key); for (const link of links.splice(0).reverse()) unlinkSync(link); };
    }
    async function child(root: string, caseId: string, crash = false, recover = false) {
        const worker = Bun.spawn([process.execPath, 'test', join(root, 'server/engine/src/mods/IntegrationSocietyAcceptance.test.ts')], {
            cwd: join(root, 'server/engine'), env: { ...process.env, CONTROL_PLANE_SERVER_ID: integrationWorldId(fixture), MANAGED_WORKSPACE: root,
                ENGINE_LOGIN_PRIVATE_KEY: readFileSync(join(root, 'server/engine/data/config/private.pem'), 'utf8'),
                SI_A14_RECOVER: recover ? '1' : '0',
                ENGINE_ADMIN_URL: 'http://127.0.0.1:65530', GATEWAY_URL: 'ws://127.0.0.1:65531', SI_A14_ISOLATED_WORKSPACE: root, SI_A14_CASE: caseId,
                PLAYER_CHECKPOINT_DATABASE: 'data/player-checkpoints.sqlite', GE_DATABASE: 'data/player-checkpoints.sqlite', PLAYER_ESCROW_SHARED_CHECKPOINT: 'true',
                TRADE_EVIDENCE_DB: 'data/mods/trade-evidence.sqlite', NODE_SHOP_ECONOMY_MODE: 'closed-society', NODE_XPRATE: '1' }, stdout: 'pipe', stderr: 'pipe' });
        let killed = false, timeout: ReturnType<typeof setTimeout> | undefined;
        if (crash) timeout = setTimeout(() => { worker.kill(); }, 30000);
        const output = (async () => { const reader = worker.stdout.getReader(); let text = '';
            while (true) { const chunk = await reader.read(); if (chunk.done) return text; text += new TextDecoder().decode(chunk.value);
                if (crash && !killed && text.includes(`SI_A14_BOUNDARY:${caseId}`)) { killed = true; worker.kill(); } }
        })();
        const [stdout, stderr, code] = await Promise.all([output, new Response(worker.stderr).text(), worker.exited]);
        if (timeout) clearTimeout(timeout);
        if (crash) { if (!killed || code === 0) throw new Error(`SI-A14 crash boundary not reached: ${caseId}\n${stdout}\n${stderr}`);
            console.info(`SI-A14 forced process termination confirmed: ${caseId}`); return; }
        if (code !== 0) throw new Error(`SI-A14 ${caseId} failed (${code})\n${stdout}\n${stderr}`);
        console.info(stdout.trim(), stderr.trim()); expect(stderr).toContain('1 pass');
    }
    try {
        const root = join(parent, 'workspace'); mkdirSync(root);
        // Named source boundary: runtime modules/config/catalog only; no UI/content sources or existing world state.
        const files = io.command(source, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(p => p && existsSync(join(source, p))
            && !/^(?:\.local|backups|bots|docs|node_modules|server\/engine\/(?:data|content)|server\/webclient)\//.test(p)
            && ((p.endsWith('.ts') && !/\.test\.ts$|\/(?:test|tests)\//.test(p)) || /^config\/.*\.json$|^agent-skills\/catalog\/.*\.json$|^sdk\/[^/]+\.json$/.test(p)
                || /^(?:package|tsconfig)\.json$|^server\/engine\/(?:package|tsconfig)\.json$/.test(p)));
        files.push('server/engine/src/mods/IntegrationSocietyAcceptance.test.ts');
        io.ancestors(source);
        const parents = new Set<string>();
        const inputFiles = [...new Set(files)].sort().map(path => { io.safePath(path); const parent = resolve(source, path, '..');
            if (!parents.has(parent)) { io.ancestors(parent); parents.add(parent); } return { path, sha256: io.fileHash(join(source, path)) }; });
        for (let offset = 0; offset < inputFiles.length; offset += 32) await Promise.all(inputFiles.slice(offset, offset + 32).map(async file => {
            const target = join(root, file.path); await mkdir(resolve(target, '..'), { recursive: true }); await copyFile(join(source, file.path), target); expect(io.fileHash(target)).toBe(file.sha256);
        }));
        cpSync(join(source, 'server/engine/data/pack'), join(root, 'server/engine/data/pack'), { recursive: true });
        cpSync(join(source, 'server/engine/src/3rdparty'), join(root, 'server/engine/src/3rdparty'), { recursive: true });
        cpSync(join(source, 'server/vendor'), join(root, 'server/vendor'), { recursive: true });
        writeFileSync(join(root, '.integration-stage.json'), JSON.stringify({ fixtureDigest: fixture.digest }));
        const closeBootstrap = runtime(root); try { await child(root, 'baseline'); } finally { closeBootstrap(); }
        const effective = [...inputFiles.map(file => file.path), 'server/engine/data/config/world.json'];
        const addPack = (path: string) => { for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
            const next = `${path}/${entry.name}`; if (entry.isDirectory()) addPack(next); else effective.push(next); } };
        for (const path of ['server/engine/data/pack', 'server/engine/src/3rdparty', 'server/vendor']) addPack(path);
        const sourceFiles = [...new Set(effective)].sort().map(path => ({ path, sha256: io.fileHash(join(root, path)), size: readFileSync(join(root, path)).length }));
        writeFileSync(join(root, '.local/simulation/integration-source.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: io.command(source, ['rev-parse', 'HEAD']).trim(),
            bunVersion: Bun.version, platform: process.platform, sourceFiles: inputFiles.map(f => f.path), files: sourceFiles, inputSourceDigest: digest(inputFiles), digest: digest(sourceFiles) }));
        const saved = join(parent, 'native-baseline'); mkdirSync(saved);
        const native = ['.local', 'server/engine/data/players', 'server/engine/data/mods', 'server/engine/data/player-checkpoints.sqlite',
            'server/engine/data/player-checkpoints.sqlite-wal', 'server/engine/data/player-checkpoints.sqlite-shm'];
        for (const relative of native) if (existsSync(join(root, relative))) { mkdirSync(resolve(saved, relative, '..'), { recursive: true }); cpSync(join(root, relative), join(saved, relative), { recursive: true }); }
        const artifact = join(source, '.local/verification', `si-a14-native-${Date.now()}`); mkdirSync(artifact, { recursive: true });
        const results: IntegrationRegressionCase[] = [], failures: string[] = [], close = runtime(root);
        try { for (const caseId of INTEGRATION_ACCEPTANCE_CASES) {
            expect(readFileSync(capability, 'utf8')).toBe(parent); expect(root.startsWith(parent + sep)).toBeTrue();
            for (const relative of native) { const target = resolve(root, relative); expect(target.startsWith(root + sep)).toBeTrue();
                rmSync(target, { recursive: true, force: true }); if (existsSync(join(saved, relative))) { mkdirSync(resolve(target, '..'), { recursive: true }); cpSync(join(saved, relative), target, { recursive: true }); } }
            let result: IntegrationRegressionCase | undefined;
            try {
                if (caseId.startsWith('crash-')) { await child(root, caseId, true); await child(root, caseId, false, true); }
                else await child(root, caseId);
                result = JSON.parse(readFileSync(join(root, '.local/si-a14-case.json'), 'utf8'));
                expect(result!.fixtureDigest).toBe(fixture.digest); expect(result!.processKilled).toBe(caseId.startsWith('crash-'));
            } catch (error) { failures.push(String(error)); }
            const destination = join(artifact, caseId); mkdirSync(destination);
            const archived: { path: string; size: number; sha256: string }[] = [];
            for (const relative of native) if (existsSync(join(root, relative))) { const target = join(destination, relative); mkdirSync(resolve(target, '..'), { recursive: true }); cpSync(join(root, relative), target, { recursive: true }); }
            const inventory = (relative: string) => { for (const entry of readdirSync(join(destination, relative), { withFileTypes: true })) {
                const path = `${relative}/${entry.name}`; if (entry.isDirectory()) inventory(path); else archived.push({ path, size: readFileSync(join(destination, path)).length, sha256: io.fileHash(join(destination, path)) }); } };
            for (const relative of ['.local', 'server/engine/data']) if (existsSync(join(destination, relative))) inventory(relative);
            io.sqliteIntegrity(destination, archived);
            // SQLite readonly quick_check may rebuild a WAL shared-memory index.
            // Seal the actual final bytes only after every database handle closes.
            for (const file of archived) { file.size = readFileSync(join(destination, file.path)).length; file.sha256 = io.fileHash(join(destination, file.path)); }
            writeFileSync(join(destination, 'files.json'), JSON.stringify(archived, null, 2));
            if (result) results.push({ ...result, evidenceFilesDigest: digest(archived) });
        } } finally { close(); }
        writeFileSync(join(artifact, 'failures.json'), JSON.stringify(failures, null, 2));
        if (failures.length) throw new Error(`SI-A14 case failures (${failures.length}); evidence: ${artifact}\n${failures.join('\n')}`);
        const seal = JSON.parse(readFileSync(join(saved, '.local/simulation/integration-native-seal.json'), 'utf8'));
        const bundle = buildIntegrationRegressionBundle({ fixtureDigest: fixture.digest, worldId: integrationWorldId(fixture), sourceDigest: digest(sourceFiles), baselineSeal: seal.digest, cases: results });
        expect(verifyIntegrationRegressionBundle(bundle)).toBeTrue();
        writeFileSync(join(artifact, 'manifest.json'), JSON.stringify(bundle, null, 2));
        console.info(`SI-A14 native evidence bundle: ${join(artifact, 'manifest.json')} digest=${bundle.digest}`);
    } finally {
        expect(resolve(parent).startsWith(resolve(tmpdir()) + sep)).toBeTrue(); expect(readFileSync(capability, 'utf8')).toBe(parent);
        rmSync(parent, { recursive: true, force: true });
    }
}, 300000);
