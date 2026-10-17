import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InstanceMaintenance, instanceBinding } from '../instance-maintenance.js';
import { atomicJson, copyInventory, inventory } from '../instance-snapshots.js';
import { reservePorts } from '../runtime-leases.js';
import { ServerRegistry } from '../server-registry.js';
import { IdentityStore, csrfFor } from '../identity-store.js';
import { LifecycleManager } from '../lifecycle-manager.js';
import type { ManagedServer } from '../lifecycle-store.js';
import type { ManagedRuntime } from '../managed-runtime.js';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';

async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'world-maintenance-')), workspace = join(dir, 'workspace');
    const server: ManagedServer = { serverId: `srv-${randomUUID()}`, creatorId: 'fixture', version: 'a'.repeat(40), template: 'classic', ports: [22000,22001,22002,22003,22004,22005], state: 'stopped', revision: 1, error: null };
    await mkdir(join(workspace, '.local'), { recursive: true }); await mkdir(join(workspace, 'empty'));
    await atomicJson(join(workspace, '.local/instance.json'), { schemaVersion: 1, binding: instanceBinding(server), workspace });
    await atomicJson(join(dir, 'prepared.json'), { binding: instanceBinding(server), isolationVersion: 1 });
    await writeFile(join(workspace, '.local/save'), 'original world state');
    return { dir, workspace, server, maintenance: new InstanceMaintenance(dir, async () => {}) };
}

