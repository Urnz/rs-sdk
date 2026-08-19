const state = {
    bots: [],
    economy: null,
    config: null,
    sort: { key: 'status', direction: 1 },
    selected: null,
    token: sessionStorage.getItem('rs-admin-token') || ''
};

const $ = selector => document.querySelector(selector);
const fmt = new Intl.NumberFormat('hu-HU');
const statusLabels = { active: 'Online', offline: 'Offline', stale: 'Nem válaszol', starting: 'Indul', stopping: 'Leáll', error: 'Hiba' };
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.mutation) headers['X-Admin-Request'] = 'rs-sdk-admin';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && state.config?.authMode === 'token') {
            const token = prompt('Add meg a helyi ADMIN_TOKEN értékét:');
            if (token) {
                state.token = token;
                sessionStorage.setItem('rs-admin-token', token);
            }
        }
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

function toast(message, error = false) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3500);
}

function relativeTime(value) {
    if (!value) return '–';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 10) return 'most';
    if (seconds < 60) return `${seconds} mp`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} p`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ó`;
    return `${Math.floor(seconds / 86400)} nap`;
}

function renderSummary() {
    const economy = state.economy;
    if (!economy) return;
    $('#metric-bots').textContent = fmt.format(economy.bots);
    $('#metric-online').textContent = fmt.format(economy.online);
    $('#metric-coins').textContent = `${fmt.format(economy.totalCoins)} gp`;
    $('#metric-xp').textContent = fmt.format(economy.totalXp);
    $('#metric-level').textContent = fmt.format(economy.averageTotalLevel);
    $('#item-stock').innerHTML = economy.itemStock.length
        ? economy.itemStock.map(item => `<div class="stock-item"><span>${escapeHtml(item.name)}</span><strong>${fmt.format(item.count)}</strong></div>`).join('')
        : '<p class="muted">Még nincs készletadat.</p>';
}

function filteredBots() {
    const search = $('#search-filter').value.trim().toLowerCase();
    const status = $('#status-filter').value;
    const skill = $('#skill-filter').value.trim().toLowerCase();
    const minimumCoins = Number($('#coins-filter').value || 0);
    const result = state.bots.filter(bot => {
        const haystack = `${bot.displayName} ${bot.username} ${bot.activity} ${bot.currentSkill || ''}`.toLowerCase();
        const skillNames = bot.skills.map(entry => entry.name).join(' ').toLowerCase();
        return (!search || haystack.includes(search))
            && (!status || bot.status === status)
            && (!skill || skillNames.includes(skill) || (bot.currentSkill || '').toLowerCase().includes(skill))
            && bot.coins >= minimumCoins;
    });
    const { key, direction } = state.sort;
    return result.sort((left, right) => {
        const a = left[key] ?? '';
        const b = right[key] ?? '';
        return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'hu')) * direction;
    });
}

function actionButtons(bot) {
    const primary = bot.canDespawn
        ? `<button class="button small secondary" data-action="despawn" data-name="${escapeHtml(bot.username)}">Despawn</button>`
        : `<button class="button small primary" data-action="spawn" data-name="${escapeHtml(bot.username)}">Spawn</button>`;
    const remove = bot.status === 'offline' || bot.status === 'error'
        ? `<button class="button small ghost" data-action="delete" data-name="${escapeHtml(bot.username)}">Törlés</button>`
        : '';
    return `<div class="row-actions">${primary}<button class="button small ghost" data-action="profile" data-name="${escapeHtml(bot.username)}">Részletek</button>${remove}</div>`;
}

