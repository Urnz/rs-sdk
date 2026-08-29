const state = {
    bots: [],
    economy: null,
    config: null,
    skills: [],
    teleportDestinations: [],
    skillRuns: [],
    economyEvents: [],
    economyEventSummary: null,
    worldMods: null,
    worldModBackups: [],
    properties: null,
    worldPlayers: [],
    adminTab: 'bots',
    sort: { key: 'status', direction: 1 },
    selected: null,
    offlineEditing: null,
    spectating: null,
    spectateTimer: null,
    worldMapSelected: null,
    worldMapPinned: null,
    token: sessionStorage.getItem('rs-admin-token') || ''
};

const $ = selector => document.querySelector(selector);
const fmt = new Intl.NumberFormat('hu-HU');
const statusLabels = { active: 'Online', offline: 'Offline', stale: 'Nem válaszol', starting: 'Indul', stopping: 'Leáll', error: 'Hiba' };
const worldModStatusLabels = { active: 'Aktív', disabled: 'Kikapcsolva', 'hot-reload-required': 'Hot reload szükséges', 'restart-required': 'Újraindítás szükséges', 'migration-required': 'Migráció szükséges', 'rollback-required': 'Rollback szükséges', 'engine-unreachable': 'Engine nem elérhető', 'activation-error': 'Aktiválási hiba' };
const worldModBackupOperationLabels = { configure: 'Módosítás előtti', manual: 'Kézi', restore: 'Restore előtti mentőpont' };
const worldModDisableModeLabels = { stateless: 'Nyom nélküli kikapcsolás', suspend: 'Állapotmegőrző felfüggesztés', 'read-only': 'Csak olvasható mód', blocked: 'Védett leállítás' };
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const xpThresholds = (() => {
    const values = []; let accumulator = 0;
    for (let index = 0; index < 99; index++) {
        const level = index + 1;
        accumulator += Math.floor(level + Math.pow(2, level / 10) * 300);
        values[index] = Math.floor(accumulator / 4) * 10;
    }
    return values;
})();
const levelForXp = xp => {
    for (let index = 98; index >= 0; index--) if (xp >= xpThresholds[index]) return Math.min(index + 2, 99);
    return 1;
};
const xpForLevel = level => level <= 1 ? 0 : xpThresholds[Math.min(97, level - 2)];

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

function selectAdminTab(tab) {
    if (!['bots', 'economy', 'skills'].includes(tab)) return;
    state.adminTab = tab;
    document.querySelectorAll('.admin-tab').forEach(button => {
        const selected = button.dataset.tab === tab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
    });
    document.querySelectorAll('[data-admin-tab-panel]').forEach(panel => {
        panel.hidden = panel.dataset.adminTabPanel !== tab;
    });
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
    $('#metric-xp-hour').textContent = `${fmt.format(economy.totalXpPerHour || 0)} XP/h`;
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
    let primary = '<button class="button small secondary" disabled>Nem elérhető</button>';
    if (bot.canRestart && (bot.status === 'stale' || bot.status === 'error')) {
        primary = `<button class="button small secondary" data-action="restart" data-name="${escapeHtml(bot.username)}">Újraindítás</button>`;
    } else if (bot.canDespawn) {
        primary = `<button class="button small secondary" data-action="despawn" data-name="${escapeHtml(bot.username)}">Despawn</button>`;
    } else if (bot.canSpawn) {
        primary = `<button class="button small primary" data-action="spawn" data-name="${escapeHtml(bot.username)}">Spawn</button>`;
    }
    const spectate = bot.status === 'active'
        ? `<button class="button small spectate" data-action="spectate" data-name="${escapeHtml(bot.username)}">Spectate</button>`
        : '';
    const skill = bot.currentSkill
        ? `<button class="button small danger-outline" data-action="stop-skill" data-name="${escapeHtml(bot.username)}">Skill stop</button>`
        : bot.status === 'active' && bot.hasCredentials
            ? `<button class="button small skill-button" data-action="start-skill" data-name="${escapeHtml(bot.username)}">Skill indítás</button>`
            : '';
    const teleport = bot.canTeleport
        ? `<button class="button small teleport" data-action="teleport" data-name="${escapeHtml(bot.username)}">Teleport</button>`
        : '';
    const editSave = bot.canEditOffline
        ? `<button class="button small save-edit" data-action="offline-edit" data-name="${escapeHtml(bot.username)}">Mentés szerkesztése</button>`
        : '';
    const remove = bot.status === 'offline' || bot.status === 'error'
        ? `<button class="button small ghost" data-action="delete" data-name="${escapeHtml(bot.username)}">Törlés</button>`
        : '';
    return `<div class="row-actions">${primary}${skill}${teleport}${editSave}${spectate}<button class="button small ghost" data-action="profile" data-name="${escapeHtml(bot.username)}">Részletek</button>${remove}</div>`;
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
            <td class="number">${bot.xpPerHour === null ? `<span class="muted">${bot.status === 'active' ? 'mérés…' : '–'}</span>` : `${fmt.format(bot.xpPerHour)}<span class="subline">+${fmt.format(bot.sessionXpGained)} session</span>`}</td>
            <td>${position}</td>
            <td title="${escapeHtml(bot.lastActivityAt || '')}">${relativeTime(bot.lastActivityAt)}</td>
            <td>${actionButtons(bot)}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="10" class="empty">Nincs a szűrőknek megfelelő bot.</td></tr>';
}

function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) return `${seconds} mp`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} p ${seconds % 60} mp`;
}

function renderSkillRuns() {
    const statusText = { completed: 'Sikeres', failed: 'Hiba', cancelled: 'Leállítva', 'limit-reached': 'Limit' };
    $('#skill-run-count').textContent = `${state.skillRuns.length} futás`;
    $('#skill-run-rows').innerHTML = state.skillRuns.length ? state.skillRuns.map(run => {
        const events = run.events.map(item => `<li><time>${escapeHtml(new Date(item.timestamp).toLocaleTimeString('hu-HU'))}</time><strong>${escapeHtml(item.type)}</strong>${item.stepId ? ` · ${escapeHtml(item.stepId)}` : ''}${item.message ? `<span>${escapeHtml(item.message)}</span>` : ''}</li>`).join('');
        return `<tr>
            <td><span class="run-status ${escapeHtml(run.status)}">${escapeHtml(statusText[run.status] || run.status)}</span></td>
            <td>${escapeHtml(run.username || 'Korábbi futás')}<span class="subline">${escapeHtml(run.runId.slice(0, 8))}</span></td>
            <td>${escapeHtml(run.skill.id)}<span class="subline">v${escapeHtml(run.skill.version)}</span></td>
            <td title="${escapeHtml(run.startedAt)}">${relativeTime(run.startedAt)}</td>
            <td class="number">${formatDuration(run.durationMs)}</td>
            <td class="number">${fmt.format(run.operations)}</td>
            <td><details class="run-details"><summary>${escapeHtml(run.message || run.reason || 'Részletek')}</summary><ul>${events}</ul></details></td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Még nincs befejezett agent-skill futás.</td></tr>';
}

function eventItems(items) {
    return items.length
        ? items.map(item => `${escapeHtml(item.name)} × ${fmt.format(item.quantity)}`).join('<br>')
        : '<span class="muted">–</span>';
}