test('verified backup restores exact world files and empty directories, retaining the prior workspace for recovery', async () => {
    const f = await fixture(), id = randomUUID();
    try {
        const first = await f.maintenance.backup(f.server, id); expect(await f.maintenance.backup(f.server, id)).toEqual(expect.objectContaining(first));
        expect(await f.maintenance.list(f.server)).toEqual([first]);
        await writeFile(join(f.workspace, '.local/save'), 'changed world state'); await writeFile(join(f.workspace, 'extra'), 'extra');
        const operation = randomUUID(); expect(await f.maintenance.restore(f.server, id, operation)).toBe(f.server.version);
        expect(await readFile(join(f.workspace, '.local/save'), 'utf8')).toBe('original world state');
        expect(await inventory(f.workspace)).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'extra' })]));
        await f.maintenance.recover(false);
        expect(await readFile(join(f.dir, `retired-${operation}`, '.local/save'), 'utf8')).toBe('changed world state');
    } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('interrupted same-version restore rolls back after reopening; corrupt and foreign snapshots never replace current state', async () => {
    const f = await fixture(), id = randomUUID();
    try {
        await f.maintenance.backup(f.server, id); await writeFile(join(f.workspace, '.local/save'), 'before interrupted restore');
        await f.maintenance.restore(f.server, id, randomUUID());
        await new InstanceMaintenance(f.dir, async () => {}).recover(true);
        expect(await readFile(join(f.workspace, '.local/save'), 'utf8')).toBe('before interrupted restore');
        await expect(f.maintenance.restore({ ...f.server, serverId: `srv-${randomUUID()}` }, id, randomUUID())).rejects.toThrow('binding');
        await writeFile(join(f.dir, 'backups', id, 'workspace/.local/save'), 'corrupted');
        await expect(f.maintenance.restore(f.server, id, randomUUID())).rejects.toThrow('integrity');
        expect(await readFile(join(f.workspace, '.local/save'), 'utf8')).toBe('before interrupted restore');
        await expect(f.maintenance.restore(f.server, '../escape', randomUUID())).rejects.toThrow('identifier');
    } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('snapshot traversal and filesystem aliases fail closed without following the target', async () => {
    const f = await fixture(), sibling = join(f.dir, 'sibling'); await mkdir(sibling);
    try {
        await writeFile(join(sibling, 'sentinel'), 'untouched'); await symlink(sibling, join(f.workspace, 'alias'), 'junction');
        await expect(f.maintenance.backup(f.server, randomUUID())).rejects.toThrow('alias');
        await expect(copyInventory(sibling, join(f.dir, 'malicious-copy'), [{ path: '../escape', sha256: 'a'.repeat(64) }])).rejects.toThrow('entry');
        expect(await readFile(join(sibling, 'sentinel'), 'utf8')).toBe('untouched');
    } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('source migration swap recovers both rename boundaries and restores the previous prepared binding', async () => {
    const f = await fixture(), id = randomUUID(), stage = join(f.dir, `stage-${id}`);
    try {
        await copyInventory(f.workspace, stage, await inventory(f.workspace));
        const next = { binding: instanceBinding({ ...f.server, version: 'b'.repeat(40) }), isolationVersion: 1 };
        await f.maintenance.replace(f.server, stage, next, id);
        expect(JSON.parse(await readFile(join(f.dir, 'prepared.json'), 'utf8')).binding.version).toBe('b'.repeat(40));
        await new InstanceMaintenance(f.dir, async () => {}).recover(true);
        expect(JSON.parse(await readFile(join(f.dir, 'prepared.json'), 'utf8')).binding.version).toBe(f.server.version);
        expect(await readFile(join(f.workspace, '.local/save'), 'utf8')).toBe('original world state');
    } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('OS port leases release only selected ports and never displace a foreign listener', async () => {
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('foreign') }), port = probe.port!;
    await expect(reservePorts([port])).rejects.toThrow(); expect(await (await fetch(probe.url)).text()).toBe('foreign'); probe.stop(true);
    const leases = await reservePorts([port]);
    try { await expect(reservePorts([port])).rejects.toThrow(); await leases.release([port]); const next = await reservePorts([port]); await next.release(); }
    finally { await leases.release(); }
});

class Runtime implements ManagedRuntime {
    version = 'a'.repeat(40); healthy = true; backupsMade: string[] = [];
    async prepare() {} async start() { this.healthy = true; } async stop() {}
    async inspect(): Promise<'running' | 'unknown'> { return this.healthy ? 'running' : 'unknown'; }
    async backup(_server: ManagedServer, id: string) { this.backupsMade.push(id); }
    async backups() { return this.backupsMade.map(id => ({ id, version: this.version, createdAt: 1 })); }
    async migrate(_server: ManagedServer, version: string) { return version; }
    async restore() { return 'b'.repeat(40); }
}
test('supervisor debounces transient failures, checks revision atomically, persists failures and permits explicit restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'world-health-')), path = join(dir, 'registry.sqlite');
    let registry = new ServerRegistry(path); const identities = new IdentityStore(':memory:'), runtime = new Runtime();
    let manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('health-owner', 'synthetic health password');
        const operation = manager.create(owner.id, { name: 'World', version: runtime.version, template: 'classic', requestKey: randomUUID() }); await manager.idle();
        const id = operation.serverId, action = async (name: string) => { manager.action(owner.id, id, name, { requestKey: randomUUID(), expectedRevision: registry.lifecycle.managed(id)!.revision }); await manager.idle(); };
        await action('start'); runtime.healthy = false; await manager.supervise(); await manager.supervise();
        expect(registry.lifecycle.managed(id)!.state).toBe('running'); runtime.healthy = true; await manager.supervise();
        runtime.healthy = false; await manager.supervise(); await manager.supervise(); await manager.supervise();
        expect(registry.lifecycle.managed(id)).toMatchObject({ state: 'failed', error: expect.stringContaining('HEALTH_CHECK_FAILED') });
        registry.close(); registry = new ServerRegistry(path); manager = new LifecycleManager(registry, identities, runtime);
        expect(registry.lifecycle.managed(id)!.state).toBe('failed'); await action('restart'); expect(registry.lifecycle.managed(id)!.state).toBe('running');
        const before = registry.lifecycle.managed(id)!; await action('stop'); registry.lifecycle.healthFailure(id, before.revision);
        expect(registry.lifecycle.managed(id)!.state).toBe('stopped');
    } finally { await manager.idle(); registry.close(); identities.close(); await rm(dir, { recursive: true, force: true }); }
});

test('maintenance HTTP enforces ownership/CSRF, exact replay and durable input; restore updates the pinned version', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new Runtime(), manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('maintenance-owner', 'synthetic maintenance password'), other = await identities.createAccount('maintenance-other', 'synthetic other password', owner.id);
        const login = await identities.login(owner.username, 'synthetic maintenance password'), foreign = await identities.login(other.username, 'synthetic other password');
        const created = manager.create(owner.id, { name: 'World', version: runtime.version, template: 'classic', requestKey: randomUUID() }); await manager.idle();
        const handler = createControlPlane(controlPlaneConfig(), identities, fetch, registry, manager), id = created.serverId;
        const request = (action: string, data?: unknown, token = login.token, csrf = true) => handler(new Request(`http://localhost:7781/api/control-plane/servers/${id}/${action}`, {
            method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: `rs-control-session=${token}`, Origin: 'http://localhost:7781', 'X-Admin-Request': 'rs-sdk-admin', ...(csrf ? { 'X-Control-CSRF': csrfFor(token) } : {}) },
            ...(data ? { body: JSON.stringify(data) } : {}) }));
        const input = { requestKey: randomUUID(), expectedRevision: registry.lifecycle.managed(id)!.revision };
        expect((await request('backup', input, foreign.token)).status).toBe(404); expect((await request('backup', input, login.token, false)).status).toBe(403);
        const response = await request('backup', input); expect(response.status).toBe(202); const { operation } = await response.json(); await manager.idle();
        expect((await (await request('backup', input)).json()).operation.id).toBe(operation.id); expect(runtime.backupsMade).toHaveLength(1);
        expect((await request('backups', undefined, foreign.token)).status).toBe(404); expect((await (await request('backups')).json()).backups).toHaveLength(1);
        const restore = { requestKey: randomUUID(), expectedRevision: registry.lifecycle.managed(id)!.revision, backupId: operation.id };
        const restored = await (await request('restore', restore)).json(); await manager.idle();
        expect(registry.lifecycle.payload(restored.operation.id)).toEqual({ backupId: operation.id }); expect(registry.lifecycle.managed(id)!.version).toBe('b'.repeat(40));
        expect((await request('restore', { ...restore, backupId: randomUUID() })).status).toBe(409);
    } finally { await manager.idle(); registry.close(); identities.close(); }
});

