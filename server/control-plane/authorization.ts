import { IdentityError, type IdentityStore } from './identity-store.js';

// New domain routes default to owner-only. GET may mint credentials (e.g. spectate).
const observations = new Set(['/api/admin/economy', '/api/admin/population-demographics', '/api/admin/simulation-clock',
    '/api/admin/economy/dependencies', '/api/admin/economy/dependency-risk', '/api/admin/society/dashboard',
    '/api/admin/society/evaluation', '/api/admin/society/evaluation/contract']);
export function requireDomainAccess(store: IdentityStore, actor: string, resource: string, req: Request) {
    const role = store.role(actor, resource), url = new URL(req.url);
    if (role === 'owner') return;
    if (role && ['GET', 'HEAD'].includes(req.method)
        && (!url.pathname.startsWith('/api/') || observations.has(url.pathname))) return;
    throw new IdentityError(403, 'ROLE_REQUIRED', 'Ehhez a művelethez tulajdonosi jogosultság szükséges.');
}
