const labels = { survival: 'Túlélés', 'self-sufficiency': 'Önfenntartás', specialization: 'Specializáció', mobility: 'Mobilitás',
    'wealth-distribution': 'Vagyoneloszlás', 'price-stability': 'Árstabilitás', unemployment: 'Munkanélküliség',
    'innovation-investment': 'Innováció / beruházás', crime: 'Bűnözés', 'systemic-risk': 'Rendszerkockázat' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = value => escape(JSON.stringify(value, null, 2));
const direction = { maximize: 'Nagyobb érték a cél', minimize: 'Kisebb érték a cél', describe: 'Leíró mutató' };

/** Mounted once. Requests are explicit, GET-only, and stale responses cannot replace a newer scope. */
export function mountSocietyDashboard(root, api) {
    const $ = selector => root.querySelector(selector), form = $('#society-scope'), filters = $('#society-filters');
    let view = null, base = null, current = null, sequence = 0, controller = null, detailController = null, prepared = false, busy = false;
    const status = (message, error = false) => { $('#society-status').textContent = message; $('#society-status').classList.toggle('danger-text', error); };
    const request = (url, signal) => api(url, { signal, headers: { 'X-Admin-Request': 'rs-sdk-admin' } });
    const clear = () => {
        view = null; current = null; $('#society-objectives').replaceChildren(); $('#society-detail').replaceChildren();
        $('#society-events').replaceChildren(); $('#society-timeline').replaceChildren(); $('#society-coverage-body').replaceChildren();
        $('#society-detail').hidden = true; $('#society-coverage').hidden = true; $('#society-event-section').hidden = true; $('#society-scope-caption').textContent = '';
    };
    const invalidate = message => { sequence++; controller?.abort(); detailController?.abort(); busy = false; clear(); status(message); };
    const fillSelect = (name, values, selected) => {
        const select = filters.elements.namedItem(name);
        select.innerHTML = `<option value="">Összes</option>${values.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')}`;
        select.value = selected ?? '';
    };
    function render(data) {
        const byKey = new Map(data.metrics.map(row => [row.key, row]));
        $('#society-objectives').innerHTML = data.evaluation.calculation.objectives.map(objective => `<article class="society-objective">
            <h3>${escape(labels[objective.id] || objective.id)}</h3><span class="muted">${objective.status === 'observed' ? 'Megfigyelt részadat' : 'Hiányos mérési adat'}</span>
            ${objective.metrics.map(metric => {
                const link = byKey.get(`${objective.id}/${metric.id}`), available = metric.status === 'observed';
                return `<div class="society-indicator"><strong>${available ? escape(metric.denominator === '1' ? metric.numerator : `${metric.numerator} / ${metric.denominator}`) : 'Nincs mérés'}</strong>
                    <small>${escape(metric.id)} · ${escape(metric.unit)} · ${escape(direction[metric.direction])}</small>
                    ${link?.numeratorScenario ? `<small>Számláló forgatókönyve: ${escape(link.numeratorScenario.label)} · ${escape(link.numeratorScenario.targetNodeId)}</small>` : ''}
                    ${available ? '' : '<p class="muted">Nincs elegendő, megfelelő scope-hoz kötött natív bizonyíték. A hiányzó adat nem nulla.</p>'}
                    <button type="button" class="button small" data-society-metric="${escape(link?.key)}" ${link?.eventCount ? '' : 'disabled'}>${link?.eventCount ? `${link.eventCount} forrásesemény` : 'Nincs igazolt eseménysor'}</button></div>`;
            }).join('')}</article>`).join('');
        $('#society-scope-caption').textContent = `Megjelenített riport: ${data.scope.fromSimulationTime} → ${data.scope.toSimulationTime} · kohorsz: ${data.scope.actorAgentIds.join(', ')} · snapshot: ${data.snapshot}`;
        $('#society-coverage').hidden = false;
        $('#society-coverage-body').innerHTML = `<p>Időben nem elhelyezhető forrásesemények: ${escape(data.sourceCoverage.unplaced)}. A teljes populáció lefedettsége nem igazolt.</p>
            <details><summary>Forrásállapotok és tartalomkötések</summary><pre>${json(data.evaluation.sources)}</pre></details>
            <details><summary>Hiányzó adatforrások</summary><pre>${json(data.evaluation.unavailableReasons)}</pre></details>
            <details><summary>Legnagyobb megfigyelt kiesések</summary><pre>${json(data.worstWithdrawals)}</pre></details>
            <ul>${[...data.limitations, ...data.evaluation.limitations].map(text => `<li>${escape(text)}</li>`).join('')}</ul>`;
        fillSelect('agent', data.facets.agents, data.filters.agent); fillSelect('business', data.facets.businesses, data.filters.business);
        fillSelect('itemId', data.facets.itemIds, data.filters.itemId === undefined ? '' : String(data.filters.itemId));
        filters.elements.namedItem('metric').innerHTML = `<option value="">Összes natív esemény</option>${data.metrics.filter(row => row.eventCount).map(row => `<option value="${escape(row.key)}">${escape(labels[row.objectiveId])} · ${escape(row.metric.id)}</option>`).join('')}`;
        filters.elements.namedItem('metric').value = data.filters.metric ?? ''; filters.elements.namedItem('region').value = data.filters.region ?? '';
        filters.elements.namedItem('limit').value = String(data.page.limit);
        $('#society-event-section').hidden = false;
        $('#society-timeline').innerHTML = data.timeline.map(bucket => `<button type="button" data-society-from="${escape(bucket.from)}" data-society-to="${escape(bucket.to)}" ${bucket.eventCount ? '' : 'disabled'}
            aria-label="${escape(bucket.from)} – ${escape(bucket.to)}: ${bucket.eventCount} esemény" title="${escape(bucket.from)} → ${escape(bucket.to)}"><span></span><strong>${bucket.eventCount}</strong><small>${escape(bucket.from.slice(11, 16))}</small></button>`).join('');
        const maximum = Math.max(1, ...data.timeline.map(bucket => bucket.eventCount));
        $('#society-timeline').querySelectorAll('button > span').forEach((bar, index) => { bar.style.height = `${Math.max(2, Math.round(64 * data.timeline[index].eventCount / maximum))}px`; });
        $('#society-event-count').textContent = `${data.totalMatchingEvents} egyező natív bizonylat / ${data.totalWindowEvents} bizonylat a megfigyelt ablakban · eseményidő: ${data.filters.eventFrom} → ${data.filters.eventTo}`;
        $('#society-events').innerHTML = data.events.length ? data.events.map(event => `<tr>
            <td><time>${escape(event.simulationTime)}</time><small>${escape(event.channel)} · ${escape(event.recordId)}</small></td>
            <td>${escape(event.agents.join(', ') || 'Nincs igazolt agentazonosítás')}<small>${escape(event.businesses.join(', ') || 'Business: nincs rögzítve')}${event.actorReferences.length ? ` · nem azonosított referenciák: ${escape(event.actorReferences.join(', '))}` : ''}</small></td>
            <td>${escape(event.itemIds.join(', ') || 'Nincs termékazonosító')}<small>Régió: ismeretlen</small></td>
            <td>${event.contribution ? `${event.contribution.numerator ? 'Számlálóban' : 'Számlálóban nem'} · ${event.contribution.denominator ? 'nevezőben' : 'nevezőben nem'}` : 'Önálló bizonylat'}</td>
            <td><button type="button" class="button small" data-society-event="${escape(event.id)}">Bizonylat</button></td></tr>`).join('') : '<tr><td colspan="5">Nincs egyező, igazolt bizonylat. Ez nem bizonyítja az aktivitás hiányát.</td></tr>';
        root.querySelector('[data-society-action="previous"]').disabled = data.page.offset === 0;
        root.querySelector('[data-society-action="next"]').disabled = data.page.nextOffset === null;
    }
    async function load(params) {
        const ticket = ++sequence; controller?.abort(); detailController?.abort(); controller = new AbortController(); busy = true;
        $('#society-detail').hidden = true; status('Natív források ellenőrzése…');
        try {
            const data = await request(`/api/admin/society/dashboard?${params}`, controller.signal);
            if (ticket !== sequence) return;
            view = data; current = new URLSearchParams(params); current.set('snapshot', data.snapshot); render(data);
            status('Részleges natív megfigyelések betöltve. Élő kísérlet nem indult.');
        } catch (error) {
            if (ticket !== sequence || error.name === 'AbortError') return;
            clear(); status(error.message, true);
        } finally { if (ticket === sequence) busy = false; }
    }
    const applyFilters = (extra = {}) => {
        if (!base || !view) return;
        const params = new URLSearchParams(base); params.set('snapshot', view.snapshot);
        for (const [name, value] of new FormData(filters)) if (String(value)) params.set(name, String(value));
        if (current?.has('eventFrom')) params.set('eventFrom', current.get('eventFrom'));
        if (current?.has('eventTo')) params.set('eventTo', current.get('eventTo'));
        for (const [name, value] of Object.entries(extra)) value === null ? params.delete(name) : params.set(name, String(value));
        return load(params);
    };
    form.addEventListener('input', () => invalidate('A riportfeltételek megváltoztak. Töltsd be újra a riportot.'));
    form.addEventListener('submit', event => {
        event.preventDefault(); const values = new FormData(form), params = new URLSearchParams();
        for (const name of ['from', 'to', 'clockId', 'clockProfileDigest']) params.set(name, String(values.get(name)).trim());
        for (const actor of String(values.get('actors')).split(',').map(id => id.trim()).filter(Boolean)) params.append('actor', actor);
        base = params; filters.reset(); void load(params);
    });
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('change', () => { void applyFilters(); });
    async function prepare(force = false) {
        if (prepared && !force) return; prepared = true;
        const ticket = sequence;
        try {
            const { clock } = await request('/api/admin/simulation-clock?limit=1');
            if (ticket !== sequence || !clock) return;
            if (force) invalidate('Az óra adatai frissültek. Válaszd ki a kohorszot, majd töltsd be a riportot.');
            for (const [name, value] of Object.entries({ clockId: clock.clockId, clockProfileDigest: clock.profileDigest,
                to: clock.lastSimulationTime, from: new Date(Date.parse(clock.lastSimulationTime) - 86400000).toISOString() }))
                if (force || !form.elements.namedItem(name).value) form.elements.namedItem(name).value = value;
        } catch (error) { if (ticket === sequence) status(`Az óra nem olvasható; a riportfeltételek kézzel is megadhatók. ${error.message}`, true); }
    }
    root.addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
        if (button.dataset.societyAction === 'clock') { await prepare(true); return; }
        if (busy || !view) return;
        if (button.dataset.societyMetric) { filters.elements.namedItem('metric').value = button.dataset.societyMetric; await applyFilters({ eventFrom: null, eventTo: null }); }
        if (button.dataset.societyFrom) await applyFilters({ eventFrom: button.dataset.societyFrom, eventTo: button.dataset.societyTo });
        if (button.dataset.societyAction === 'reset-filters') { filters.reset(); await applyFilters({ eventFrom: null, eventTo: null }); }
        if (button.dataset.societyAction === 'reset-time') await applyFilters({ eventFrom: null, eventTo: null });
        if (button.dataset.societyAction === 'next' && view.page.nextOffset !== null) { const next = new URLSearchParams(current); next.set('offset', String(view.page.nextOffset)); await load(next); }
        if (button.dataset.societyAction === 'previous') { const previous = new URLSearchParams(current); previous.set('offset', String(Math.max(0, view.page.offset - view.page.limit))); await load(previous); }
        if (button.dataset.societyEvent) {
            const ticket = sequence; detailController?.abort(); const ownController = new AbortController(); detailController = ownController;
            const detail = $('#society-detail'); detail.hidden = false; detail.textContent = 'Bizonylat ellenőrzése…';
            try {
                const data = await request(`/api/admin/society/dashboard/events/${encodeURIComponent(button.dataset.societyEvent)}?${current}`, ownController.signal);
                if (ticket !== sequence || ownController !== detailController || ownController.signal.aborted) return;
                detail.innerHTML = `<h3>Natív bizonylat</h3><dl><dt>Azonosító / natív sorszám</dt><dd>${escape(data.event.recordId)} / ${escape(data.event.nativeSequence)}</dd>
                    <dt>Forrásdigest</dt><dd>${escape(data.event.sourceDigest)}</dd><dt>Szimulációs / valós idő</dt><dd>${escape(data.event.simulationTime)} / ${escape(data.event.wallTime)}</dd></dl>
                    <p class="muted">Régió nincs rögzítve. A bizonylat a megjelenített riport snapshotjához tartozik.</p>
                    <h4>Eredeti natív rekord</h4><pre>${json(data.nativeRecord)}</pre><details><summary>Órakötés, gráfkapcsolatok és mutatóhozzájárulás</summary><pre>${json({ simulationBinding: data.simulationBinding, graphNodes: data.graphNodes, graphEdges: data.graphEdges, contribution: data.contribution })}</pre></details>`;
                detail.scrollIntoView({ block: 'nearest' });
            } catch (error) { if (ticket === sequence && ownController === detailController && error.name !== 'AbortError') { clear(); status(error.message, true); } }
        }
    });
    return { prepare };
}
