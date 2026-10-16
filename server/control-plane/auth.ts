import { timingSafeEqual } from 'node:crypto';
import { csrfFor, IdentityError, type IdentityStore, sessionLifetimeSeconds } from './identity-store.js';
export const sessionCookieName = 'rs-control-session';
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
export function sessionToken(req: Request) {
    const matches = (req.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(sessionCookieName + '='));
    return matches.length === 1 ? matches[0]!.slice(sessionCookieName.length + 1) : null;
}
export function sessionCookie(token: string, clear = false) {
    // HTTP is permitted only on loopback; remote/TLS deployment remains a separate phase.
    return `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : sessionLifetimeSeconds}`;
}
export function requireSession(req: Request, store: IdentityStore, owner = false) {
    const token = sessionToken(req), session = store.session(token);
    if (!session) throw new IdentityError(401, 'LOGIN_REQUIRED', 'Jelentkezz be az adminfelület használatához.');
    if (owner && !store.owns(session.account.id)) throw new IdentityError(403, 'OWNER_REQUIRED', 'Ehhez a helyi szerverhez tulajdonosi jogosultság szükséges.');
    if (!['GET', 'HEAD'].includes(req.method)) {
        const supplied = req.headers.get('x-control-csrf') ?? '', expected = csrfFor(token!);
        if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('x-admin-request') !== 'rs-sdk-admin'
            || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
            throw new IdentityError(403, 'CSRF_REQUIRED', 'Érvénytelen munkamenet-védelem; töltsd újra az oldalt.');
    }
    return { ...session, token: token! };
}
export function authError(error: unknown) {
    return error instanceof IdentityError ? json({ error: error.message, code: error.code }, error.status)
        : json({ error: 'A fiókművelet nem sikerült.', code: 'IDENTITY_FAILURE' }, 500);
}
export async function body(req: Request): Promise<Record<string, unknown>> {
    if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new IdentityError(415, 'JSON_REQUIRED', 'JSON kérés szükséges.');
    const reader = req.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    if (!reader) throw new IdentityError(400, 'INVALID_BODY', 'Hiányzó kérés.');
    while (true) { const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8192) { await reader.cancel(); throw new IdentityError(413, 'BODY_TOO_LARGE', 'Túl nagy fiókkérés.'); }
        chunks.push(chunk.value);
    }
    try { const value = JSON.parse(Buffer.concat(chunks).toString());
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value;
    } catch { throw new IdentityError(400, 'INVALID_BODY', 'Érvénytelen JSON kérés.'); }
}
export async function accountRoute(req: Request, store: IdentityStore): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
        if (path === '/api/control-plane/login' && req.method === 'POST') {
            if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('x-admin-request') !== 'rs-sdk-admin')
                throw new IdentityError(403, 'SAME_ORIGIN_REQUIRED', 'Helyi, azonos eredetű bejelentkezés szükséges.');
            const data = await body(req), login = await store.login(data.username, data.password);
            return json({ account: login.account }, 200, { 'Set-Cookie': sessionCookie(login.token) });
        }
        const session = requireSession(req, store);
        if (path === '/api/control-plane/session' && req.method === 'GET') return json({ account: session.account,
            expiresAt: session.expiresAt, csrfToken: csrfFor(session.token), ownsLocalServer: store.owns(session.account.id) });
        if (path === '/api/control-plane/logout' && req.method === 'POST') {
            store.logout(session.token); return json({ loggedOut: true }, 200, { 'Set-Cookie': sessionCookie('', true) });
        }
        if (path === '/api/control-plane/password' && req.method === 'POST') {
            const data = await body(req); await store.changePassword(session.account.id, data.currentPassword, data.password);
            return json({ loggedOut: true }, 200, { 'Set-Cookie': sessionCookie('', true) });
        }
        if (path === '/api/control-plane/accounts') {
            requireSession(req, store, true);
            if (req.method === 'GET') return json({ accounts: store.listAccounts(session.account.id) });
            if (req.method === 'POST') { const data = await body(req); return json({ account: await store.createAccount(data.username, data.password, session.account.id) }, 201); }
        }
        const ownership = /^\/api\/control-plane\/accounts\/([a-f0-9-]{36})\/ownership$/.exec(path);
        if (ownership && req.method === 'PUT') {
            requireSession(req, store, true);
            const data = await body(req);
            if (typeof data.granted !== 'boolean') throw new IdentityError(400, 'INVALID_GRANT', 'Kifejezett jogosultsági döntés szükséges.');
            store.setOwnership(session.account.id, ownership[1]!, data.granted); return json({ updated: true });
        }
        return json({ error: 'Ismeretlen fiókművelet vagy HTTP-módszer.' }, 404);
    } catch (error) { return authError(error); }
}
