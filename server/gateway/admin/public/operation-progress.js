import { reviewMutation } from './operation-review.js';

const records = new Map(), active = new Map();
const labels = { review: 'Jóváhagyásra vár', sending: 'Beküldés folyamatban', running: 'Folyamatban',
    completed: 'Befejeződött', partial: 'Teendő maradt', failed: 'Sikertelen', unknown: 'Ellenőrzés szükséges',
    cancelled: 'Nem indult el' };
const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);
let reader, panel, list, summary, announcement, stopped = false;
const text = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };

function mount() {
    if (panel) return;
    panel = document.createElement('details'); panel.id = 'operation-progress'; panel.open = true;
    summary = text('summary', 'Műveletek');
    announcement = text('p', ''); announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
    const note = text('p', 'Az indítás és a háttérfutás külön állapot. A lista ezen az oldalon, nézetváltás után is megmarad.');
    list = document.createElement('ol'); list.setAttribute('aria-label', 'Műveletek állapota');
    panel.append(summary, announcement, note, list);
    const anchor = document.querySelector('.admin-content, .account-shell') || document.body;
    anchor.prepend(panel);
}
function update(record, state, message) {
    record.state = state; record.message = message; record.updatedAt = Date.now();
    if (record.inline?.isConnected) record.inline.textContent = `${record.title} · ${labels[state]}: ${message}`;
    if (terminal.has(state)) active.delete(record.key);
    if (panel && ['failed', 'unknown', 'partial', 'sending'].includes(state)) panel.open = true;
    render();
    const latest = `${record.title} · ${labels[state]}: ${message}`;
    if (announcement.textContent !== latest) announcement.textContent = latest;
    if (state === 'sending' && !document.querySelector('dialog[open]')) panel.scrollIntoView({ block: 'nearest' });
}
function render() {
    mount();
    const entries = [...records.values()].reverse();
    const ongoing = entries.filter(record => !terminal.has(record.state)).length;
    summary.textContent = `Műveletek · ${ongoing} folyamatban / ellenőrizendő · ${entries.length} bejegyzés`;
    list.replaceChildren(...entries.map(record => {
        const item = document.createElement('li'); item.dataset.state = record.state; item.dataset.operationId = record.id;
        item.append(text('strong', `${record.title} · ${labels[record.state]}`));
        item.append(text('small', `${record.scope} · ${new Date(record.startedAt).toLocaleTimeString('hu-HU')} óta · ellenőrizve: ${new Date(record.updatedAt).toLocaleTimeString('hu-HU')}`));
        item.append(text('p', record.message));
        if (record.reference) item.append(text('code', record.reference));
        if (record.href) { const link = text('a', 'Eredmény és részletek'); link.href = record.href; item.append(link); }
        if (record.check && !terminal.has(record.state)) {
            const button = text('button', 'Állapot ellenőrzése'); button.type = 'button'; button.disabled = record.checking;
            button.addEventListener('click', () => { void check(record); }); item.append(button);
        }
        if (terminal.has(record.state)) {
            const button = text('button', 'Elrejtés'); button.type = 'button';
            button.addEventListener('click', () => { records.delete(record.id); render(); }); item.append(button);
        }
        return item;
    }));
}
function create(key, title) {
    // Only completed entries are bounded. An unresolved operation must stay discoverable.
    const finished = [...records.values()].filter(record => terminal.has(record.state));
    for (const record of finished.slice(0, Math.max(0, finished.length - 19))) records.delete(record.id);
    const record = { id: crypto.randomUUID(), key, title, scope: document.querySelector('#server-context-name')?.textContent
        || new URL(location.href).searchParams.get('serverId') || 'Helyi felügyelet / saját fiók',
    startedAt: Date.now(), updatedAt: Date.now(), state: 'review', message: 'Az adatok ellenőrzése és jóváhagyása folyamatban. A művelet még nem indult el.' };
    const dialog = document.activeElement?.closest('dialog[open]');
    if (dialog) {
        dialog.querySelector('.operation-inline')?.remove();
        record.inline = text('p', record.message); record.inline.className = 'operation-inline'; record.inline.setAttribute('role', 'status');
        dialog.append(record.inline);
    }
    records.set(record.id, record); active.set(key, record); render(); return record;
}
export function setOperationReader(value) { reader = value; }

