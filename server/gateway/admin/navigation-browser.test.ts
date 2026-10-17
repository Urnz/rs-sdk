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
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        expect(await page.$eval('#skill-trial-list', element => element.closest('[data-admin-tab-panel]')!.getAttribute('data-admin-tab-panel'))).toBe('skills');
        expect(reads).toContain('/api/admin/businesses'); expect(reads).toContain('/api/admin/economic-contracts');
        expect(writes).toEqual([]);
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
        await page.click('#admin-navigation [data-tab="overview"]'); await page.waitForSelector('#workflow-cards', { visible: true });
        await page.goto(new URL('/admin/index.html?serverId=local-default#unknown', admin.url).toString());
        await page.waitForFunction(() => location.hash === '#overview');
        expect(await page.$eval('#admin-view-title', element => element.textContent)).toBe('Áttekintés');
        expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await browser?.close(); await admin.stop(true); registry.close(); identities.close(); }
}, 40000);
