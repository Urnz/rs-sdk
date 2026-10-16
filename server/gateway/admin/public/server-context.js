const values = new URL(location.href).searchParams.getAll('serverId');
if (values.length !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(values[0] || '')) {
    location.replace('/admin/');
    throw new Error('Szerverválasztás szükséges.');
}
// A document owns one context. Switching servers navigates to a new document, never shared storage.
export const serverId = values[0];
export const tokenKey = `rs-admin-token:${serverId}`;
export function contextHeaders(headers = {}) {
    const current = new URL(location.href).searchParams.getAll('serverId');
    if (current.length !== 1 || current[0] !== serverId) throw new Error('Szerverváltás után töltsd újra a lapot; korábbi adatból művelet nem indítható.');
    return { ...headers, 'X-Control-Server-ID': serverId };
}
export function renderServerContext(server = { id: serverId, name: serverId }) {
    if (server.id !== serverId) throw new Error('Eltérő szerverkontextus érkezett.');
    document.querySelector('#server-context-name').textContent = server.name;
    document.querySelector('#server-context-id').textContent = serverId;
    document.title = `${server.name} · RS Agent Admin`;
}
renderServerContext();
