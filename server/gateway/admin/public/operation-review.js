export const reviewCancelledMessage = 'A műveletet nem indítottuk el.';
export class OperationReviewCancelled extends Error {
    constructor() { super(reviewCancelledMessage); this.code = 'REVIEW_CANCELLED'; }
}
export const formatReviewParameters = value => JSON.stringify(value, (key, entry) => /password|secret|token|api.?key|credential/i.test(key) ? '[rejtett]' : entry);
let matrixPromise, pending = false;
async function matrix() {
    if (!matrixPromise) matrixPromise = fetch('/admin/capability-matrix.v1.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(async response => {
        if (!response.ok) throw new Error('A műveleti magyarázat nem tölthető be. Töltsd újra az oldalt; a kérés nem indult el.');
        const value = await response.json();
        if (value.schemaVersion !== 1 || value.reviewSchemaVersion !== 1) throw new Error('A műveleti útmutató verziója nem megfelelő. Töltsd újra az oldalt.');
        return value;
    }).catch(error => { matrixPromise = undefined; throw error; });
    return matrixPromise;
}
function matches(template, path) {
    const parts = template.split('/'), actual = path.split('/');
    return parts.length === actual.length && parts.every((value, index) => value.startsWith(':') || value === actual[index]);
}
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function section(parent, title, content) {
    const element = document.createElement('section'); element.append(text('h3', title), text('p', content)); parent.append(element);
}
function safeValue(value) { return String(value).slice(0, 240); }
const visibleFields = {
    username: 'Karakter', agentId: 'Döntéshozó', workerAgentId: 'Dolgozó', requesterAgentId: 'Megbízó',
    expectedRevision: 'Beküldött állapotverzió', expectedSavedAt: 'Megnyitott mentés időpontja', backupId: 'Kiválasztott mentés',
    runId: 'Teljesítést igazoló futás', transactionId: 'Egyeztetett tranzakció', approvalDigest: 'Jóváhagyási bizonyíték azonosítója',
    requestKey: 'Kérésazonosító', targetVersion: 'Célverzió', role: 'Új szerepkör', granted: 'Tulajdonosi döntés',
    resolution: 'Döntés', status: 'Új állapot', balanceGp: 'Új pénztáregyenleg (gp)', testBotUsername: 'Tesztkarakter',
    assigneeAgentId: 'Megbízott döntéshozó', rewardGp: 'Jutalom (gp)', parameterProfileId: 'Paraméterprofil', parameterProfileVersion: 'Profilverzió',
    avatarPlayerUsername: 'Kapcsolt karakter', subjectId: 'Intézményi kör azonosítója', resourceId: 'Érintett képességhozzáférés',
    validFrom: 'Érvényesség kezdete', validUntil: 'Érvényesség vége', goalId: 'Célazonosító', title: 'Cél / megbízás címe',
    dailyOperationalBudgetGp: 'Napi működési keret (gp)', dailyLlmBudgetMicros: 'Napi modellkeret (mikroegység)', maxDecisionsPerDay: 'Max. napi döntésszám',
    reason: 'Rögzítendő indoklás'
};

