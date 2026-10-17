import { expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { approveOperation } from '../../gateway/admin/test-review-helper.js';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';
import { readAdminLlmSettings } from '../../gateway/admin/llm-settings.js';
import { IdentityStore } from '../identity-store.js';
import { ServerRegistry } from '../server-registry.js';
import { LifecycleManager } from '../lifecycle-manager.js';
import type { ManagedRuntime } from '../managed-runtime.js';
import type { ManagedServer } from '../lifecycle-store.js';

test('maintenance UI backs up, selects a snapshot, restores and migrates with visible completed operations', async () => {
    const registry = new ServerRegistry(':memory:'), identities = new IdentityStore(':memory:');
    const backups: { id: string; version: string; createdAt: number }[] = [];
    const runtime: ManagedRuntime = { version: 'a'.repeat(40), async prepare() {}, async start() {}, async stop() {}, async inspect() { return 'stopped'; },
        async backup(server, id) { backups.push({ id, version: server.version, createdAt: Date.now() }); }, async backups() { return backups; },
        async restore(_server, id) { return backups.find(backup => backup.id === id)!.version; }, async migrate(_server, version) { return version; } };
    const manager = new LifecycleManager(registry, identities, runtime);
    const owner = await identities.createAccount('maintenance-ui', 'synthetic maintenance UI password');
    const created = manager.create(owner.id, { name: 'Menthető világ', version: runtime.version, template: 'classic', requestKey: crypto.randomUUID() }); await manager.idle();
    runtime.version = 'b'.repeat(40);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(controlPlaneConfig(), identities, fetch, registry, manager) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error))); page.on('dialog', dialog => { void dialog.accept(); });
        await page.goto(new URL('/admin/', admin.url).toString());
        await page.type('[name="username"]', owner.username); await page.type('[name="password"]', 'synthetic maintenance UI password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        const click = async (text: string) => {
            await page.waitForFunction(label => Array.from(document.querySelectorAll('.server-card button')).some(button => button.textContent === label && !(button as HTMLButtonElement).disabled), {}, text);
            await page.evaluate(label => (Array.from(document.querySelectorAll('.server-card button')).find(button => button.textContent === label) as HTMLButtonElement).click(), text);
            if (text !== 'Mentések betöltése') await approveOperation(page);
        };
        await click('Mentés készítése'); await page.waitForFunction(() => document.getElementById('lifecycle-message')!.textContent === 'A művelet befejeződött.');
        await page.waitForFunction(() => !document.querySelector('.server-card button:disabled'));
        expect(backups).toHaveLength(1);
        await click('Mentések betöltése'); await page.waitForSelector('.server-card select option');
        await click('Mentés visszaállítása'); await manager.idle();
        await page.waitForFunction(() => document.getElementById('lifecycle-message')!.textContent === 'A művelet befejeződött.');
        await click('Verzió frissítése');
        await page.waitForFunction(() => document.querySelector('.server-card')!.textContent!.includes('Forrás: bbbbbbbb'));
        await page.waitForFunction(() => document.querySelectorAll('#operation-progress li[data-state="completed"]').length === 3);
        expect(await page.$$('#operation-progress li[data-state="failed"], #operation-progress li[data-state="unknown"]')).toHaveLength(0);
        expect(registry.lifecycle.managed(created.serverId)!.version).toBe(runtime.version);
        await page.setViewport({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
    } finally { await browser?.close(); await manager.idle(); await admin.stop(true); registry.close(); identities.close(); }
}, 30000);