function renderEconomyEvents() {
    const labels = {
        production: 'Termelés', consumption: 'Felhasználás', 'shop-buy': 'Bolti vásárlás',
        'shop-sell': 'Bolti eladás', 'player-trade': 'Player trade', 'bank-transfer': 'Bankmozgatás'
    };
    const botFilter = $('#event-bot-filter').value.trim().toLowerCase();
    const kindFilter = $('#event-kind-filter').value;
    const events = state.economyEvents.filter(event =>
        (!botFilter || (event.username || '').includes(botFilter)) && (!kindFilter || event.kind === kindFilter)
    );
    const summary = state.economyEventSummary || { producedItems: 0, consumedItems: 0, shopTransactions: 0, playerTrades: 0, netCoins: 0 };
    $('#event-produced').textContent = fmt.format(summary.producedItems);
    $('#event-consumed').textContent = fmt.format(summary.consumedItems);
    $('#event-shops').textContent = fmt.format(summary.shopTransactions);
    $('#event-trades').textContent = fmt.format(summary.playerTrades);
    $('#event-coins').textContent = `${summary.netCoins > 0 ? '+' : ''}${fmt.format(summary.netCoins)} gp`;
    $('#event-coins').classList.toggle('positive', summary.netCoins > 0);
    $('#event-coins').classList.toggle('negative', summary.netCoins < 0);
    $('#economy-event-count').textContent = `${events.length} / ${state.economyEvents.length} esemény`;
    $('#economy-event-rows').innerHTML = events.length ? events.map(event => `<tr>
        <td title="${escapeHtml(event.timestamp)}">${relativeTime(event.timestamp)}</td>
        <td>${escapeHtml(event.username || 'Korábbi futás')}</td>
        <td><span class="event-kind ${escapeHtml(event.kind)}">${escapeHtml(labels[event.kind] || event.kind)}</span>${event.partial ? '<span class="subline">részleges / sikertelen lépés</span>' : ''}</td>
        <td>${eventItems(event.itemsIn)}</td><td>${eventItems(event.itemsOut)}</td>
        <td class="number ${event.coinsDelta > 0 ? 'positive' : event.coinsDelta < 0 ? 'negative' : ''}">${event.coinsDelta > 0 ? '+' : ''}${fmt.format(event.coinsDelta)} gp</td>
        <td>${escapeHtml(event.skillId)}${event.counterparty ? `<span class="subline">partner: ${escapeHtml(event.counterparty)}</span>` : ''}<span class="subline">${escapeHtml(event.runId.slice(0, 8))}</span></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Nincs a szűrőknek megfelelő gazdasági esemény.</td></tr>';
}

function renderWorldMapBots() {
    const container = $('#world-map-bots');
    const online = state.bots.filter(bot => bot.status === 'active' && bot.position)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'hu'));
    const botNames = new Set(online.map(bot => bot.displayName.toLowerCase()));
    const players = state.worldPlayers.filter(player => !botNames.has(player.name.toLowerCase()))
        .sort((left, right) => left.name.localeCompare(right.name, 'hu'));
    $('#world-map-count').textContent = `${online.length} bot · ${players.length} játékos`;
    const selected = online.find(bot => `bot:${bot.username}` === state.worldMapSelected);
    const selectedPlayer = players.find(player => `player:${player.name}` === state.worldMapSelected);
    $('#world-map-selected').textContent = selected
        ? `${selected.displayName} · ${selected.position.x}, ${selected.position.z}, ${selected.position.level}`
        : selectedPlayer ? `${selectedPlayer.name} · ${selectedPlayer.x}, ${selectedPlayer.z}, ${selectedPlayer.level}`
            : state.worldMapPinned ? `${state.worldMapPinned.label} · ${state.worldMapPinned.x}, ${state.worldMapPinned.z}, ${state.worldMapPinned.level}`
                : 'Nincs kijelölt szereplő';
    const spectate = $('#world-map-spectate');
    spectate.hidden = !selected;
    spectate.dataset.name = selected?.username || '';
    const botRows = online.map(bot => `<button class="world-map-bot${`bot:${bot.username}` === state.worldMapSelected ? ' selected' : ''}" data-action="world-focus" data-name="${escapeHtml(bot.username)}">
        <span><strong>${escapeHtml(bot.displayName)}</strong><small>${escapeHtml(bot.currentSkill || bot.activity || 'Idle')}</small></span>
        <span class="world-map-coordinates">${bot.position.x}, ${bot.position.z}<small>szint ${bot.position.level}</small></span>
    </button>`);
    const playerRows = players.map(player => `<button class="world-map-bot${`player:${player.name}` === state.worldMapSelected ? ' selected' : ''}" data-action="world-player-focus" data-name="${escapeHtml(player.name)}">
        <span><strong>${escapeHtml(player.name)}</strong><small>Kézi játékos</small></span>
        <span class="world-map-coordinates">${player.x}, ${player.z}<small>szint ${player.level}</small></span>
    </button>`);
    container.innerHTML = [...botRows, ...playerRows].join('') || '<p class="muted empty">Nincs online szereplő.</p>';
}

function focusWorldBot(username) {
    const bot = state.bots.find(entry => entry.username === username && entry.status === 'active' && entry.position);
    if (!bot) return;
    state.worldMapSelected = `bot:${username}`;
    state.worldMapPinned = null;
    renderWorldMapBots();
    const frame = $('#world-map-frame');
    const targetOrigin = new URL(state.config.worldMapUrl, location.href).origin;
    frame.contentWindow?.postMessage({
        type: 'rs-map-focus', name: bot.displayName,
        x: bot.position.x, z: bot.position.z, level: bot.position.level
    }, targetOrigin);
}

function focusWorldPlayer(name) {
    const player = state.worldPlayers.find(entry => entry.name === name);
    if (!player) return;
    state.worldMapSelected = `player:${name}`;
    state.worldMapPinned = null;
    renderWorldMapBots();
    const frame = $('#world-map-frame');
    frame.contentWindow?.postMessage({ type: 'rs-map-focus', name, x: player.x, z: player.z, level: player.level },
        new URL(state.config.worldMapUrl, location.href).origin);
}

function openWorldMap() {
    const frame = $('#world-map-frame');
    if (frame.src === 'about:blank') frame.src = state.config.worldMapUrl;
    renderWorldMapBots();
    $('#world-map-dialog').showModal();
    const first = state.bots.find(bot => bot.status === 'active' && bot.position);
    if (!state.worldMapSelected && first) setTimeout(() => focusWorldBot(first.username), 500);
}

function openWorldMapAt(x, z, level, label) {
    const frame = $('#world-map-frame');
    if (frame.src === 'about:blank') frame.src = state.config.worldMapUrl;
    state.worldMapSelected = null;
    state.worldMapPinned = { x, z, level, label };
    renderWorldMapBots();
    $('#world-map-spectate').hidden = true;
    if ($('#world-admin-dialog').open) $('#world-admin-dialog').close();
    $('#world-map-dialog').showModal();
    const focus = () => frame.contentWindow?.postMessage({
        type: 'rs-map-focus', name: label, x, z, level
    }, new URL(state.config.worldMapUrl, location.href).origin);
    if (frame.contentDocument?.readyState === 'complete') focus();
    else frame.addEventListener('load', focus, { once: true });
    setTimeout(focus, 400);
}

function closeWorldMap() {
    $('#world-map-dialog').close();
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
        <div class="profile-header"><p class="eyebrow">BOTPROFIL</p><h2>${escapeHtml(bot.displayName)}</h2><p class="muted"><span class="status ${bot.status}">${statusLabels[bot.status] || bot.status}</span> · ${escapeHtml(bot.activity)}</p><div class="profile-actions">${bot.currentSkill ? `<button class="button danger-outline" data-action="stop-skill" data-name="${escapeHtml(bot.username)}">Skill leállítása</button>` : bot.status === 'active' && bot.hasCredentials ? `<button class="button skill-button" data-action="start-skill" data-name="${escapeHtml(bot.username)}">Skill hozzárendelése</button>` : ''}${bot.canTeleport ? `<button class="button teleport" data-action="teleport" data-name="${escapeHtml(bot.username)}">Biztonságos teleport</button>` : ''}${bot.canEditOffline ? `<button class="button save-edit" data-action="offline-edit" data-name="${escapeHtml(bot.username)}">Offline mentés szerkesztése</button>` : ''}${bot.status === 'active' ? `<button class="button spectate" data-action="spectate" data-name="${escapeHtml(bot.username)}">Élő Spectate</button>` : ''}</div></div>
        <div class="profile-grid"><div><span>Total level</span><strong>${fmt.format(bot.totalLevel)}</strong></div><div><span>Combat</span><strong>${fmt.format(bot.combatLevel)}</strong></div><div><span>Pénz</span><strong>${fmt.format(bot.coins)} gp</strong></div><div><span>Összes XP</span><strong>${fmt.format(bot.totalXp)}</strong></div><div><span>Session XP</span><strong>+${fmt.format(bot.sessionXpGained)}</strong></div><div><span>XP/óra</span><strong>${bot.xpPerHour === null ? bot.status === 'active' ? 'mérés…' : '–' : fmt.format(bot.xpPerHour)}</strong></div><div><span>Pozíció</span><strong>${bot.position ? `${bot.position.x}, ${bot.position.z}` : '–'}</strong></div><div><span>Mentés</span><strong>${bot.hasSave ? 'van' : 'nincs'}</strong></div></div>
        ${bot.currentSkill ? `<p><strong>Aktív agent skill:</strong> ${escapeHtml(bot.currentSkill)}<br><span class="muted">Run: ${escapeHtml(bot.runId || '–')}</span></p>` : ''}
        ${bot.skillXpGains.length ? `<h3 class="section-title">Session XP-növekedés</h3><div class="skill-list">${bot.skillXpGains.map(skill => `<div class="skill"><span>${escapeHtml(skill.name)}</span><strong>+${fmt.format(skill.gained)}${skill.xpPerHour === null ? '' : ` · ${fmt.format(skill.xpPerHour)}/h`}</strong></div>`).join('')}</div>` : ''}
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

function drawRadar(data) {
    const canvas = $('#spectate-radar');
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const width = Math.max(320, rect.width || 620), height = Math.max(300, rect.height || 460);
    canvas.width = width * dpr; canvas.height = height * dpr;
    const context = canvas.getContext('2d'); context.scale(dpr, dpr);
    context.fillStyle = '#0d110c'; context.fillRect(0, 0, width, height);
    const center = { x: width / 2, y: height / 2 };
    const all = [...data.nearbyPlayers, ...data.nearbyNpcs, ...data.nearbyLocs, ...data.groundItems];
    const maxDistance = Math.max(8, ...all.map(entity => Math.max(Math.abs(entity.x - data.player.x), Math.abs(entity.z - data.player.z))));
    const scale = Math.min(15, Math.max(5, (Math.min(width, height) / 2 - 30) / maxDistance));
    context.strokeStyle = '#263024'; context.lineWidth = 1;
    for (let tile = -Math.floor(width / scale / 2); tile <= Math.floor(width / scale / 2); tile += 5) {
        const x = center.x + tile * scale; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let tile = -Math.floor(height / scale / 2); tile <= Math.floor(height / scale / 2); tile += 5) {
        const y = center.y + tile * scale; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    const point = (entity, color, radius, square = false) => {
        const x = center.x + (entity.x - data.player.x) * scale;
        const y = center.y - (entity.z - data.player.z) * scale;
        if (x < -5 || y < -5 || x > width + 5 || y > height + 5) return;
        context.fillStyle = color;
        if (square) context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        else { context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); }
    };
    data.nearbyLocs.forEach(entity => point(entity, '#61705d', 2, true));
    data.groundItems.forEach(entity => point(entity, '#b987d4', 3));
    data.nearbyNpcs.forEach(entity => point(entity, entity.inCombat ? '#ff6e61' : '#d49461', 3));
    data.nearbyPlayers.forEach(entity => point(entity, '#69a7d8', 4));
    point(data.player, '#e8c55d', 7);
    context.fillStyle = '#edf0e7'; context.font = '12px Segoe UI';
    context.fillText(`${data.player.x}, ${data.player.z}, ${data.player.level}`, center.x + 11, center.y - 10);
}

async function refreshSpectate() {
    if (!state.spectating || !$('#spectate-dialog').open) return;
    try {
        const data = await api(`/api/admin/bots/${encodeURIComponent(state.spectating)}/spectate`);
        $('#spectate-title').textContent = `${data.displayName} – élő nézet`;
        $('#spectate-status').innerHTML = `<span class="status active">Online</span><strong>${escapeHtml(data.activity)}</strong><span>Tick ${fmt.format(data.tick)} · ${Math.round(data.stateAgeMs)} ms</span><span>HP ${data.player.hp}/${data.player.maxHp}</span><span>Run ${data.player.runEnergy}%</span><span>${data.player.inCombat ? 'Harcban' : 'Nincs harcban'}</span>`;
        drawRadar(data);
        const entities = [...data.nearbyPlayers.map(item => ({ ...item, kind: 'Játékos' })), ...data.nearbyNpcs.map(item => ({ ...item, kind: 'NPC' }))]
            .sort((left, right) => left.distance - right.distance).slice(0, 14);
        $('#spectate-entities').innerHTML = entities.length ? entities.map(item => `<div><span>${escapeHtml(item.kind)} · ${escapeHtml(item.name)}</span><strong>${Math.round(item.distance)} tile</strong></div>`).join('') : '<span class="muted">Nincs közeli szereplő.</span>';
        $('#spectate-inventory').innerHTML = itemChips(data.inventory);
        $('#spectate-messages').innerHTML = data.gameMessages.length ? data.gameMessages.slice().reverse().map(message => `<div><span>${escapeHtml(message.sender ? `${message.sender}: ` : '')}${escapeHtml(message.text)}</span><strong>t${message.tick}</strong></div>`).join('') : '<span class="muted">Nincs friss üzenet.</span>';
    } catch (error) {
        $('#spectate-status').innerHTML = `<span class="status stale">Nem elérhető</span><strong>${escapeHtml(error.message)}</strong>`;
    }
}

function openSpectate(username) {
    state.spectating = username;
    $('#spectate-title').textContent = `${username} – kapcsolódás…`;
    $('#spectate-status').textContent = 'Élő állapot betöltése…';
    $('#spectate-entities').innerHTML = ''; $('#spectate-inventory').innerHTML = ''; $('#spectate-messages').innerHTML = '';
    $('#spectate-dialog').showModal();
    clearInterval(state.spectateTimer);
    void refreshSpectate();
    state.spectateTimer = setInterval(refreshSpectate, 1000);
}

function closeSpectate() {
    clearInterval(state.spectateTimer); state.spectateTimer = null; state.spectating = null;
    $('#spectate-dialog').close();
}

function selectedSkill() {
    return state.skills.find(skill => skill.reference === $('#skill-select').value) || null;
}

function renderSkillParameters() {
    const skill = selectedSkill();
    if (!skill) {
        $('#skill-description').innerHTML = '<span class="muted">Nincs választható verified skill.</span>';
        $('#skill-parameters').innerHTML = '';
        return;
    }
    $('#skill-description').innerHTML = `<strong>${escapeHtml(skill.name)}</strong><p>${escapeHtml(skill.description)}</p><span>${skill.tags.map(tag => escapeHtml(tag)).join(' · ')} · max. ${Math.round(skill.limits.timeoutMs / 1000)} mp</span>`;
    const entries = Object.entries(skill.parameters);
    $('#skill-parameters').innerHTML = entries.length ? entries.map(([name, parameter]) => {
        const required = parameter.required && parameter.default === undefined ? 'required' : '';
        const value = parameter.default ?? '';
        let control;
        if (parameter.enum) {
            control = `<select data-param="${escapeHtml(name)}" data-type="${parameter.type}" ${required}>${parameter.enum.map(option => `<option value="${escapeHtml(option)}" ${Object.is(option, value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>`;
        } else if (parameter.type === 'boolean') {
            control = `<input data-param="${escapeHtml(name)}" data-type="boolean" type="checkbox" ${value === true ? 'checked' : ''}>`;
        } else {
            control = `<input data-param="${escapeHtml(name)}" data-type="${parameter.type}" type="${parameter.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}" ${parameter.minimum !== undefined ? `min="${parameter.minimum}"` : ''} ${parameter.maximum !== undefined ? `max="${parameter.maximum}"` : ''} ${required}>`;
        }
        return `<label>${escapeHtml(name)}${control}<span>${escapeHtml(parameter.description)}</span></label>`;
    }).join('') : '<p class="dialog-note">Ehhez a skillhez nincs beállítandó paraméter.</p>';
}