async function check(record) {
    if (stopped || record.checking || terminal.has(record.state)) return;
    clearTimeout(record.timer); record.checking = true; render();
    try {
        const result = await record.check();
        update(record, result.state, result.message);
    } catch (error) {
        update(record, 'unknown', `Az indítás visszaigazolt, de az állapot nem olvasható: ${error.message} Ellenőrizd a kapcsolatot, majd az Állapot ellenőrzése gombot használd. Ne indíts új futást emiatt.`);
    } finally {
        record.checking = false; render();
        if (!stopped && !terminal.has(record.state) && Date.now() - record.startedAt < 180000)
            record.timer = setTimeout(() => { void check(record); }, 2000);
        else if (!stopped && !terminal.has(record.state) && !record.message.includes('három perc után szünetel'))
            update(record, 'unknown', `${record.message} Az automatikus követés három perc után szünetel. Kérj új állapotellenőrzést; ez nem indít új műveletet.`);
    }
}
export function experimentState(run) {
    if (!run) throw new Error('A futás még nem található a szerveren.');
    const errors = (run.participants || []).filter(item => ['failed', 'blocked', 'rejected'].includes(item.status))
        .map(item => `${item.agentId}: ${item.reason || item.status}`).join('; ');
    if (run.status === 'running') return { state: 'running', message: run.dispatchEconomy
        ? 'A kísérlet elindult. A résztvevők feladatai futnak; az eredményt automatikusan ellenőrizzük.'
        : 'A kísérlet elindult. A résztvevők feladatainak kiosztása folyamatban.' };
    if (run.status === 'completed') return { state: 'completed', message: 'A kísérlet befejeződött. Az eredmények és a résztvevők részletei a Kísérletek nézetben olvashatók.' };
    if (['failed', 'completed-with-errors'].includes(run.status)) return { state: run.status === 'failed' ? 'failed' : 'partial',
        message: `${run.error || errors || 'Egy vagy több résztvevő nem fejezte be sikeresen a feladatát.'} Nyisd meg az agentenkénti eredményeket, ellenőrizd az online karaktereket, a célokat és az AI keretét. Csak az ok rendezése után indíts új kísérletet.` };
    throw new Error(`Ismeretlen kísérletállapot: ${run.status}`);
}
function follow(record, path, data, status) {
    if (data.experiment?.experimentId) {
        record.reference = data.experiment.experimentId; record.href = '#experiments';
        record.check = async () => experimentState((await reader(`/api/admin/multi-agent-experiments/${encodeURIComponent(record.reference)}`)).experiment);
        const result = experimentState(data.experiment); update(record, result.state, result.message);
    } else if (data.operation?.id) {
        record.reference = data.operation.id;
        record.check = async () => {
            const { operation } = await reader(`/api/control-plane/servers/operations/${encodeURIComponent(record.reference)}`);
            if (!operation) throw new Error('A szerverművelet nem található.');
            if (!['running', 'succeeded', 'failed'].includes(operation.state)) throw new Error('A szerverművelet állapota nem értelmezhető.');
            return { state: operation.state === 'succeeded' ? 'completed' : operation.state === 'failed' ? 'failed' : 'running',
                message: operation.state === 'succeeded' ? 'A szerverművelet befejeződött. Frissítsd a szerverlistát.'
                    : operation.state === 'failed' ? `${operation.error || 'A szerverművelet sikertelen.'} Ellenőrizd a szerverkártyát és a mentéseket, mielőtt újrapróbálod.` : 'A szerverművelet fut; az állapotot automatikusan ellenőrizzük.' };
        };
        update(record, 'running', 'A szerver elfogadta az indítást. Az eredményre várunk…');
    } else if (data.process?.runId || data.record?.outcome?.runId) {
        record.reference = data.process?.runId || data.record.outcome.runId;
        record.check = async () => {
            const { runs } = await reader('/api/admin/skill-runs?limit=1000');
            const run = runs.find(item => item.runId === record.reference);
            if (!run) return { state: 'running', message: 'A feladat elindult; még nincs lezárt futási jelentés. A Képességek és próbák nézetben követheted.' };
            return { state: run.status === 'completed' ? 'completed' : 'failed', message: `${run.message || run.reason || run.status} ${run.status === 'completed' ? 'A futási jelentés elkészült.' : 'Nyisd meg a futás részleteit, és rendezd a jelzett okot az újrapróbálás előtt.'}` };
        };
        update(record, 'running', 'A feladat indítása visszaigazolt; várunk a lezárt futási jelentésre.');
    } else if (data.activationError || data.episodeError || data.settlementError) {
        update(record, 'partial', `A módosítás megtörtént, de további teendő maradt: ${data.activationError || data.episodeError || data.settlementError} Ellenőrizd az eredmény részleteit; a teljes módosítást ne küldd be újra.`);
    } else if (data.record?.outcome && status === 202) {
        update(record, data.record.outcome.status === 'approval-required' ? 'partial' : 'completed',
            `A döntési ciklus lezárult: ${data.record.outcome.reason || data.record.outcome.status}. Ellenőrizd a döntési naplót és az esetleges jóváhagyásra váró javaslatot.`);
    } else if (status === 202) {
        const match = path.match(/^\/api\/admin\/bots\/([^/]+)\/(despawn|restart|stop-skill)$/);
        const input = record.input;
        const username = path === '/api/admin/bots/spawn' ? input.username : match ? decodeURIComponent(match[1]) : null;
        if (username) {
            record.reference = username;
            const expected = data.process || data.result?.process || data.result;
            record.check = async () => {
                const bot = await reader(`/api/admin/bots/${encodeURIComponent(username)}`);
                const starting = path === '/api/admin/bots/spawn' || match?.[2] === 'restart';
                const exact = !expected?.startedAt || bot.process?.startedAt === expected.startedAt
                    && bot.process?.status === 'running' && Number.isFinite(bot.stateAgeMs)
                    && Date.now() - bot.stateAgeMs >= new Date(expected.startedAt).getTime();
                const done = match?.[2] === 'despawn' ? bot.status === 'offline' : match?.[2] === 'stop-skill' ? !bot.currentSkill : bot.status === 'active' && exact;
                const failed = bot.status === 'error' || starting && ['exited', 'error'].includes(bot.process?.status);
                return { state: done ? 'completed' : failed ? 'failed' : 'running',
                    message: done ? 'A karakter kért állapota visszaolvasva.' : bot.lastError
                        ? `${bot.lastError} Ellenőrizd a karakter részleteit és a helyi szerver kapcsolatát.` : failed
                            ? 'A karakter folyamata leállt. Ellenőrizd a karakter naplóját és a helyi szerver kapcsolatát az újrapróbálás előtt.'
                            : 'Az indítás visszaigazolt; a karakter kért folyamatának friss állapotára várunk.' };
            };
            update(record, 'running', 'Az indítás visszaigazolt; a karakter állapotát ellenőrizzük.');
        } else update(record, 'unknown', 'A szerver elfogadta a kérést (HTTP 202). A háttérmunka lezárását ez a válasz még nem igazolja. Nyisd meg az eredmény részleteit, és frissítsd a megfelelő listát az újrapróbálás előtt.');
    } else {
        update(record, data.restartRequired ? 'partial' : 'completed', data.restartRequired
            ? 'A beállítás elmentve. Az aktiváláshoz indítsd újra a helyi játékszervert a Saját szervereim oldalon.'
                : 'A szerver visszaigazolta a művelet befejezését. Az eredmény részleteit a kapcsolódó nézetben találod.');
    }
    delete record.input;
    if (record.check && reader && !terminal.has(record.state)) { render(); record.timer = setTimeout(() => { void check(record); }, 300); }
}

