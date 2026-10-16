'use strict';
const list = document.getElementById('server-list'), message = document.getElementById('servers-message');
const refresh = document.getElementById('servers-refresh'), empty = document.getElementById('servers-empty');
let pending = false, stopped = false, timer;
function card(server) {
    const article = document.createElement('article'), title = document.createElement('h2'), summary = document.createElement('p');
    article.className = 'server-card'; article.dataset.serverId = server.id; title.textContent = server.name;
    article.append(title, summary);
    if (server.connection) {
        const gateway = server.connection.gateway.state, engine = server.connection.engine.state;
        article.dataset.gateway = gateway; article.dataset.engine = engine;
        summary.textContent = gateway === 'available' ? 'Az admin kapcsolata elérhető.' : 'Az admin kapcsolata jelenleg nem válaszol.';
        const services = document.createElement('p');
        services.textContent = `Gateway: ${gateway === 'available' ? 'elérhető' : 'nem elérhető'} · Játékszerver: ${engine === 'available' ? 'elérhető' : 'nem elérhető'}`;
        article.append(services);
    } else summary.textContent = 'A szerver adminfelülete még nincs csatlakoztatva.';
    const footer = document.createElement('footer');
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
