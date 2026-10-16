import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalManagedRuntime } from '../managed-runtime.js';
import type { ManagedServer } from '../lifecycle-store.js';

test('runtime rejects path/version/template substitutions before any filesystem provisioning', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'managed-runtime-validation-'));
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../../..'), temporary, join(temporary, 'identity.sqlite'));
    const server: ManagedServer = { serverId: `srv-${randomUUID()}`, creatorId: 'fixture', version: runtime.version, template: 'classic', ports: [20000,20001,20002,20003,20004,20005], state: 'stopped', revision: 1, error: null };
    try {
        for (const altered of [{ serverId: '../escape' }, { version: '--remote=invalid' }, { template: 'invented' }, { ports: [80,80] }])
            await expect(runtime.prepare({ ...server, ...altered })).rejects.toMatchObject({ code: 'INVALID_INSTANCE' });
        expect(existsSync(join(temporary, server.serverId))).toBe(false);
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('occupied or unidentified ports never authorize killing a foreign process or replacing its run journal', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'managed-runtime-conflict-'));
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../../..'), temporary, join(temporary, 'identity.sqlite'));
    const listeners = Array.from({ length: 6 }, () => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ foreign: true }) }));
    const ports = listeners.map(listener => listener.port!);
    const server: ManagedServer = { serverId: `srv-${randomUUID()}`, creatorId: 'fixture', version: runtime.version, template: 'classic', ports, state: 'stopped', revision: 1, error: null };
    try {
        await expect(runtime.start(server)).rejects.toMatchObject({ code: 'PORT_OCCUPIED' });
        const dir = join(temporary, server.serverId); await mkdir(dir);
        await writeFile(join(dir, 'runtime.json'), JSON.stringify({ token: 'a'.repeat(64), generation: randomUUID(), ports }));
        expect(await runtime.inspect(server)).toBe('unknown');
        await expect(runtime.stop(server)).rejects.toMatchObject({ code: 'RUNTIME_UNREACHABLE' });
        expect((await (await fetch(listeners[0]!.url)).json()).foreign).toBe(true);
    } finally { listeners.forEach(listener => listener.stop(true)); await rm(temporary, { recursive: true, force: true }); }
});

test('source export handles upstream instruction symlinks on Windows and preserves the exact prepared binding', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'managed-source-export-')), source = join(temporary, 'source');
    const git = (args: string[]) => {
        const result = Bun.spawnSync(['git', ...args], { cwd: source, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
        if (result.exitCode) throw new Error(`Fixture Git command failed: ${args[0]}`);
        return result.stdout.toString().trim();
    };
    try {
        await mkdir(source);
        for (const relative of ['node_modules', 'server/engine/node_modules', 'server/webclient/node_modules', 'server/engine/data/pack', 'server/webclient/out', 'server/control-plane', 'config'])
            await mkdir(join(source, relative), { recursive: true });
        await writeFile(join(source, 'server/control-plane/managed-worker.ts'), '// synthetic worker fixture');
        await writeFile(join(source, 'CLAUDE.md'), 'Synthetic upstream instructions');
        await writeFile(join(source, 'alias-target.txt'), 'CLAUDE.md');
        await writeFile(join(source, 'config/llm-runtime.json'), JSON.stringify({ enabled: true, autonomousExecution: { enabled: true }, skillBuilder: { enabled: true } }));
        await writeFile(join(source, 'server/engine/data/pack/main_file_cache.dat'), 'synthetic packed cache');
        await writeFile(join(source, 'server/webclient/out/client.js'), '// synthetic compiled client');
        for (const relative of ['server/engine/package.json', 'server/webclient/package.json']) await writeFile(join(source, relative), '{}');
        git(['init', '--quiet']);
        git(['add', 'CLAUDE.md', 'config/llm-runtime.json', 'server/control-plane/managed-worker.ts', 'server/engine/package.json', 'server/webclient/package.json']);
        const blob = git(['hash-object', '-w', 'alias-target.txt']);
        for (const alias of ['AGENTS.md', 'GEMINI.md']) git(['update-index', '--add', '--cacheinfo', `120000,${blob},${alias}`]);
        git(['-c', 'user.name=Repository contributor', '-c', 'user.email=contributor@example.invalid', 'commit', '--quiet', '-m', 'Synthetic source fixture']);
        await writeFile(join(source, '.env'), 'synthetic untracked settings');
        const runtime = new LocalManagedRuntime(source, join(temporary, 'instances'), join(temporary, 'identity.sqlite'));
        const server: ManagedServer = { serverId: `srv-${randomUUID()}`, creatorId: 'fixture', version: runtime.version, template: 'closed-economy', ports: [20000,20001,20002,20003,20004,20005], state: 'stopped', revision: 1, error: null };
        await runtime.prepare(server);
        const workspace = join(temporary, 'instances', server.serverId, 'workspace');
        expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(false);
        expect(existsSync(join(workspace, 'GEMINI.md'))).toBe(false);
        expect(existsSync(join(workspace, '.env'))).toBe(false);
        expect(JSON.parse(await readFile(join(workspace, 'server/engine/data/config/world.json'), 'utf8')).node).toMatchObject({ shopEconomyMode: 'closed-society', xpRate: 1 });
        expect(JSON.parse(await readFile(join(workspace, 'config/llm-runtime.json'), 'utf8')).autonomousExecution.enabled).toBe(false);
        const marker = join(workspace, 'retained.txt'); await writeFile(marker, 'retained');
        await runtime.prepare(server); expect(await readFile(marker, 'utf8')).toBe('retained');
        await expect(runtime.prepare({ ...server, template: 'classic' })).rejects.toMatchObject({ code: 'INSTANCE_BINDING_CONFLICT' });
    } finally { await rm(temporary, { recursive: true, force: true }); }
}, 20000);
