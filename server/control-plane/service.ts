import { serveAdminAsset } from '../gateway/admin/assets.js';
import { localOrigin, type ControlPlaneConfig } from './config.js';

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
export interface BackendState { state: 'available' | 'unavailable'; httpStatus: number | null }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const allowedHeaders = ['accept', 'content-type', 'authorization', 'x-admin-token', 'x-admin-request'];

/** A separate HTTP owner. No gateway imports, game state stores, credentials or simulation timers. */
export function createControlPlane(config: ControlPlaneConfig, fetcher: Fetcher = fetch) {
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
    return async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return json({ error: 'Local admin origin required' }, 403);
        const origin = req.headers.get('origin');
        if ((origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Same-origin request required' }, 403);
        if (url.pathname === '/health') return req.method === 'GET' ? json({ service: 'rs-sdk-control-plane', ready: true }) : json({ error: 'Method not allowed' }, 405);
        if (url.pathname === '/api/control-plane/status') return req.method === 'GET' ? json(await status()) : json({ error: 'Method not allowed' }, 405);
        if (url.pathname === '/') return Response.redirect(new URL('/admin/', url), 308);
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
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
