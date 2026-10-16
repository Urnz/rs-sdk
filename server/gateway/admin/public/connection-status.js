/** Independent of the data bootstrap: the admin shell remains understandable during backend outages. */
export function mountConnectionStatus(element) {
    let stopped = false, timer;
    async function update() {
        try {
            const response = await fetch('/api/control-plane/status', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
            // The old gateway URL remains a compatible direct entry point.
            if (response.status === 404) { element.hidden = true; stopped = true; return; }
            if (!response.ok) throw new Error('status unavailable');
            const status = await response.json();
            if (status.service !== 'rs-sdk-control-plane' || status.ready !== true
                || !['available', 'unavailable'].includes(status.gateway?.state) || !['available', 'unavailable'].includes(status.engine?.state)) throw new Error('invalid status');
            element.hidden = false;
            element.dataset.gateway = status.gateway.state; element.dataset.engine = status.engine.state;
            const connected = status.gateway.state === 'available';
            element.querySelector('[data-connection-summary]').textContent = connected ? 'Admin elérhető' : 'Admin elérhető · a gateway kapcsolata szünetel';
            element.querySelector('[data-connection-gateway]').textContent = connected ? 'Gateway: elérhető' : 'Gateway: nem elérhető';
            element.querySelector('[data-connection-engine]').textContent = status.engine.state === 'available' ? 'Játékszerver: elérhető' : 'Játékszerver: nem elérhető';
            element.querySelector('[data-connection-detail]').textContent = !connected
                ? 'Az adatok és műveletek a gateway helyreállítása után automatikusan újratöltődnek.'
                : status.engine.state === 'unavailable' ? 'A játékhoz kötött műveletekhez indítsd el a helyi játékszervert.' : 'A helyi szolgáltatások válaszolnak.';
        } catch {
            element.hidden = false;
            element.dataset.gateway = 'unknown'; element.dataset.engine = 'unknown';
            element.querySelector('[data-connection-summary]').textContent = 'A kapcsolat állapota nem frissíthető';
            element.querySelector('[data-connection-gateway]').textContent = 'Gateway: ismeretlen';
            element.querySelector('[data-connection-engine]').textContent = 'Játékszerver: ismeretlen';
            element.querySelector('[data-connection-detail]').textContent = 'Az admin állapotellenőrzése automatikusan újrapróbálkozik.';
        } finally { if (!stopped) timer = setTimeout(update, 5000); }
    }
    void update();
    return () => { stopped = true; clearTimeout(timer); };
}
