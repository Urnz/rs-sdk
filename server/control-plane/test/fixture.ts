import { IdentityStore, csrfFor } from '../identity-store.js';

export async function identityFixture() {
    const store = new IdentityStore(':memory:');
    const owner = await store.createAccount('fixture-owner', 'synthetic owner password');
    const login = await store.login(owner.username, 'synthetic owner password');
    const cookie = `rs-control-session=${login.token}`, csrf = csrfFor(login.token);
    return { store, owner, cookie, csrf,
        request(url: string, init: RequestInit = {}) {
            const headers = new Headers(init.headers);
            headers.set('cookie', [cookie, headers.get('cookie')].filter(Boolean).join('; '));
            if (init.method && !['GET', 'HEAD'].includes(init.method)) {
                if (!headers.has('origin')) headers.set('origin', new URL(url).origin);
                if (!headers.has('x-control-csrf')) headers.set('x-control-csrf', csrf);
            }
            return new Request(url, { ...init, headers });
        } };
}
