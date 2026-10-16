import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = join(import.meta.dir, '../../..');
function freePort() { const socket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') }); const port = socket.port!; socket.stop(true); return port; }
async function ready(port: number) {
    const until = Date.now() + 7000;
    while (Date.now() < until) {
        try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) }); if (response.ok) return; } catch {}
        await Bun.sleep(25);
    }
    throw new Error('Independent admin did not become ready');
}
test('standalone process boots with only control-plane stores, protects data and binds only loopback', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-plane-process-')), port = freePort(), absent = freePort();
    const child = Bun.spawn([process.execPath, join(repo, 'server/control-plane/main.ts')], { cwd: temporary,
        env: { ...process.env, CONTROL_PLANE_IDENTITY_PATH: join(temporary, 'identity.sqlite'), CONTROL_PLANE_PORT: String(port), CONTROL_PLANE_GATEWAY_ORIGIN: `http://127.0.0.1:${absent}`, CONTROL_PLANE_ENGINE_ORIGIN: `http://127.0.0.1:${absent}` },
        stdout: 'ignore', stderr: Bun.file(join(temporary, 'stderr.log')) });
    try {
        await ready(port); expect(child.pid).not.toBe(process.pid);
        expect((await fetch(`http://127.0.0.1:${port}/admin/`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${port}/api/control-plane/status`)).status).toBe(401);
        expect(existsSync(join(temporary, 'identity.sqlite'))).toBe(true);
        expect(existsSync(join(temporary, 'servers.sqlite'))).toBe(true);
        expect(existsSync(join(temporary, '.local'))).toBe(false);
        const bindings = Bun.spawnSync(['pwsh', '-NoProfile', '-Command', `@(Get-NetTCPConnection -State Listen -LocalPort ${port}).LocalAddress | ConvertTo-Json -Compress`], { stdout: 'pipe', stderr: 'pipe' });
        expect(bindings.exitCode).toBe(0); expect(bindings.stdout.toString()).toContain('127.0.0.1'); expect(bindings.stdout.toString()).not.toContain('0.0.0.0');
    } finally { child.kill(); await child.exited; await rm(temporary, { recursive: true, force: true }); }
}, 15000);
test('background admin lifecycle is idempotent, port-safe and does not stop backend processes', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-plane-managed-')), stateDirectory = join(temporary, 'state');
    const backend = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ ready: true }) }), port = freePort();
    const run = async (script: string, extra: string[] = []) => {
        const child = Bun.spawn(['pwsh', '-NoProfile', '-File', join(repo, 'scripts', script), '-StateDirectory', stateDirectory, ...extra], {
            env: { ...process.env, CONTROL_PLANE_GATEWAY_ORIGIN: backend.url.origin, CONTROL_PLANE_ENGINE_ORIGIN: backend.url.origin },
            stdout: 'pipe', stderr: 'pipe' });
        const exit = await child.exited;
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            const drained = await Promise.race([Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]),
                new Promise<never>((_resolve, reject) => { drainTimer = setTimeout(() => reject(new Error('Background admin retained launcher pipes')), 1000); })]);
            await writeFile(join(temporary, script + '.log'), drained.join('\n'));
        } finally { clearTimeout(drainTimer); }
        return exit;
    };
    try {
        expect(await run('start-admin.ps1', ['-Port', String(port)])).toBe(0); await ready(port);
        const original = JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8'));
        expect(await run('start-admin.ps1', ['-Port', String(port)])).toBe(0);
        expect(JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')).pid).toBe(original.pid);
        expect(await run('stop-admin.ps1')).toBe(0); expect(existsSync(join(stateDirectory, 'runtime.json'))).toBe(false);
        expect((await fetch(new URL('/health', backend.url))).status).toBe(200);
        expect(await run('start-admin.ps1', ['-Port', String(backend.port)])).not.toBe(0);
        expect(existsSync(join(stateDirectory, 'runtime.json'))).toBe(false);
        await writeFile(join(stateDirectory, 'runtime.json'), JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAtUtc: '2000-01-01T00:00:00.000Z', port }));
        expect(await run('stop-admin.ps1')).toBe(0); expect((await fetch(new URL('/health', backend.url))).status).toBe(200);
    } finally { await run('stop-admin.ps1'); backend.stop(true); await rm(temporary, { recursive: true, force: true }); }
}, 25000);
