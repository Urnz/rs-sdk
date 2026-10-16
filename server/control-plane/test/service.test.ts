import { beforeAll, afterAll, expect, test } from 'bun:test';
import { controlPlaneConfig, localOrigin } from '../config.js';
import { createControlPlane } from '../service.js';
import { identityFixture } from './fixture.js';
let fixture: Awaited<ReturnType<typeof identityFixture>>;
beforeAll(async () => { fixture = await identityFixture(); });
afterAll(() => fixture.store.close());

const config = controlPlaneConfig();
test('configuration accepts only distinct local/private HTTP endpoints', () => {
    for (const origin of ['https://localhost:7780', 'http://example.invalid', 'http://user:password@localhost:7780', 'http://localhost:7780/path', 'http://localhost:7780/?x=1'])
        expect(() => localOrigin(origin)).toThrow();
    expect(() => controlPlaneConfig({ CONTROL_PLANE_PORT: '7780' })).toThrow('differ');
    expect(() => controlPlaneConfig({ CONTROL_PLANE_PORT: '0' })).toThrow('port');
    expect(localOrigin('http://127.0.0.1:7780')).toBe('http://127.0.0.1:7780');
});
test('admin HTML, assets and readiness remain available with both backends absent', async () => {
    let probes = 0;
    const handler = createControlPlane(config, fixture.store, async () => { probes++; throw new Error('sensitive backend failure'); });
    const response = await handler(fixture.request('http://127.0.0.1:7781/admin/'));
    expect(response.status).toBe(200); expect(await response.text()).toContain('Saját szervereim'); expect(probes).toBe(0);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await handler(fixture.request('http://127.0.0.1:7781/admin/admin.js'))).status).toBe(200);
    expect((await handler(fixture.request('http://127.0.0.1:7781/health'))).status).toBe(200);
    const status = await (await handler(fixture.request('http://127.0.0.1:7781/api/control-plane/status'))).json();
    expect(status).toMatchObject({ ready: true, gateway: { state: 'unavailable' }, engine: { state: 'unavailable' } });
    expect(JSON.stringify(status)).not.toContain('sensitive');
    await handler(fixture.request('http://127.0.0.1:7781/api/control-plane/status')); expect(probes).toBe(2);
});
test('proxy preserves exact method/query/body and supplied authentication, without injecting service credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const handler = createControlPlane(config, fixture.store, async (url, init) => { calls.push({ url: url.toString(), init });
        return new Response('gateway result', { status: 409, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'private=not-forwarded', 'Location': 'http://example.invalid/' } }); });
    const response = await handler(fixture.request('http://127.0.0.1:7781/api/admin/safe-operation?revision=2', { method: 'POST',
        headers: { Origin: 'http://127.0.0.1:7781', 'X-Admin-Request': 'rs-sdk-admin', 'X-Admin-Token': 'synthetic-test-token', 'Content-Type': 'application/json', Cookie: 'unrelated=secret' }, body: '{"reason":"technical test"}' }));
    expect(response.status).toBe(409); expect(await response.text()).toBe('gateway result');
    expect(calls[0]!.url).toBe('http://localhost:7780/api/admin/safe-operation?revision=2'); expect(calls[0]!.init.method).toBe('POST');
    const headers = new Headers(calls[0]!.init.headers); expect(headers.get('x-admin-token')).toBe('synthetic-test-token');
    expect(headers.get('origin')).toBe(config.gatewayOrigin); expect(headers.get('cookie')).toBe(fixture.cookie);
    expect(await new Response(calls[0]!.init.body).text()).toBe('{"reason":"technical test"}');
    expect(response.headers.has('set-cookie')).toBe(false); expect(response.headers.has('location')).toBe(false);
    await handler(fixture.request('http://127.0.0.1:7781/api/admin/config'));
    expect(new Headers(calls[1]!.init.headers).has('authorization')).toBe(false); expect(new Headers(calls[1]!.init.headers).has('x-admin-token')).toBe(false);
    expect(calls[0]!.init.redirect).toBe('error');
});
test('foreign origins, missing mutation intent and non-admin routes never reach a backend', async () => {
    let calls = 0; const handler = createControlPlane(config, fixture.store, async () => { calls++; return Response.json({}); });
    for (const request of [fixture.request('http://example.invalid/admin/'),
        fixture.request('http://localhost:7781/api/admin/config', { headers: { Origin: 'http://example.invalid' } }),
        fixture.request('http://localhost:7781/api/admin/config', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
        fixture.request('http://localhost:7781/api/admin/action', { method: 'POST', body: '{}' })]) expect((await handler(request)).status).toBe(403);
    for (const path of ['/api/internal/admin/player-reward', '/state/ada', '/admin/%2fsecret', '/.env', '/admin/../../../.env'])
        expect((await handler(fixture.request('http://localhost:7781' + path))).status).toBe(404);
    expect(calls).toBe(0);
});
test('backend timeout returns a bounded, sanitized outage and concurrent status requests share probes', async () => {
    let calls = 0, aborted = 0; const handler = createControlPlane({ ...config, probeTimeoutMs: 20, proxyTimeoutMs: 20 }, fixture.store, async (_url, init) => {
        calls++; return new Promise((_resolve, reject) => {
            // Retain the signal and a referenced timer: an unreferenced AbortSignal timer alone need not keep Bun's event loop awake.
            const fallback = setTimeout(() => reject(new Error(`Signal was not delivered: ${init.signal!.aborted}`)), 500);
            init.signal!.addEventListener('abort', () => { aborted++; clearTimeout(fallback); reject(new Error('private backend trace')); }, { once: true });
        });
    });
    const statusRequest = () => handler(fixture.request('http://localhost:7781/api/control-plane/status'));
    const statuses = await Promise.all([statusRequest(), statusRequest(), statusRequest()]); expect(calls).toBe(2);
    for (const status of statuses) expect((await status.json()).gateway.state).toBe('unavailable');
    const response = await handler(fixture.request('http://localhost:7781/api/admin/config')); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    expect(aborted).toBe(3);
    const mutation = await handler(fixture.request('http://localhost:7781/api/admin/action', { method: 'POST', headers: { 'X-Admin-Request': 'rs-sdk-admin' }, body: '{}' }));
    expect((await mutation.json()).code).toBe('GATEWAY_OUTCOME_UNKNOWN'); expect(aborted).toBe(4);
});
test('real HTTP backend shutdown does not close admin or its static asset owner', async () => {
    let gateway: ReturnType<typeof Bun.serve> | undefined = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async req => Response.json({ ready: true,
        method: req.method, body: await req.text(), origin: req.headers.get('origin'), authorization: req.headers.get('authorization') }) });
    let engine: ReturnType<typeof Bun.serve> | undefined = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ ready: true }) });
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane({ ...config, gatewayOrigin: gateway.url.origin, engineOrigin: engine.url.origin }, fixture.store) });
    const get = (path: string) => fetch(new URL(path, admin.url), { headers: { Cookie: fixture.cookie } });
    try {
        expect((await (await get('/api/control-plane/status')).json()).engine.state).toBe('available');
        const forwarded = await (await fetch(new URL('/api/admin/echo', admin.url), { method: 'POST',
            headers: { Cookie: fixture.cookie, 'X-Control-CSRF': fixture.csrf, Origin: admin.url.origin, 'X-Admin-Request': 'rs-sdk-admin', Authorization: 'Bearer synthetic-test-token' }, body: '{"exact":"body"}' })).json();
        expect(forwarded).toMatchObject({ method: 'POST', body: '{"exact":"body"}', origin: gateway!.url.origin, authorization: 'Bearer synthetic-test-token' });
        engine.stop(true); engine = undefined; await Bun.sleep(1100);
        const partial = await (await get('/api/control-plane/status')).json(); expect(partial.engine.state).toBe('unavailable'); expect(partial.gateway.state).toBe('available');
        gateway!.stop(true); gateway = undefined; await Bun.sleep(1100);
        expect((await get('/admin/')).status).toBe(200); expect((await get('/admin/connection-status.js')).status).toBe(200);
        expect((await get('/api/admin/config')).status).toBe(503); expect((await (await get('/api/control-plane/status')).json()).ready).toBe(true);
    } finally { admin.stop(true); gateway?.stop(true); engine?.stop(true); }
});
