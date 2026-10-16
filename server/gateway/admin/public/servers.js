'use strict';
const list = document.getElementById('server-list'), message = document.getElementById('servers-message');
const refresh = document.getElementById('servers-refresh'), empty = document.getElementById('servers-empty');
let pending = false, stopped = false, timer;
let session, mutationPending = false, lastCreate;
const lifecycleMessage = document.getElementById('lifecycle-message');
const stateLabels = { provisioning: 'Létrehozás folyamatban', stopped: 'Leállítva', starting: 'Indítás folyamatban', running: 'Fut', stopping: 'Leállítás folyamatban', restarting: 'Újraindítás folyamatban', archiving: 'Archiválás folyamatban', archived: 'Archiválva', failed: 'Műveleti hiba' };
function lifecycleStatus(text, error = false) { lifecycleMessage.textContent = text; lifecycleMessage.dataset.error = String(error); }
async function lifecycleApi(path, data) {
    const headers = {};
    if (data) {
        const sessionResponse = await fetch('/api/control-plane/session', { cache: 'no-store' });
        if (!sessionResponse.ok) { stopped = true; location.assign('/admin/login.html'); throw new Error('Jelentkezz be újra.'); }
        session = await sessionResponse.json();
        headers['Content-Type'] = 'application/json'; headers['X-Admin-Request'] = 'rs-sdk-admin'; headers['X-Control-CSRF'] = session.csrfToken;
    }
    const response = await fetch('/api/control-plane/servers' + path, { method: data ? 'POST' : 'GET', headers,
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) { stopped = true; location.assign('/admin/login.html'); }
    if (!response.ok) throw new Error(result.error || 'A szerverművelet nem sikerült.');
    return result;
}
async function watchOperation(operation) {
    const deadline = Date.now() + 180000;
    while (!stopped) {
        const result = await lifecycleApi(`/operations/${operation.id}`); operation = result.operation;
        if (operation.state !== 'running') {
            lifecycleStatus(operation.state === 'succeeded' ? 'A művelet befejeződött.' : operation.error, operation.state === 'failed');
            await update(); return operation.state === 'succeeded';
        }
        if (Date.now() > deadline) { lifecycleStatus('A művelet még fut. A Frissítés gombbal ellenőrizheted az állapotot.'); return; }
        await new Promise(resolve => setTimeout(resolve, 700));
    }
}
async function mutate(path, data) {
    if (mutationPending) return;
    mutationPending = true;
    try {
        lifecycleStatus('A művelet kérése folyamatban…');
        const { operation } = await lifecycleApi(path, data);
        lifecycleStatus('A művelet elindult; az eredményre várunk…');
        await update(); return await watchOperation(operation);
    } catch (error) { lifecycleStatus(`${error.message} A kérés kimenetele bizonytalan lehet; ellenőrizd a szerver állapotát.`, true); }
    finally { mutationPending = false; await update(); }
}
function card(server) {
    const article = document.createElement('article'), title = document.createElement('h2'), summary = document.createElement('p');
    article.className = 'server-card'; article.dataset.serverId = server.id; title.textContent = server.name;
    article.append(title, summary);
    if (server.managed) {
        summary.textContent = stateLabels[server.managed.state] || 'Ismeretlen állapot';
        if (server.managed.state === 'running' && server.managed.observedState !== 'running') summary.textContent = 'A folyamat futása jelenleg nem igazolható.';
        const selection = document.createElement('p'); selection.textContent = `Forrás: ${server.managed.version.slice(0, 8)} · Sablon: ${server.managed.template}`; article.append(selection);
        if (server.managed.error) { const error = document.createElement('p'); error.className = 'server-error'; error.textContent = server.managed.error; article.append(error); }
    } else if (server.connection) {
        const gateway = server.connection.gateway.state, engine = server.connection.engine.state;
        article.dataset.gateway = gateway; article.dataset.engine = engine;
        summary.textContent = gateway === 'available' ? 'Az admin kapcsolata elérhető.' : 'Az admin kapcsolata jelenleg nem válaszol.';
        const services = document.createElement('p');
        services.textContent = `Gateway: ${gateway === 'available' ? 'elérhető' : 'nem elérhető'} · Játékszerver: ${engine === 'available' ? 'elérhető' : 'nem elérhető'}`;
        article.append(services);
    } else summary.textContent = 'A szerver adminfelülete még nincs csatlakoztatva.';
    const footer = document.createElement('footer');
    if (server.managed && ['stopped', 'running', 'failed'].includes(server.managed.state)) {
        for (const [action, label] of [['start', 'Indítás'], ['stop', 'Leállítás'], ['restart', 'Újraindítás'], ['archive', 'Archiválás']]) {
            if (action === 'start' && server.managed.state === 'running' || ['stop', 'restart'].includes(action) && server.managed.state === 'stopped') continue;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.action = action; button.disabled = mutationPending;
            const requestKey = crypto.randomUUID();
            button.addEventListener('click', async () => {
                if (action === 'archive' && !confirm('A szerver leáll és archiválva marad. A mentések és naplók megmaradnak; az archivált szerver nem indítható újra. Folytatod?')) return;
                button.disabled = true;
                try { await mutate(`/${server.id}/${action}`, { requestKey, expectedRevision: server.managed.revision }); }
                finally { button.disabled = false; }
            }); footer.append(button);
        }
    }
    if (server.adminUrl === '/admin/index.html?serverId=local-default') {
        const open = document.createElement('a'); open.href = server.adminUrl; open.textContent = 'Szerver megnyitása'; footer.append(open);
        if (server.connection?.gateway.state === 'unavailable') {
            const hint = document.createElement('small'); hint.textContent = 'A felület leállított játékszerver mellett is megnyitható.'; footer.append(hint);
        }
    }
    article.append(footer); return article;
}
async function update() {
    if (pending || stopped) return;
    clearTimeout(timer); pending = true; refresh.disabled = true; list.setAttribute('aria-busy', 'true');
    try {
        const response = await fetch('/api/control-plane/servers', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (response.status === 401) { stopped = true; location.assign('/admin/login.html'); return; }
        const data = await response.json(); if (!response.ok || !Array.isArray(data.servers)) throw new Error(data.error || 'A szerverlista nem tölthető be.');
        list.replaceChildren(...data.servers.map(card)); empty.hidden = data.servers.length !== 0;
        message.textContent = data.servers.length ? `${data.servers.length} saját szerver · Frissítve: ${new Date().toLocaleTimeString('hu-HU')}` : '';
        message.dataset.error = 'false';
    } catch (error) {
        list.replaceChildren(); empty.hidden = true;
        message.textContent = `${error.name === 'TimeoutError' ? 'A szerverlista lekérése túl sokáig tartott.' : error.message} Próbáld újra a Frissítés gombbal.`;
        message.dataset.error = 'true';
    } finally {
        pending = false; refresh.disabled = false; list.setAttribute('aria-busy', 'false');
        if (!stopped) timer = setTimeout(update, 10000);
    }
}
refresh.addEventListener('click', update);
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void update(); } });
void update();
void lifecycleApi('/catalog').then(catalog => {
    const form = document.getElementById('server-create-form');
    for (const [name, entries] of [['version', catalog.versions], ['template', catalog.templates]]) {
        form.elements[name].replaceChildren(...entries.map(entry => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.label; return option; }));
    }
    document.getElementById('server-create').hidden = false;
}).catch(() => { lifecycleStatus('A szerverlétrehozás ebben a kapcsolatban nem érhető el. Próbáld újratölteni az oldalt.', true); });
document.getElementById('server-create-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    const fingerprint = JSON.stringify(data);
    if (lastCreate?.fingerprint !== fingerprint) lastCreate = { fingerprint, requestKey: crypto.randomUUID() };
    const button = form.querySelector('button'); button.disabled = true;
    try { if (await mutate('', { ...data, requestKey: lastCreate.requestKey })) { form.reset(); lastCreate = null; } }
    finally { button.disabled = false; }
});
