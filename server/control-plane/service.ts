import { serveAdminAsset } from '../gateway/admin/assets.js';
import { localOrigin, type ControlPlaneConfig } from './config.js';
import { accountRoute, authError, body, json, requireSession, sessionCookieName, sessionToken } from './auth.js';
import type { IdentityStore } from './identity-store.js';
import { IdentityError, localServerId } from './identity-store.js';
import type { RegisteredServer, ServerRegistry } from './server-registry.js';
import type { LifecycleManager } from './lifecycle-manager.js';
import { pageServerContext, requestServerContext, serverContextHeader } from './server-context.js';
import { requireDomainAccess } from './authorization.js';
import { RequestBudget } from './request-budget.js';

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
export interface BackendState { state: 'available' | 'unavailable'; httpStatus: number | null }
const allowedHeaders = ['accept', 'content-type', 'authorization', 'x-admin-token', 'x-admin-request', 'x-control-csrf'];

/** A separate HTTP owner. Identity state is independent of every game/domain database. */
export function createControlPlane(config: ControlPlaneConfig, identities: IdentityStore, fetcher: Fetcher = fetch, registry?: ServerRegistry, lifecycle?: LifecycleManager) {
    const gateway = localOrigin(config.gatewayOrigin), engine = localOrigin(config.engineOrigin);
    const budget = new RequestBudget();
    for (const timeout of [config.probeTimeoutMs, config.proxyTimeoutMs]) if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('Invalid backend timeout');
    type Target = { id: string; name: string; gateway: string; engine: string; managed: boolean };
    function target(actor: string, id: string): Target {
        if (!identities.role(actor, id)) throw new IdentityError(404, 'SERVER_NOT_FOUND', 'A szerver nem található.');
        const registered = registry?.get(id);
        if (id === localServerId && (!registry || registered?.gatewayOrigin === gateway && registered.engineOrigin === engine))
            return { id, name: registered?.name ?? 'Helyi szerver', gateway, engine, managed: false };
        const managed = registry?.lifecycle.managed(id);
        if (!registered || !managed || !lifecycle || managed.ports.length !== 6
            || registered.gatewayOrigin !== `http://127.0.0.1:${managed.ports[0]}` || registered.engineOrigin !== `http://127.0.0.1:${managed.ports[1]}`)
            throw new IdentityError(404, 'SERVER_NOT_CONNECTED', 'Ehhez a szerverhez nincs ellenőrzött admin-kapcsolat.');
        return { id, name: registered.name, gateway: localOrigin(registered.gatewayOrigin), engine: localOrigin(registered.engineOrigin), managed: true };
    }
    const cached = new Map<string, { at: number; value: unknown }>(), pending = new Map<string, Promise<unknown>>();
    async function probe(origin: string, path: string): Promise<BackendState> {
        try { const response = await fetcher(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(config.probeTimeoutMs) });
            await response.body?.cancel();
            return { state: response.ok ? 'available' : 'unavailable', httpStatus: response.status };
        } catch { return { state: 'unavailable', httpStatus: null }; }
    }
    async function status(selected: Target, actor: string) {
        const key = selected.id;
        const previous = cached.get(key); if (previous && performance.now() - previous.at < 1000) return previous.value;
        if (!pending.has(key)) pending.set(key, (async () => {
            const [gatewayState, engineState] = selected.managed
                ? await lifecycle!.connection(actor, selected.id).then(connection => [
                    { state: connection.gateway ? 'available' : 'unavailable', httpStatus: null },
                    { state: connection.engine ? 'available' : 'unavailable', httpStatus: null }])
                : await Promise.all([probe(selected.gateway, '/status'), probe(selected.engine, '/engine-status')]);
            const value = { schemaVersion: 1, service: 'rs-sdk-control-plane', ready: true, checkedAt: new Date().toISOString(),
                server: { id: selected.id, name: selected.name }, gateway: gatewayState, engine: engineState };
            cached.set(key, { at: performance.now(), value }); return value;
        })().finally(() => { pending.delete(key); }));
        return pending.get(key)!;
    }
    async function serverView(server: RegisteredServer, actor: string) {
        const connected = server.id === localServerId && server.gatewayOrigin === gateway && server.engineOrigin === engine;
        const managed = !!lifecycle && !!registry?.lifecycle.managed(server.id);
        return { id: server.id, name: server.name, registeredAt: server.registeredAt, role: identities.role(actor, server.id),
            adminUrl: connected || managed ? `/admin/index.html?serverId=${server.id}` : null,
            connection: connected ? await status({ id: server.id, name: server.name, gateway, engine, managed: false }, '') : null,
            ...(lifecycle ? { managed: await lifecycle.view(server.id) } : {}) };
    }
    async function servers(req: Request): Promise<Response> {
        try {
            const session = requireSession(req, identities);
            if (!registry) return json({ error: 'A szerverregiszter nem érhető el.', code: 'REGISTRY_UNAVAILABLE' }, 503);
            const path = new URL(req.url).pathname;
            const grants = /^\/api\/control-plane\/servers\/(local-default|srv-[a-f0-9-]{36})\/grants(?:\/([a-f0-9-]{36}))?$/.exec(path);
            if (grants) {
                if (!registry.get(grants[1]!)) throw new IdentityError(404, 'SERVER_NOT_FOUND', 'A szerver nem található.');
                if (req.method === 'GET' && !grants[2]) return json({ accounts: identities.grants(session.account.id, grants[1]!) });
                if (req.method === 'PUT' && grants[2]) {
                    const data = await body(req); identities.setRole(session.account.id, grants[2], grants[1]!, data.role); return json({ updated: true });
                }
                return json({ error: 'Method not allowed' }, 405);
            }
            if (lifecycle) {
                if (path === '/api/control-plane/servers/catalog' && req.method === 'GET') return json(lifecycle.catalog());
                const operation = /^\/api\/control-plane\/servers\/operations\/([a-f0-9-]{36})$/.exec(path);
                if (operation && req.method === 'GET') return json({ operation: lifecycle.operation(session.account.id, operation[1]!) });
                if (path === '/api/control-plane/servers' && req.method === 'POST') return json({ operation: lifecycle.create(session.account.id, await body(req)) }, 202);
                const backups = /^\/api\/control-plane\/servers\/(srv-[a-f0-9-]{36})\/backups$/.exec(path);
                if (backups && req.method === 'GET') return json({ backups: await lifecycle.backups(session.account.id, backups[1]!) });
                const action = /^\/api\/control-plane\/servers\/(srv-[a-f0-9-]{36})\/(start|stop|restart|archive|backup|restore|migrate)$/.exec(path);
                if (action && req.method === 'POST') return json({ operation: lifecycle.action(session.account.id, action[1]!, action[2]!, await body(req)) }, 202);
            }
            if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
            if (path === '/api/control-plane/servers') {
                const visible = registry.visibleTo(id => !!identities.role(session.account.id, id));
                return json({ schemaVersion: 1, servers: await Promise.all(visible.map(server => serverView(server, session.account.id))) });
            }
            const id = path.slice('/api/control-plane/servers/'.length);
            const server = registry.get(id);
            if (!server || !identities.role(session.account.id, id)) return json({ error: 'A szerver nem található.', code: 'SERVER_NOT_FOUND' }, 404);
            return json({ server: await serverView(server, session.account.id) });
        } catch (error) { return error instanceof IdentityError ? authError(error)
            : json({ error: 'A szerverregiszter nem olvasható. Ellenőrizd a helyi admin naplóját.', code: 'REGISTRY_UNAVAILABLE' }, 503); }
    }
    const handle = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        if (config.transport ? url.origin !== config.transport.origin : url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return json({ error: 'Configured admin origin required' }, 403);
        if (req.headers.has('host') && req.headers.get('host') !== url.host) return json({ error: 'Invalid Host' }, 403);
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
        try { session = requireSession(req, identities); }
        catch (error) {
            if (['/', '/admin', '/admin/', '/admin/index.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(req.method))
                return new Response(null, { status: 303, headers: { Location: '/admin/login.html', 'Cache-Control': 'no-store' } });
            return authError(error);
        }
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
            let frameEngine = engine;
            if (url.pathname === '/admin/index.html') {
                if (!url.searchParams.has('serverId')) return new Response(null, { status: 303, headers: { Location: '/admin/', 'Cache-Control': 'no-store' } });
                try {
                    if (req.headers.has(serverContextHeader)) requestServerContext(req);
                    frameEngine = target(session.account.id, pageServerContext(url)).engine;
                }
                catch (error) { return authError(error); }
            }
            const assetUrl = new URL(url);
            if (url.pathname === '/admin/index.html' && identities.role(session.account.id, pageServerContext(url)) !== 'owner') assetUrl.pathname = '/admin/observations.html';
            const response = await serveAdminAsset(assetUrl, frameEngine);
            if (req.method === 'HEAD' && response) return new Response(null, { status: response.status, headers: response.headers });
            return response ?? new Response('Not found', { status: 404 });
        }
        if (!url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/control-plane/status') return json({ error: 'Not found' }, 404);
        let selected: Target;
        try { selected = target(session.account.id, requestServerContext(req));
            if (url.pathname.startsWith('/api/admin/')) requireDomainAccess(identities, session.account.id, selected.id, req); }
        catch (error) { return authError(error); }
        try {
            if (url.pathname === '/api/control-plane/status') return req.method === 'GET' ? json(await status(selected, session.account.id)) : json({ error: 'Method not allowed' }, 405);
            if (selected.managed && !(await lifecycle!.connection(session.account.id, selected.id)).gateway)
                return json({ error: 'A kiválasztott szerver gateway-folyamata nem érhető el hitelesítetten. A Saját szervereim oldalon ellenőrizd az állapotát.', code: 'SERVER_GATEWAY_UNAVAILABLE' }, 503);
        } catch { return json({ error: 'A szerver futása nem igazolható. Ellenőrizd a saját szervereid állapotát.', code: 'SERVER_RUNTIME_UNAVAILABLE' }, 503); }
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
        const mutation = !['GET', 'HEAD'].includes(req.method);
        if (mutation && req.headers.get('x-admin-request') !== 'rs-sdk-admin') return json({ error: 'Explicit admin request required' }, 403);
        const headers = new Headers();
        for (const name of allowedHeaders) { const value = req.headers.get(name); if (value !== null) headers.set(name, value); }
        // Only this validated session cookie reaches the selected gateway; unrelated cookies never do.
        headers.set('cookie', `${sessionCookieName}=${session.token}`);
        headers.set(serverContextHeader, selected.id);
        // Same-origin was checked above; keep the gateway's local-mode mutation gate valid through the local proxy.
        if (origin) headers.set('origin', selected.gateway);
        try {
            const response = await fetcher(new URL(url.pathname + url.search, selected.gateway), { method: req.method, headers,
                ...(mutation ? { body: req.body } : {}), redirect: 'error', signal: AbortSignal.any([req.signal, AbortSignal.timeout(config.proxyTimeoutMs)]) });
            const outgoing = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            outgoing.set('Content-Type', response.headers.get('content-type') ?? 'application/json');
            outgoing.set('X-Control-Server-ID', selected.id);
            if (response.headers.has(serverContextHeader) && response.headers.get(serverContextHeader) !== selected.id) {
                await response.body?.cancel(); throw new Error('Backend context mismatch');
            }
            return new Response(response.body, { status: response.status, headers: outgoing });
        } catch {
            return mutation ? json({ error: 'A gateway válasza nem érkezett meg. A művelet kimenetele ismeretlen; ellenőrizd az állapotot és az auditnaplót újrapróbálás előtt.', code: 'GATEWAY_OUTCOME_UNKNOWN' }, 503)
                : json({ error: 'A gateway nem elérhető. Az adminfelület működik; állítsd helyre a helyi gateway kapcsolatát.', code: 'GATEWAY_UNAVAILABLE' }, 503);
        }
    };
    return async (req: Request, connection: string | { requestIP(req: Request): { address: string } | null } = 'unresolved'): Promise<Response> => {
        const socketAddress = typeof connection === 'string' ? connection : connection.requestIP(req)?.address ?? 'unresolved';
        const path = new URL(req.url).pathname, mutation = !['GET', 'HEAD'].includes(req.method);
        let rateLimited = !budget.take(`ip:${socketAddress}`, 1200)
            || mutation && !budget.take(`mutate:${socketAddress}`, 60)
            || path === '/api/control-plane/login' && !budget.take(`login:${socketAddress}`, 10);
        if (!rateLimited && mutation) {
            const account = identities.session(sessionToken(req))?.account;
            if (account) rateLimited = !budget.take(`actor:${account.id}`, 60);
        }
        let response: Response;
        if (rateLimited) response = json({ code: 'RATE_LIMIT', error: 'Túl sok admin kérés; várj egy percet.' }, 429, { 'Retry-After': '60' });
        else response = await handle(req);
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('X-Frame-Options', 'DENY');
        if (config.transport) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
        return response;
    };
}
