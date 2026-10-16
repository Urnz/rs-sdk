import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