function showSkill(username) {
    const form = $('#skill-form'); form.reset(); form.elements.username.value = username;
    form.elements.reason.value = 'Kézi agent-skill hozzárendelés';
    $('#skill-bot-name').textContent = state.bots.find(bot => bot.username === username)?.displayName || username;
    $('#skill-select').innerHTML = state.skills.map(skill => `<option value="${escapeHtml(skill.reference)}">${escapeHtml(skill.name)} · ${escapeHtml(skill.version)}</option>`).join('');
    renderSkillParameters(); $('#skill-dialog').showModal();
}

function showTeleport(username) {
    const form = $('#teleport-form'); form.reset(); form.elements.username.value = username;
    form.elements.reason.value = 'Kézi admin teleport';
    const bot = state.bots.find(entry => entry.username === username);
    $('#teleport-bot-name').textContent = bot?.displayName || username;
    $('#teleport-current-position').textContent = bot?.position
        ? `${bot.position.x}, ${bot.position.z}, szint ${bot.position.level}`
        : 'nincs friss pozíció';
    $('#teleport-destination').innerHTML = state.teleportDestinations.map(destination =>
        `<option value="${escapeHtml(destination.id)}">${escapeHtml(destination.label)} · ${destination.x}, ${destination.z}, ${destination.level}</option>`
    ).join('');
    $('#teleport-description').textContent = state.teleportDestinations[0]?.description || '';
    $('#teleport-dialog').showModal();
}

