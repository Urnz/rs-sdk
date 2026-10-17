'use strict';
const observationId = new URL(location.href).searchParams.get('serverId');
const observationElement = id => document.getElementById('observation-' + id);
async function observationApi(path) {
    const response = await fetch(path, { headers: { 'X-Control-Server-ID': observationId }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.status === 401) location.assign('/admin/login.html');
    if (!response.ok) throw new Error();
    return response.json();
}
async function refreshObservations() {
    const button = observationElement('refresh'); button.disabled = true;
    try {
        if (!observationId) throw new Error();
        const { server } = await observationApi('/api/control-plane/servers/' + encodeURIComponent(observationId));
        observationElement('title').textContent = server.name;
        observationElement('message').textContent = server.role === 'operator' ? 'Üzemeltetői hozzáférés. Az indítás és leállítás a Saját szervereim oldalon érhető el.' : 'Nézői hozzáférés. A megfigyelés nem módosítja a világot.';
        await Promise.all([
            observationApi('/api/control-plane/status').then(result => { observationElement('connection').textContent = `Gateway: ${result.gateway.state === 'available' ? 'elérhető' : 'nem elérhető'} · Játékszerver: ${result.engine.state === 'available' ? 'elérhető' : 'nem elérhető'}`; })
                .catch(() => { observationElement('connection').textContent = 'A kapcsolat jelenleg nem ellenőrizhető.'; }),
            observationApi('/api/admin/simulation-clock').then(result => { observationElement('clock').textContent = result.clock?.simulationTime ? new Date(result.clock.simulationTime).toLocaleString('hu-HU') : 'Nincs elérhető szimulációs idő.'; })
                .catch(() => { observationElement('clock').textContent = 'A szimulációs óra jelenleg nem érhető el.'; }),
            observationApi('/api/admin/population-demographics').then(result => {
                const population = result.report?.sections?.population?.value;
                observationElement('population').textContent = population ? `Élő tagok: ${population.activeLivingMembers} · Összes rögzített tag: ${population.recordedMembers}` : 'Még nincs ellenőrzött populációs adat.';
            }).catch(() => { observationElement('population').textContent = 'A populáció adatai jelenleg nem érhetők el.'; })
        ]);
    } catch { observationElement('message').textContent = 'A szerver nem érhető el ezzel a hozzáféréssel. Ellenőrizd a Saját szervereim oldalt.'; }
    finally { button.disabled = false; }
}
observationElement('refresh').addEventListener('click', refreshObservations);
void refreshObservations();
