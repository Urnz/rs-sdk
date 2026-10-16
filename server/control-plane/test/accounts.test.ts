import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityStore, csrfFor, sessionLifetimeSeconds } from '../identity-store.js';
import { createControlPlane } from '../service.js';
import { createGatewayIdentityGate } from '../gateway-identity.js';
import { controlPlaneConfig } from '../config.js';
import { identityFixture } from './fixture.js';

test('account names reject line endings and non-ASCII characters without creating records', async () => {
    const store = new IdentityStore(':memory:');
    try {
        for (const name of ['valid-name\n', 'valid-name\r\n', 'has space', 'ékezetes', '..name', 'ab', 'a'.repeat(41)])
            await expect(store.createAccount(name, 'synthetic validation password')).rejects.toMatchObject({ code: 'USERNAME_POLICY', status: 400 });
        const owner = await store.createAccount('valid-name', 'synthetic validation password');
        expect(store.listAccounts(owner.id)).toHaveLength(1);
    } finally { store.close(); }
});

test('identity persists independently across restart, with hashed credentials, expiring sessions and resource-scoped ownership', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-identity-')), path = join(temporary, 'identity.sqlite');
    let now = 1000000, store = new IdentityStore(path, () => now);
    try {
        const owner = await store.createAccount('Owner.One', 'synthetic persistence password');
        const other = await store.createAccount('other-user', 'synthetic other password', owner.id);
        const login = await store.login('OWNER.ONE', 'synthetic persistence password');
        expect(login.account.username).toBe('owner.one'); expect(store.owns(owner.id, 'different-server')).toBe(false);
        const db = new Database(path, { readonly: true });
        try {
            const row = db.query('SELECT password_hash FROM accounts WHERE id=?').get(owner.id) as { password_hash: string };
            expect(row.password_hash).toStartWith('$argon2id$v=19$m=65536,t=3,');
            expect(JSON.stringify(db.query('SELECT * FROM sessions').all())).not.toContain(login.token);
            expect(JSON.stringify(db.query('SELECT * FROM identity_audit').all())).not.toContain('password');
        } finally { db.close(); }
        store.close(); store = new IdentityStore(path, () => now);
        expect(store.session(login.token)?.account.id).toBe(owner.id); expect(store.owns(other.id)).toBe(false);
        expect(() => store.setOwnership(other.id, other.id, true)).toThrow('tulajdonosi');
        expect(() => store.setOwnership(owner.id, owner.id, false)).toThrow('utolsó');
        store.setOwnership(owner.id, other.id, true); store.setOwnership(other.id, owner.id, false);
        expect(store.owns(owner.id)).toBe(false); expect(store.session(login.token)).not.toBeNull();
        now += sessionLifetimeSeconds * 1000; expect(store.session(login.token)).toBeNull();
    } finally { store.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('concurrent first-account creation grants exactly one bootstrap owner; duplicate names never replace a password', async () => {
    const store = new IdentityStore(':memory:');
    try {
        const attempts = await Promise.allSettled([store.createAccount('first-one', 'synthetic first password'), store.createAccount('first-two', 'synthetic second password')]);
        const successful = attempts.filter(result => result.status === 'fulfilled'); expect(successful).toHaveLength(1);
        const owner = successful[0]!; if (owner.status !== 'fulfilled') throw new Error();
        await expect(store.createAccount(owner.value.username.toUpperCase(), 'synthetic replacement password', owner.value.id)).rejects.toThrow('foglalt');
        expect(store.listAccounts(owner.value.id)).toHaveLength(1);
    } finally { store.close(); }
});

test('password changes require the current password and invalidate every existing session, logout invalidates replay', async () => {
    const fixture = await identityFixture();
    try {
        const second = await fixture.store.login(fixture.owner.username, 'synthetic owner password');
        await expect(fixture.store.changePassword(fixture.owner.id, 'wrong password', 'synthetic replacement password')).rejects.toThrow('Érvénytelen');
        expect(fixture.store.session(second.token)).not.toBeNull();
        await fixture.store.changePassword(fixture.owner.id, 'synthetic owner password', 'synthetic replacement password');
        expect(fixture.store.session(second.token)).toBeNull();
        const login = await fixture.store.login(fixture.owner.username, 'synthetic replacement password');
        fixture.store.logout(login.token); expect(fixture.store.session(login.token)).toBeNull();
    } finally { fixture.store.close(); }
});

test('identity mutations roll back with audit failure, future schemas fail closed', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-audit-')), path = join(temporary, 'identity.sqlite');
    const store = new IdentityStore(path);
    try {
        const owner = await store.createAccount('audit-owner', 'synthetic audit password');
        const other = await store.createAccount('audit-other', 'synthetic other password', owner.id);
        const db = new Database(path);
        try { db.exec("CREATE TRIGGER refuse_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
            expect(() => store.setOwnership(owner.id, other.id, true)).toThrow('fixture audit failure');
            expect(store.owns(other.id)).toBe(false);
        } finally { db.close(); }
    } finally { store.close(); }
    const future = new Database(path); future.exec('PRAGMA user_version=99'); future.close();
    try { expect(() => new IdentityStore(path)).toThrow('Unsupported'); }
    finally { await rm(temporary, { recursive: true, force: true }); }
});

test('login failures are generic and the attempt budget survives store reopen', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-budget-')), path = join(temporary, 'identity.sqlite');
    let store = new IdentityStore(path);
    try {
        await store.createAccount('budget-owner', 'synthetic budget password');
        for (const username of ['budget-owner', 'missing-user']) {
            await expect(store.login(username, 'wrong password')).rejects.toMatchObject({ code: 'INVALID_LOGIN', status: 401 });
        }
        const db = new Database(path); db.query('UPDATE login_budget SET attempts=30').run(); db.close();
        store.close(); store = new IdentityStore(path);
        await expect(store.login('budget-owner', 'synthetic budget password')).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMIT', status: 429 });
    } finally { store.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('unauthenticated requests and non-owners never reach game backends or account administration', async () => {
    const fixture = await identityFixture(); let calls = 0;
    const handler = createControlPlane(controlPlaneConfig(), fixture.store, async () => { calls++; return Response.json({}); });
    try {
        for (const path of ['/api/admin/config', '/api/admin/bots', '/api/control-plane/status', '/api/control-plane/accounts']) {
            expect((await handler(new Request('http://localhost:7781' + path))).status).toBe(401);
        }
        expect((await handler(new Request('http://localhost:7781/admin/'))).status).toBe(303);
        expect((await handler(new Request('http://localhost:7781/admin/login.html'))).status).toBe(200);
        expect((await handler(new Request('http://localhost:7781/health'))).status).toBe(200);
        const other = await fixture.store.createAccount('http-other', 'synthetic other password', fixture.owner.id);
        const login = await fixture.store.login(other.username, 'synthetic other password');
        for (const path of ['/api/admin/config', '/api/control-plane/status', '/api/control-plane/accounts']) {
            const request = new Request('http://localhost:7781' + path, { headers: { Cookie: `rs-control-session=${login.token}`, Authorization: 'Bearer forged-owner', 'X-Owner-Id': fixture.owner.id, 'X-Control-Server-ID': 'local-default' } });
            expect((await handler(request)).status).toBe(path.endsWith('/accounts') ? 403 : 404);
        }
        expect(calls).toBe(0);
    } finally { fixture.store.close(); }
});

test('login rotates attacker-supplied cookies; same-origin, session CSRF and bounded JSON protect mutations', async () => {
    const fixture = await identityFixture(); let calls = 0;
    const handler = createControlPlane(controlPlaneConfig(), fixture.store, async () => { calls++; return Response.json({}); });
    const root = 'http://localhost:7781';
    const loginRequest = (headers: HeadersInit = {}) => new Request(root + '/api/control-plane/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin', ...headers },
        body: JSON.stringify({ username: fixture.owner.username, password: 'synthetic owner password' }) });
    try {
        expect((await handler(loginRequest())).status).toBe(403);
        const login = await handler(loginRequest({ Origin: root, Cookie: 'rs-control-session=attacker-fixed-session' }));
        expect(login.status).toBe(200); const setCookie = login.headers.get('set-cookie')!;
        expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('SameSite=Strict'); expect(setCookie).not.toContain('attacker');
        const session = await (await handler(fixture.request(root + '/api/control-plane/session'))).json();
        expect(session.csrfToken).toBe(fixture.csrf); expect(JSON.stringify(session)).not.toContain('password');
        for (const csrf of ['', 'forged', 'é'.repeat(64)]) {
            const request = new Request(root + '/api/admin/action', { method: 'POST', headers: { Cookie: fixture.cookie, Origin: root, 'X-Admin-Request': 'rs-sdk-admin', 'X-Control-CSRF': csrf }, body: '{}' });
            expect((await handler(request)).status).toBe(403);
        }
        const oversized = fixture.request(root + '/api/control-plane/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin' }, body: JSON.stringify({ username: 'x'.repeat(8193) }) });
        expect((await handler(oversized)).status).toBe(413);
        expect(calls).toBe(0);
        expect((await handler(new Request(root + '/api/control-plane/session', { headers: { Cookie: `${fixture.cookie}; ${fixture.cookie}` } }))).status).toBe(401);
        expect((await handler(fixture.request(root + '/api/control-plane/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': 'rs-sdk-admin' }, body: '{}' }))).status).toBe(200);
        expect((await handler(fixture.request(root + '/api/control-plane/session'))).status).toBe(401);
    } finally { fixture.store.close(); }
});

