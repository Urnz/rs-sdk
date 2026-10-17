import { serverId } from './server-context.js';

const form = document.querySelector('#capability-filters');
const results = document.querySelector('#capability-results');
const status = document.querySelector('#capability-status');
const retry = document.querySelector('#capability-retry');
const labels = { available: 'Van felületi belépés', missing: 'Felületi kezelés hiányzik', infrastructure: 'Automatikus felületi háttérművelet' };
let matrix;
document.querySelector('#capability-back').href = `/admin/index.html?serverId=${encodeURIComponent(serverId)}`;
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hu-HU');
function node(tag, text, className) {
    const element = document.createElement(tag); element.textContent = text;
    if (className) element.className = className;
    return element;
}
function render() {
    const query = fold(form.elements.search.value.trim());
    const selected = matrix.capabilities.filter(item => (!form.elements.area.value || item.area === form.elements.area.value)
        && (!form.elements.coverage.value || item.coverage === form.elements.coverage.value)
        && fold([item.title, item.area, item.prerequisites, item.access, item.route].join(' ')).includes(query));
    const fragment = document.createDocumentFragment();
    for (const item of selected) {
        const card = node('article', '', 'capability-card'); card.dataset.coverage = item.coverage;
        card.append(node('h2', item.title), node('p', `${item.area} · ${labels[item.coverage]}`, 'capability-location'));
        card.append(node('p', item.prerequisites));
        if (item.entry) {
            const link = node('a', `Megnyitás: ${item.entry.label}`);
            const url = new URL(item.entry.page, location.href);
            url.searchParams.set('serverId', serverId); link.href = url.pathname + url.search + url.hash;
            card.append(link);
        } else card.append(node('p', item.gap));
        const details = node('details', ''); details.append(node('summary', 'Jogosultság, állapot és eredmény'));
        const list = node('dl', '');
        for (const [label, value] of [['Szükséges hozzáférés', item.access], ['Állapot követése', item.state], ['Eredmény', item.result], ['Hiba esetén', item.error]])
            list.append(node('dt', label), node('dd', value));
        details.append(list); card.append(details);
        if (item.review?.mode === 'required') card.append(node('p', 'Végrehajtás előtt külön áttekintés mutatja a pontos változást, az ellenőrzött adatokat és a helyreállítás lehetőségét.'));
        const technical = node('details', ''); technical.append(node('summary', 'Technikai azonosító'));
        for (const operation of item.operations) technical.append(node('p', `${operation.method} ${operation.path}`));
        technical.append(node('code', item.id));
        card.append(technical); fragment.append(card);
    }
    if (!selected.length) fragment.append(node('p', 'Nincs találat. Próbálj másik kifejezést, vagy töröld a szűrőket.'));
    results.replaceChildren(fragment);
    const gaps = matrix.capabilities.filter(item => item.coverage === 'missing').length;
    status.textContent = `${selected.length} / ${matrix.capabilities.length} műveletcsoport · ${gaps} felületi hiány · jegyzék: ${matrix.version} · felülvizsgálva: ${matrix.reviewedAt}`;
}
async function load() {
    retry.hidden = true; status.dataset.error = 'false'; results.setAttribute('aria-busy', 'true');
    status.textContent = 'A műveletjegyzék betöltése…';
    try {
        const response = await fetch('capability-matrix.v1.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.schemaVersion !== 1 || !Array.isArray(data.capabilities)) throw new Error();
        matrix = data;
        const previous = form.elements.area.value;
        form.elements.area.replaceChildren(node('option', 'Minden terület')); form.elements.area.firstChild.value = '';
        for (const area of [...new Set(matrix.capabilities.map(item => item.area))].sort((a, b) => a.localeCompare(b, 'hu'))) {
            const option = node('option', area); option.value = area; form.elements.area.append(option);
        }
        form.elements.area.value = previous; render();
    } catch {
        results.replaceChildren(); status.dataset.error = 'true';
        status.textContent = 'A műveletjegyzék nem tölthető be. Ellenőrizd a kapcsolatot és a bejelentkezést, majd válaszd az Újrapróbálás gombot.';
        retry.hidden = false;
    } finally { results.setAttribute('aria-busy', 'false'); }
}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => { if (matrix && event.target === form.elements.search) render(); });
form.addEventListener('change', event => { if (matrix && event.target !== form.elements.search) render(); });
form.addEventListener('reset', () => queueMicrotask(() => { if (matrix) render(); }));
retry.addEventListener('click', load);
void load();
