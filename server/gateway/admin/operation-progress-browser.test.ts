import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { createControlPlane } from '../../control-plane/service.js';
import { controlPlaneConfig } from '../../control-plane/config.js';
import { IdentityStore } from '../../control-plane/identity-store.js';
import { ServerRegistry } from '../../control-plane/server-registry.js';
import { serveAdminAsset } from './assets.js';

async function submitExperiment(page: Page, label: string) {
    await page.evaluate(label => {
        const form = document.querySelector<HTMLFormElement>('#multi-agent-experiment-form')!;
        (form.elements.namedItem('label') as HTMLInputElement).value = label;
        const profiles = form.elements.namedItem('parameterProfile') as HTMLSelectElement;
        profiles.replaceChildren(new Option('Fixture profile', 'fixture@1.0.0')); profiles.value = 'fixture@1.0.0';
        const candidates = document.getElementById('multi-agent-candidate-list')!; candidates.replaceChildren();
        for (const value of ['fixture-a', 'fixture-b']) {
            const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'experimentAgentId'; input.value = value; input.checked = true; candidates.append(input);
        }
        form.requestSubmit();
    }, label);
    try { await page.waitForSelector('#operation-review[open]', { timeout: 5000 }); }
    catch (error) {
        const diagnostics = await page.evaluate(() => ({ toast: document.getElementById('toast')?.textContent,
            progress: document.getElementById('operation-progress')?.textContent,
            invalid: Array.from(document.querySelectorAll<HTMLFormElement>('#multi-agent-experiment-form :invalid')).map(item => item.outerHTML) }));
        throw new Error(`${error}: ${JSON.stringify(diagnostics)}`);
    }
}
const rowWith = async (page: Page, id: string, state: string) => page.waitForFunction(({ id, state }) =>
    Array.from(document.querySelectorAll('#operation-progress li')).some(item => item.textContent!.includes(id) && (item as HTMLElement).dataset.state === state), {}, { id, state });

