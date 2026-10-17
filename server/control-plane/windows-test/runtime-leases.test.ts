import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlPlaneLease } from '../runtime-leases.js';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LocalManagedRuntime } from '../managed-runtime.js';
import { ServerSecretStore } from '../secret-store.js';
import { instanceBinding } from '../instance-maintenance.js';
import type { ManagedServer } from '../lifecycle-store.js';
import { spawnManagedProcess } from '../managed-process.js';
import { reservePorts } from '../runtime-leases.js';

test('Windows permits only one control-plane writer for a canonical registry path and releases on close', async () => {
    const path = join(tmpdir(), `lease-${randomUUID()}.sqlite`), owner = await controlPlaneLease(path);
    try { await expect(controlPlaneLease(path)).rejects.toThrow(); await expect(controlPlaneLease(path.toUpperCase())).rejects.toThrow(); }
    finally { await new Promise<void>(resolve => owner.close(() => resolve())); }
    const next = await controlPlaneLease(path); await new Promise<void>(resolve => next.close(() => resolve()));
});

test('runtime releases every Windows TCP lease before spawning either worker and can restart both roles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-handoff-')), id = `srv-${randomUUID()}`, workspace = join(dir, id, 'workspace');
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../../..'), dir, join(dir, 'identity.sqlite'));
    const probes = Array.from({ length: 6 }, () => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') }));
    const ports = probes.map(probe => probe.port!); await Promise.all(probes.map(probe => probe.stop(true)));
    const server: ManagedServer = { serverId: id, creatorId: 'fixture', version: runtime.version, template: 'classic', ports, state: 'stopped', revision: 1, error: null };
    for (const relative of ['.local', 'server/engine/data/config', 'server/control-plane', 'server/gateway']) await mkdir(join(workspace, relative), { recursive: true });
    const keys = generateKeyPairSync('rsa', { modulusLength: 1024 }), publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await writeFile(join(workspace, 'server/engine/data/config/public.pem'), publicPem);
    await writeFile(join(workspace, '.local/instance.json'), JSON.stringify({ schemaVersion: 1, binding: instanceBinding(server), workspace }));
    await writeFile(join(dir, id, 'prepared.json'), JSON.stringify({ binding: instanceBinding(server), isolationVersion: 1, publicKeySha256: createHash('sha256').update(publicPem).digest('hex') }));
    await writeFile(join(workspace, 'server/control-plane/secret-store.ts'), '// synthetic vault capability');
    await writeFile(join(workspace, 'server/control-plane/authorization.ts'), '// synthetic role capability');
    await writeFile(join(workspace, 'server/control-plane/managed-worker.ts'), `
        import {writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
        const role=process.env.MANAGED_ROLE,id=process.env.CONTROL_PLANE_SERVER_ID,generation=process.env.MANAGED_GENERATION;
        const ports=role==='engine'?[process.env.WEB_PORT,process.env.WEB_MANAGEMENT_PORT,process.env.NODE_PORT]:[process.env.AGENT_PORT];
        const services=ports.map(port=>Bun.serve({hostname:'127.0.0.1',port:Number(port),fetch:()=>new Response('synthetic service')}));
        Bun.serve({hostname:'127.0.0.1',port:Number(process.env.MANAGED_CONTROL_PORT),async fetch(req){
            if(req.headers.get('authorization')!=='Bearer '+process.env.MANAGED_CONTROL_TOKEN)return new Response(null,{status:401});
            if(req.method==='GET')return Response.json({id,role,generation,ready:true,stopping:false});
            await writeFile(resolve(process.env.MANAGED_WORKSPACE,'../gateway-quiesced.json'),JSON.stringify({id,generation}));
            setTimeout(()=>process.exit(0),50);return Response.json({stopping:true});
        }});
    `);
    const store = new ServerSecretStore(workspace);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('control plane') });
    const adminPort = admin.port!;
    try {
        await store.set('engine-login-key', keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
        await runtime.start(server); expect(await runtime.connection(server)).toEqual({ engine: true, gateway: true });
        await admin.stop(true);
        const replacement = Bun.serve({ hostname: '127.0.0.1', port: adminPort, fetch: () => new Response('replacement admin') });
        try { expect(await (await fetch(replacement.url)).text()).toBe('replacement admin'); }
        finally { await replacement.stop(true); }
        await runtime.stop(server); expect(await runtime.inspect(server)).toBe('stopped');
        await runtime.start(server); expect(await runtime.inspect(server)).toBe('running'); await runtime.stop(server);
    } finally { await admin.stop(true); await runtime.stop(server); for (const name of ['engine-login-key', 'worker-control-token']) await store.delete(name); await rm(dir, { recursive: true, force: true }); }
}, 20000);

test('aborting a launcher closes only its owned startup process, including paths with spaces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime launch abort ')), worker = join(dir, 'worker script.ts');
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') }), port = probe.port!; await probe.stop(true);
    await writeFile(worker, `Bun.serve({hostname:'127.0.0.1',port:${port},fetch:()=>new Response('owned startup')});`);
    const child = spawnManagedProcess({ executable: process.execPath, worker, cwd: dir,
        environment: Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
        stdout: join(dir, 'worker.out.log'), stderr: join(dir, 'worker.err.log'), launchError: join(dir, 'launcher.err.log') });
    try {
        const until = Date.now() + 5000; let ready = false;
        while (Date.now() < until && !ready) {
            try { ready = await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(100) })).text() === 'owned startup'; } catch {}
            if (!ready) await Bun.sleep(50);
        }
        expect(ready).toBe(true); await child.kill(); await child.exited;
        const lease = await reservePorts([port]); await lease.release();
    } finally { await child.kill(); await rm(dir, { recursive: true, force: true }); }
}, 10000);
