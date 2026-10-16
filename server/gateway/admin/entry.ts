import { createGatewayIdentityGate } from '../../control-plane/gateway-identity.js';
import { handleAdminRequest, type AdminRouteContext } from './routes.js';

/** HTTP security boundary; domain handler unit tests can supply their own isolated context. */
export function createOwnedAdminHandler(context: () => AdminRouteContext, gate = createGatewayIdentityGate()) {
    return async (req: Request, url: URL): Promise<Response | null> => {
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin/')) {
            const denied = gate(req); if (denied) return denied;
            if (['/admin', '/admin/'].includes(url.pathname)) return new Response(null, { status: 303,
                headers: { Location: `/admin/index.html?serverId=${gate.resource}`, 'Cache-Control': 'no-store' } });
        }
        const response = await handleAdminRequest(req, url, context());
        if (response && url.pathname.startsWith('/api/admin/')) response.headers.set('X-Control-Server-ID', gate.resource);
        return response;
    };
}