/** One reviewed request. No automatic mutation retry; status checks are read-only. */
export async function runOperation(path, options, send) {
    const method = (options.method || 'GET').toUpperCase();
    if (['GET', 'HEAD'].includes(method) || /\/api\/control-plane\/(login|logout)$/.test(path)) return (await send(AbortSignal.timeout(30000), () => {})).data;
    const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([method, path, options.body])));
    const key = [...new Uint8Array(fingerprint)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (active.has(key)) throw new Error('Ez a művelet már folyamatban van vagy ellenőrzésre vár. Keresd meg a Műveletek listában; ne küldd be újra.');
    const record = create(key, 'Művelet előkészítése');
    let sent = false;
    try {
        const capability = await reviewMutation(path, method, options.body, options.reviewContext);
        record.title = capability?.title || 'Fiókművelet';
        record.scope = capability?.scope || record.scope;
        if (capability?.entry?.page?.startsWith('index.html#')) record.href = capability.entry.page.slice('index.html'.length);
        const { data, status } = await send(AbortSignal.timeout(30000), () => { sent = true; update(record, 'sending', 'A kérés elküldve. Várunk a szerver visszaigazolására; ne indítsd újra.'); });
        const input = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        record.input = { username: input?.username };
        follow(record, path, data, status); return data;
    } catch (error) {
        const cancelled = error.code === 'REVIEW_CANCELLED', notSent = !sent || error.code === 'REVIEW_NOT_SENT';
        update(record, cancelled ? 'cancelled' : notSent || error.rejected ? 'failed' : 'unknown', cancelled ? 'Megszakítottad a jóváhagyást. A művelet nem indult el; az űrlapon folytathatod.'
            : `${error.name === 'TimeoutError' ? 'A szerver válaszára várva lejárt az időkorlát.' : error.message} ${notSent ? 'A művelet nem indult el. Ellenőrizd a kapcsolatot és a megadott adatokat, majd próbáld újra.'
                : error.rejected ? 'Ellenőrizd a megadott adatokat, a jogosultságot és az előfeltételeket. Az újrapróbálás előtt nézd meg az eredménylistát.'
                    : 'A kérés kimenetele nem igazolt. Ellenőrizd a kapcsolatot és az eredménylistát; ne küldd be újra, amíg nem tisztázott, létrejött-e a művelet.'}`);
        throw error;
    }
}

export function observeExperiments(experiments) {
    for (const run of experiments) {
        let record = [...records.values()].find(item => item.reference === run.experimentId);
        if (!record && run.status === 'running') {
            record = create(`experiment:${run.experimentId}`, 'Kísérlet követése'); record.reference = run.experimentId; record.href = '#experiments';
            record.check = async () => experimentState((await reader(`/api/admin/multi-agent-experiments/${encodeURIComponent(run.experimentId)}`)).experiment);
            record.timer = setTimeout(() => { void check(record); }, 2000);
        }
        if (record && !(terminal.has(record.state) && run.status === 'running')) {
            const result = experimentState(run); update(record, result.state, result.message);
        }
    }
}
window.addEventListener('pagehide', () => { stopped = true; for (const record of records.values()) clearTimeout(record.timer); });
window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    stopped = false;
    for (const record of records.values()) if (record.check && !terminal.has(record.state)) void check(record);
});