function updateTeleportDescription() {
    const destination = state.teleportDestinations.find(entry => entry.id === $('#teleport-destination').value);
    $('#teleport-description').textContent = destination?.description || '';
}

function aggregateEditableItems(items) {
    const aggregate = new Map();
    for (const item of items.filter(entry => entry.id !== 995)) {
        const current = aggregate.get(item.id) || { id: item.id, name: item.name, count: 0 };
        current.count += item.count;
        aggregate.set(item.id, current);
    }
    return [...aggregate.values()].sort((left, right) => left.id - right.id);
}

function addEditableItem(targetId, item = { id: '', count: 1, name: '' }) {
    $(`#${targetId}`).querySelector('.editable-empty')?.remove();
    const row = document.createElement('div');
    row.className = 'editable-item';
    row.innerHTML = `<input data-field="id" type="number" min="0" max="65534" step="1" placeholder="Item ID" value="${escapeHtml(item.id)}" required>
        <input data-field="count" type="number" min="1" max="2147483647" step="1" placeholder="Mennyiség" value="${escapeHtml(item.count)}" required>
        <button type="button" class="button small danger-outline" data-action="offline-remove-item" aria-label="Item eltávolítása">×</button>
        <span class="item-name">${escapeHtml(item.name || 'Új item – az ID-t az engine ellenőrzi')}</span>`;
    $(`#${targetId}`).append(row);
}

function renderEditableItems(targetId, items) {
    const target = $(`#${targetId}`);
    target.innerHTML = '';
    for (const item of aggregateEditableItems(items)) addEditableItem(targetId, item);
    if (!target.children.length) target.innerHTML = '<span class="muted editable-empty">Üres.</span>';
}

function renderOfflineBackups(backups) {
    $('#offline-backups').innerHTML = backups.length ? backups.map(backup => `<div class="backup-entry">
        <span><strong>${new Date(backup.createdAt).toLocaleString('hu-HU')}</strong><small>${backup.operation === 'edit' ? 'Szerkesztés előtti' : 'Visszaállítás előtti'} · ${fmt.format(backup.size)} bájt</small></span>
        <button type="button" class="button small secondary" data-action="offline-restore" data-backup-id="${escapeHtml(backup.id)}">Visszaállítás</button>
    </div>`).join('') : '<span class="muted">Még nincs biztonsági másolat.</span>';
}

async function showOfflineEditor(username) {
    const bot = state.bots.find(entry => entry.username === username);
    if (!bot?.canEditOffline || !bot.saveSavedAt) throw new Error('Csak teljesen offline, érvényes mentéssel rendelkező bot szerkeszthető.');
    const data = await api(`/api/admin/bots/${encodeURIComponent(username)}/offline-save`, { mutation: true });
    if (!data.readiness?.editable) {
        const messages = {
            'player-online': 'A játékos még jelen van az engine-ben. Várd meg a teljes kijelentkezést.',
            'login-pending': 'A játékos bejelentkezése még folyamatban van.',
            'logout-pending': 'Az engine még az utolsó kijelentkezési mentést írja.'
        };
        throw new Error(messages[data.readiness?.code] || 'A mentés még használatban van; próbáld újra rövidesen.');
    }
    if (!data.state) throw new Error('A hiteles mentésadatokat nem sikerült betölteni.');
    const saved = data.state;
    state.offlineEditing = username;
    const form = $('#offline-editor-form'); form.reset();
    form.elements.username.value = username;
    form.elements.expectedSavedAt.value = saved.savedAt;
    form.elements.reason.value = 'Kézi offline botadat-szerkesztés';
    $('#offline-editor-title').textContent = `${bot.displayName} mentésének szerkesztése`;
    $('#offline-coins').value = saved.coins;
    $('#offline-skill-rows').innerHTML = saved.skills.map(skill => `<tr class="offline-skill-row" data-skill="${escapeHtml(skill.name)}">
        <td><strong>${escapeHtml(skill.name)}</strong></td>
        <td><input data-field="level" type="number" min="1" max="99" step="1" value="${levelForXp(skill.experience)}" aria-label="${escapeHtml(skill.name)} level"></td>
        <td><input data-field="experience" type="number" min="0" max="2000000000" step="1" value="${skill.experience}" aria-label="${escapeHtml(skill.name)} XP"></td>
    </tr>`).join('');
    renderEditableItems('offline-inventory-rows', saved.inventory);
    renderEditableItems('offline-bank-rows', saved.bank);
    renderOfflineBackups(data.backups);
    $('#offline-editor-dialog').showModal();
}