test('v2 registry migration retains pending intents, ownership-independent records and audit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'registry-v3-')), path = join(dir, 'registry.sqlite');
    const initial = new ServerRegistry(path), id = `srv-${randomUUID()}`;
    const operation = initial.lifecycle.create('owner', randomUUID(), 'fingerprint', { id, name: 'Existing', version: 'a'.repeat(40), template: 'classic' }); initial.close();
    const old = new Database(path); old.exec('DROP TABLE lifecycle_maintenance; PRAGMA user_version=2'); old.close();
    const migrated = new ServerRegistry(path);
    try { expect(migrated.lifecycle.pending().map(row => row.id)).toContain(operation.id); expect(migrated.get(id)?.name).toBe('Existing'); expect(migrated.lifecycle.payload(operation.id)).toEqual({}); }
    finally { migrated.close(); await rm(dir, { recursive: true, force: true }); }
});

test('restart reconciliation uses the durable SQL outcome, rolling back pending swaps and retaining completed versions', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new Runtime();
    const decisions: boolean[] = []; let journal: string | null = null;
    const recoveryRuntime: ManagedRuntime = { ...runtime, version: runtime.version, prepare: runtime.prepare, start: runtime.start, stop: runtime.stop, inspect: runtime.inspect,
        async pendingMaintenance() { return journal; }, async recover(_server, interrupted) { decisions.push(interrupted); journal = null; } };
    let manager = new LifecycleManager(registry, identities, recoveryRuntime);
    try {
        const owner = await identities.createAccount('recovery-owner', 'synthetic recovery password');
        const created = manager.create(owner.id, { name: 'Recoverable', version: runtime.version, template: 'classic', requestKey: randomUUID() }); await manager.idle();
        const id = created.serverId;
        const begin = () => registry.lifecycle.begin(owner.id, randomUUID(), randomUUID(), id, 'migrate', registry.lifecycle.managed(id)!.revision, { targetVersion: 'b'.repeat(40) });
        const pending = begin(); journal = pending.id;
        manager = new LifecycleManager(registry, identities, recoveryRuntime); manager.recover(); await manager.idle();
        expect(decisions).toEqual([true]); expect(registry.lifecycle.operation(pending.id)!.state).toBe('failed'); expect(registry.lifecycle.managed(id)!.version).toBe(runtime.version);
        const committed = begin(); journal = committed.id; registry.lifecycle.finish(committed.id, 'stopped', null, 'b'.repeat(40));
        manager = new LifecycleManager(registry, identities, recoveryRuntime); manager.recover(); await manager.idle();
        expect(decisions).toEqual([true, false]); expect(registry.lifecycle.managed(id)!.version).toBe('b'.repeat(40));
    } finally { await manager.idle(); registry.close(); identities.close(); }
});
