import { serveAdminAsset } from '../gateway/admin/assets.js';
import { localOrigin, type ControlPlaneConfig } from './config.js';
import { accountRoute, authError, body, json, requireSession, sessionCookieName } from './auth.js';
import type { IdentityStore } from './identity-store.js';
import { IdentityError, localServerId } from './identity-store.js';
import type { RegisteredServer, ServerRegistry } from './server-registry.js';
import type { LifecycleManager } from './lifecycle-manager.js';

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
export interface BackendState { state: 'available' | 'unavailable'; httpStatus: number | null }
const allowedHeaders = ['accept', 'content-type', 'authorization', 'x-admin-token', 'x-admin-request', 'x-control-csrf'];

/** A separate HTTP owner. Identity state is independent of every game/domain database. */
export function createControlPlane(config: ControlPlaneConfig, identities: IdentityStore, fetcher: Fetcher = fetch, registry?: ServerRegistry, lifecycle?: LifecycleManager) {
    const gateway = localOrigin(config.gatewayOrigin), engine = localOrigin(config.engineOrigin);
    for (const timeout of [config.probeTimeoutMs, config.proxyTimeoutMs]) if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('Invalid backend timeout');
    let cached: { at: number; value: unknown } | null = null, pending: Promise<unknown> | null = null;
    async function probe(origin: string, path: string): Promise<BackendState> {
        try { const response = await fetcher(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(config.probeTimeoutMs) });
            await response.body?.cancel();
            return { state: response.ok ? 'available' : 'unavailable', httpStatus: response.status };
        } catch { return { state: 'unavailable', httpStatus: null }; }
    }
    async function status() {
        if (cached && performance.now() - cached.at < 1000) return cached.value;
        if (!pending) pending = Promise.all([probe(gateway, '/status'), probe(engine, '/engine-status')]).then(([gatewayState, engineState]) => {
            const value = { schemaVersion: 1, service: 'rs-sdk-control-plane', ready: true, checkedAt: new Date().toISOString(),
                gateway: gatewayState, engine: engineState };
            cached = { at: performance.now(), value }; return value;
        }).finally(() => { pending = null; });
        return pending;
    }
    async function serverView(server: RegisteredServer) {
        const connected = server.id === localServerId && server.gatewayOrigin === gateway && server.engineOrigin === engine;
        return { id: server.id, name: server.name, registeredAt: server.registeredAt,
            adminUrl: connected ? '/admin/index.html?serverId=local-default' : null,
            connection: connected ? await status() : null, ...(lifecycle ? { managed: await lifecycle.view(server.id) } : {}) };
    }
    async function servers(req: Request): Promise<Response> {
        try {
            const session = requireSession(req, identities);
            if (!registry) return json({ error: 'A szerverregiszter nem érhető el.', code: 'REGISTRY_UNAVAILABLE' }, 503);
            const path = new URL(req.url).pathname;
            if (lifecycle) {
                if (path === '/api/control-plane/servers/catalog' && req.method === 'GET') return json(lifecycle.catalog());
                const operation = /^\/api\/control-plane\/servers\/operations\/([a-f0-9-]{36})$/.exec(path);
                if (operation && req.method === 'GET') return json({ operation: lifecycle.operation(session.account.id, operation[1]!) });
                if (path === '/api/control-plane/servers' && req.method === 'POST') return json({ operation: lifecycle.create(session.account.id, await body(req)) }, 202);
                const action = /^\/api\/control-plane\/servers\/(srv-[a-f0-9-]{36})\/(start|stop|restart|archive)$/.exec(path);
                if (action && req.method === 'POST') return json({ operation: lifecycle.action(session.account.id, action[1]!, action[2]!, await body(req)) }, 202);
            }
            if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
            if (path === '/api/control-plane/servers') {
                const visible = registry.visibleTo(id => identities.owns(session.account.id, id));
                return json({ schemaVersion: 1, servers: await Promise.all(visible.map(serverView)) });
            }
            const id = path.slice('/api/control-plane/servers/'.length);
            const server = registry.get(id);
            if (!server || !identities.owns(session.account.id, id)) return json({ error: 'A szerver nem található.', code: 'SERVER_NOT_FOUND' }, 404);
            return json({ server: await serverView(server) });
        } catch (error) { return error instanceof IdentityError ? authError(error)
            : json({ error: 'A szerverregiszter nem olvasható. Ellenőrizd a helyi admin naplóját.', code: 'REGISTRY_UNAVAILABLE' }, 503); }
    }
    return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return json({ error: 'Local admin origin required' }, 403);
        const origin = req.headers.get('origin');
        if ((origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Same-origin request required' }, 403);
        if (url.pathname === '/health') return req.method === 'GET' ? json({ service: 'rs-sdk-control-plane', ready: true }) : json({ error: 'Method not allowed' }, 405);
        if (url.pathname === '/api/control-plane/servers' || url.pathname.startsWith('/api/control-plane/servers/')) return servers(req);
        const publicAccountAssets = ['/admin/login.html', '/admin/account.html', '/admin/account.js', '/admin/account.css'];
        if (publicAccountAssets.includes(url.pathname)) {
            if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
            const response = await serveAdminAsset(url, engine);
            return response && req.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response ?? json({ error: 'Not found' }, 404);
        }
        if (url.pathname.startsWith('/api/control-plane/') && url.pathname !== '/api/control-plane/status') return accountRoute(req, identities);
        const homePaths = ['/', '/admin', '/admin/', '/admin/servers.html', '/admin/servers.js', '/admin/servers.css'];
        if (homePaths.includes(url.pathname)) {
            try { requireSession(req, identities); }
            catch (error) {
                if (['GET', 'HEAD'].includes(req.method) && !url.pathname.endsWith('.js') && !url.pathname.endsWith('.css'))
                    return new Response(null, { status: 303, headers: { Location: '/admin/login.html', 'Cache-Control': 'no-store' } });
                return authError(error);
            }
            if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
            if (url.pathname === '/' || url.pathname === '/admin') return new Response(null, { status: 303, headers: { Location: '/admin/', 'Cache-Control': 'no-store' } });
            const assetUrl = new URL(url); if (url.pathname === '/admin/') assetUrl.pathname = '/admin/servers.html';
            const response = await serveAdminAsset(assetUrl, engine);
            return response && req.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response ?? json({ error: 'Not found' }, 404);
        }
        if (!['/', '/admin'].includes(url.pathname) && !url.pathname.startsWith('/admin/') && !url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/control-plane/status') return json({ error: 'Not found' }, 404);
        let session;
        try { session = requireSession(req, identities, true); }
        catch (error) {
            if (['/', '/admin', '/admin/', '/admin/index.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(req.method))
                return new Response(null, { status: 303, headers: { Location: '/admin/login.html', 'Cache-Control': 'no-store' } });
            return authError(error);
        }
        if (url.pathname === '/api/control-plane/status') return req.method === 'GET' ? json(await status()) : json({ error: 'Method not allowed' }, 405);
        if (url.pathname === '/') return Response.redirect(new URL('/admin/', url), 308);
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            if (url.pathname === '/admin/index.html' && url.searchParams.has('serverId') && url.searchParams.get('serverId') !== localServerId)
                return json({ error: 'A szerverhez még nincs bekötött adminfelület.', code: 'SERVER_ADMIN_UNAVAILABLE' }, 404);
            if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
            const response = await serveAdminAsset(url, engine);
            if (req.method === 'HEAD' && response) return new Response(null, { status: response.status, headers: response.headers });
            return response ?? new Response('Not found', { status: 404 });
        }
        if (!url.pathname.startsWith('/api/admin/')) return json({ error: 'Not found' }, 404);
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
        const mutation = !['GET', 'HEAD'].includes(req.method);
        if (mutation && req.headers.get('x-admin-request') !== 'rs-sdk-admin') return json({ error: 'Explicit admin request required' }, 403);
        const headers = new Headers();
        for (const name of allowedHeaders) { const value = req.headers.get(name); if (value !== null) headers.set(name, value); }
        // Only this validated session cookie reaches the fixed local gateway; unrelated cookies never do.
        headers.set('cookie', `${sessionCookieName}=${session.token}`);
        // Same-origin was checked above; keep the gateway's local-mode mutation gate valid through the local proxy.
        if (origin) headers.set('origin', gateway);
        try {
            const response = await fetcher(new URL(url.pathname + url.search, gateway), { method: req.method, headers,
                ...(mutation ? { body: req.body } : {}), redirect: 'error', signal: AbortSignal.any([req.signal, AbortSignal.timeout(config.proxyTimeoutMs)]) });
            const outgoing = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            outgoing.set('Content-Type', response.headers.get('content-type') ?? 'application/json');
            return new Response(response.body, { status: response.status, headers: outgoing });
        } catch {
            return mutation ? json({ error: 'A gateway válasza nem érkezett meg. A művelet kimenetele ismeretlen; ellenőrizd az állapotot és az auditnaplót újrapróbálás előtt.', code: 'GATEWAY_OUTCOME_UNKNOWN' }, 503)
                : json({ error: 'A gateway nem elérhető. Az adminfelület működik; állítsd helyre a helyi gateway kapcsolatát.', code: 'GATEWAY_UNAVAILABLE' }, 503);
        }
    };
}