function collectEditableItems(targetId) {
    return [...$(`#${targetId}`).querySelectorAll('.editable-item')].map(row => ({
        id: Number(row.querySelector('[data-field="id"]').value),
        count: Number(row.querySelector('[data-field="count"]').value)
    }));
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
        const [data, history, skillHistory, economyEvents, worldPlayers] = await Promise.all([
            api('/api/admin/bots'), api('/api/admin/economy?limit=240'), api('/api/admin/skill-runs?limit=30'),
            api('/api/admin/economy-events?limit=200'), api('/api/admin/world-players')
        ]);
        state.bots = data.bots;
        state.economy = data.economy;
        state.skillRuns = skillHistory.runs;
        state.economyEvents = economyEvents.events;
        state.economyEventSummary = economyEvents.summary;
        state.worldPlayers = worldPlayers.players;
        $('#last-refresh').textContent = `Frissítve: ${new Date(data.generatedAt).toLocaleTimeString('hu-HU')} · automatikus frissítés 5 másodpercenként`;
        renderSummary(); renderTable(); renderSkillRuns(); renderEconomyEvents();
        if ($('#world-map-dialog').open) renderWorldMapBots();
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

function worldModInput(setting, value) {
    const safeKey = escapeHtml(setting.key);
    if (setting.type === 'boolean') {
        return `<label class="check world-mod-setting"><input data-mod-setting="${safeKey}" data-setting-type="boolean" type="checkbox" ${value ? 'checked' : ''}><span>${escapeHtml(setting.label)}<br><small>${escapeHtml(setting.description)}</small></span></label>`;
    }
    const type = setting.type === 'string' ? 'text' : 'number';
    const step = setting.type === 'integer' ? '1' : setting.type === 'number' ? 'any' : '';
    const minimum = setting.minimum === undefined ? '' : `min="${setting.minimum}"`;
    const maximum = setting.maximum === undefined ? '' : `max="${setting.maximum}"`;
    return `<label class="world-mod-setting ${setting.type === 'string' ? 'wide' : ''}">${escapeHtml(setting.label)}<input data-mod-setting="${safeKey}" data-setting-type="${setting.type}" type="${type}" value="${escapeHtml(value)}" ${step ? `step="${step}"` : ''} ${minimum} ${maximum} required><small>${escapeHtml(setting.description)}</small></label>`;
}

function renderWorldMods() {
    const data = state.worldMods;
    if (!data) return;
    const pending = data.mods.filter(mod => !['active', 'disabled'].includes(mod.status)).length;
    const loaded = data.engineLoadedAt ? new Date(data.engineLoadedAt).toLocaleString('hu-HU') : 'nem elérhető';
    const reloaded = data.engineLastReloadAt ? new Date(data.engineLastReloadAt).toLocaleString('hu-HU') : 'még nem volt';
    $('#world-mod-summary').innerHTML = `Kért revízió: ${fmt.format(data.revision)} · engine revízió: ${data.activeRevision ?? 'nem elérhető'} · indulás: ${escapeHtml(loaded)} · utolsó hot reload: ${escapeHtml(reloaded)} · ${pending} függőben lévő módosítás${data.engineLoadError ? `<strong class="danger-text"> · Betöltési hiba: ${escapeHtml(data.engineLoadError)}</strong>` : ''}`;
    $('#world-mod-list').innerHTML = data.mods.map(mod => `
        <article class="world-mod-card ${mod.status === 'restart-required' ? 'pending' : mod.status}" data-mod-id="${escapeHtml(mod.id)}">
            <div class="world-mod-heading"><div><h3>${escapeHtml(mod.name)}</h3><p>${escapeHtml(mod.description)}</p></div>
                <label class="check"><input data-world-mod-enabled type="checkbox" ${mod.requested.enabled ? 'checked' : ''} ${mod.requested.enabled && !mod.disablePlan.allowed ? 'disabled' : ''}> Engedélyezve</label></div>
            <div class="world-mod-meta">
                <span class="world-mod-badge ${mod.status}">${worldModStatusLabels[mod.status] || mod.status}</span>
                <span class="world-mod-badge">${escapeHtml(mod.id)} @ ${escapeHtml(mod.version)}</span>
                <span class="world-mod-badge">Adatséma: v${fmt.format(mod.dataSchemaVersion)}</span>
                <span class="world-mod-badge">${mod.activation === 'restart-required' ? 'Restart életciklus' : 'Hot reload'}</span>
                <span class="world-mod-badge disable-${escapeHtml(mod.disablePlan.mode)}">${escapeHtml(worldModDisableModeLabels[mod.disablePlan.mode] || mod.disablePlan.mode)}</span>
                <span class="world-mod-badge">Hook: ${escapeHtml(mod.hooks.join(', ') || 'nincs')}</span>
            </div>
            ${mod.runtime ? `<div class="world-mod-runtime">
                <span>Hook hívások: <strong>${fmt.format(mod.runtime.hookInvocations)}</strong></span>
                <span>Hook hibák: <strong>${fmt.format(mod.runtime.hookErrors)}</strong></span>
                <span>Utolsó hívás: <strong>${mod.runtime.lastHookAt ? escapeHtml(new Date(mod.runtime.lastHookAt).toLocaleString('hu-HU')) : 'még nem futott'}</strong></span>
                ${Object.entries(mod.runtime.counters).map(([key, value]) => `<span>${escapeHtml(key)}: <strong>${fmt.format(value)}</strong></span>`).join('')}
                ${mod.runtime.lastError ? `<span class="danger-text">Utolsó hiba: <strong>${escapeHtml(mod.runtime.lastError)}</strong></span>` : ''}
            </div>` : '<div class="world-mod-runtime muted">Nincs aktív engine-metrika.</div>'}
            <div class="world-mod-disable-plan ${mod.disablePlan.allowed ? '' : 'blocked'}">
                <strong>Kikapcsolási szerződés:</strong> ${escapeHtml(mod.disablePlan.description)}
                <span>${mod.disablePlan.dataPreserved ? 'A domainadatok megmaradnak.' : 'Nincs megőrzendő domainadat.'}</span>
                ${mod.disablePlan.blockers.length ? `<span class="danger-text"><strong>Blokkolók:</strong> ${escapeHtml(mod.disablePlan.blockers.join(' · '))}</span>` : '<span>Kikapcsolási preflight: rendben.</span>'}
            </div>
            ${mod.runtime?.details?.length ? `<details class="world-mod-telemetry"><summary>Játékosonkénti állapot (${fmt.format(mod.runtime.details.length)})</summary>
                <div class="world-mod-telemetry-scroll"><table><thead><tr><th>Játékos</th><th>Activity kulcs</th><th class="number">Ismétlés</th><th class="number">Következő szorzó</th></tr></thead><tbody>
                    ${mod.runtime.details.map(detail => `<tr><td>${escapeHtml(detail.username)}</td><td title="${escapeHtml(detail.activityKey)}">${escapeHtml(detail.activityKey)}</td><td class="number">${detail.repetitionScore.toFixed(2)}</td><td class="number">${Math.round(detail.nextMultiplier * 100)}%</td></tr>`).join('')}
                </tbody></table></div></details>` : ''}
            <details class="world-mod-config" ${mod.settings.length <= 4 ? 'open' : ''}>
                <summary>Beállítások szerkesztése (${fmt.format(mod.settings.length)})</summary>
                <div class="world-mod-settings">${mod.settings.map(setting => worldModInput(setting, mod.requested.config[setting.key])).join('')}</div>
                <div class="world-mod-actions"><label>Indoklás<input data-world-mod-reason value="World mod konfiguráció módosítása" maxlength="240" required></label>
                    <button class="button primary" data-action="world-mod-save">Mentés</button></div>
            </details>
        </article>`).join('') || '<p class="empty">Nincs telepített world mod.</p>';
}

function renderWorldModBackups() {
    $('#world-mod-backups').innerHTML = state.worldModBackups.map(backup => `
        <article class="world-mod-backup-row">
            <div><strong>Revízió ${fmt.format(backup.revision)}</strong><small>${escapeHtml(worldModBackupOperationLabels[backup.operation] || backup.operation)} · ${escapeHtml(new Date(backup.createdAt).toLocaleString('hu-HU'))}</small><small>${escapeHtml(backup.reason)}</small></div>
            <button type="button" class="button ghost" data-action="world-mod-restore" data-backup-id="${escapeHtml(backup.id)}">Visszaállítás</button>
        </article>`).join('') || '<p class="empty">Még nincs konfigurációmentés.</p>';
}

function renderProperties() {
    const data = state.properties;
    if (!data) return;
    $('#property-summary').textContent = data.enabled
        ? 'A mod aktív: az online játékosok inventoryjában lévő coinból tesztvásárlás indítható.'
        : 'A mod read-only: a tulajdon látható, de új vásárlás nem indítható.';
    $('#property-list').innerHTML = data.properties.map(property => {
        const owner = property.state.owner ? `${property.state.owner.kind}: ${property.state.owner.id}` : 'Nincs tulajdonos';
        const canBuy = data.enabled && property.state.status === 'available';
        const canReset = property.state.status === 'owned' || property.state.status === 'disabled';
        return `<article class="property-card">
            <div><h4>${escapeHtml(property.displayName)}</h4><p>${escapeHtml(property.description)}</p></div>
            <div class="property-meta">
                <span>${escapeHtml(property.type)}</span><span>${escapeHtml(property.location.region)}</span>
                <span>${fmt.format(property.purchasePrice)} coin</span><span>${escapeHtml(property.state.status)}</span>
                <span>${escapeHtml(owner)}</span><span>${property.location.x}, ${property.location.z}, ${property.location.level}</span>
            </div>
            <div class="property-actions">
                <button type="button" class="button ghost" data-action="property-map"
                    data-property-x="${property.location.x}" data-property-z="${property.location.z}"
                    data-property-level="${property.location.level}" data-property-label="${escapeHtml(property.displayName)}">Térképen</button>
                <button type="button" class="button ${canBuy ? 'primary' : 'ghost'}" data-action="property-purchase"
                    data-property-id="${escapeHtml(property.propertyId)}" ${canBuy ? '' : 'disabled'}>Tesztvásárlás</button>
                ${canReset ? `<button type="button" class="button danger" data-action="property-reset"
                    data-property-id="${escapeHtml(property.propertyId)}" data-property-version="${property.state.version}">Fejlesztői reset</button>` : ''}
            </div>
        </article>`;
    }).join('') || '<p class="empty">Nincs konfigurált ingatlan.</p>';
    $('#property-pending-list').innerHTML = (data.pendingPurchases || []).map(purchase => `<article class="property-pending-row">
        <div><strong>${escapeHtml(purchase.propertyId)}</strong><small>${escapeHtml(purchase.transactionId)}</small>
            <small>${escapeHtml(purchase.buyer.kind)}: ${escapeHtml(purchase.buyer.id)} · ${fmt.format(purchase.amount)} coin · ${escapeHtml(new Date(purchase.createdAt).toLocaleString('hu-HU'))}</small></div>
        <div class="property-actions">
            <button type="button" class="button ghost" data-action="property-reconcile" data-resolution="release-unpaid"
                data-transaction-id="${escapeHtml(purchase.transactionId)}">Nem történt terhelés</button>
            <button type="button" class="button danger" data-action="property-reconcile" data-resolution="commit-debited"
                data-transaction-id="${escapeHtml(purchase.transactionId)}">Terhelés megtörtént</button>
        </div>
    </article>`).join('') || '<p class="empty">Nincs félbemaradt vásárlás.</p>';
}

async function refreshWorldAdminData() {
    const [mods, backups, properties] = await Promise.all([
        api('/api/admin/world-mods'),
        api('/api/admin/world-mods/backups?limit=30'),
        api('/api/admin/properties')
    ]);
    state.worldMods = mods;
    state.worldModBackups = backups.backups;
    state.properties = properties;
    renderWorldMods();
    renderWorldModBackups();
    renderProperties();
}

async function openWorldAdmin() {
    await refreshWorldAdminData();
    $('#world-admin-dialog').showModal();
}

async function saveWorldMod(button) {
    const card = button.closest('[data-mod-id]');
    const modId = card.dataset.modId;
    const config = {};
    card.querySelectorAll('[data-mod-setting]').forEach(input => {
        const type = input.dataset.settingType;
        config[input.dataset.modSetting] = type === 'boolean' ? input.checked : type === 'string' ? input.value : Number(input.value);
    });
    const reason = card.querySelector('[data-world-mod-reason]').value.trim();
    if (!reason) throw new Error('A módosításhoz indoklás szükséges.');
    const result = await api(`/api/admin/world-mods/${encodeURIComponent(modId)}`, {
        method: 'PUT', mutation: true,
        body: JSON.stringify({ expectedRevision: state.worldMods.revision, enabled: card.querySelector('[data-world-mod-enabled]').checked, config, reason })
    });
    await refreshWorldAdminData();
    if (result.activationError) toast(`Mentve, de a hot reload sikertelen: ${result.activationError}`, true);
    else if (result.restartRequired) toast('Mentve. Az engine újraindítása után lép életbe.');
    else toast(result.hotReloaded ? 'A mod mentve és hot reloaddal aktiválva.' : 'A mod beállítása frissült.');
}

document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const name = button.dataset.name;
    try {
        if (button.dataset.action === 'offline-add-item') addEditableItem(button.dataset.target);
        if (button.dataset.action === 'offline-remove-item') {
            const container = button.closest('.editable-items');
            button.closest('.editable-item').remove();
            if (!container.querySelector('.editable-item')) container.innerHTML = '<span class="muted editable-empty">Üres.</span>';
        }
        if (button.dataset.action === 'offline-restore') {
            const username = state.offlineEditing;
            const form = $('#offline-editor-form');
            const reason = form.elements.reason.value.trim();
            if (!username || !reason) throw new Error('A visszaállításhoz indoklás szükséges.');
            if (!confirm('Biztosan visszaállítod ezt a mentést? A jelenlegi állapotról előtte automatikus másolat készül.')) return;
            await api(`/api/admin/bots/${encodeURIComponent(username)}/offline-save/restore`, {
                method: 'POST', mutation: true,
                body: JSON.stringify({ backupId: button.dataset.backupId, expectedSavedAt: form.elements.expectedSavedAt.value, reason })
            });
            $('#offline-editor-dialog').close(); state.offlineEditing = null;
            toast(`${username} mentése visszaállítva.`); await refresh();
        }
        if (button.dataset.action === 'profile') openProfile(name);
        if (button.dataset.action === 'spectate') openSpectate(name);
        if (button.dataset.action === 'start-skill') showSkill(name);
        if (button.dataset.action === 'teleport') showTeleport(name);
        if (button.dataset.action === 'offline-edit') await showOfflineEditor(name);
        if (button.dataset.action === 'world-focus') focusWorldBot(name);
        if (button.dataset.action === 'world-player-focus') focusWorldPlayer(name);
        if (button.dataset.action === 'world-spectate') { closeWorldMap(); openSpectate(name); }
        if (button.dataset.action === 'property-map') openWorldMapAt(
            Number(button.dataset.propertyX), Number(button.dataset.propertyZ),
            Number(button.dataset.propertyLevel), button.dataset.propertyLabel
        );
        if (button.dataset.action === 'world-mod-save') await saveWorldMod(button);
        if (button.dataset.action === 'property-purchase') {
            const propertyId = button.dataset.propertyId;
            const username = prompt('Melyik online játékos vásárolja meg az ingatlant?');
            if (!username?.trim()) return;
            const reason = prompt('A tesztvásárlás indoklása:', 'Phase 9 ingatlanvásárlási teszt');
            if (!reason?.trim()) return;
            await api(`/api/admin/properties/${encodeURIComponent(propertyId)}/purchase`, {
                method: 'POST', mutation: true,
                body: JSON.stringify({ username: username.trim(), reason: reason.trim() })
            });
            await refreshWorldAdminData();
            toast('Az ingatlanvásárlás sikeresen lefutott.');
        }
        if (button.dataset.action === 'property-reset') {
            const propertyId = button.dataset.propertyId;
            const reason = prompt('A fejlesztői reset indoklása:', 'Phase 9 tesztingatlan felszabadítása');
            if (!reason?.trim()) return;
            if (!confirm(`Biztosan felszabadítod ezt az ingatlant: ${propertyId}? A művelet nem térít vissza coinokat.`)) return;
            await api(`/api/admin/properties/${encodeURIComponent(propertyId)}/reset`, {
                method: 'POST', mutation: true,
                body: JSON.stringify({ expectedVersion: Number(button.dataset.propertyVersion), reason: reason.trim() })
            });
            await refreshWorldAdminData();
            toast('Az ingatlan fejlesztői resetje sikeresen lefutott.');
        }
        if (button.dataset.action === 'property-reconcile') {
            const transactionId = button.dataset.transactionId;
            const resolution = button.dataset.resolution;
            const debited = resolution === 'commit-debited';
            const reason = prompt('A pending tranzakció egyeztetésének indoklása:', 'Crash utáni kézi állapotegyeztetés');
            if (!reason?.trim()) return;
            const warning = debited
                ? 'A döntés tulajdonossá teszi a vevőt, de nem von le újabb coinokat.'
                : 'A döntés felszabadítja az ingatlant, és nem térít vissza coinokat.';
            if (!confirm(`${warning}\n\nCsak a játékos mentésének ellenőrzése után folytasd.`)) return;
            await api('/api/admin/properties/reconcile', {
                method: 'POST', mutation: true,
                body: JSON.stringify({ transactionId, resolution, reason: reason.trim() })
            });
            await refreshWorldAdminData();
            toast('A félbemaradt vásárlás egyeztetése sikeresen lefutott.');
        }
        if (button.dataset.action === 'world-mod-restore') {
            const backup = state.worldModBackups.find(entry => entry.id === button.dataset.backupId);
            if (!backup) throw new Error('A kiválasztott backup már nem található.');
            const form = $('#world-mod-restore-form');
            form.reset();
            form.elements.backupId.value = backup.id;
            $('#world-mod-restore-summary').textContent = `A ${new Date(backup.createdAt).toLocaleString('hu-HU')} időpontban mentett ${backup.revision}. revízió áll vissza. Előtte az aktuális állapotról új mentőpont készül.`;
            $('#world-mod-restore-dialog').showModal();
        }
        if (button.dataset.action === 'admin-tab') selectAdminTab(button.dataset.tab);
        if (button.dataset.action === 'stop-skill') {
            const reason = prompt(`${name} agent skilljének leállítási oka:`, 'Kézi agent-skill leállítás');
            if (!reason) return;
            await api(`/api/admin/bots/${encodeURIComponent(name)}/stop-skill`, { method: 'POST', mutation: true, body: JSON.stringify({ reason }) });
            toast(`${name} skilljének leállítása elindult.`); await refresh();
        }
        if (button.dataset.action === 'spawn') showSpawn(name);
        if (button.dataset.action === 'restart') {
            const reason = prompt(`${name} újraindításának oka:`, 'Beragadt vagy nem válaszoló bot újraindítása');
            if (!reason) return;
            await api(`/api/admin/bots/${encodeURIComponent(name)}/restart`, { method: 'POST', mutation: true, body: JSON.stringify({ reason }) });
            toast(`${name} újraindítása elindult.`); await refresh();
        }
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

$('#skill-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), parameters = {};
    for (const control of $('#skill-parameters').querySelectorAll('[data-param]')) {
        if (control.dataset.type !== 'boolean' && control.value === '' && !control.required) continue;
        if (control.dataset.type === 'boolean') parameters[control.dataset.param] = control.type === 'checkbox' ? control.checked : control.value === 'true';
        else if (control.dataset.type === 'number') parameters[control.dataset.param] = Number(control.value);
        else parameters[control.dataset.param] = control.value;
    }
    try {
        await api(`/api/admin/bots/${encodeURIComponent(data.get('username'))}/start-skill`, {
            method: 'POST', mutation: true,
            body: JSON.stringify({ skill: data.get('skill'), parameters, reason: data.get('reason') })
        });
        form.closest('dialog').close(); toast(`${data.get('username')} skillje elindult.`); await refresh();
    } catch (error) { toast(error.message, true); }
});

$('#teleport-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    try {
        const response = await api(`/api/admin/bots/${encodeURIComponent(data.get('username'))}/teleport`, {
            method: 'POST', mutation: true,
            body: JSON.stringify({ destinationId: data.get('destinationId'), reason: data.get('reason') })
        });
        form.closest('dialog').close();
        toast(`${data.get('username')} teleportálva: ${response.destination.label}.`);
        await refresh();
    } catch (error) { toast(error.message, true); }
});