test('direct gateway ownership is checked on every request, including revocation and missing configured stores', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-gateway-')), path = join(temporary, 'identity.sqlite');
    const store = new IdentityStore(path);
    const gate = createGatewayIdentityGate(path);
    try {
        const owner = await store.createAccount('gateway-owner', 'synthetic gateway password');
        const second = await store.createAccount('gateway-second', 'synthetic second password', owner.id);
        const login = await store.login(owner.username, 'synthetic gateway password'), cookie = `rs-control-session=${login.token}`;
        expect(gate(new Request('http://localhost:7780/api/admin/config'))?.status).toBe(401);
        expect(gate(new Request('http://localhost:7780/api/admin/config', { headers: { Cookie: cookie, 'X-Control-Server-ID': 'local-default' } }))).toBeNull();
        expect(gate(new Request('http://localhost:7780/api/admin/config', { method: 'POST', headers: { Cookie: cookie } }))?.status).toBe(403);
        store.setOwnership(owner.id, second.id, true); store.setOwnership(second.id, owner.id, false);
        expect(gate(new Request('http://localhost:7780/api/admin/config', { headers: { Cookie: cookie } }))?.status).toBe(403);
        expect(createGatewayIdentityGate(join(temporary, 'missing.sqlite'))(new Request('http://localhost:7780/api/admin/config'))?.status).toBe(503);
    } finally { gate.close(); store.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('bootstrap CLI accepts credentials only through stdin and never echoes them or overwrites an existing owner', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-bootstrap-')), path = join(temporary, 'identity.sqlite');
    const input = JSON.stringify({ username: 'cli-owner', password: 'synthetic CLI password' });
    const run = async () => {
        const child = Bun.spawn([process.execPath, join(import.meta.dir, '../bootstrap-account.ts')], { env: { ...process.env, CONTROL_PLANE_IDENTITY_PATH: path }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        child.stdin.write(input); child.stdin.end();
        const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout + stderr).not.toContain('synthetic CLI password'); return exit;
    };
    try { expect(await run()).toBe(0); expect(await run()).toBe(1); }
    finally { await rm(temporary, { recursive: true, force: true }); }
});

test('real gateway entry point protects formerly public config and static routes before loading domain state', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-gateway-entry-')), path = join(temporary, 'identity.sqlite');
    const store = new IdentityStore(path);
    try {
        const owner = await store.createAccount('entry-owner', 'synthetic entry password');
        const login = await store.login(owner.username, 'synthetic entry password');
        const routesUrl = new URL('../../gateway/admin/entry.ts', import.meta.url).href;
        const code = `const {createOwnedAdminHandler}=await import(${JSON.stringify(routesUrl)});
            const context={gatewayBots:()=>new Map(),supervisor:{}};
            const handleAdminRequest=createOwnedAdminHandler(()=>context);
            for(const path of ['/api/admin/config','/admin/']) {
                const denied=new Request('http://localhost:7780'+path);
                if((await handleAdminRequest(denied,new URL(denied.url),context)).status!==401)process.exit(2);
                const upgrade=new Request(denied.url,{headers:{Upgrade:'websocket',Connection:'Upgrade'}});
                if((await handleAdminRequest(upgrade,new URL(upgrade.url),context)).status!==401)process.exit(4);
                const owner=new Request(denied.url,{headers:{Cookie:process.env.FIXTURE_COOKIE,'X-Control-Server-ID':'local-default'}});
                if((await handleAdminRequest(owner,new URL(owner.url),context)).status!==(path==='/admin/'?303:200))process.exit(3);
            }`;
        const child = Bun.spawn([process.execPath, '--eval', code], { env: { ...process.env, CONTROL_PLANE_IDENTITY_PATH: path, FIXTURE_COOKIE: `rs-control-session=${login.token}` }, stdout: 'ignore', stderr: 'pipe' });
        const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(stderr).toBe(''); expect(exit).toBe(0);
    } finally { store.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('real HTTP proxy forwards only the validated session and CSRF to the gateway ownership boundary', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-proxy-owner-')), path = join(temporary, 'identity.sqlite');
    const store = new IdentityStore(path), gate = createGatewayIdentityGate(path);
    let gateway: ReturnType<typeof Bun.serve> | undefined;
    try {
        const owner = await store.createAccount('proxy-owner', 'synthetic proxy password');
        const login = await store.login(owner.username, 'synthetic proxy password');
        gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
            const denied = gate(req); if (denied) return denied;
            return Response.json({ body: await req.text(), cookie: req.headers.get('cookie'), method: req.method });
        } });
        const handler = createControlPlane({ ...controlPlaneConfig(), gatewayOrigin: gateway.url.origin }, store);
        const response = await handler(new Request('http://127.0.0.1:7781/api/admin/fixture', { method: 'POST',
            headers: { Cookie: `rs-control-session=${login.token}; unrelated=do-not-forward`, Origin: 'http://127.0.0.1:7781',
                'X-Admin-Request': 'rs-sdk-admin', 'X-Control-CSRF': csrfFor(login.token), 'X-Control-Server-ID': 'local-default' }, body: '{"fixture":"exact"}' }));
        expect(response.status).toBe(200); expect(await response.json()).toEqual({ body: '{"fixture":"exact"}', cookie: `rs-control-session=${login.token}`, method: 'POST' });
    } finally { gateway?.stop(true); gate.close(); store.close(); await rm(temporary, { recursive: true, force: true }); }
});