test('full admin browser survives absent services and bootstraps after gateway recovery without reloading', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-plane-browser-'));
    const identities = new IdentityStore(join(temporary, 'identity.sqlite'));
    await identities.createAccount('browser-owner', 'synthetic browser password');
    const llm = await readAdminLlmSettings({ defaultConfigPath: join(import.meta.dir, '../../..', 'config/llm-runtime.json'),
        overrideConfigPath: join(temporary, 'missing.json'), apiKeyPath: join(temporary, 'no-secret.txt') }, {});
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unused') });
    const gatewayPort = reservation.port!, gatewayOrigin = reservation.url.origin; reservation.stop(true);
    const engineReservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unused') });
    const engineOrigin = engineReservation.url.origin; engineReservation.stop(true);
    const config = { ...controlPlaneConfig(), gatewayOrigin, engineOrigin }, registry = new ServerRegistry(':memory:');
    registry.ensureConfiguredLocal(config);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, fetch, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined, gateway: ReturnType<typeof Bun.serve> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error))); await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(new URL('/admin/', admin.url).toString());
        expect(new URL(page.url()).pathname).toBe('/admin/login.html');
        await page.type('[name="username"]', 'browser-owner'); await page.type('[name="password"]', 'synthetic browser password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('.server-card[data-server-id="local-default"] a');
        expect(await page.$eval('h1', element => element.textContent)).toBe('Saját szervereim');
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-3-servers-desktop.png') });
        await page.setViewport({ width: 390, height: 844 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-3-servers-mobile.png'), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        let rejectList = true;
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (new URL(request.url()).pathname === '/api/control-plane/servers' && rejectList)
                void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Teszt: a regiszter átmenetileg nem olvasható.' }) });
            else void request.continue();
        });
        await page.click('#servers-refresh'); await page.waitForSelector('#servers-message[data-error="true"]');
        expect(await page.$eval('#servers-message', element => element.textContent)).toContain('Frissítés');
        expect(await page.$$('.server-card')).toHaveLength(0);
        rejectList = false; await page.click('#servers-refresh'); await page.waitForSelector('.server-card a');
        await Promise.all([page.waitForNavigation(), page.click('.server-card a')]);
        await page.setViewport({ width: 1440, height: 1000 });
        await page.waitForSelector('#connection-status[data-gateway="unavailable"][data-engine="unavailable"]');
        expect(await page.$eval('h1', element => element.textContent)).toBe('Szerver kezelése');
        await page.click('#admin-navigation [data-tab="map"]');
        await page.click('#world-map-button');
        expect(await page.$eval('#world-map-dialog', element => (element as HTMLDialogElement).open)).toBe(false);
        expect(await page.$eval('#toast', element => element.textContent)).toContain('gateway');
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-1-admin-offline-desktop.png') });
        await page.setViewport({ width: 390, height: 844 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-1-admin-offline-mobile.png') });
        const bannerWidth = await page.$eval('#connection-status', element => element.getBoundingClientRect().width); expect(bannerWidth).toBeLessThanOrEqual(390);
        const defaults = { skills: [], destinations: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
            bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], generatedAt: new Date().toISOString(),
            economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
        gateway = Bun.serve({ hostname: '127.0.0.1', port: gatewayPort, fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === '/api/admin/llm-settings') return Response.json(llm);
            if (path === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 250, worldMapUrl: engineOrigin + '/mapview/' });
            return Response.json(defaults);
        } });
        await page.waitForSelector('#connection-status[data-gateway="available"][data-engine="unavailable"]', { timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('#last-refresh')?.textContent?.startsWith('Frissítve:'), { timeout: 10000 });
        expect(await page.$eval('#metric-bots', element => element.textContent)).toBe('0');
        gateway.stop(true); gateway = undefined;
        await page.waitForSelector('#connection-status[data-gateway="unavailable"]', { timeout: 10000 });
        expect((await fetch(new URL('/admin/', admin.url), { redirect: 'manual' })).status).toBe(303); expect(errors).toEqual([]);
    } finally { await browser?.close(); gateway?.stop(true); await admin.stop(true); registry.close(); identities.close(); await rm(temporary, { recursive: true, force: true }); }
}, 40000);

