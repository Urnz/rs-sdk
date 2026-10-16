import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IdentityStore, csrfFor } from '../identity-store.js';
import { ServerRegistry } from '../server-registry.js';
import { LifecycleManager } from '../lifecycle-manager.js';
import type { ManagedRuntime } from '../managed-runtime.js';
import type { ManagedServer } from '../lifecycle-store.js';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';
import { createGatewayIdentityGate } from '../gateway-identity.js';

export class FixtureRuntime implements ManagedRuntime {
    version = 'a'.repeat(40); calls: string[] = []; running = new Set<string>(); failure: string | null = null;
    async prepare(server: ManagedServer) { this.calls.push(`prepare:${server.serverId}`); if (this.failure === 'prepare') throw new Error('private provider detail'); }
    async start(server: ManagedServer) { this.calls.push(`start:${server.serverId}`); if (this.failure === 'start') throw new Error('private process detail'); this.running.add(server.serverId); }
    async stop(server: ManagedServer) { this.calls.push(`stop:${server.serverId}`); this.running.delete(server.serverId); }
    async inspect(server: ManagedServer): Promise<'running' | 'stopped'> { return this.running.has(server.serverId) ? 'running' : 'stopped'; }
}
const creation = (runtime: ManagedRuntime, name = 'Tesztvilág') => ({ name, version: runtime.version, template: 'classic', requestKey: randomUUID() });

test('create replays exactly, conflicting requests fail closed, two worlds have distinct ownership and ports', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new FixtureRuntime();
    const manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('lifecycle-owner', 'synthetic lifecycle password');
        const other = await identities.createAccount('lifecycle-other', 'synthetic other password', owner.id);
        const input = creation(runtime), first = manager.create(owner.id, input);
        expect(manager.create(owner.id, input).id).toBe(first.id);
        expect(() => manager.create(owner.id, { ...input, name: 'Másik név' })).toThrow('más kérés');
        const second = manager.create(other.id, creation(runtime, 'Második világ')); await manager.idle();
        expect(manager.operation(owner.id, first.id).state).toBe('succeeded');
        const a = registry.lifecycle.managed(first.serverId)!, b = registry.lifecycle.managed(second.serverId)!;
        expect(a.state).toBe('stopped'); expect(a.ports.some(port => b.ports.includes(port))).toBe(false);
        expect(identities.owns(owner.id, a.serverId)).toBe(true); expect(identities.owns(owner.id, b.serverId)).toBe(false);
        expect(() => manager.action(other.id, a.serverId, 'start', { requestKey: randomUUID(), expectedRevision: a.revision })).toThrow('nem található');
        expect(() => manager.operation(other.id, first.id)).toThrow('nem található');
        expect(runtime.calls.filter(call => call.startsWith('prepare:'))).toHaveLength(2);
    } finally { await manager.idle(); registry.close(); identities.close(); }
});

test('start stop restart archive are serialized, audited, revision-protected and archived data stays registered', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new FixtureRuntime();
    const manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('actions-owner', 'synthetic actions password');
        const create = manager.create(owner.id, creation(runtime)); await manager.idle(); const id = create.serverId;
        const act = (action: string) => manager.action(owner.id, id, action, { requestKey: randomUUID(), expectedRevision: registry.lifecycle.managed(id)!.revision });
        const start = act('start');
        expect(() => act('archive')).toThrow('már fut művelet');
        await manager.idle(); expect(manager.operation(owner.id, start.id).state).toBe('succeeded');
        expect((await manager.view(id))?.observedState).toBe('running');
        expect(() => manager.action(owner.id, id, 'stop', { requestKey: randomUUID(), expectedRevision: 1 })).toThrow('megváltozott');
        act('restart'); await manager.idle(); expect(runtime.running.has(id)).toBe(true);
        act('stop'); await manager.idle(); expect(runtime.running.has(id)).toBe(false);
        act('archive'); await manager.idle(); expect(registry.lifecycle.managed(id)?.state).toBe('archived');
        expect(registry.get(id)).not.toBeNull(); expect(() => act('start')).toThrow('archivált');
    } finally { await manager.idle(); registry.close(); identities.close(); }
});

test('failed and interrupted operations retain evidence, ownership intent recovers without replaying process starts', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new FixtureRuntime();
    let manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('recovery-owner', 'synthetic recovery password');
        runtime.failure = 'prepare'; const failed = manager.create(owner.id, creation(runtime)); await manager.idle();
        expect(manager.operation(owner.id, failed.id)).toMatchObject({ state: 'failed' });
        expect(manager.operation(owner.id, failed.id).error).not.toContain('private provider');
        runtime.failure = null;
        const input = creation(runtime), id = `srv-${randomUUID()}`;
        const pending = registry.lifecycle.create(owner.id, input.requestKey, registry.lifecycle.fingerprint({ name: input.name, version: input.version, template: input.template }),
            { id, name: input.name, version: input.version, template: input.template });
        expect(identities.owns(owner.id, id)).toBe(false);
        manager = new LifecycleManager(registry, identities, runtime); manager.recover(); await manager.idle();
        expect(identities.owns(owner.id, id)).toBe(true);
        expect(manager.operation(owner.id, pending.id)).toMatchObject({ state: 'failed' });
        expect(manager.operation(owner.id, pending.id).error).toContain('OPERATION_INTERRUPTED');
        expect(runtime.calls.some(call => call.startsWith('start:'))).toBe(false);
    } finally { await manager.idle(); registry.close(); identities.close(); }
});

