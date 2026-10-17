'use strict';
const byId = id => document.getElementById(id);
let accountSession;
function message(text, error = false) { byId('account-message').textContent = text; byId('account-message').dataset.error = String(error); }
async function accountApi(path, data, method = 'POST') {
    const headers = {};
    if (data !== undefined) {
        headers['Content-Type'] = 'application/json'; headers['X-Admin-Request'] = 'rs-sdk-admin';
        if (accountSession) headers['X-Control-CSRF'] = accountSession.csrfToken;
    }
    const response = await fetch('/api/control-plane/' + path, { method: data === undefined ? 'GET' : method, headers, cache: 'no-store',
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (result.code === 'LOGIN_REQUIRED' && !byId('login-form')) location.assign('/admin/login.html');
        throw new Error(result.error || 'A fiókművelet nem sikerült.');
    }
    return result;
}
function wireForm(id, action) {
    const form = byId(id); if (!form) return;
    form.addEventListener('submit', async event => {
        event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
        try { await action(Object.fromEntries(new FormData(form)), form); }
        catch (error) { message(error.message, true); }
        finally { form.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; }); button.disabled = false; }
    });
}
async function loadAccount() {
    accountSession = await accountApi('session');
    byId('account-content').hidden = false; byId('account-name').textContent = accountSession.account.username;
    byId('ownership-summary').textContent = { owner: 'A helyi szerver tulajdonosa vagy.', operator: 'A helyi szerverhez üzemeltetői hozzáférésed van.', viewer: 'A helyi szervert nézőként megfigyelheted.' }[accountSession.localRole] || 'Ehhez a helyi szerverhez még nincs hozzáférésed. A hozzáférést egy meglévő tulajdonos adhatja meg.';
    byId('back-to-admin').hidden = !accountSession.localRole;
    byId('owner-management').hidden = !accountSession.ownsLocalServer;
    byId('account-list').replaceChildren();
    await loadSessions(); await loadRoles();
    if (!accountSession.ownsLocalServer) return;
    const { accounts } = await accountApi('accounts');
    for (const account of accounts) {
        const row = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
        label.textContent = `${account.username} · ${account.ownsLocalServer ? 'tulajdonos' : 'nincs szerverhozzáférés'}`;
        button.type = 'button'; button.textContent = account.ownsLocalServer ? 'Tulajdonjog visszavonása' : 'Tulajdonjog megadása';
        button.addEventListener('click', async () => {
            const action = account.ownsLocalServer ? 'visszavonod' : 'megadod';
            if (!confirm(`Biztosan ${action} ${account.username} teljes tulajdonosi jogosultságát a helyi szerverhez?`)) return;
            button.disabled = true;
            try { await accountApi(`accounts/${account.id}/ownership`, { granted: !account.ownsLocalServer }, 'PUT'); await loadAccount(); message('A jogosultság frissült.'); }
            catch (error) { message(error.message, true); } finally { button.disabled = false; }
        });
        row.append(label, button); byId('account-list').append(row);
    }
}
async function loadSessions() {
    const { sessions } = await accountApi('sessions'); byId('session-list').replaceChildren();
    for (const session of sessions) {
        const row = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
        label.textContent = `${session.current ? 'Ez a munkamenet' : 'Másik munkamenet'} · Lejár: ${new Date(session.expiresAt).toLocaleString('hu-HU')}`;
        button.type = 'button'; button.textContent = 'Munkamenet visszavonása';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await accountApi(`sessions/${session.id}`, {}, 'DELETE'); if (session.current) location.assign('/admin/login.html'); else await loadSessions(); }
            catch (error) { message(error.message, true); button.disabled = false; }
        }); row.append(label, button); byId('session-list').append(row);
    }
}
async function loadRoles() {
    byId('role-management').hidden = true; byId('role-list').replaceChildren();
    const id = new URL(location.href).searchParams.get('serverId');
    if (!id) return;
    const server = await accountApi(`servers/${encodeURIComponent(id)}`);
    if (server.server.role !== 'owner') return;
    const { accounts } = await accountApi(`servers/${encodeURIComponent(id)}/grants`);
    byId('role-management').hidden = false; byId('role-server-name').textContent = server.server.name; byId('role-list').replaceChildren();
    for (const account of accounts) {
        const row = document.createElement('li'), label = document.createElement('span'), select = document.createElement('select'), button = document.createElement('button');
        label.textContent = account.username; select.setAttribute('aria-label', `${account.username} szerepköre`);
        for (const [value, text] of [['', 'Nincs hozzáférés'], ['viewer', 'Néző'], ['operator', 'Üzemeltető'], ['owner', 'Tulajdonos']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
        }
        select.value = account.role || ''; button.type = 'button'; button.textContent = 'Szerepkör mentése';
        button.addEventListener('click', async () => {
            button.disabled = true;
            try { await accountApi(`servers/${encodeURIComponent(id)}/grants/${account.id}`, { role: select.value || null }, 'PUT'); await loadAccount(); message('A szerepkör frissült.'); }
            catch (error) { message(error.message, true); button.disabled = false; }
        }); row.append(label, select, button); byId('role-list').append(row);
    }
}
wireForm('login-form', async data => {
    await accountApi('login', data);
    location.assign('/admin/');
});
wireForm('password-form', async data => { await accountApi('password', data); location.assign('/admin/login.html'); });
wireForm('create-account-form', async (data, form) => { await accountApi('accounts', data); form.reset(); await loadAccount(); message('A fiók létrejött, szerverhozzáférés nélkül.'); });
byId('logout-button')?.addEventListener('click', async () => {
    try { await accountApi('logout', {}); location.assign('/admin/login.html'); } catch (error) { message(error.message, true); }
});
if (byId('account-content')) void loadAccount().then(() => message('')).catch(error => message(error.message, true));