test('two admin tabs keep independent mandatory contexts, settings and an explicit offline shell', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:'), running = new Set<string>();
    const root = await identities.createAccount('tabs-root', 'synthetic root password');
    const owner = await identities.createAccount('tabs-owner', 'synthetic owner password', root.id);
    const runtime: ManagedRuntime = { version: 'a'.repeat(40), async prepare() {}, async start(server) { running.add(server.serverId); },
        async stop(server) { running.delete(server.serverId); }, async inspect(server) { return running.has(server.serverId) ? 'running' : 'stopped'; } };
    const manager = new LifecycleManager(registry, identities, runtime), ids: string[] = [];
    for (const name of ['Világ A', 'Világ B']) { ids.push(manager.create(owner.id, { name, version: runtime.version, template: 'classic', requestKey: crypto.randomUUID() }).serverId); await manager.idle(); }
    for (const id of ids) { manager.action(owner.id, id, 'start', { requestKey: crypto.randomUUID(), expectedRevision: registry.lifecycle.managed(id)!.revision }); await manager.idle(); }
    const config = JSON.parse(await Bun.file(join(import.meta.dir, '../../../config/llm-runtime.json')).text());
    const settings = ids.map((id, index) => ({ config: { ...config, model: `model-${index}` }, source: 'server-override', apiKey: { configured: false, source: 'none' } }));
    const defaults = { skills: [], destinations: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
        bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], generatedAt: new Date().toISOString(),
        economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
    const writes: string[] = [], requests: string[] = [];
    const handler = createControlPlane(controlPlaneConfig(), identities, async (url, init) => {
        const index = ids.findIndex(id => registry.get(id)!.gatewayOrigin === url.origin); expect(index).toBeGreaterThanOrEqual(0);
        const id = ids[index]!; expect(new Headers(init.headers).get('X-Control-Server-ID')).toBe(id); requests.push(id);
        if (url.pathname === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 500, worldMapUrl: registry.get(id)!.engineOrigin + '/mapview/' });
        if (url.pathname === '/api/admin/llm-settings') {
            if (init.method === 'PUT') { settings[index]!.config = (await new Response(init.body).json()).config; writes.push(id); }
            return Response.json(settings[index]);
        }
        return Response.json(defaults);
    }, registry, manager);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler }); let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const a = await browser.newPage();
        const errors: string[] = []; a.on('pageerror', error => errors.push(String(error)));
        await a.goto(new URL('/admin/', admin.url).toString()); await a.type('[name="username"]', owner.username); await a.type('[name="password"]', 'synthetic owner password');
        await Promise.all([a.waitForNavigation(), a.click('#login-form button')]);
        await a.waitForSelector(`.server-card[data-server-id="${ids[0]}"] a`);
        await Promise.all([a.waitForNavigation(), a.click(`.server-card[data-server-id="${ids[0]}"] a`)]);
        const b = await browser.newPage(); b.on('pageerror', error => errors.push(String(error)));
        await b.goto(new URL(`/admin/index.html?serverId=${ids[1]}`, admin.url).toString());
        for (const [index, page] of [a, b].entries()) {
            await page.waitForFunction(() => document.querySelector('#last-refresh')?.textContent?.startsWith('Frissítve:'));
            expect(await page.$eval('#server-context-id', element => element.textContent)).toBe(ids[index]!);
            expect(await page.$eval('#server-context-name', element => element.textContent)).toBe(index ? 'Világ B' : 'Világ A');
        }
        await b.evaluate(() => {
            const form = document.querySelector('#llm-settings-form') as HTMLFormElement;
            (form.elements.namedItem('model') as HTMLInputElement).value = 'changed-only-b';
            (form.elements.namedItem('reason') as HTMLInputElement).value = 'context test'; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        await approveOperation(b);
        await b.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('elmentve'));
        expect(writes).toEqual([ids[1]!]); expect(settings[0]!.config.model).toBe('model-0');
        expect(await a.$eval('#llm-settings-form [name="model"]', element => (element as HTMLInputElement).value)).toBe('model-0');
        const previousWrites = writes.length;
        await a.evaluate(other => { history.replaceState({}, '', `/admin/index.html?serverId=${other}`);
            document.querySelector('#llm-settings-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }, ids[1]);
        await a.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('töltsd újra'));
        expect(writes).toHaveLength(previousWrites);
        await a.goto(new URL(`/admin/index.html?serverId=${ids[0]}`, admin.url).toString());
        running.delete(ids[0]!); await a.reload();
        await a.waitForSelector('#connection-status[data-gateway="unavailable"]');
        expect(await a.$eval('#server-context-name', element => element.textContent)).toBe('Világ A');
        await a.setViewport({ width: 1440, height: 1050 }); await a.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-6-server-context-desktop.png'), fullPage: true });
        await b.setViewport({ width: 390, height: 844 }); await b.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-6-server-context-mobile.png'), fullPage: true });
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
    } finally { await browser?.close(); await manager.idle(); await admin.stop(true); registry.close(); identities.close(); }
}, 40000);