$('#offline-editor-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), username = data.get('username');
    const skills = [...$('#offline-skill-rows').querySelectorAll('.offline-skill-row')].map(row => ({
        name: row.dataset.skill,
        experience: Number(row.querySelector('[data-field="experience"]').value)
    }));
    const draft = {
        expectedSavedAt: data.get('expectedSavedAt'),
        coins: Number(data.get('coins')),
        skills,
        inventory: collectEditableItems('offline-inventory-rows'),
        bank: collectEditableItems('offline-bank-rows')
    };
    try {
        const response = await api(`/api/admin/bots/${encodeURIComponent(username)}/offline-save`, {
            method: 'POST', mutation: true,
            body: JSON.stringify({ draft, reason: data.get('reason') })
        });
        form.closest('dialog').close(); state.offlineEditing = null;
        toast(`${username} offline mentése frissült; backup: ${response.result.backupId.slice(0, 19)}…`);
        await refresh();
    } catch (error) { toast(error.message, true); }
});

$('#offline-skill-rows').addEventListener('input', event => {
    const row = event.target.closest('.offline-skill-row');
    if (!row) return;
    const level = row.querySelector('[data-field="level"]');
    const experience = row.querySelector('[data-field="experience"]');
    if (event.target === level) experience.value = xpForLevel(Math.max(1, Math.min(99, Number(level.value))));
    if (event.target === experience) level.value = levelForXp(Math.max(0, Number(experience.value)));
});

