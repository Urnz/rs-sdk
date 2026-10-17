import { IdentityError, IdentityStore, identityPath } from './identity-store.js';
import { authError, json, requireSession } from './auth.js';
import { pageServerContext, requestServerContext } from './server-context.js';
import { requireDomainAccess } from './authorization.js';
import { RequestBudget } from './request-budget.js';

/** A missing identity store must never restore the old unauthenticated local admin mode. */
export function createGatewayIdentityGate(path = identityPath(), resource = process.env.CONTROL_PLANE_SERVER_ID || 'local-default') {
    let store: IdentityStore | undefined;
    const budget = new RequestBudget();
    const check = (req: Request): Response | null => {
        try {
            if (!budget.take('gateway', 2400)) return json({ code: 'RATE_LIMIT', error: 'Túl sok admin kérés; várj egy percet.' }, 429, { 'Retry-After': '60' });
            store ??= new IdentityStore(path, undefined, true);
            const session = requireSession(req, store);
            requireDomainAccess(store, session.account.id, resource, req);
            const url = new URL(req.url);
            const requested = url.pathname.startsWith('/api/admin/') ? requestServerContext(req)
                : url.pathname === '/admin/index.html' || ['/admin', '/admin/'].includes(url.pathname) && url.searchParams.has('serverId') ? pageServerContext(url) : resource;
            if (url.pathname === '/admin/index.html' && req.headers.has('X-Control-Server-ID')) requestServerContext(req);
            if (requested !== resource) throw new IdentityError(409, 'SERVER_CONTEXT_MISMATCH', 'Ez a gateway másik szerverhez tartozik.');
            return null;
        }
        catch (error) { return error instanceof IdentityError ? authError(error) : json({ code: 'IDENTITY_UNAVAILABLE',
            error: 'A fióktár nem érhető el. Indítsd el a független helyi admint; az első tulajdonosi fiókot ott lehet beállítani.' }, 503); }
    };
    return Object.assign(check, { resource, close() { store?.close(); store = undefined; } });
}