test('v1 registry migration preserves bindings/history and lifecycle state survives reopening', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'lifecycle-migrate-')), path = join(temporary, 'servers.sqlite');
    const db = new Database(path, { create: true }); db.exec(`CREATE TABLE servers (id TEXT PRIMARY KEY,name TEXT NOT NULL,gateway_origin TEXT NOT NULL,engine_origin TEXT NOT NULL,registered_at INTEGER NOT NULL);
        CREATE TABLE registry_audit (sequence INTEGER PRIMARY KEY,kind TEXT NOT NULL,server_id TEXT NOT NULL,created_at INTEGER NOT NULL); PRAGMA user_version=1;`);
    db.query('INSERT INTO servers VALUES (?,?,?,?,?)').run('old-world', 'Régi világ', 'http://localhost:7001', 'http://localhost:7002', 123); db.close();
    let registry = new ServerRegistry(path);
    try {
        expect(registry.get('old-world')?.registeredAt).toBe(123);
        const id = `srv-${randomUUID()}`, operation = registry.lifecycle.create('fixture-actor', randomUUID(), 'fixture-fingerprint', { id, name: 'Új világ', version: 'a'.repeat(40), template: 'classic' });
        registry.close(); registry = new ServerRegistry(path);
        expect(registry.lifecycle.managed(id)?.state).toBe('provisioning'); expect(registry.lifecycle.operation(operation.id)?.state).toBe('running');
        expect(registry.get('old-world')?.registeredAt).toBe(123);
    } finally { registry.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('HTTP catalog and mutations enforce sessions/CSRF/ownership and report accepted operation IDs', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:'), runtime = new FixtureRuntime();
    const manager = new LifecycleManager(registry, identities, runtime);
    try {
        const owner = await identities.createAccount('http-lifecycle', 'synthetic HTTP password');
        const login = await identities.login(owner.username, 'synthetic HTTP password');
        const handler = createControlPlane(controlPlaneConfig(), identities, async () => Response.json({}), registry, manager);
        const request = (path: string, data?: unknown, csrf = true) => new Request('http://localhost:7781/api/control-plane/servers' + path, {
            method: data ? 'POST' : 'GET', headers: { Cookie: `rs-control-session=${login.token}`, Origin: 'http://localhost:7781', 'Content-Type': 'application/json',
                'X-Admin-Request': 'rs-sdk-admin', ...(csrf ? { 'X-Control-CSRF': csrfFor(login.token) } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
        expect((await handler(new Request('http://localhost:7781/api/control-plane/servers/catalog'))).status).toBe(401);
        expect((await (await handler(request('/catalog'))).json()).templates).toHaveLength(2);
        expect((await handler(request('', creation(runtime), false))).status).toBe(403);
        expect((await handler(request('', { ...creation(runtime), template: 'invented' }))).status).toBe(400);
        const response = await handler(request('', creation(runtime))); expect(response.status).toBe(202);
        const { operation } = await response.json(); await manager.idle();
        expect((await (await handler(request(`/operations/${operation.id}`))).json()).operation.state).toBe('succeeded');
        expect((await (await handler(request(''))).json()).servers[0].managed.state).toBe('stopped');
    } finally { await manager.idle(); registry.close(); identities.close(); }
});

test('managed gateway accepts its own owner only, not the legacy local-server owner', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'managed-gateway-')), path = join(temporary, 'identity.sqlite');
    const identities = new IdentityStore(path), id = `srv-${randomUUID()}`;
    const gate = createGatewayIdentityGate(path, id);
    try {
        const legacy = await identities.createAccount('legacy-owner', 'synthetic legacy password');
        const owner = await identities.createAccount('managed-owner', 'synthetic managed password', legacy.id);
        identities.initializeManagedOwnership(owner.id, id);
        for (const [username, password, expected] of [[legacy.username, 'synthetic legacy password', 403], [owner.username, 'synthetic managed password', 0]] as const) {
            const login = await identities.login(username, password);
            expect(gate(new Request('http://localhost:19000/api/admin/config', { headers: { Cookie: `rs-control-session=${login.token}` } }))?.status ?? 0).toBe(expected);
        }
        expect(() => identities.initializeManagedOwnership(legacy.id, id)).toThrow('ütközik');
    } finally { gate.close(); identities.close(); await rm(temporary, { recursive: true, force: true }); }
});
