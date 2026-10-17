import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createControlPlane } from '../../control-plane/service.js';
import { controlPlaneConfig } from '../../control-plane/config.js';
import { IdentityStore } from '../../control-plane/identity-store.js';
import { ServerRegistry } from '../../control-plane/server-registry.js';

test('owner workflows stay discoverable, correctly grouped and server-bound across navigation, reload and mobile', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:');
    const owner = await identities.createAccount('navigation-owner', 'synthetic navigation password');
    const config = controlPlaneConfig({}); registry.ensureConfiguredLocal(config);
    const llm = JSON.parse(await Bun.file(join(import.meta.dir, '../../../config/llm-runtime.json')).text());
    let offline = false;
    const reads: string[] = [], writes: string[] = [];
    const defaults = { skills: [], destinations: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
        bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], offers: [], contracts: [], businesses: [], backups: [],
        generatedAt: new Date().toISOString(), economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async (url, init) => {
        if (offline) return Response.json({ error: 'A tesztvilág leállt.' }, { status: 503 });
        if (url.pathname.startsWith('/api/admin/')) {
            expect(new Headers(init.headers).get('X-Control-Server-ID')).toBe('local-default');
            if (init.method && init.method !== 'GET') writes.push(url.pathname); else reads.push(url.pathname);
        }
        if (url.pathname === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 60000, worldMapUrl: config.engineOrigin + '/mapview/' });
        if (url.pathname === '/api/admin/llm-settings') return Response.json({ config: llm, source: 'project-default', apiKey: { configured: false, source: 'none' } });
        if (url.pathname === '/api/admin/world-mods') return Response.json({ revision: 0, mods: [] });
        if (url.pathname === '/api/admin/properties') return Response.json({ enabled: false, properties: [], pendingPurchases: [] });
        return Response.json(defaults);
    }, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(new URL('/admin/', admin.url).toString());
        await page.type('[name="username"]', owner.username); await page.type('[name="password"]', 'synthetic navigation password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('.server-card a');
        await Promise.all([page.waitForNavigation(), page.click('.server-card a')]);
        await page.waitForFunction(() => document.querySelector('#last-refresh')!.textContent!.startsWith('Frissítve:'));
        expect(new URL(page.url()).hash).toBe('#overview');
        expect(await page.$$('.navigation-group')).toHaveLength(4);
        expect(await page.$$('#workflow-cards a')).toHaveLength(12);
        await page.waitForSelector('[data-workflow-guide="context"] summary');
        expect(await page.$eval('.workflow-help', element => (element as HTMLDetailsElement).open)).toBe(false);
        await page.focus('[data-workflow-guide="context"] summary'); await page.keyboard.press('Enter');
        expect(await page.$eval('.workflow-help', element => (element as HTMLDetailsElement).open)).toBe(true);
        // Actual workflow destinations, not just a list of renamed navigation items.
        const destinations = {
            bots: '#new-bot-button', agents: '#llm-replan-list', map: '#world-map-button', economy: '#item-stock',
            businesses: '#business-form', contracts: '#economic-offer-form', society: '#society-scope', skills: '#capability-gap-list',
            experiments: '#multi-agent-experiment-form', world: '#world-admin-button', 'world-events': '#world-director-config-form', llm: '#llm-settings-form'
        };
        for (const [view, selector] of Object.entries(destinations)) {
            await page.click(`#admin-navigation [data-tab="${view}"]`);
            await page.waitForSelector(selector, { visible: true });
            expect(new URL(page.url()).searchParams.getAll('serverId')).toEqual(['local-default']);
            expect(await page.$eval('#admin-view-title', element => document.activeElement === element)).toBe(true);
            expect(await page.$eval('#admin-view-description', element => element.textContent!.length)).toBeGreaterThan(40);
            expect(await page.evaluate(selected => Array.from(document.querySelectorAll<HTMLElement>('[data-admin-tab-panel]'))
                .filter(panel => !panel.hidden).every(panel => panel.dataset.adminTabPanel === selected), view)).toBe(true);
            expect(await page.$eval('#admin-navigation [aria-current="page"]', element => (element as HTMLElement).dataset.tab)).toBe(view);
            await page.waitForFunction(value => document.querySelector<HTMLElement>('[data-workflow-guide="context"]')!.dataset.guide === value, {}, view);
            expect(await page.$eval('.workflow-help', element => (element as HTMLDetailsElement).open)).toBe(true);
            expect(await page.$$('.workflow-help ol li').then(items => items.length)).toBeGreaterThanOrEqual(2);
            expect(await page.$eval('.workflow-help', element => element.textContent)).toContain('Ha elakadnál');
            expect(await page.$$eval('.workflow-help a', links => links.every(link => new URL((link as HTMLAnchorElement).href).searchParams.get('serverId') === 'local-default'))).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        expect(await page.$eval('#skill-trial-list', element => element.closest('[data-admin-tab-panel]')!.getAttribute('data-admin-tab-panel'))).toBe('skills');
        expect(reads).toContain('/api/admin/businesses'); expect(reads).toContain('/api/admin/economic-contracts');
        expect(writes).toEqual([]);
        // Every local field explanation is an actual description, not part of its label.
        expect(await page.$$('[aria-describedby*="workflow-hint-"]')).toHaveLength(18);
        expect(await page.$$eval('[aria-describedby*="workflow-hint-"]', fields => fields.every(field => {
            const ids = field.getAttribute('aria-describedby')!.split(/\s+/);
            return ids.every(id => Boolean(document.getElementById(id)))
                && !field.closest('label')!.querySelector('.workflow-field-hint');
        }))).toBe(true);
        await page.$eval('#multi-agent-experiment-form [name="seed"]', element => { (element as HTMLInputElement).value = 'Retained seed'; });
        await page.click('#admin-navigation [data-tab="experiments"]');
        await page.click('.workflow-help summary'); await page.click('.workflow-help summary');
        expect(await page.$eval('#multi-agent-experiment-form [name="seed"]', element => (element as HTMLInputElement).value)).toBe('Retained seed');
        await page.click('.workflow-help a[href$="#agents"]');
        await page.waitForSelector('[data-guide="agents"]');
        expect(new URL(page.url()).searchParams.getAll('serverId')).toEqual(['local-default']);
        await page.focus('#admin-navigation [data-tab="skills"]'); await page.keyboard.press('Enter');
        await page.waitForSelector('#capability-gap-list', { visible: true });
        await page.focus('.skip-navigation'); await page.keyboard.press('Enter');
        expect(new URL(page.url()).hash).toBe('#skills');
        expect(await page.$eval('#admin-view-title', element => document.activeElement === element)).toBe(true);
        await page.click('#admin-navigation [data-tab="bots"]'); await page.click('#new-bot-button');
        expect(await page.$eval('#spawn-dialog', element => (element as HTMLDialogElement).open)).toBe(true);
        await page.keyboard.press('Escape');
        await page.click('#admin-navigation [data-tab="experiments"]'); await page.click('#snapshot-button');
        expect(await page.$eval('#snapshot-dialog', element => (element as HTMLDialogElement).open)).toBe(true);
        await page.keyboard.press('Escape');
        await page.click('#admin-navigation [data-tab="world"]'); await page.click('#world-admin-button');
        await page.waitForSelector('#world-admin-dialog[open]'); await page.keyboard.press('Escape');
        await page.goBack();
        await page.waitForSelector('[data-admin-tab-panel="experiments"]', { visible: true });
        await page.goForward();
        await page.waitForSelector('[data-admin-tab-panel="world"]', { visible: true });
        await page.goto(new URL('/admin/index.html?serverId=local-default#contracts', admin.url).toString());
        await page.waitForSelector('#economic-offer-form', { visible: true });
        await page.reload(); await page.waitForSelector('#economic-offer-form', { visible: true });
        await page.setViewport({ width: 390, height: 844 });
        await page.select('#admin-view-select', 'experiments'); await page.waitForSelector('#multi-agent-experiment-form', { visible: true });
        await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-workflow-guide="context"]')!.dataset.guide === 'experiments');
        await page.$eval('.workflow-help', element => { (element as HTMLDetailsElement).open = true; element.scrollIntoView(); });
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-5-help-mobile.png') });
        await page.$eval('#experiment-parameter-profile-form [name="version"]', element => element.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-5-fields-mobile.png') });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.$eval('.workflow-help', element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-5-help-desktop.png') });
        await page.setViewport({ width: 390, height: 844 });
        await page.select('#admin-view-select', 'overview'); await page.waitForSelector('#workflow-cards', { visible: true });
        // Overview links work through the same navigation and keep the selected server.
        await page.click('#workflow-cards a[href="#businesses"]'); await page.waitForSelector('#business-form', { visible: true });
        expect(await page.$eval('#admin-view-select', element => (element as HTMLSelectElement).value)).toBe('businesses');
        for (const view of ['overview', ...Object.keys(destinations)]) {
            await page.select('#admin-view-select', view);
            await page.waitForFunction(value => location.hash === `#${value}` && Array.from(document.querySelectorAll<HTMLElement>('[data-admin-tab-panel]'))
                .filter(panel => !panel.hidden).every(panel => panel.dataset.adminTabPanel === value), {}, view);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.select('#admin-view-select', 'overview'); await page.waitForSelector('#workflow-cards', { visible: true });
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-1-mobile.png'), fullPage: true });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-1-desktop.png'), fullPage: true });
        // Navigation and explanations remain available even when the game backend cannot bootstrap.
        offline = true;
        await page.goto(new URL('/admin/index.html?serverId=local-default#businesses', admin.url).toString());
        await page.reload();
        await page.waitForSelector('#business-form', { visible: true });
        await page.waitForFunction(() => document.querySelector('#last-refresh')!.textContent!.startsWith('Kapcsolatra vár:'));
        await page.waitForSelector('[data-guide="businesses"] summary');
        await page.click('[data-guide="businesses"] summary');
        expect(await page.$eval('.workflow-help', element => element.textContent)).toContain('Létrehozása önmagában nem indít');
        await page.click('#admin-navigation [data-tab="overview"]'); await page.waitForSelector('#workflow-cards', { visible: true });
        await page.goto(new URL('/admin/index.html?serverId=local-default#unknown', admin.url).toString());
        await page.waitForFunction(() => location.hash === '#overview');
        expect(await page.$eval('#admin-view-title', element => element.textContent)).toBe('Áttekintés');
        // The same local help is available on control-plane pages without the game backend.
        await page.goto(new URL('/admin/servers.html?serverId=local-default', admin.url).toString());
        await page.waitForSelector('[data-guide="servers"] summary');
        await page.focus('[data-guide="servers"] summary'); await page.keyboard.press('Enter');
        expect(await page.$eval('.workflow-help', element => element.textContent)).toContain('nincs visszaaktiválás');
        await page.click('.workflow-help a');
        await page.waitForSelector('[data-guide="account"] summary');
        expect(new URL(page.url()).searchParams.get('serverId')).toBe('local-default');
        await page.waitForSelector('#password-form [aria-describedby*="workflow-hint-"]');
        await page.click('[data-guide="account"] summary');
        expect(await page.$eval('.workflow-help', element => element.textContent)).toContain('alapértelmezett szerver tulajdonosa');
        const viewer = await identities.createAccount('guide-viewer', 'synthetic guide viewer password', owner.id);
        identities.setRole(owner.id, viewer.id, 'local-default', 'viewer');
        const viewerContext = await browser.createBrowserContext();
        try {
            const viewerPage = await viewerContext.newPage(); viewerPage.on('pageerror', error => errors.push(String(error)));
            await viewerPage.goto(new URL('/admin/login.html', admin.url).toString());
            await viewerPage.type('[name="username"]', viewer.username); await viewerPage.type('[name="password"]', 'synthetic guide viewer password');
            await Promise.all([viewerPage.waitForNavigation(), viewerPage.click('#login-form button')]);
            await viewerPage.goto(new URL('/admin/index.html?serverId=local-default', admin.url).toString());
            await viewerPage.waitForSelector('[data-guide="observations"] summary');
            await viewerPage.click('[data-guide="observations"] summary');
            expect(await viewerPage.$eval('.workflow-help', element => element.textContent)).toContain('megfigyelőként');
            expect(await viewerPage.$$('#multi-agent-experiment-form')).toHaveLength(0);
        } finally { await viewerContext.close(); }
        expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await browser?.close(); await admin.stop(true); registry.close(); identities.close(); }
}, 40000);