function renderTable() {
    const bots = filteredBots();
    $('#visible-count').textContent = `${bots.length} / ${state.bots.length}`;
    $('#bot-rows').innerHTML = bots.length ? bots.map(bot => {
        const position = bot.position ? `${bot.position.x}, ${bot.position.z}, ${bot.position.level}` : '–';
        const activity = bot.currentSkill || bot.activity;
        return `<tr>
            <td><span class="status ${bot.status}">${statusLabels[bot.status] || bot.status}</span></td>
            <td><button class="bot-name" data-action="profile" data-name="${escapeHtml(bot.username)}">${escapeHtml(bot.displayName)}</button><span class="subline">${bot.hasCredentials ? 'kezelt bot' : bot.hasSave ? 'mentett bot' : 'új bot'}</span></td>
            <td>${escapeHtml(activity || '–')}<span class="subline">${bot.runId ? `run ${escapeHtml(bot.runId.slice(0, 8))}` : escapeHtml(bot.lastError || '')}</span></td>
            <td class="number">${fmt.format(bot.totalLevel)}</td>
            <td class="number">${fmt.format(bot.combatLevel)}</td>
            <td class="number">${fmt.format(bot.coins)} gp</td>
            <td>${position}</td>
            <td title="${escapeHtml(bot.lastActivityAt || '')}">${relativeTime(bot.lastActivityAt)}</td>
            <td>${actionButtons(bot)}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="9" class="empty">Nincs a szűrőknek megfelelő bot.</td></tr>';
}

function itemChips(items) {
    return items.length
        ? items.slice(0, 80).map(item => `<span class="item-chip">${escapeHtml(item.name)} × ${fmt.format(item.count)}</span>`).join('')
        : '<span class="muted">Üres vagy még nincs adat.</span>';
}

function openProfile(username) {
    const bot = state.bots.find(entry => entry.username === username);
    if (!bot) return;
    state.selected = username;
    $('#profile-content').innerHTML = `
        <div class="profile-header"><p class="eyebrow">BOTPROFIL</p><h2>${escapeHtml(bot.displayName)}</h2><p class="muted"><span class="status ${bot.status}">${statusLabels[bot.status] || bot.status}</span> · ${escapeHtml(bot.activity)}</p></div>
        <div class="profile-grid"><div><span>Total level</span><strong>${fmt.format(bot.totalLevel)}</strong></div><div><span>Combat</span><strong>${fmt.format(bot.combatLevel)}</strong></div><div><span>Pénz</span><strong>${fmt.format(bot.coins)} gp</strong></div><div><span>Összes XP</span><strong>${fmt.format(bot.totalXp)}</strong></div><div><span>Pozíció</span><strong>${bot.position ? `${bot.position.x}, ${bot.position.z}` : '–'}</strong></div><div><span>Mentés</span><strong>${bot.hasSave ? 'van' : 'nincs'}</strong></div></div>
        ${bot.currentSkill ? `<p><strong>Aktív agent skill:</strong> ${escapeHtml(bot.currentSkill)}<br><span class="muted">Run: ${escapeHtml(bot.runId || '–')}</span></p>` : ''}
        <h3 class="section-title">Skillek</h3><div class="skill-list">${bot.skills.map(skill => `<div class="skill"><span>${escapeHtml(skill.name)}</span><strong>${skill.level}</strong></div>`).join('')}</div>
        <h3 class="section-title">Inventory</h3><div class="items">${itemChips(bot.inventory)}</div>
        <h3 class="section-title">Felszerelés</h3><div class="items">${itemChips(bot.equipment)}</div>
        <h3 class="section-title">Bank</h3><div class="items">${itemChips(bot.bank)}</div>
        ${bot.lastError ? `<h3 class="section-title danger-text">Legutóbbi hiba</h3><p>${escapeHtml(bot.lastError)}</p>` : ''}`;
    $('#profile-drawer').classList.add('open');
    $('#profile-drawer').setAttribute('aria-hidden', 'false');
    $('#drawer-backdrop').classList.add('open');
}

function closeProfile() {
    $('#profile-drawer').classList.remove('open');
    $('#profile-drawer').setAttribute('aria-hidden', 'true');
    $('#drawer-backdrop').classList.remove('open');
}

function drawChart(snapshots) {
    const canvas = $('#economy-chart');
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = 130 * dpr;
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);
    const width = rect.width, height = 130, padding = 12;
    context.clearRect(0, 0, width, height);
    if (snapshots.length < 2) {
        context.fillStyle = '#9ca793'; context.fillText('Az idősor a panel használata közben 30 másodpercenként épül.', 12, 65); return;
    }
    const draw = (values, color) => {
        const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
        context.beginPath();
        values.forEach((value, index) => {
            const x = padding + index * (width - padding * 2) / Math.max(1, values.length - 1);
            const y = height - padding - (value - min) / span * (height - padding * 2);
            index ? context.lineTo(x, y) : context.moveTo(x, y);
        });
        context.strokeStyle = color; context.lineWidth = 2; context.stroke();
    };
    draw(snapshots.map(item => item.totalCoins), '#d8aa4e');
    draw(snapshots.map(item => item.online), '#68c27a');
}

async function refresh() {
    try {
        const data = await api('/api/admin/bots');
        state.bots = data.bots;
        state.economy = data.economy;
        $('#last-refresh').textContent = `Frissítve: ${new Date(data.generatedAt).toLocaleTimeString('hu-HU')} · automatikus frissítés 5 másodpercenként`;
        renderSummary(); renderTable();
        const history = await api('/api/admin/economy?limit=240');
        drawChart(history.snapshots);
        if (state.selected && $('#profile-drawer').classList.contains('open')) openProfile(state.selected);
    } catch (error) {
        $('#last-refresh').textContent = `Hiba: ${error.message}`;
        toast(error.message, true);
    }
}

function showSpawn(username = '') {
    const form = $('#spawn-form');
    form.reset();
    form.elements.username.value = username;
    form.elements.server.value = 'localhost:8888';
    form.elements.reason.value = 'Kézi admin spawn';
    const bot = state.bots.find(entry => entry.username === username);
    form.elements.password.required = !bot?.hasCredentials;
    $('#spawn-dialog').showModal();
}

document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const name = button.dataset.name;
    try {
        if (button.dataset.action === 'profile') openProfile(name);
        if (button.dataset.action === 'spawn') showSpawn(name);
        if (button.dataset.action === 'despawn') {
            const reason = prompt(`${name} leállításának oka:`, 'Kézi admin despawn');
            if (!reason) return;
            await api(`/api/admin/bots/${encodeURIComponent(name)}/despawn`, { method: 'POST', mutation: true, body: JSON.stringify({ reason }) });
            toast(`${name} leállítása elindult.`); await refresh();
        }
        if (button.dataset.action === 'delete') {
            const form = $('#delete-form'); form.reset(); form.elements.username.value = name; $('#delete-dialog').showModal();
        }
    } catch (error) { toast(error.message, true); }
});

$('#spawn-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    try {
        await api('/api/admin/bots/spawn', { method: 'POST', mutation: true, body: JSON.stringify({
            username: data.get('username'), password: data.get('password'), server: data.get('server'),
            reason: data.get('reason'), rememberCredentials: data.get('rememberCredentials') === 'on'
        }) });
        form.closest('dialog').close(); toast(`${data.get('username')} indítása elindult.`); await refresh();
    } catch (error) { toast(error.message, true); }
});

$('#delete-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), username = data.get('username');
    try {
        await api(`/api/admin/bots/${encodeURIComponent(username)}`, { method: 'DELETE', mutation: true, body: JSON.stringify({ confirmUsername: data.get('confirmUsername'), reason: data.get('reason') }) });
        form.closest('dialog').close(); toast(`${username} karanténba került.`); await refresh();
    } catch (error) { toast(error.message, true); }
});

$('#snapshot-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    try {
        await api('/api/admin/experiments', { method: 'POST', mutation: true, body: JSON.stringify({ label: data.get('label'), reason: data.get('reason') }) });
        form.closest('dialog').close(); toast('A kísérleti snapshot elkészült.');
    } catch (error) { toast(error.message, true); }
});

for (const selector of ['#search-filter', '#status-filter', '#skill-filter', '#coins-filter']) {
    $(selector).addEventListener('input', renderTable);
}
$('thead').addEventListener('click', event => {
    const key = event.target.closest('[data-sort]')?.dataset.sort;
    if (!key) return;
    if (state.sort.key === key) state.sort.direction *= -1;
    else state.sort = { key, direction: 1 };
    renderTable();
});
$('#clear-filters').addEventListener('click', () => { for (const id of ['search-filter', 'status-filter', 'skill-filter', 'coins-filter']) $(`#${id}`).value = ''; renderTable(); });
$('#new-bot-button').addEventListener('click', () => showSpawn());
$('#snapshot-button').addEventListener('click', () => { $('#snapshot-form').reset(); $('#snapshot-dialog').showModal(); });
$('#close-profile').addEventListener('click', closeProfile); $('#drawer-backdrop').addEventListener('click', closeProfile);
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

state.config = await api('/api/admin/config');
await refresh();
setInterval(refresh, state.config.refreshMs || 5000);
