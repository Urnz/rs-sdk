const labels = {
    status: 'Állapot', reason: 'Indoklás', error: 'Hiba', warnings: 'Figyelmeztetések', blockers: 'Végrehajtást akadályozó okok',
    entries: 'Bejegyzések', events: 'Események', summary: 'Összefoglaló', kind: 'Típus', action: 'Művelet', success: 'Sikeres',
    timestamp: 'Időpont', occurredAt: 'Esemény ideje', operator: 'Végrehajtó', before: 'Korábbi állapot', after: 'Új állapot',
    agentId: 'Döntéshozó', displayName: 'Név', username: 'Karakter', sourceAgentId: 'Forrás döntéshozó', recipientAgentId: 'Fogadó döntéshozó',
    heirAgentId: 'Örökös', heirUsername: 'Örökös karaktere', estateId: 'Hagyaték', ruleId: 'Engedélyező szabály',
    revision: 'Állapotverzió', assets: 'Érintett vagyon', propertyId: 'Ingatlan', knowledgeIds: 'Átadható tudás', facts: 'Átadott ismeretek',
    report: 'Riport', control: 'Vezérlőállapot', enabled: 'Engedélyezve', paused: 'Szünetel', agents: 'Döntéshozók',
    profiles: 'Választható világprofilok', runs: 'Korábbi futások', experiments: 'Pillanatképek', snapshots: 'Pillanatképek',
    label: 'Megnevezés', name: 'Név', description: 'Leírás', title: 'Megnevezés', message: 'Magyarázat', checks: 'Ellenőrzések',
    ok: 'Rendben', simulation: 'Csak előnézet', preview: 'Előzetes ellenőrzés', result: 'Eredmény', application: 'Alkalmazási bizonylat',
    output: 'Tervezett világ', population: 'Népesség', entrants: 'Új résztvevők', count: 'Darabszám', identity: 'Személyazonosság',
    plan: 'Terv', request: 'Kérés', entryId: 'Utánpótlás azonosítója', batchId: 'Csomagazonosító', seed: 'Ismételhető kiindulóérték',
    profile: 'Világprofil', profileId: 'Profil', resultId: 'Világterv azonosítója', resultDigest: 'Világterv ellenőrzőlenyomata',
    simulationClock: 'Szimulációs óra', clockId: 'Óraazonosító', simulationTime: 'Szimulációs idő', observedAt: 'Megfigyelve',
    from: 'Kezdet', to: 'Vég', fromSimulationTime: 'Szimulációs kezdet', toSimulationTime: 'Szimulációs vég', scope: 'Vizsgált kör',
    cohort: 'Résztvevő karakterek', actorAgentIds: 'Vizsgált döntéshozók', players: 'Karakterek', empty: 'Üres ismétlési állapot',
    snapshot: 'Pillanatkép', receipt: 'Bizonylat', requestKey: 'Kérésazonosító', commandId: 'Műveletazonosító', sourceCommandId: 'Korábbi nullázás azonosítója',
    policy: 'Szabályzat', version: 'Verzió', mode: 'Mód', bindings: 'Szabálykötések', enabledAt: 'Bekapcsolva',
    objectives: 'Értékelési szempontok', metrics: 'Mutatók', calculation: 'Számítás', sources: 'Adatforrások', limitations: 'Értelmezési korlátok',
    unavailableReasons: 'Hiányzó adatok okai', unit: 'Mértékegység', numerator: 'Számláló', denominator: 'Nevező', value: 'Érték',
    nodes: 'Szereplők és erőforrások', edges: 'Függőségek', risks: 'Kockázatok', scenarios: 'Forgatókönyvek', dependencies: 'Függőségek',
    coverage: 'Adatlefedettség', available: 'Elérhető', confidence: 'Bizonyosság', archive: 'Archivált emlékek', records: 'Rögzített adatok',
    episodes: 'Emlékek', semantic: 'Ismeretek', goals: 'Célok', createdAt: 'Létrehozva', updatedAt: 'Frissítve',
    startedAtAudit: 'Indítás ideje', completedAtAudit: 'Befejezés ideje', completedAt: 'Befejezve', added: 'Új megfigyelések száma',
    role: 'Szerepkör', roles: 'Szerepkörök', department: 'Terület', responsibilities: 'Feladatok', permissions: 'Jogosultságok',
    definitionDigest: 'Kísérleti definíció ellenőrzőlenyomata', environment: 'Kísérleti környezet', environmentDigest: 'Környezet ellenőrzőlenyomata',
    parameterProfileDigest: 'Paraméterprofil ellenőrzőlenyomata', xpInitialState: 'Kezdeti XP-ismétlési állapot',
    pausedAt: 'Szüneteltetés ideje', pausedBy: 'Szüneteltető', pauseReason: 'Szüneteltetés indoka',
    basisPoints: 'Érték (10 000 = 100%)', direction: 'Értékelési irány', capabilities: 'Támogatott összehasonlítások',
    axis: 'Összehasonlítási szempont', supported: 'Támogatott', controlSessionId: 'Kontrollfutás', treatmentSessionId: 'Kezelési futás',
    nodeId: 'Szereplő / erőforrás azonosítója', targetNodeId: 'Érintett szereplő', sourceNodeId: 'Forrás szereplő',
    topology: 'Függőségi hálózat', evidence: 'Alátámasztó bizonylatok', withdrawals: 'Kiesési forgatókönyvek',
    obligations: 'Kötelezettségek', amountGp: 'Összeg (gp)', balanceGp: 'Egyenleg (gp)', quantity: 'Mennyiség',
    itemId: 'Tárgyazonosító', itemName: 'Tárgy neve', businessId: 'Vállalkozás', factionId: 'Szervezet',
    experimentsSupported: 'Támogatott kísérletek', evidenceRunIds: 'Bizonyító futások', participantCount: 'Résztvevők száma',
    inheritanceRules: 'Engedélyezett öröklési szabályok', memoryRules: 'Engedélyezett tudásátadási szabályok', estates: 'Hagyatékok',
    transferId: 'Tudásátadás azonosítója', decisionId: 'Döntés azonosítója', activities: 'Tevékenységek', repetitionScore: 'Ismétlési pontszám',
    awards: 'XP-jóváírások száma', baseXp: 'Alap XP', grantedXp: 'Jóváírt XP'
};
const values = { unavailable: 'Nem áll rendelkezésre', available: 'Elérhető', observed: 'Megfigyelt adat', active: 'Aktív',
    completed: 'Befejezett', failed: 'Sikertelen', blocked: 'Blokkolt', pending: 'Várakozik', running: 'Folyamatban',
    applied: 'Alkalmazva', reset: 'Visszaállítva', 'rollback-required': 'Visszaállítást igényel', open: 'Nyitott',
    'custody-ready': 'Őrzésbe vétel kész', sealed: 'Lezárt', player: 'Játékos', institution: 'Intézmény',
    manager: 'Vezető', worker: 'Dolgozó', trader: 'Kereskedő', crafter: 'Kézműves', gatherer: 'Gyűjtő',
    maximize: 'A nagyobb érték kedvezőbb', minimize: 'A kisebb érték kedvezőbb', describe: 'Leíró mutató',
    inconclusive: 'Nincs elég bizonyíték', frontier: 'Újonnan benépesülő világ', 'blank-slate': 'Üres kiinduló világ',
    'seeded-economy': 'Előkészített gazdaság', 'mature-society': 'Kifejlett társadalom', 'historical-burn-in': 'Előzetes történeti futás',
    'diminishing-xp': 'Ismételt tevékenység XP-hatása', 'wake-up': 'Felébredés', decision: 'Döntés', evidence: 'Bizonyíték',
    'goal-update': 'Célváltozás', 'memory-update': 'Emlékváltozás', 'next-wake-up': 'Következő felébredés' };