test('experiment approval visibly sends once, follows its exact run across views, recovers failed reads and shows terminal/partial errors', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:'), config = controlPlaneConfig({});
    const owner = await identities.createAccount('progress-owner', 'synthetic progress owner password'); registry.ensureConfiguredLocal(config);
    const llm = JSON.parse(await Bun.file(join(import.meta.dir, '../../../config/llm-runtime.json')).text());
    const defaults = { skills: [], destinations: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
        bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], offers: [], contracts: [], businesses: [], backups: [],
        generatedAt: new Date().toISOString(), economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
    let writes = 0, failList = false, failRead = false, reject = false, release: (() => void) | undefined;
    let run: Record<string, unknown> | undefined;
    const app = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async (url, init) => {
        if (init.method === 'POST' && url.pathname === '/api/admin/multi-agent-experiments') {
            writes++; const body = await new Response(init.body).json();
            if (reject) return Response.json({ error: 'A kiválasztott karakter offline.' }, { status: 422 });
            await new Promise<void>(resolve => { release = resolve; });
            run = { experimentId: crypto.randomUUID(), label: body.label, summary: 'Fixture run', seed: 'fixture-seed', definitionDigest: 'fixture-digest',
                status: 'running', startedAt: new Date().toISOString(), participants: [], baselineEconomy: defaults.economy, dispatchEconomy: null };
            return Response.json({ experiment: run }, { status: 202 });
        }
        if (url.pathname === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 60000, worldMapUrl: config.engineOrigin + '/mapview/' });
        if (url.pathname === '/api/admin/llm-settings') return Response.json({ config: llm, source: 'project-default', apiKey: { configured: false, source: 'none' } });
        if (url.pathname === '/api/admin/multi-agent-experiments') return failList ? Response.json({ error: 'Fixture list unavailable' }, { status: 503 }) : Response.json({ experiments: run ? [run] : [] });
        if (url.pathname.startsWith('/api/admin/multi-agent-experiments/')) return failRead ? Response.json({ error: 'Fixture status unavailable' }, { status: 503 }) : Response.json({ experiment: run });
        return Response.json(defaults);
    }, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        await page.setViewport({ width: 1440, height: 1000 }); page.on('pageerror', error => errors.push(String(error)));
        await page.goto(new URL('/admin/login.html', app.url).toString());
        await page.type('[name="username"]', owner.username); await page.type('[name="password"]', 'synthetic progress owner password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.goto(new URL('/admin/index.html?serverId=local-default#experiments', app.url).toString());
        await page.waitForFunction(() => document.getElementById('last-refresh')!.textContent!.startsWith('Frissítve:'));
        await submitExperiment(page, 'Cancel fixture'); await page.keyboard.press('Escape');
        await page.waitForSelector('#operation-progress li[data-state="cancelled"]'); expect(writes).toBe(0);
        await submitExperiment(page, 'Delayed fixture'); await page.click('[data-review-approve]');
        await page.waitForSelector('#operation-progress li[data-state="sending"]');
        await page.evaluate(() => { document.querySelector<HTMLFormElement>('#multi-agent-experiment-form')!.requestSubmit(); });
        expect(writes).toBe(1);
        await page.click('#admin-navigation [data-tab="bots"]');
        expect(await page.$eval('#operation-progress', item => item.checkVisibility())).toBe(true);
        failList = true; release!();
        await page.waitForSelector('#operation-progress li[data-state="running"]');
        const id = String(run!.experimentId); await rowWith(page, id, 'running');
        expect(await page.$eval('#operation-progress', item => item.textContent)).toContain('A kísérlet elindult');
        expect(await page.$eval('#multi-agent-experiment-list', item => item.textContent)).toContain('Delayed fixture');
        failRead = true;
        await page.click('#operation-progress li[data-state="running"] button'); await rowWith(page, id, 'unknown');
        expect(await page.$eval('#operation-progress', item => item.textContent)).toContain('Ne indíts új futást');
        failRead = false; run!.status = 'completed';
        await page.click('#operation-progress li[data-state="unknown"] button'); await rowWith(page, id, 'completed');
        expect(writes).toBe(1);
        failList = false; await page.click('#admin-navigation [data-tab="experiments"]');
        await submitExperiment(page, 'Partial fixture'); await page.click('[data-review-approve]');
        await page.waitForSelector('#operation-progress li[data-state="sending"]'); release!();
        await page.waitForFunction(() => !(document.getElementById('start-multi-agent-experiment') as HTMLButtonElement).disabled);
        run!.status = 'completed-with-errors'; run!.error = '<img src=x onerror=alert(1)> Fixture budget exhausted';
        await rowWith(page, String(run!.experimentId), 'partial');
        expect(await page.$$('#operation-progress img')).toHaveLength(0);
        expect(await page.$eval('#operation-progress li[data-state="partial"]', item => item.textContent)).toContain('AI keretét');
        reject = true; await submitExperiment(page, 'Rejected fixture'); await page.click('[data-review-approve]');
        await page.waitForSelector('#operation-progress li[data-state="failed"]');
        const failure = await page.$eval('#operation-progress li[data-state="failed"]', item => item.textContent);
        expect(failure).toContain('offline'); expect(failure).toContain('HTTP 422'); expect(failure).toContain('előfeltételeket');
        expect(writes).toBe(3);
        await page.setViewport({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-4-progress-mobile.png') });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-4-progress-desktop.png') });
        // Reload reads durable running experiments again; completed records are not browser-persisted.
        reject = false; run!.status = 'running'; await page.reload();
        await rowWith(page, String(run!.experimentId), 'running');
        expect(writes).toBe(3); expect(errors).toEqual([]);
        // Transport loss after sending must not claim failure or retry a mutation automatically.
        await page.evaluate(async () => {
            const modulePath = '/admin/operation-progress.js', module = await import(modulePath);
            void module.runOperation('/api/admin/agents/fixture-a/episodes/prune', { method: 'POST', body: { reason: 'Timeout fixture' } },
                async (_signal: AbortSignal, markSent: () => void) => { markSent(); throw new DOMException('Fixture timeout', 'TimeoutError'); }).catch(() => {});
        });
        await page.waitForSelector('#operation-review[open]'); await page.click('[data-review-approve]');
        await page.waitForSelector('#operation-progress li[data-state="unknown"]');
        expect(await page.$eval('#operation-progress li[data-state="unknown"]', item => item.textContent)).toContain('ne küldd be újra');
        const duplicateSent = await page.evaluate(async () => {
            const modulePath = '/admin/operation-progress.js', module = await import(modulePath);
            let sent = false;
            await module.runOperation('/api/admin/agents/fixture-a/episodes/prune', { method: 'POST', body: { reason: 'Timeout fixture' } },
                async () => { sent = true; return { data: {}, status: 200 }; }).catch(() => {});
            return sent;
        });
        expect(duplicateSent).toBe(false);
        expect(writes).toBe(3);
    } finally { release?.(); await browser?.close(); await app.stop(true); registry.close(); identities.close(); }
}, 40000);