test('server creation and lifecycle actions show visible progress, failures and retained archives in Chrome', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:');
    await identities.createAccount('browser-manager', 'synthetic manager password');
    let failStart = false; const running = new Set<string>();
    const runtime: ManagedRuntime = { version: 'a'.repeat(40),
        async prepare() {}, async start(server) { if (failStart) throw new Error('private fixture detail'); running.add(server.serverId); },
        async stop(server) { running.delete(server.serverId); }, async inspect(server) { return running.has(server.serverId) ? 'running' : 'stopped'; } };
    const manager = new LifecycleManager(registry, identities, runtime);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(controlPlaneConfig(), identities, fetch, registry, manager) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage();
        page.on('dialog', dialog => void dialog.accept());
        await page.goto(new URL('/admin/', admin.url).toString());
        await page.type('[name="username"]', 'browser-manager'); await page.type('[name="password"]', 'synthetic manager password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('#server-create:not([hidden])');
        await page.type('#server-create-form [name="name"]', 'Böngészős világ');
        await page.select('#server-create-form [name="template"]', 'closed-economy'); await page.click('#server-create-form button');
        await approveOperation(page);
        const waitState = (state: string) => page.waitForFunction(text => Array.from(document.querySelectorAll('.server-card > p')).some(element => element.textContent === text), {}, state);
        await waitState('Leállítva'); await page.waitForSelector('.server-card [data-action="start"]:not(:disabled)');
        await page.click('.server-card [data-action="start"]'); await approveOperation(page); await waitState('Fut');
        await page.waitForSelector('.server-card [data-action="restart"]:not(:disabled)'); await page.click('.server-card [data-action="restart"]');
        await approveOperation(page);
        await page.waitForFunction(() => document.querySelector('#lifecycle-message')?.textContent === 'A művelet befejeződött.');
        await page.waitForSelector('.server-card [data-action="stop"]:not(:disabled)'); await page.click('.server-card [data-action="stop"]'); await approveOperation(page); await waitState('Leállítva');
        failStart = true; await page.waitForSelector('.server-card [data-action="start"]:not(:disabled)'); await page.click('.server-card [data-action="start"]'); await approveOperation(page); await waitState('Műveleti hiba');
        expect(await page.$eval('#lifecycle-message', element => element.textContent)).not.toContain('private fixture detail');
        await page.waitForSelector('.server-card [data-action="archive"]:not(:disabled)'); await page.click('.server-card [data-action="archive"]'); await approveOperation(page); await waitState('Archiválva');
        expect(await page.$$('.server-card button')).toHaveLength(0);
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.setViewport({ width: 1440, height: 1100 }); await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-4-lifecycle-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-4-lifecycle-mobile.png'), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally { await browser?.close(); await manager.idle(); await admin.stop(true); registry.close(); identities.close(); }
}, 40000);

test('owner can create an account, grant/revoke access, and a non-owner can log in without backend privileges', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-account-ui-'));
    const identities = new IdentityStore(join(temporary, 'identity.sqlite'));
    await identities.createAccount('ui-owner', 'synthetic owner password');
    const config = controlPlaneConfig(), registry = new ServerRegistry(':memory:'); registry.ensureConfiguredLocal(config);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async () => { throw new Error('fixture backend absent'); }, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error))); page.on('dialog', dialog => void dialog.accept());
        await page.setViewport({ width: 390, height: 844 }); await page.goto(new URL('/admin/', admin.url).toString());
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-2-login-mobile.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.type('[name="username"]', 'ui-owner'); await page.type('[name="password"]', 'wrong password'); await page.click('#login-form button');
        await page.waitForSelector('#account-message[data-error="true"]');
        await page.waitForFunction(() => !(document.querySelector('#login-form button') as HTMLButtonElement).disabled);
        await page.type('[name="password"]', 'synthetic owner password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('#control-account-link:not([hidden])');
        await Promise.all([page.waitForNavigation(), page.click('#control-account-link')]);
        await page.waitForSelector('#owner-management:not([hidden])');
        await page.type('#create-account-form [name="username"]', 'ui-guest'); await page.type('#create-account-form [name="password"]', 'synthetic guest password');
        await page.click('#create-account-form button');
        const waitOwnership = (owner: boolean) => page.waitForFunction((expected: boolean) => Array.from(document.querySelectorAll('#account-list li')).some(row =>
            row.querySelector('span')?.textContent === `ui-guest · ${expected ? 'tulajdonos' : 'nincs szerverhozzáférés'}`), {}, owner);
        const toggleGuest = () => page.evaluate(() => {
            const row = Array.from(document.querySelectorAll('#account-list li')).find(row => row.textContent?.startsWith('ui-guest ·'))!;
            (row.querySelector('button') as HTMLButtonElement).click();
        });
        await waitOwnership(false); await toggleGuest(); await approveOperation(page); await waitOwnership(true); await toggleGuest(); await approveOperation(page); await waitOwnership(false);
        await page.setViewport({ width: 1024, height: 1000 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-2-owner-accounts.png'), fullPage: true });
        expect((await page.cookies()).find(cookie => cookie.name === 'rs-control-session')?.httpOnly).toBe(true);
        await Promise.all([page.waitForNavigation(), page.click('#logout-button')]);
        await page.type('[name="username"]', 'ui-guest'); await page.type('[name="password"]', 'synthetic guest password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('#servers-empty:not([hidden])');
        await Promise.all([page.waitForNavigation(), page.click('#control-account-link')]);
        await page.waitForSelector('#account-content:not([hidden])');
        expect(await page.$eval('#owner-management', element => (element as HTMLElement).hidden)).toBe(true);
        expect(await page.evaluate(async () => (await fetch('/api/admin/config', { headers: { 'X-Control-Server-ID': 'local-default' } })).status)).toBe(404);
        expect(errors).toEqual([]);
    } finally { await browser?.close(); await admin.stop(true); registry.close(); identities.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}, 40000);