export const element = (tag, text, className) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
};
export function reportValue(value, depth = 0, field = '') {
    if (value === null || value === undefined) return element('p', 'Nincs rögzített adat. Ez nem nulla érték.');
    if (typeof value !== 'object') return element('span', typeof value === 'boolean' ? value ? 'Igen' : 'Nem'
        : ['status', 'kind', 'role', 'direction', 'mode', 'profileId', 'axis'].includes(field) && Object.hasOwn(values, value) ? values[value] : String(value));
    if (depth > 9) { const details = element('details'); details.append(element('summary', 'További forrásrészletek'), element('pre', JSON.stringify(value, null, 2))); return details; }
    if (Array.isArray(value)) {
        if (!value.length) return element('p', 'Nincs bejegyzés a kiválasztott körben.');
        const list = element('ol'); let shown = 0;
        const more = element('button', 'További bejegyzések'); more.type = 'button';
        const append = () => {
            more.remove();
            for (const item of value.slice(shown, shown + 25)) { const row = element('li'); row.append(reportValue(item, depth + 1)); list.append(row); }
            shown += 25; if (shown < value.length) list.append(more);
        };
        more.addEventListener('click', append); append(); return list;
    }
    const list = element('dl'), technical = element('details'), metadata = element('dl');
    technical.append(element('summary', 'Ellenőrzőlenyomatok és forrásazonosítók'), metadata);
    for (const [key, item] of Object.entries(value)) {
        const target = /digest|hash|schemaVersion|rollbackToken/i.test(key) ? metadata : list;
        const entry = element('dd'); entry.append(reportValue(item, depth + 1, key));
        target.append(element('dt', Object.hasOwn(labels, key) ? labels[key] : key.replace(/([a-z])([A-Z])/g, '$1 $2')), entry);
    }
    const group = element('div'); group.append(list); if (metadata.children.length) group.append(technical); return group;
}
export function inputField(form, name, label, options = {}) {
    const wrapper = element('label', label), input = element(options.choices ? 'select' : options.type === 'textarea' ? 'textarea' : 'input');
    input.name = name; input.id = `${form.id.replace(/-form$/, '')}-${name}`;
    if (input.tagName === 'INPUT') input.type = options.type || 'text';
    if (options.choices) for (const [value, text] of options.choices) { const option = element('option', text); option.value = value; input.append(option); }
    input.required = options.required !== false; input.maxLength = options.maxLength || 1000;
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.value !== undefined) input.value = options.value;
    if (options.pattern) input.pattern = options.pattern;
    if (options.accept) input.accept = options.accept;
    wrapper.append(input);
    if (options.hint) {
        const hint = element('small', options.hint); hint.id = input.id + '-hint';
        input.setAttribute('aria-describedby', hint.id); wrapper.append(hint);
    }
    const fields = form.querySelector('fieldset'); fields.querySelector('legend').hidden = false; fields.insertBefore(wrapper, fields.querySelector('.management-actions')); return input;
}
export function workflowCard(root, id, title, explanation) {
    const card = element('details', undefined, 'management-workflow'); card.id = id;
    card.append(element('summary', title), element('p', explanation));
    const form = element('form'); form.id = id + '-form';
    const fields = element('fieldset'), legend = element('legend', 'Adatok megadása'); legend.hidden = true; fields.append(legend);
    const actions = element('div', undefined, 'management-actions');
    const status = element('p', 'Válassz műveletet. Az eredmény vagy a hiba itt marad a kártyán.'); status.setAttribute('role', 'status');
    const output = element('div', undefined, 'management-result'); output.setAttribute('aria-label', title + ' eredménye'); output.setAttribute('role', 'region'); output.tabIndex = 0;
    fields.append(actions); form.append(fields); card.append(form, status, output); root.append(card);
    let busy = false, sequence = 0, prepared;
    const invalidate = () => { sequence++; prepared = undefined; applyButtons.forEach(button => { button.disabled = true; }); output.replaceChildren(); status.textContent = 'Az adatok változtak. Kérj új lekérdezést vagy előnézetet.'; };
    const applyButtons = [];
    form.addEventListener('submit', event => event.preventDefault()); form.addEventListener('input', invalidate); form.addEventListener('change', invalidate);
    async function run(job, { preview = false, apply = false, validate = true, accept = () => true } = {}) {
        if (busy || validate && !form.reportValidity()) return;
        if (apply && !prepared) return;
        busy = true; const ticket = ++sequence;
        const chosen = prepared, data = Object.fromEntries(new FormData(form)); prepared = undefined; fields.disabled = true; applyButtons.forEach(button => { button.disabled = true; });
        status.classList.remove('danger-text'); status.textContent = 'Ellenőrzés és adatbetöltés folyamatban…'; output.replaceChildren(); output.setAttribute('aria-busy', 'true');
        try {
            const result = await job(data, chosen);
            if (ticket !== sequence) return;
            output.append(reportValue(result));
            const blockers = result?.blockers || result?.preview?.blockers || result?.result?.blockers || [];
            const ready = preview && result !== null && result !== undefined && result?.status !== 'unavailable' && !blockers.length && result?.preview?.ok !== false && accept(result);
            if (ready) { prepared = structuredClone(result); applyButtons.forEach(button => { button.disabled = false; }); }
            status.textContent = blockers.length || result?.preview?.ok === false ? 'Az ellenőrzés akadályt talált. Rendezd a felsorolt okokat, majd kérj új előnézetet.'
                : preview ? ready ? 'Az előnézet elkészült. Ellenőrizd az eredményt; a végrehajtás külön jóváhagyást kér.' : 'Nincs végrehajtható előnézet. Ellenőrizd az adatlefedettséget és a kiszolgáló válaszát; kérj új ellenőrzést.'
                    : 'A szerver válasza megérkezett. Az eredményt és az adatlefedettséget alább ellenőrizheted.';
        } catch (error) {
            if (ticket !== sequence) return;
            status.classList.add('danger-text'); status.textContent = `${error.message} Ellenőrizd a megadott adatokat és a szerver kapcsolatát. Módosítás előtt kérj friss előnézetet; a sikertelen visszajelzés miatt ne ismételd meg automatikusan a műveletet.`;
        } finally { busy = false; fields.disabled = false; output.setAttribute('aria-busy', 'false'); }
    }
    const button = (label, job, options = {}) => {
        const control = element('button', label, 'button secondary'); control.type = 'button';
        if (options.apply) { control.disabled = true; applyButtons.push(control); }
        control.addEventListener('click', () => { void run(job, options); }); actions.append(control); return control;
    };
    return { card, form, output, status, button, invalidate, field: (name, label, options) => inputField(form, name, label, options) };
}
export const splitNames = value => value.split(/[,\n]/).map(text => text.trim()).filter(Boolean);
export function timeScope(card, { actors = true, digest = true } = {}, api) {
    card.field('from', 'Időablak kezdete (UTC)', { hint: 'Szimulációs idő, például 2030-01-01T00:00:00.000Z.' });
    card.field('to', 'Időablak vége (UTC)', { hint: 'A kezdetnél későbbi szimulációs időpont.' });
    card.field('clockId', 'Szimulációs óra azonosítója', { hint: 'Az Óraadatok kitöltése gomb a szerverről olvassa be.' });
    if (digest) card.field('clockProfileDigest', 'Óraprofil ellenőrzőlenyomata', { pattern: '[a-f0-9]{64}', hint: 'Az Óraadatok kitöltése gomb automatikusan kitölti.' });
    if (actors) card.field('actors', 'Vizsgált döntéshozók', { hint: 'A döntéshozók azonosítói, vesszővel elválasztva. A Célok és önálló működés nézetben találod őket.' });
    const source = document.querySelector('#society-scope');
    if (source) card.button('Időablak és résztvevők átvétele a társadalmi riportból', () => {
        for (const name of ['from', 'to', 'clockId', 'clockProfileDigest', 'actors'])
            if (card.form.elements[name] && source.elements[name]) card.form.elements[name].value = source.elements[name].value;
        return { message: 'Az adatok átvéve. Most kérheted a külön riportot.' };
    }, { validate: false });
    card.button('Óraadatok kitöltése', async () => {
        const { clock } = await api('/api/admin/simulation-clock?limit=1');
        const to = clock?.lastSimulationTime || clock?.simulationTime;
        if (!clock?.clockId || !/^[a-f0-9]{64}$/.test(clock.profileDigest || '') || !Number.isFinite(Date.parse(to)))
            throw new Error('A szerver szimulációs órája még nem olvasható. Ellenőrizd a világ kapcsolatát; ne találj ki óraazonosítót vagy lenyomatot.');
        card.form.elements.clockId.value = clock.clockId;
        if (digest) card.form.elements.clockProfileDigest.value = clock.profileDigest;
        if (!card.form.elements.to.value) card.form.elements.to.value = to;
        if (!card.form.elements.from.value) card.form.elements.from.value = new Date(Date.parse(to) - 86400000).toISOString();
        return { message: 'Az óraadatok kitöltve. Az üres időablak az utolsó 24 szimulációs órát kapta; a meglévő időablak megmaradt. Ellenőrizd a résztvevőket, majd kérj riportot.' };
    }, { validate: false });
}
export function scopeQuery(data) {
    if (!Number.isFinite(Date.parse(data.from)) || !Number.isFinite(Date.parse(data.to)) || Date.parse(data.from) >= Date.parse(data.to))
        throw new Error('Adj meg érvényes UTC időablakot: a vég legyen későbbi a kezdetnél.');
    const query = new URLSearchParams({ from: data.from, to: data.to });
    if (data.clockId) query.set('clockId', data.clockId);
    if (data.clockProfileDigest) query.set('clockProfileDigest', data.clockProfileDigest);
    for (const actor of splitNames(data.actors || '')) query.append('actor', actor);
    return query;
}
export function mountReportWorkflows(api, { owner = false } = {}) {
    const economy = document.querySelector('#economy-reports');
    if (economy) {
        const card = workflowCard(economy, 'dependency-report', 'Gazdasági függőségek és kiesési kockázat', 'Válassz szimulációs időablakot. A függőségek és a kiesési kockázat két külön, csak olvasó riport. A hiányos adat nem jelent kockázatmentességet.');
        timeScope(card, { actors: false }, api);
        card.button('Függőségek lekérdezése', data => api(`/api/admin/economy/dependencies?${scopeQuery(data)}&basis=simulation`));
        card.button('Kiesési kockázat lekérdezése', data => api(`/api/admin/economy/dependency-risk?${scopeQuery(data)}&basis=simulation`));
    }
    const society = document.querySelector('#evaluation-reports');
    if (society) {
        const contract = workflowCard(society, 'evaluation-contract', 'Mit és hogyan mérünk?', 'A mérési szerződés elmagyarázza a mutatókat, a szükséges bizonyítékokat és a hiányzó adat jelentését.');
        contract.button('Mérési szerződés megnyitása', () => api('/api/admin/society/evaluation/contract'));
        const card = workflowCard(society, 'evaluation-report', 'Társadalmi értékelés és önfenntartás', 'Egy pontos időablak és résztvevői kör külön riportjai. Nincs összpontszám: az eredményeket az adatforrásokkal együtt értelmezd.');
        timeScope(card, {}, api);
        card.button('Társadalmi értékelés', data => api(`/api/admin/society/evaluation?${scopeQuery(data)}`));
        if (owner) card.button('Önfenntartás', data => api(`/api/admin/society/self-sufficiency?${scopeQuery(data)}`));
    }
}