test('background skill reports and real fetch timeouts keep their outcome distinct from successful submission', async () => {
    let requests = 0, release: (() => void) | undefined;
    const app = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/') return new Response('<!doctype html><main class="admin-content"></main>', { headers: { 'Content-Type': 'text/html' } });
        if (url.pathname === '/fixture-delay') {
            requests++; await new Promise<void>(resolve => { release = resolve; }); return Response.json({ ok: true });
        }
        return await serveAdminAsset(url, 'http://127.0.0.1:1') || new Response('Not found', { status: 404 });
    } });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage();
        await page.goto(app.url.toString());
        await page.evaluate(async () => {
            const modulePath = '/admin/operation-progress.js', module = await import(modulePath);
            const fixture = window as unknown as { runs: { runId: string; status: string; reason: string }[]; sends: number };
            fixture.runs = []; fixture.sends = 0;
            module.setOperationReader(async () => ({ runs: fixture.runs }));
            void module.runOperation('/api/admin/bots/Fixture/start-skill', { method: 'POST', body: { skill: 'fixture@1.0.0', reason: 'Skill progress fixture' } },
                async (_signal: AbortSignal, markSent: () => void) => { markSent(); fixture.sends++; return { data: { process: { runId: 'fixture-run' } }, status: 202 }; });
        });
        await page.waitForSelector('#operation-review[open]'); await page.click('[data-review-approve]');
        await rowWith(page, 'fixture-run', 'running');
        await page.evaluate(() => { (window as unknown as { runs: unknown[] }).runs = [{ runId: 'fixture-run', status: 'failed', reason: 'Fixture operation limit' }]; });
        await page.click('#operation-progress li[data-state="running"] button');
        await rowWith(page, 'fixture-run', 'failed');
        expect(await page.$eval('#operation-progress li[data-state="failed"]', item => item.textContent)).toContain('Fixture operation limit');
        expect(await page.evaluate(() => (window as unknown as { sends: number }).sends)).toBe(1);
        // An already-online old process cannot complete a newly accepted restart.
        await page.evaluate(async () => {
            const modulePath = '/admin/operation-progress.js', module = await import(modulePath);
            const fixture = window as unknown as { restartStarted: string; restarted: boolean; restartReads: number };
            fixture.restartStarted = new Date().toISOString(); fixture.restarted = false; fixture.restartReads = 0;
            module.setOperationReader(async () => {
                fixture.restartReads++;
                return { status: 'active', stateAgeMs: 0, process: { status: 'running', startedAt: fixture.restarted ? fixture.restartStarted : '2000-01-01T00:00:00.000Z' } };
            });
            void module.runOperation('/api/admin/bots/Fixture/restart', { method: 'POST', body: { reason: 'Restart progress fixture' } },
                async (_signal: AbortSignal, markSent: () => void) => { markSent(); return { data: { result: { startedAt: fixture.restartStarted } }, status: 202 }; });
        });
        await page.waitForSelector('#operation-review[open]'); await page.click('[data-review-approve]');
        await page.waitForFunction(() => (window as unknown as { restartReads: number }).restartReads > 0);
        await rowWith(page, 'Fixture', 'running');
        await page.evaluate(() => { (window as unknown as { restarted: boolean }).restarted = true; });
        await page.click('#operation-progress li[data-state="running"] button');
        await rowWith(page, 'Fixture', 'completed');
        await page.evaluate(async () => {
            const modulePath = '/admin/operation-progress.js', module = await import(modulePath);
            const original = AbortSignal.timeout.bind(AbortSignal);
            AbortSignal.timeout = ms => original(ms === 30000 ? 150 : ms);
            void module.runOperation('/api/admin/agents/fixture-a/episodes/prune', { method: 'POST', body: { reason: 'Real timeout fixture' } },
                async (signal: AbortSignal, markSent: () => void) => { markSent(); const response = await fetch('/fixture-delay', { method: 'POST', signal }); return { data: await response.json(), status: response.status }; }).catch(() => {});
        });
        await page.waitForSelector('#operation-review[open]'); await page.click('[data-review-approve]');
        await page.waitForSelector('#operation-progress li[data-state="unknown"]');
        expect(await page.$eval('#operation-progress li[data-state="unknown"]', item => item.textContent)).toContain('időkorlát');
        expect(requests).toBe(1);
    } finally { release?.(); await browser?.close(); await app.stop(true); }
}, 15000);
