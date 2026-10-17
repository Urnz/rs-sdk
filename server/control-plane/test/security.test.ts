import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlPlaneConfig, privateBind } from '../config.js';
import { IdentityStore, csrfFor } from '../identity-store.js';
import { createControlPlane } from '../service.js';
import { createGatewayIdentityGate } from '../gateway-identity.js';
import { ServerRegistry } from '../server-registry.js';
import { LifecycleManager } from '../lifecycle-manager.js';
import { RequestBudget } from '../request-budget.js';
import { loadTls, validateTls } from '../tls.js';
import { LocalManagedRuntime } from '../managed-runtime.js';
import { identityFixture } from './fixture.js';

test('HTTPS is explicit, private-bound and canonical; partial or wildcard/public configurations fail closed', () => {
    const env = { CONTROL_PLANE_HTTPS_ORIGIN: 'https://admin.invalid:7781', CONTROL_PLANE_BIND: '192.168.1.2', CONTROL_PLANE_TLS_CERT: 'synthetic.crt' };
    expect(controlPlaneConfig({}).transport).toBeUndefined();
    expect(controlPlaneConfig(env).transport).toEqual({ hostname: '192.168.1.2', origin: 'https://admin.invalid:7781', certificatePath: 'synthetic.crt' });
    for (const bind of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.2', '::1', 'fd12::1']) expect(privateBind(bind)).toBe(true);
    for (const bind of ['0.0.0.0', '::', '8.8.8.8', '172.32.0.1', 'localhost', '::ffff:127.0.0.1']) expect(() => controlPlaneConfig({ ...env, CONTROL_PLANE_BIND: bind })).toThrow();
    for (const origin of ['http://admin.invalid:7781', 'https://admin.invalid', 'https://admin.invalid:7781/path', 'https://admin.invalid:7781/?x=1', 'https://user:synthetic@admin.invalid:7781'])
        expect(() => controlPlaneConfig({ ...env, CONTROL_PLANE_HTTPS_ORIGIN: origin })).toThrow();
    for (const key of Object.keys(env)) expect(() => controlPlaneConfig({ ...env, [key]: undefined })).toThrow();
});

test('TLS initialization never reads a key in local mode and never falls back from a missing vault/certificate', async () => {
    let reads = 0;
    const secrets = { async get() { reads++; return null; }, async set() {}, async delete() {}, async status() { return false; } };
    expect(await loadTls(controlPlaneConfig({}), secrets)).toBeUndefined(); expect(reads).toBe(0);
    const config = controlPlaneConfig({ CONTROL_PLANE_HTTPS_ORIGIN: 'https://admin.invalid:7781', CONTROL_PLANE_BIND: '127.0.0.1', CONTROL_PLANE_TLS_CERT: 'absent.crt' });
    await expect(loadTls(config, secrets)).rejects.toThrow('fallback is disabled'); expect(reads).toBe(1);
    expect(() => validateTls('not a certificate', 'synthetic-private-value', config.transport!.origin)).toThrow('Invalid HTTPS');
});

test('legacy identity upgrade preserves owners/accounts/audit, revokes old sessions and rolls back atomically on audit failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'identity-v2-')), path = join(dir, 'identity.sqlite'), token = 'a'.repeat(43);
    const legacy = new Database(path);
    legacy.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT);
        CREATE TABLE ownership(account_id TEXT REFERENCES accounts(id),resource_id TEXT,PRIMARY KEY(account_id,resource_id));
        CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),expires_at INTEGER);
        CREATE INDEX sessions_account ON sessions(account_id);
        CREATE TABLE login_budget(id INTEGER PRIMARY KEY,started_at INTEGER,attempts INTEGER);
        CREATE TABLE identity_audit(sequence INTEGER PRIMARY KEY,kind TEXT,actor_id TEXT,subject_id TEXT,resource_id TEXT,created_at INTEGER);
        INSERT INTO accounts VALUES ('legacy-owner','legacy-owner','synthetic-unusable-hash'),('legacy-guest','legacy-guest','synthetic-unusable-hash');
        INSERT INTO ownership VALUES ('legacy-owner','local-default');
        INSERT INTO identity_audit(kind,created_at) VALUES ('legacy-audit',1);
        PRAGMA user_version=1;
        CREATE TRIGGER refuse_upgrade BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;`);
    legacy.query('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'legacy-owner', Date.now() + 60000);
    try {
        expect(() => new IdentityStore(path)).toThrow('synthetic audit failure');
        expect(legacy.query('PRAGMA user_version').get()).toEqual({ user_version: 1 });
        expect(legacy.query('SELECT * FROM sessions').all()).toHaveLength(1);
        legacy.exec('DROP TRIGGER refuse_upgrade');
        const store = new IdentityStore(path);
        try {
            expect(store.role('legacy-owner')).toBe('owner'); expect(store.role('legacy-guest')).toBeNull(); expect(store.session(token)).toBeNull();
            expect(store.listAccounts('legacy-owner')).toHaveLength(2);
            expect(legacy.query('SELECT kind FROM identity_audit ORDER BY sequence').all()).toEqual([{ kind: 'legacy-audit' }, { kind: 'identity-v2-sessions-revoked' }]);
            expect(legacy.query('PRAGMA user_version').get()).toEqual({ user_version: 2 });
        } finally { store.close(); }
    } finally { legacy.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('server roles are live, scoped and equally enforced by the proxy and direct gateway; sensitive GET and new routes default to owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'roles-v2-')), path = join(dir, 'identity.sqlite');
    const store = new IdentityStore(path), registry = new ServerRegistry(':memory:'), gate = createGatewayIdentityGate(path);
    const config = controlPlaneConfig({}); registry.ensureConfiguredLocal(config); let calls = 0;
    const owner = await store.createAccount('roles-owner', 'synthetic roles password');
    const guest = await store.createAccount('roles-guest', 'synthetic guest password', owner.id), login = await store.login(guest.username, 'synthetic guest password');
    const handler = createControlPlane(config, store, async (url, init) => { calls++; return gate(new Request(url, init)) ?? Response.json({ ok: true }); }, registry);
    const req = (path: string, method = 'GET') => new Request('http://localhost:7781' + path, { method, headers: { Cookie: `rs-control-session=${login.token}`,
        'X-Control-Server-ID': 'local-default', Origin: 'http://localhost:7781', 'X-Admin-Request': 'rs-sdk-admin', 'X-Control-CSRF': csrfFor(login.token) } });
    try {
        store.setRole(owner.id, guest.id, 'local-default', 'viewer');
        expect(store.role(guest.id, 'srv-' + randomUUID())).toBeNull();
        const list = await (await handler(req('/api/control-plane/servers'))).json(); expect(list.servers[0].role).toBe('viewer');
        expect((await handler(req('/admin/index.html?serverId=local-default'))).status).toBe(200);
        expect((await handler(req('/admin/index.html?serverId=local-default'))).headers.get('content-type')).toContain('text/html');
        expect((await handler(req('/api/admin/economy'))).status).toBe(200);
        const before = calls;
        for (const [path, method] of [['/api/admin/bots/x/spectate', 'GET'], ['/api/admin/llm-settings', 'GET'], ['/api/admin/new-route', 'GET'], ['/api/admin/economy', 'POST']]) {
            expect((await handler(req(path!, method))).status).toBe(403);
            expect(gate(req(path!, method))?.status).toBe(403);
        }
        expect(calls).toBe(before);
        expect(() => store.setRole(guest.id, guest.id, 'local-default', 'owner')).toThrow('tulajdonosi');
        expect(() => store.setRole(owner.id, owner.id, 'local-default', 'viewer')).toThrow('utolsó');
        expect(store.role(owner.id)).toBe('owner');
        store.setRole(owner.id, guest.id, 'local-default', 'operator'); expect((await handler(req('/api/admin/economy'))).status).toBe(200);
        store.setRole(owner.id, guest.id, 'local-default', null);
        expect((await handler(req('/api/admin/economy'))).status).toBe(404); expect(gate(req('/api/admin/economy'))?.status).toBe(403);
        store.setRole(owner.id, guest.id, 'local-default', 'owner'); expect((await handler(req('/api/admin/new-route'))).status).toBe(200);
        // Compatibility ownership revocation must also clear lower roles.
        store.setOwnership(owner.id, guest.id, false); expect(store.role(guest.id)).toBeNull();
    } finally {
        gate.close(); registry.close(); store.close();
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
});

test('operator can start/stop/restart only its managed server; viewer and operator cannot maintain/archive or grant roles', async () => {
    const fixture = await identityFixture(), registry = new ServerRegistry(':memory:');
    const runtime = { version: 'a'.repeat(40), async prepare() {}, async start() {}, async stop() {}, async inspect() { return 'running' as const; } };
    const manager = new LifecycleManager(registry, fixture.store, runtime);
    try {
        const guest = await fixture.store.createAccount('managed-reader', 'synthetic reader password', fixture.owner.id);
        const world = manager.create(fixture.owner.id, { name: 'Szerepkörös világ', version: runtime.version, template: 'classic', requestKey: randomUUID() }); await manager.idle();
        const action = (kind: string) => manager.action(guest.id, world.serverId, kind, { requestKey: randomUUID(), expectedRevision: registry.lifecycle.managed(world.serverId)!.revision });
        fixture.store.setRole(fixture.owner.id, guest.id, world.serverId, 'viewer');
        expect(() => action('start')).toThrow('jogosultság');
        fixture.store.setRole(fixture.owner.id, guest.id, world.serverId, 'operator');
        for (const kind of ['start', 'restart', 'stop']) { expect(action(kind).state).toBe('running'); await manager.idle(); }
        for (const kind of ['archive', 'backup', 'restore', 'migrate']) expect(() => action(kind)).toThrow('jogosultság');
        expect(() => fixture.store.grants(guest.id, world.serverId)).toThrow('tulajdonosi');
        fixture.store.setRole(fixture.owner.id, guest.id, world.serverId, null); expect(() => action('start')).toThrow('nem található');
    } finally { await manager.idle(); registry.close(); fixture.store.close(); }
});

test('session revocation is account scoped, login rotates the same browser and HTTPS issues/clears Secure cookies', async () => {
    const fixture = await identityFixture(), config = controlPlaneConfig({ CONTROL_PLANE_HTTPS_ORIGIN: 'https://admin.invalid:7781', CONTROL_PLANE_BIND: '127.0.0.1', CONTROL_PLANE_TLS_CERT: 'synthetic.crt' });
    const handler = createControlPlane(config, fixture.store), root = config.transport!.origin;
    try {
        const guest = await fixture.store.createAccount('sessions-guest', 'synthetic guest password', fixture.owner.id);
        const other = await fixture.store.login(guest.username, 'synthetic guest password'), otherId = fixture.store.sessions(guest.id, other.token)[0]!.id;
        const request = (path: string, method = 'GET', data?: unknown) => fixture.request(root + '/api/control-plane/' + path, { method,
            headers: { 'X-Admin-Request': 'rs-sdk-admin', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        const sessions = await (await handler(request('sessions'))).json(); expect(sessions.sessions).toHaveLength(1);
        expect(JSON.stringify(sessions)).not.toContain(fixture.cookie.split('=')[1]!); expect(JSON.stringify(sessions)).not.toContain('token_hash');
        expect((await handler(request('sessions/' + otherId, 'DELETE'))).status).toBe(404); expect(fixture.store.session(other.token)).not.toBeNull();
        const login = await handler(request('login', 'POST', { username: fixture.owner.username, password: 'synthetic owner password' }));
        expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toContain('; Secure'); expect(fixture.store.session(fixture.cookie.split('=')[1]!)).toBeNull();
        const token = login.headers.get('set-cookie')!.split(';')[0]!.split('=')[1]!, id = fixture.store.sessions(fixture.owner.id, token)[0]!.id;
        const revoke = await handler(new Request(root + '/api/control-plane/sessions/' + id, { method: 'DELETE', headers: { Cookie: `rs-control-session=${token}`, Origin: root, 'X-Admin-Request': 'rs-sdk-admin', 'X-Control-CSRF': csrfFor(token) } }));
        expect(revoke.status).toBe(200); expect(revoke.headers.get('set-cookie')).toContain('Max-Age=0; Secure'); expect(fixture.store.session(token)).toBeNull();
        for (const url of ['http://admin.invalid:7781/health', 'https://forged.invalid:7781/health', 'http://127.0.0.1:7781/health'])
            expect((await handler(new Request(url, { headers: { 'X-Forwarded-Host': 'admin.invalid:7781', 'X-Forwarded-Proto': 'https' } }))).status).toBe(403);
        expect((await handler(new Request(root + '/health'))).headers.get('strict-transport-security')).toContain('max-age=');
    } finally { fixture.store.close(); }
});

test('bounded request budgets expire and forwarded IPs cannot bypass HTTP limits', async () => {
    let now = 1000; const budget = new RequestBudget(() => now);
    expect(budget.take('x', 1)).toBe(true); expect(budget.take('x', 1)).toBe(false); now += 60000; expect(budget.take('x', 1)).toBe(true);
    const fixture = await identityFixture(), handler = createControlPlane(controlPlaneConfig({}), fixture.store);
    try {
        for (let i = 0; i < 10; i++) expect((await handler(new Request('http://localhost:7781/api/control-plane/login', { method: 'POST', headers: { 'X-Forwarded-For': `10.0.0.${i}` } }), '10.0.0.1')).status).toBe(403);
        const limited = await handler(new Request('http://localhost:7781/api/control-plane/login', { method: 'POST', headers: { 'X-Forwarded-For': '10.1.1.1' } }), '10.0.0.1');
        expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60');
        expect((await handler(new Request('http://localhost:7781/health'), '10.0.0.2')).status).toBe(200);
        for (let i = 0; i < 1200; i++) expect((await handler(new Request('http://localhost:7781/health'), '10.0.0.3')).status).toBe(200);
        expect((await handler(new Request('http://localhost:7781/health'), '10.0.0.3')).status).toBe(429);
    } finally { fixture.store.close(); }
});

test('active sessions have a hard count bound; revocation remains effective after reopening the store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sessions-v2-')), path = join(dir, 'identity.sqlite');
    let store = new IdentityStore(path);
    try {
        const owner = await store.createAccount('session-bound', 'synthetic session password');
        const tokens: string[] = [];
        for (let i = 0; i < 11; i++) tokens.push((await store.login(owner.username, 'synthetic session password')).token);
        expect(store.session(tokens[0]!)).toBeNull(); expect(store.sessions(owner.id, tokens[10]!)).toHaveLength(10);
        const revoked = store.sessions(owner.id, tokens[10]!).find(session => session.current)!;
        store.revokeSession(owner.id, revoked.id); store.close(); store = new IdentityStore(path);
        expect(store.session(tokens[10]!)).toBeNull(); expect(store.sessions(owner.id, tokens[9]!)).toHaveLength(9);
        expect(store.session(tokens[9]!)).not.toBeNull();
    } finally { store.close(); Bun.gc(true); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test('an old pinned gateway is rejected before secrets or workers are started under the new identity schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'old-gateway-v2-'));
    const probes = Array.from({ length: 6 }, () => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }));
    const ports = probes.map(probe => probe.port!); await Promise.all(probes.map(probe => probe.stop(true)));
    const runtime = new LocalManagedRuntime(join(import.meta.dir, '../../..'), dir, join(dir, 'identity.sqlite'));
    try {
        await expect(runtime.start({ serverId: `srv-${randomUUID()}`, creatorId: 'fixture', version: runtime.version, template: 'classic', ports,
            state: 'stopped', revision: 1, error: null })).rejects.toMatchObject({ code: 'VERSION_UPGRADE_REQUIRED' });
    } finally { await rm(dir, { recursive: true, force: true }); }
});
