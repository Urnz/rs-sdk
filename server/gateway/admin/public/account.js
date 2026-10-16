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
    byId('ownership-summary').textContent = accountSession.ownsLocalServer ? 'A helyi szerver tulajdonosa vagy.' : 'Ehhez a helyi szerverhez még nincs tulajdonosi jogosultságod. A hozzáférést egy meglévő tulajdonos adhatja meg.';
    byId('back-to-admin').hidden = !accountSession.ownsLocalServer;
    byId('owner-management').hidden = !accountSession.ownsLocalServer;
    byId('account-list').replaceChildren();
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
