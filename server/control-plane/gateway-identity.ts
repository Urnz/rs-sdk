import { IdentityError, IdentityStore, identityPath } from './identity-store.js';
import { authError, json, requireSession } from './auth.js';

/** A missing identity store must never restore the old unauthenticated local admin mode. */
export function createGatewayIdentityGate(path = identityPath(), resource = process.env.CONTROL_PLANE_SERVER_ID || 'local-default') {
    let store: IdentityStore | undefined;
    const check = (req: Request): Response | null => {
        try {
            store ??= new IdentityStore(path, undefined, true);
            const session = requireSession(req, store);
            if (!store.owns(session.account.id, resource)) throw new IdentityError(403, 'OWNER_REQUIRED', 'Ehhez a szerverhez tulajdonosi jogosultság szükséges.');
            return null;
        }
        catch (error) { return error instanceof IdentityError ? authError(error) : json({ code: 'IDENTITY_UNAVAILABLE',
            error: 'A fióktár nem érhető el. Indítsd el a független helyi admint; az első tulajdonosi fiókot ott lehet beállítani.' }, 503); }
    };
    return Object.assign(check, { close() { store?.close(); store = undefined; } });
}