for (const selector of ['#search-filter', '#status-filter', '#skill-filter', '#coins-filter']) {
    $(selector).addEventListener('input', renderTable);
}
for (const selector of ['#event-bot-filter', '#event-kind-filter']) $(selector).addEventListener('input', renderEconomyEvents);
$('thead').addEventListener('click', event => {
    const key = event.target.closest('[data-sort]')?.dataset.sort;
    if (!key) return;
    if (state.sort.key === key) state.sort.direction *= -1;
    else state.sort = { key, direction: 1 };
    renderTable();
});
$('#clear-filters').addEventListener('click', () => { for (const id of ['search-filter', 'status-filter', 'skill-filter', 'coins-filter']) $(`#${id}`).value = ''; renderTable(); });
$('#clear-event-filters').addEventListener('click', () => { $('#event-bot-filter').value = ''; $('#event-kind-filter').value = ''; renderEconomyEvents(); });
$('#new-bot-button').addEventListener('click', () => showSpawn());
$('#world-admin-button').addEventListener('click', () => openWorldAdmin().catch(error => toast(error.message, true)));
$('#create-world-mod-backup').addEventListener('click', () => {
    $('#world-mod-backup-form').reset();
    $('#world-mod-backup-dialog').showModal();
});
$('#world-map-button').addEventListener('click', openWorldMap);
$('#snapshot-button').addEventListener('click', () => { $('#snapshot-form').reset(); $('#snapshot-dialog').showModal(); });
$('#skill-select').addEventListener('change', renderSkillParameters);
$('#teleport-destination').addEventListener('change', updateTeleportDescription);
$('#offline-editor-dialog').addEventListener('close', () => { state.offlineEditing = null; });
$('#close-profile').addEventListener('click', closeProfile); $('#drawer-backdrop').addEventListener('click', closeProfile);
$('#close-spectate').addEventListener('click', closeSpectate);
$('#close-world-map').addEventListener('click', closeWorldMap);
$('#close-world-admin').addEventListener('click', () => $('#world-admin-dialog').close());
$('#restart-engine-button').addEventListener('click', () => {
    const form = $('#engine-restart-form');
    form.reset();
    $('#engine-restart-dialog').showModal();
});
$('#hot-reload-mods-button').addEventListener('click', () => {
    $('#hot-reload-form').reset();
    $('#hot-reload-dialog').showModal();
});
$('#hot-reload-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = new FormData(form).get('reason')?.toString().trim();
    if (!reason) return;
    const button = $('#confirm-hot-reload');
    button.disabled = true;
    try {
        const response = await api('/api/admin/world-mods/reload', { method: 'POST', mutation: true, body: JSON.stringify({ reason }) });
        await refreshWorldAdminData();
        form.closest('dialog').close();
        const result = response.result;
        const blocked = result.pendingRestartIds.length + result.migrationRequiredIds.length + result.rollbackRequiredIds.length;
        toast(`${result.appliedIds.length} mod hot reloadja kész${blocked ? `; ${blocked} mod más lifecycle-lépést igényel` : ''}.`);
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
});
$('#engine-restart-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = new FormData(form).get('reason')?.toString().trim();
    if (!reason) return;
    const button = $('#confirm-engine-restart');
    button.disabled = true;
    button.textContent = 'Engine újraindítása…';
    try {
        const response = await api('/api/admin/engine/restart', {
            method: 'POST', mutation: true, body: JSON.stringify({ reason })
        });
        state.worldMods = await api('/api/admin/world-mods');
        renderWorldMods();
        form.closest('dialog').close();
        toast(`Az engine újraindult (PID ${response.result.pid}).`);
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = 'Engine újraindítása';
    }
});
$('#world-mod-backup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = new FormData(form).get('reason')?.toString().trim();
    if (!reason) return;
    try {
        await api('/api/admin/world-mods/backups', { method: 'POST', mutation: true, body: JSON.stringify({ reason }) });
        await refreshWorldAdminData();
        form.closest('dialog').close();
        toast('A world mod konfiguráció backupja elkészült.');
    } catch (error) { toast(error.message, true); }
});
$('#world-mod-restore-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const backupId = values.get('backupId')?.toString();
    const reason = values.get('reason')?.toString().trim();
    if (!backupId || !reason) return;
    const button = $('#confirm-world-mod-restore');
    button.disabled = true;
    try {
        const response = await api(`/api/admin/world-mods/backups/${encodeURIComponent(backupId)}/restore`, {
            method: 'POST', mutation: true,
            body: JSON.stringify({ expectedRevision: state.worldMods.revision, reason })
        });
        await refreshWorldAdminData();
        form.closest('dialog').close();
        toast(response.activationError ? `A konfiguráció visszaállt, de az aktiválás sikertelen: ${response.activationError}` : 'A konfiguráció visszaállt; a hot-reload kompatibilis modok aktiválódtak.');
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
});
$('#world-map-dialog').addEventListener('cancel', event => { event.preventDefault(); closeWorldMap(); });
window.addEventListener('message', event => {
    if (!state.config?.worldMapUrl || event.origin !== new URL(state.config.worldMapUrl, location.href).origin) return;
    if (event.data?.type === 'rs-map-ready' && state.worldMapSelected) focusWorldBot(state.worldMapSelected);
});
$('#spectate-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSpectate(); });
document.querySelectorAll('.dialog-close:not(#close-spectate):not(#close-world-map):not(#close-world-admin)').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

const bootstrap = await Promise.all([
    api('/api/admin/config'), api('/api/admin/skills'), api('/api/admin/teleport-destinations')
]);
state.config = bootstrap[0]; state.skills = bootstrap[1].skills; state.teleportDestinations = bootstrap[2].destinations;
selectAdminTab('bots');
await refresh();
setInterval(refresh, state.config.refreshMs || 5000);
