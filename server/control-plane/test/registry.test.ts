import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerRegistry, serverRegistryPath } from '../server-registry.js';
import { IdentityStore, csrfFor } from '../identity-store.js';
import { controlPlaneConfig } from '../config.js';
import { createControlPlane } from '../service.js';

const config = controlPlaneConfig();
test('registry survives restart, exact registration replays once and conflicting bindings fail closed', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'server-registry-')), path = join(temporary, 'servers.sqlite');
    let registry = new ServerRegistry(path, () => 1000);
    try {
        const first = registry.ensureConfiguredLocal(config);
        expect(registry.ensureConfiguredLocal(config)).toEqual(first);
        expect(() => registry.ensureConfiguredLocal({ ...config, gatewayOrigin: 'http://localhost:7000' })).toThrow('más regisztráció');
        registry.close(); registry = new ServerRegistry(path, () => 2000);
        expect(registry.get('local-default')).toEqual(first);
        const db = new Database(path);
        try {
            expect((db.query('SELECT COUNT(*) AS count FROM registry_audit').get() as { count: number }).count).toBe(1);
            db.exec("CREATE TRIGGER refuse_registry_audit BEFORE INSERT ON registry_audit BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
            expect(() => registry.register({ id: 'rollback', name: 'Rollback', gatewayOrigin: 'http://localhost:7001', engineOrigin: 'http://localhost:7002' })).toThrow('fixture audit failure');
            expect(registry.get('rollback')).toBeNull();
        } finally { db.close(); }
    } finally { registry.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('registry rejects unsafe metadata and future schemas without modifying identity state', async () => {
    const registry = new ServerRegistry(':memory:');
    try {
        const valid = { id: 'valid', name: 'Északi világ', gatewayOrigin: 'http://localhost:7001', engineOrigin: 'http://localhost:7002' };
        for (const id of ['', '../escape', 'valid\n', 'a'.repeat(65)]) expect(() => registry.register({ ...valid, id })).toThrow();
        for (const name of ['', ' ', 'valid\n', 'a'.repeat(81)]) expect(() => registry.register({ ...valid, name })).toThrow();
        for (const gatewayOrigin of ['http://example.invalid', 'http://localhost:7001/path', 'https://localhost:7001']) expect(() => registry.register({ ...valid, gatewayOrigin })).toThrow();
        expect(registry.register(valid).name).toBe(valid.name);
    } finally { registry.close(); }
    const temporary = await mkdtemp(join(tmpdir(), 'server-registry-schema-')), path = join(temporary, 'servers.sqlite');
    const db = new Database(path, { create: true }); db.exec('PRAGMA user_version=99'); db.close();
    try {
        expect(() => new ServerRegistry(path)).toThrow('Unsupported');
        expect(() => serverRegistryPath(path)).toThrow('must differ');
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('list/detail expose only owned servers; foreign records and unbound endpoints are never probed', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'server-registry-access-')), identity = join(temporary, 'identity.sqlite');
    const identities = new IdentityStore(identity), registry = new ServerRegistry(join(temporary, 'servers.sqlite'));
    try {
        const owner = await identities.createAccount('registry-owner', 'synthetic registry password');
        const other = await identities.createAccount('registry-other', 'synthetic other password', owner.id);
        const empty = await identities.createAccount('registry-empty', 'synthetic empty password', owner.id);
        registry.ensureConfiguredLocal(config);
        for (const [id, name] of [['alpine', '<img src=x onerror=alert(1)>'], ['private-world', 'Privát világ']])
            registry.register({ id: id!, name: name!, gatewayOrigin: 'http://localhost:7001', engineOrigin: 'http://localhost:7002' });
        // Import existing ownership fixtures; registering metadata itself grants nobody any rights.
        const db = new Database(identity);
        try { db.query('INSERT INTO ownership VALUES (?,?)').run(owner.id, 'alpine'); db.query('INSERT INTO ownership VALUES (?,?)').run(other.id, 'private-world'); }
        finally { db.close(); }
        const calls: string[] = [];
        const handler = createControlPlane(config, identities, async url => { calls.push(url.toString()); throw new Error('fixture absent'); }, registry);
        const login = async (username: string, password: string) => {
            const session = await identities.login(username, password);
            return (path: string) => handler(new Request('http://127.0.0.1:7781' + path, { headers: {
                Cookie: `rs-control-session=${session.token}`,
                ...(path.startsWith('/admin/index.html?') ? {} : { 'X-Control-Server-ID': 'local-default' })
            } }));
        };
        const own = await login(owner.username, 'synthetic registry password');
        const result = await (await own('/api/control-plane/servers')).json();
        expect(result.servers.map((server: { id: string }) => server.id).sort()).toEqual(['alpine', 'local-default']);
        expect(JSON.stringify(result)).not.toContain('Privát világ'); expect(JSON.stringify(result)).not.toContain('gatewayOrigin');
        expect(result.servers.find((server: { id: string }) => server.id === 'alpine').adminUrl).toBeNull();
        expect(calls.sort()).toEqual(['http://localhost:7780/status', 'http://localhost:8888/engine-status']);
        const foreign = await own('/api/control-plane/servers/private-world'), missing = await own('/api/control-plane/servers/missing-world');
        expect(foreign.status).toBe(404); expect(await foreign.json()).toEqual(await missing.json());
        const theirs = await login(other.username, 'synthetic other password');
        expect((await (await theirs('/api/control-plane/servers')).json()).servers.map((server: { id: string }) => server.id)).toEqual(['private-world']);
        expect((await theirs('/admin/')).status).toBe(200); expect((await theirs('/api/admin/config')).status).toBe(404);
        const noServers = await login(empty.username, 'synthetic empty password');
        expect(await (await noServers('/api/control-plane/servers')).json()).toEqual({ schemaVersion: 1, servers: [] });
        expect(calls).toHaveLength(2);
        // Revocation immediately removes the card and the detail without revoking the account session.
        identities.setOwnership(owner.id, other.id, true); identities.setOwnership(other.id, owner.id, false);
        expect((await (await own('/api/control-plane/servers')).json()).servers.map((server: { id: string }) => server.id)).toEqual(['alpine']);
        expect((await own('/api/control-plane/servers/local-default')).status).toBe(404);
        const deniedPage = await own('/admin/index.html?serverId=alpine');
        expect(deniedPage.status).toBe(404);
        expect((await theirs('/admin/index.html?serverId=private-world')).status).toBe(404);
        expect((await handler(new Request('http://127.0.0.1:7781/api/control-plane/servers'))).status).toBe(401);
        const mutationSession = await identities.login(owner.username, 'synthetic registry password');
        expect((await handler(new Request('http://127.0.0.1:7781/api/control-plane/servers', { method: 'POST', headers: {
            Cookie: `rs-control-session=${mutationSession.token}`, Origin: 'http://127.0.0.1:7781',
            'X-Admin-Request': 'rs-sdk-admin', 'X-Control-CSRF': csrfFor(mutationSession.token)
        }, body: '{}' }))).status).toBe(405);
    } finally { registry.close(); identities.close(); await rm(temporary, { recursive: true, force: true }); }
});
