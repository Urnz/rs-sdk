import { createGatewayIdentityGate } from '../../control-plane/gateway-identity.js';
import { handleAdminRequest, type AdminRouteContext } from './routes.js';

/** HTTP security boundary; domain handler unit tests can supply their own isolated context. */
export function createOwnedAdminHandler(context: () => AdminRouteContext, gate = createGatewayIdentityGate()) {
    return async (req: Request, url: URL): Promise<Response | null> => {
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin/')) {
            const denied = gate(req); if (denied) return denied;
        }
        return handleAdminRequest(req, url, context());
    };
}