/** A final client-side review. Backend authorization and validation remain authoritative. */
export async function reviewMutation(path, method = 'GET', body, context = {}) {
    try { return await prepareReview(path, method, body, context); }
    catch (error) { if (!error.code) error.code = 'REVIEW_NOT_SENT'; throw error; }
}
async function prepareReview(path, method, body, context) {
    if (['GET', 'HEAD'].includes(method.toUpperCase())) return;
    const locationBefore = location.pathname + location.search;
    const target = new URL(path, location.href);
    // Login must work before authenticated guide assets can be read.
    if (method === 'POST' && ['/api/control-plane/login', '/api/control-plane/logout'].includes(target.pathname)) return;
    const catalogue = await matrix();
    const capability = catalogue.capabilities.find(item => item.operations.some(operation => operation.method === method.toUpperCase() && matches(operation.path, target.pathname)));
    if (!capability?.review) throw new Error('Ehhez a művelethez nincs ellenőrzött magyarázat. A kérés nem indult el.');
    const data = typeof body === 'string' ? JSON.parse(body) : body || {};
    const variant = target.pathname.split('/').at(-1);
    const key = capability.review.variantField === 'path' ? variant : capability.review.variantField === 'execute'
        ? data.execute === true ? 'execute' : 'preview' : data[capability.review.variantField];
    const policy = capability.review.variants?.[key] || capability.review;
    if (policy.mode === 'direct') return capability;
    if (policy.mode !== 'required' || ['changes', 'evidence', 'notChanged', 'recovery', 'retry'].some(field => !policy[field]))
        throw new Error('Ehhez a művelethez még nincs felületi jóváhagyás. A kérés nem indult el.');
    if (pending) throw new Error('Egy másik művelet jóváhagyásra vár. Előbb zárd le azt az ablakot.');
    pending = true;
    const returnFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.id = 'operation-review'; dialog.className = 'operation-review';
    dialog.setAttribute('aria-labelledby', 'operation-review-title'); dialog.setAttribute('aria-describedby', 'operation-review-intro');
    const shell = document.createElement('div'); shell.className = 'operation-review-body';
    const heading = text('h2', policy.title || capability.title); heading.id = 'operation-review-title';
    const topCancel = text('button', 'Mégse'); topCancel.type = 'button'; topCancel.dataset.reviewCancel = '';
    const header = document.createElement('div'); header.className = 'operation-review-header'; header.append(heading, topCancel);
    const intro = text('p', 'Ellenőrizd a változást, majd a lap alján hagyd jóvá. A Mégse gombbal visszatérhetsz az adatokhoz. A beküldött adatokat a szerver újra ellenőrzi.'); intro.id = 'operation-review-intro';
    shell.append(header, intro);
    const scope = document.createElement('dl');
    let server = document.querySelector('#server-context-name')?.textContent || new URL(location.href).searchParams.get('serverId');
    if (target.pathname.startsWith('/api/control-plane/accounts/')) server = 'Helyi alapértelmezett szerver (local-default)';
    if (target.pathname === '/api/control-plane/password' || target.pathname.startsWith('/api/control-plane/sessions/')) server = 'Saját adminfiók';
    if (target.pathname === '/api/control-plane/servers') server = 'Új helyi világ';
    if (target.pathname.startsWith('/api/control-plane/servers/')) {
        const id = target.pathname.split('/')[4];
        const card = [...document.querySelectorAll('[data-server-id]')].find(item => item.dataset.serverId === id);
        server = card?.querySelector('h2')?.textContent || id;
    }
    scope.append(text('dt', 'Érintett kör'), text('dd', server || 'Saját fiók / helyi felügyelet'));
    scope.append(text('dt', 'Művelet'), text('dd', capability.title));
    for (const [index, value] of target.pathname.split('/').entries()) {
        if (index > 3 && !capability.operations.some(operation => operation.path.split('/')[index] === value))
            scope.append(text('dt', 'Kijelölt azonosító'), text('dd', decodeURIComponent(value)));
    }
    const choices = { owner: 'Tulajdonos', operator: 'Üzemeltető', viewer: 'Néző', player: 'Játékos-döntéshozó', institution: 'Intézményi döntéshozó', manager: 'Vezető', worker: 'Dolgozó', 'commit-debited': 'Igazolt terhelés alapján tulajdonba adás',
        'release-unpaid': 'Ki nem fizetett foglalás felszabadítása', cancelled: 'Teljesítés előtti megszüntetés', defaulted: 'Meghiúsultként lezárás',
        active: 'Aktív', dormant: 'Szünetel', closed: 'Lezárt', accepted: 'Elfogadott', rejected: 'Elutasított', completed: 'Befejezett', blocked: 'Blokkolt', abandoned: 'Elvetett' };
    for (const [field, label] of Object.entries(visibleFields)) {
        if (field === 'role' && data.role === null) scope.append(text('dt', label), text('dd', 'Nincs hozzáférés; visszavonás'));
        else if (['string', 'number', 'boolean'].includes(typeof data[field])) {
            const value = field === 'granted' ? data[field] ? 'Megadás' : 'Visszavonás'
                : ['role', 'resolution', 'status'].includes(field) ? choices[data[field]] || data[field] : data[field];
            scope.append(text('dt', label), text('dd', safeValue(value)));
        }
    }
    if (data.draft?.expectedSavedAt) scope.append(text('dt', 'Megnyitott mentés időpontja'), text('dd', safeValue(data.draft.expectedSavedAt)));
    for (const [field, label] of [['skill', 'Képesség'], ['destinationId', 'Célpont'], ['seed', 'Seed'], ['cycleKey', 'Cikluskulcs'],
        ['name', 'Új világ neve'], ['version', 'Forrásverzió'], ['template', 'Világsablon'], ['wageGp', 'Díjazás (gp)']])
        if (['string', 'number'].includes(typeof data[field])) scope.append(text('dt', label), text('dd', safeValue(data[field])));
    if (Array.isArray(data.agentIds)) scope.append(text('dt', 'Résztvevők'), text('dd', data.agentIds.map(safeValue).join(', ')));
    if (data.config && capability.route === '/api/admin/llm-settings') {
        for (const [field, label] of [['provider', 'AI-szolgáltató'], ['model', 'Modell']]) scope.append(text('dt', label), text('dd', safeValue(data.config[field])));
        for (const [field, label] of [['enabled', 'AI engedélyezve'], ['automaticReplanning', 'Automatikus újratervezés']])
            if (typeof data.config[field] === 'boolean') scope.append(text('dt', label), text('dd', data.config[field] ? 'Igen' : 'Nem'));
        for (const [field, label] of [['autonomousExecution', 'Automatikus feladatvégrehajtás'], ['skillBuilder', 'Képességfejlesztés']])
            if (typeof data.config[field]?.enabled === 'boolean') scope.append(text('dt', label), text('dd', data.config[field].enabled ? 'Igen' : 'Nem'));
        for (const [value, label] of [[data.config.dailyBudget?.maxCostMicros, 'Napi modellköltség-keret (mikroegység)'],
            [data.config.limits?.maxCostMicros, 'Modellköltség-keret döntésenként'], [data.config.autonomousExecution?.maxOperations, 'Max. művelet feladatonként'],
            [data.config.autonomousExecution?.maxTimeoutMs, 'Max. feladatidő (ms)']])
            if (typeof value === 'number') scope.append(text('dt', label), text('dd', safeValue(value)));
    }
    if (data.config && capability.route === '/api/admin/world-director/config') {
        scope.append(text('dt', 'Automatikus ütemezés'), text('dd', data.config.enabled ? 'Bekapcsolva' : 'Kikapcsolva'));
        scope.append(text('dt', 'Időköz (perc)'), text('dd', safeValue(data.config.intervalMinutes)));
    }
    if (capability.route === '/api/admin/llm-settings' && (data.removeApiKey || data.apiKey)) scope.append(text('dt', 'Titokkezelés'), text('dd', data.removeApiKey ? 'Mentett API-kulcs törlése' : 'API-kulcs cseréje; az érték rejtve marad'));
    if (typeof data.rememberCredentials === 'boolean') scope.append(text('dt', 'Botjelszó megjegyzése'), text('dd', data.rememberCredentials ? 'Windows titoktárban' : 'Nincs új megjegyzés'));
    shell.append(scope);
    section(shell, 'Mi változik?', policy.changes);
    section(shell, 'Milyen adatok alapján?', policy.evidence);
    section(shell, 'Mi nem történik meg?', policy.notChanged);
    section(shell, 'Helyreállítás', policy.recovery);
    section(shell, 'Újrapróbálás hiba esetén', policy.retry);
    if (data.draft) {
        const details = document.createElement('details'); details.append(text('summary', 'Beküldendő mentésadatok'));
        details.append(text('p', `Pénz: ${safeValue(data.draft.coins)} gp`));
        for (const skill of data.draft.skills || []) details.append(text('p', `${safeValue(skill.name)}: ${safeValue(skill.experience)} XP`));
        for (const [field, label] of [['inventory', 'Hátizsák'], ['bank', 'Bank']]) {
            details.append(text('h3', label));
            if (!data.draft[field]?.length) details.append(text('p', 'Üres'));
            for (const item of data.draft[field] || []) details.append(text('p', `${safeValue(item.id)} × ${safeValue(item.count)}`));
        }
        shell.append(details);
    }
    if (context.operationSummary) section(shell, 'Kijelölt javaslat', context.operationSummary);
    if (context.configuration) {
        const details = document.createElement('details'); details.append(text('summary', 'Beküldendő szabályértékek'));
        for (const setting of context.configuration) details.append(text('p', `${safeValue(setting.label)}: ${safeValue(setting.value)}`));
        shell.append(details);
    }
    if (capability.route === '/api/admin/llm-settings') {
        const details = document.createElement('details'); details.append(text('summary', 'Engedélyezett automatikus képességek és kereteik'));
        const skills = data.config?.autonomousExecution?.allowedSkills || [];
        if (!skills.length) details.append(text('p', 'Nincs automatikus végrehajtásra engedélyezett képesség.'));
        for (const skill of skills) {
            details.append(text('h3', `${safeValue(skill.id)}@${safeValue(skill.version)}`));
            for (const [field, label] of [['risk', 'Műveleti kör'], ['maxQuantity', 'Max. mennyiség'], ['maxUnitPriceGp', 'Max. egységár (gp)'],
                ['maxGpPerRun', 'Max. kiadás futásonként (gp)'], ['maxGpPerDay', 'Max. napi kiadás (gp)']])
                if (skill[field] !== undefined) details.append(text('p', `${label}: ${safeValue(skill[field])}`));
            if (Array.isArray(skill.itemNames)) details.append(text('p', `Érintett tárgyak: ${skill.itemNames.map(safeValue).join(', ')}`));
            if (Array.isArray(skill.operations)) details.append(text('p', `Engedélyezett lépések: ${skill.operations.map(safeValue).join(', ')}`));
            for (const [name, bounds] of Object.entries(skill.parameters || {}))
                details.append(text('p', `${safeValue(name)}: ${formatReviewParameters(bounds)}`));
        }
        shell.append(details);
    }
    if (context.publicationSummary) section(shell, 'A publikálandó összeállítás bizonyítékai', context.publicationSummary);
    const actions = document.createElement('div'); actions.className = 'operation-review-actions';
    const cancel = text('button', 'Mégse'), approve = text('button', policy.approveLabel || 'Jóváhagyás és végrehajtás');
    cancel.type = approve.type = 'button'; cancel.dataset.reviewCancel = ''; approve.dataset.reviewApprove = '';
    actions.append(cancel, approve); shell.append(actions); dialog.append(shell); document.body.append(dialog);
    try {
        const approved = await new Promise(resolve => {
            let decision = false;
            cancel.addEventListener('click', () => dialog.close());
            topCancel.addEventListener('click', () => dialog.close());
            approve.addEventListener('click', () => { approve.disabled = true; decision = true; dialog.close(); });
            dialog.addEventListener('close', () => resolve(decision), { once: true });
            dialog.addEventListener('cancel', () => { decision = false; });
            dialog.showModal(); topCancel.focus();
        });
        if (!approved) throw new OperationReviewCancelled();
        if (location.pathname + location.search !== locationBefore) throw new Error('A szerver vagy oldal megváltozott. Töltsd újra; a kérés nem indult el.');
    } finally { dialog.remove(); pending = false; if (returnFocus?.isConnected) returnFocus.focus(); }
    return { ...capability, title: policy.title || policy.approveLabel || capability.title, scope: server };
}
