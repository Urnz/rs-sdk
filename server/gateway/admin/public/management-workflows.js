import { element, workflowCard, mountReportWorkflows, splitNames, scopeQuery } from './workflow-reports.js';

const encoded = value => encodeURIComponent(value);
const payload = (data, operationSummary) => ({ mutation: true, body: JSON.stringify(data), reviewContext: { operationSummary } });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reason = card => card.field('reason', 'Indoklás', { hint: 'Legalább 8 karakter: miért szükséges ez a művelet?', pattern: '.{8,1000}' });
const choices = [];
function chooser(card, name, label, kind) {
    const select = card.field(name, label, { choices: [['', 'Előbb töltsd be a választható adatokat…']] });
    choices.push({ card, select, kind }); return select;
}
export function mountManagementWorkflows(api) {
    const gateway = api;
    api = (path, options = {}) => gateway(path, { ...options, headers: { ...options.headers, 'X-Admin-Request': 'rs-sdk-admin' } });
    mountReportWorkflows(api, { owner: true });
    const root = id => document.querySelector('#' + id);
    const agents = root('agent-reports'), experiments = root('experiment-reports'), society = root('population-workflows'), world = root('genesis-workflows');
    const catalog = workflowCard(root('management-options'), 'workflow-options', 'Választható résztvevők, hagyatékok és szabályok', 'A külön kezelési űrlapokhoz töltsd be az aktuális adatokat. Üres szabálylista esetén nincs engedélyezett átadás; a szerver tulajdonosának ellenőrzött helyi szabályzatra van szüksége. A betöltés nem módosítja a világot.');
    catalog.button('Választható adatok frissítése', async () => {
        for (const choice of choices) choice.card.invalidate();
        const [options, data] = await Promise.all([api('/api/admin/workflow-options'), api('/api/admin/agents')]);
        for (const { select, kind } of choices) {
            const rows = kind === 'agents' ? data.agents.map(agent => [agent.identity.agentId, `${agent.identity.displayName} (${agent.identity.agentId})`])
                : kind === 'estates' ? options.estates.map(estate => [estate.estateId, `${estate.username} · ${estate.status} · ${estate.estateId}`])
                    : kind === 'inheritance' ? options.inheritanceRules.map(rule => [rule.ruleId, `${rule.ruleId} · ${rule.factionId}`])
                        : options.memoryRules.map(rule => [rule.ruleId, `${rule.sourceAgentId} → ${rule.recipientAgentId} · ${rule.ruleId}`]);
            const old = select.value;
            select.replaceChildren(); const placeholder = element('option', rows.length ? 'Válassz…' : 'Nincs választható adat – lásd a magyarázatot fent.'); placeholder.value = ''; select.append(placeholder);
            for (const [value, label] of rows) { const option = element('option', label); option.value = value; select.append(option); }
            if (rows.some(([value]) => value === old)) select.value = old;
        }
        return { message: 'A választók frissültek a kezelési űrlapokon.', ...options,
            warnings: [...options.warnings, ...(!options.inheritanceRules.length ? ['Nincs engedélyezett öröklési szabály. Öröklés előnézete és végrehajtása csak beállított szabályzattal lehetséges.'] : []),
                ...(!options.memoryRules.length ? ['Nincs engedélyezett tudásátadási szabály. Automatikus emlék- vagy tudásmásolás nem történik.'] : [])] };
    });
    for (const area of [agents, experiments, society, world]) {
        const link = element('a', 'Résztvevők és engedélyezett szabályok betöltése'); link.href = '#workflow-options';
        link.addEventListener('click', event => { event.preventDefault(); catalog.card.open = true; catalog.card.scrollIntoView({ block: 'center' }); catalog.card.querySelector('summary').focus(); });
        area.prepend(link);
    }
    const timeline = workflowCard(agents, 'agent-timeline-report', 'Döntéshozó teljes idővonala', 'A kiválasztott döntéshozó felébredései, döntései, céljai, feladatai és bizonyítékai egy időrendben. Legfeljebb 200 legutóbbi bejegyzés.');
    chooser(timeline, 'agentId', 'Döntéshozó', 'agents');
    timeline.button('Idővonal lekérdezése', data => api(`/api/admin/agents/${encoded(data.agentId)}/timeline?limit=200`));
    const autonomy = workflowCard(agents, 'autonomy-control-report', 'Önálló működés vezérlőállapota', 'Csak olvasó ellenőrzés. A kapcsolót és a döntési szabályokat a fenti önálló működési beállításoknál módosíthatod.');
    autonomy.button('Vezérlőállapot ellenőrzése', () => api('/api/admin/autonomy-control'));
    const audit = workflowCard(root('admin-audit-reports'), 'admin-audit-report', 'Adminműveletek naplója', 'A legutóbbi 100 rögzített adminművelet: végrehajtó, indoklás, eredmény és hiba. A napló olvasása nem ismétli meg a műveleteket.');
    audit.button('Napló betöltése', () => api('/api/admin/audit?limit=100'));
    const roles = workflowCard(root('business-reports'), 'business-roles-report', 'Vállalkozási szerepkörök és feladatok', 'Nézd meg a szerver által támogatott szerepköröket, mielőtt alkalmazottat vagy megbízást rendelsz a vállalkozáshoz.');
    roles.button('Szerepkörök megnyitása', () => api('/api/admin/business-role-definitions'));
    const environment = workflowCard(experiments, 'experiment-environment-report', 'Kísérleti környezet ellenőrzése', 'Az aktív világszabályok és verziók állapota. A lekérdezés nem indít kísérletet.');
    environment.button('Környezet ellenőrzése', () => api('/api/admin/multi-agent-experiments/environment'));
    const snapshots = workflowCard(experiments, 'experiment-snapshots-report', 'Kísérleti pillanatképek visszakeresése', 'A legutóbbi adatfelvételek olvasása. Ezek mérési pillanatképek; a teljes szerver mentése a Saját szervereim oldalon érhető el.');
    snapshots.button('Pillanatképek betöltése', () => api('/api/admin/experiments?limit=100'));
    const preflight = workflowCard(experiments, 'experiment-preflight', 'Indítás előtti vizsgálat', 'A fenti kísérletűrlap résztvevőit, profilját és leírását ellenőrzi. Nem indít feladatot. Az indítást később a Kísérlet indítása gombbal kérheted.');
    preflight.button('A kísérletűrlap ellenőrzése indítás nélkül', () => {
        const form = root('multi-agent-experiment-form');
        if (!form.reportValidity()) throw new Error('Töltsd ki a fenti kísérletűrlapot.');
        const agentIds = [...form.querySelectorAll('[name="experimentAgentId"]:checked')].map(input => input.value);
        if (agentIds.length < 2) throw new Error('Válassz legalább két online játékos-döntéshozót a fenti űrlapon.');
        const [parameterProfileId, parameterProfileVersion] = form.elements.parameterProfile.value.split('@');
        return api('/api/admin/multi-agent-experiments/preflight', { method: 'POST', ...payload({ agentIds, parameterProfileId, parameterProfileVersion,
            label: form.elements.label.value, seed: form.elements.seed.value, summary: form.elements.summary.value, reason: form.elements.reason.value }) });
    });
    const long = workflowCard(society, 'long-experiment-report', 'Hosszú társadalmi kísérlet', 'Korábban futtatott hosszú kísérlet eredménye és két mérési ág összehasonlítása. A futásazonosítókat a kísérlet létrehozásakor kapott bizonylaton találod.');
    long.field('control', 'Első futás azonosítója', { hint: 'A hosszú kísérlet session azonosítója; nem a rövid kísérlet UUID-je.' });
    long.field('treatment', 'Második futás azonosítója', { required: false, hint: 'Csak összehasonlításhoz szükséges.' });
    long.field('axis', 'Összehasonlítási szempont', { choices: [['diminishing-xp', 'Ismételt tevékenység XP-hatása']] });
    long.button('Első futás riportja', data => api(`/api/admin/society/long-experiments/${encoded(data.control)}`));
    long.button('Két futás összehasonlítása', data => {
        if (!data.treatment || data.control === data.treatment) throw new Error('Adj meg két külön futásazonosítót.');
        return api(`/api/admin/society/long-experiment-comparison?${new URLSearchParams(data)}`);
    });
    const memory = workflowCard(society, 'memory-transfer-workflow', 'Archivált emlékek és engedélyezett tudásátadás', 'Az archívum megnyitása csak olvasás. Az előnézet megmutatja az átadható ismereteket és akadályokat; átadás csak pontos, előre engedélyezett szabállyal történhet.');
    chooser(memory, 'sourceAgentId', 'Forrás döntéshozó', 'agents'); chooser(memory, 'recipientAgentId', 'Fogadó döntéshozó', 'agents'); chooser(memory, 'ruleId', 'Engedélyező szabály', 'memory'); reason(memory);
    memory.button('Archívum megnyitása', () => {
        const id = memory.form.elements.sourceAgentId.value; if (!id) throw new Error('Válassz forrás döntéshozót.');
        return api(`/api/admin/population-memory/${encoded(id)}/archive`);
    }, { validate: false });
    memory.button('Tudásátadás előnézete', async data => ({ ...await api(`/api/admin/population-memory/${encoded(data.sourceAgentId)}/transfer-preview`, { method: 'POST', ...payload(data) }), transferId: crypto.randomUUID() }), { preview: true, accept: value => digest(value.digest) && Array.isArray(value.knowledgeIds) });
    memory.button('Ellenőrzött tudás átadása', (data, preview) => api(`/api/admin/population-memory/${encoded(data.sourceAgentId)}/transfer`, { method: 'POST',
        ...payload({ ...data, transferId: preview.transferId, previewDigest: preview.digest }, `${data.sourceAgentId} → ${data.recipientAgentId}; ${preview.knowledgeIds.length} ismeret; szabály: ${data.ruleId}; előnézet: ${preview.digest}`) }), { apply: true });
    const inheritance = workflowCard(society, 'inheritance-workflow', 'Hagyaték ellenőrzése és öröklés', 'Csak a hagyatéki szabályzat szerinti személyes ingatlanok adhatók át. A kedvezményezettet, a pontos vagyont és az állapotverziót az előnézet rögzíti.');
    chooser(inheritance, 'estateId', 'Hagyaték', 'estates'); chooser(inheritance, 'heirAgentId', 'Örökös döntéshozó', 'agents'); chooser(inheritance, 'ruleId', 'Öröklési szabály', 'inheritance'); reason(inheritance);
    inheritance.button('Öröklés előnézete', async data => ({ ...await api(`/api/admin/population-estates/${encoded(data.estateId)}/inheritance-preview`, { method: 'POST', ...payload(data) }), decisionId: crypto.randomUUID() }), { preview: true, accept: value => digest(value.digest) && Number.isSafeInteger(value.revision) && Array.isArray(value.assets) });
    inheritance.button('Ellenőrzött vagyon átadása', (data, preview) => api(`/api/admin/population-estates/${encoded(data.estateId)}/inheritance`, { method: 'POST',
        ...payload({ ...data, decisionId: preview.decisionId, expectedRevision: preview.revision, previewDigest: preview.digest }, `${data.estateId} → ${data.heirAgentId}; ingatlanok: ${preview.assets.map(asset => asset.propertyId).join(', ')}; verzió: ${preview.revision}; lenyomat: ${preview.digest}`) }), { apply: true });
    const entry = workflowCard(society, 'population-entry-workflow', 'Népesség utánpótlása', 'Új népességtagok terve egy már élő, világkezdethez tartozó döntéshozó alapján. Az alkalmazás nem lépteti be automatikusan az új karaktereket.');
    chooser(entry, 'anchorAgentId', 'Kiinduló döntéshozó', 'agents');
    entry.field('batchId', 'Utánpótlási csomag neve', { pattern: '[a-z0-9][a-z0-9.-]{0,63}', hint: 'Egyedi név kisbetűkkel és kötőjellel, például elso-erkezok. Ugyanazt a nevet ne használd másik tervhez.' });
    entry.field('seed', 'Ismételhető kiindulóérték', { maxLength: 128 }); entry.field('count', 'Új résztvevők száma', { type: 'number', min: 1, max: 10000, value: 1 }); reason(entry);
    const entryRequest = data => ({ batchId: data.batchId, seed: data.seed, count: Number(data.count), anchorAgentId: data.anchorAgentId });
    entry.button('Új résztvevők előnézete', data => api('/api/admin/population-entry/preview', { method: 'POST', ...payload({ request: entryRequest(data), reason: data.reason }) }), { preview: true, accept: value => digest(value.result?.digest) && Array.isArray(value.result?.entrants) });
    entry.button('Előnézeti résztvevők létrehozása', (data, preview) => api('/api/admin/population-entry/apply', { method: 'POST',
        ...payload({ request: entryRequest(data), reason: data.reason, expectedPlanDigest: preview.result.digest }, `${data.count} új résztvevő; csomag: ${data.batchId}; kiinduló döntéshozó: ${data.anchorAgentId}; terv: ${preview.result.digest}`) }), { apply: true });
    const xp = workflowCard(experiments, 'xp-baseline-workflow', 'XP-ismétlési alapállapot', 'Az ismétlési előzmények nullázása kontrollált kísérlethez, illetve korábbi nullázás visszaállítása. Ez nem a karakter megszerzett összes XP-jének törlése. Először olvasd be az aktuális állapotot.');
    xp.field('cohort', 'Résztvevő karakternevek', { hint: 'Kisbetűs karakternevek, vesszővel elválasztva; legfeljebb 50.' });
    xp.field('kind', 'Kért változás', { choices: [['reset', 'Ismétlési állapot nullázása'], ['restore', 'Korábbi nullázás visszaállítása']] });
    xp.field('sourceCommandId', 'Korábbi nullázás műveletazonosítója', { required: false, hint: 'Visszaállításhoz a korábbi nullázás bizonylatán szereplő commandId szükséges.' }); reason(xp);
    xp.button('Aktuális XP-alapállapot olvasása', async data => ({ ...await api(`/api/admin/society/xp-baseline?${new URLSearchParams(splitNames(data.cohort).map(player => ['player', player]))}`), commandId: crypto.randomUUID() }), { preview: true, accept: value => digest(value.storeDigest) && Array.isArray(value.cohort) });
    xp.button('Kiválasztott XP-művelet jóváhagyása', (data, preview) => {
        if (data.kind === 'restore' && !/^[a-f0-9-]{36}$/.test(data.sourceCommandId)) throw new Error('A visszaállításhoz add meg a korábbi nullázás műveletazonosítóját, majd olvasd újra az állapotot.');
        return api('/api/admin/society/xp-baseline', { method: 'POST', ...payload({ kind: data.kind, cohort: splitNames(data.cohort), commandId: preview.commandId,
            expectedStoreDigest: preview.storeDigest, sourceCommandId: data.kind === 'restore' ? data.sourceCommandId : null, reason: data.reason }, `${data.kind === 'reset' ? 'Ismétlési állapot nullázása' : 'Korábbi nullázás visszaállítása'}; karakterek: ${data.cohort}; korábbi művelet: ${data.sourceCommandId || 'nincs'}; állapot: ${preview.storeDigest}; kérés: ${preview.commandId}`) });
    }, { apply: true });
    const execution = workflowCard(experiments, 'xp-execution-workflow', 'XP-végrehajtási bizonyíték', 'Olvasd el a kísérlet natív XP-bizonyítékát. A lezárás helyreállítási lépés: lezárja a bizonyítékgyűjtést; nem pótolja a hiányzó mérést és nem indít új feladatot.');
    execution.field('experimentId', 'Kísérlet azonosítója', { pattern: '[a-fA-F0-9-]{36}', hint: 'A rövid kísérlet futási kártyáján megjelenő UUID.' }); reason(execution);
    execution.button('Bizonyíték olvasása', data => api(`/api/admin/society/xp-execution/${encoded(data.experimentId)}`), { preview: true });
    execution.button('Bizonyítékgyűjtés lezárása', data => api(`/api/admin/society/xp-execution/${encoded(data.experimentId)}`, { method: 'POST', ...payload({ action: 'seal', reason: data.reason }, `XP-bizonyíték lezárása: ${data.experimentId}`) }), { apply: true });
    const genesis = workflowCard(world, 'genesis-start-workflow', 'Előkészített világterv ellenőrzése és alkalmazása', 'Válassz egy korábban előállított WorldGenesisResult JSON-fájlt. A tervet a szerver ellenőrzi; csak sikeres előnézet után alkalmazható. A visszaállítás a tárolt mentőanyagot használja.');
    genesis.field('resultFile', 'Előkészített világterv fájlja', { type: 'file', accept: '.json,application/json', hint: 'A világkezdet-generátor eredményfájlja, nem konfiguráció és nem szervermentés. Legfeljebb 2 MB.' }); reason(genesis);
    genesis.button('Világterv előnézete', async data => {
        if (!data.resultFile.size || data.resultFile.size > 2 * 1024 * 1024) throw new Error('Válassz legfeljebb 2 MB-os világtervet.');
        let result; try { result = JSON.parse(await data.resultFile.text()); } catch { throw new Error('A kiválasztott fájl nem érvényes JSON.'); }
        return api('/api/admin/world-genesis/preview', { method: 'POST', ...payload({ result, reason: data.reason }) });
    }, { preview: true, accept: value => value.preview?.ok === true && digest(value.confirmationDigest) && value.result?.resultDigest === value.confirmationDigest });
    genesis.button('Ellenőrzött világterv alkalmazása', (data, preview) => api('/api/admin/world-genesis/start', { method: 'POST',
        ...payload({ result: preview.result, confirmationDigest: preview.confirmationDigest, reason: data.reason }, `Világterv: ${preview.result.resultId}; profil: ${preview.result.profile.profileId}; seed: ${preview.result.seed}; ellenőrzött terv: ${preview.confirmationDigest}`) }), { apply: true });
    let runs = [];
    const history = workflowCard(world, 'genesis-history-workflow', 'Világkezdeti profilok és korábbi alkalmazások', 'A profilok a lehetséges kiinduló világokat írják le. A futáslista megmutatja a korábbi alkalmazásokat és visszaállításokat; betöltése kitölti az alábbi választót is.');
    history.button('Világprofilok olvasása', () => api('/api/admin/world-genesis/profiles'));
    history.button('Korábbi alkalmazások frissítése', async () => {
        reset.invalidate(); runs = [];
        const result = await api('/api/admin/world-genesis/runs?limit=50'); runs = result.runs;
        runSelect.replaceChildren(); const placeholder = element('option', runs.length ? 'Válassz korábbi alkalmazást…' : 'Még nincs korábbi alkalmazás.'); placeholder.value = ''; runSelect.append(placeholder);
        for (const run of runs) { const option = element('option', `${run.resultId} · ${run.status} · ${run.revision}. verzió`); option.value = run.resultId; runSelect.append(option); }
        return result;
    });
    const reset = workflowCard(world, 'genesis-reset-workflow', 'Világkezdet visszaállítása', 'A tárolt mentőanyag alapján állít vissza. Először frissítsd a korábbi alkalmazások listáját, majd ellenőrizd a kiválasztott alkalmazás állapotát és verzióját.');
    const runSelect = reset.field('resultId', 'Korábbi alkalmazás', { choices: [['', 'Előbb frissítsd a korábbi alkalmazásokat…']] }); reason(reset);
    reset.button('Kijelölt alkalmazás ellenőrzése', data => {
        const run = runs.find(item => item.resultId === data.resultId); if (!run) throw new Error('Frissítsd az alkalmazások listáját.');
        if (!['applied', 'rollback-required'].includes(run.status)) throw new Error('Ez az alkalmazás jelenleg nem állítható vissza. Frissítsd a listát és ellenőrizd az állapotot.');
        return run;
    }, { preview: true, accept: value => digest(value.resultDigest) && Number.isSafeInteger(value.revision) });
    reset.button('Kijelölt világkezdet visszaállítása', (data, preview) => api(`/api/admin/world-genesis/${encoded(data.resultId)}/reset`, { method: 'POST',
        ...payload({ expectedRevision: preview.revision, confirmationDigest: preview.resultDigest, reason: data.reason }, `Visszaállítás: ${data.resultId}; állapot: ${preview.status}; verzió: ${preview.revision}; terv: ${preview.resultDigest}`) }), { apply: true });
    const trade = workflowCard(world, 'external-trade-workflow', 'Világkezdet utáni külső kereskedelem és tisztaság', 'A megfigyelés a meglévő helyi főkönyvből rögzít adatot. Nem indít kereskedést, és nem kapcsolódik hivatalos játékszolgáltatáshoz. A riport UTC szimulációs időablakot használ.');
    trade.field('resultId', 'Világkezdet azonosítója', { hint: 'A fenti korábbi alkalmazások listájából olvasható ki.' });
    trade.field('from', 'Időablak kezdete (UTC)', { required: false, hint: 'A kereskedelmi riporthoz szükséges.' });
    trade.field('to', 'Időablak vége (UTC)', { required: false, hint: 'A kereskedelmi riporthoz szükséges.' }); reason(trade);
    trade.button('Kereskedelmi riport', data => api(`/api/admin/world-genesis/${encoded(data.resultId)}/external-trade?${scopeQuery(data)}`));
    trade.button('Tisztasági riport', data => api(`/api/admin/world-genesis/${encoded(data.resultId)}/integrity`));
    trade.button('Meglévő kereskedelmi események megfigyelése', data => api(`/api/admin/world-genesis/${encoded(data.resultId)}/external-trade/observe`, { method: 'POST', ...payload({ reason: data.reason }, `Helyi megfigyelések rögzítése: ${data.resultId}`) }));
}
