import { expect, test } from 'bun:test';
import puppeteer from 'puppeteer';
import { IdentityStore } from '../identity-store.js';
import { ServerRegistry } from '../server-registry.js';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';

test('browser owner grants viewer access, viewer gets observation UI and another browser session can be revoked', async () => {
    const store = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:'), config = controlPlaneConfig({});
    const owner = await store.createAccount('security-owner', 'synthetic browser password');
    const guest = await store.createAccount('security-guest', 'synthetic guest password', owner.id); registry.ensureConfiguredLocal(config);
    const handler = createControlPlane(config, store, async url => {
        if (url.pathname === '/api/admin/simulation-clock') return Response.json({ clock: { simulationTime: '2026-01-01T00:00:00Z' } });
        if (url.pathname === '/api/admin/population-demographics') return Response.json({ report: { sections: { population: { value: { activeLivingMembers: 12, recordedMembers: 15 } } } } });
        return Response.json({ ok: true });
    }, registry);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
        const login = async (page: import('puppeteer').Page, username: string, password: string) => {
            await page.goto(new URL('/admin/login.html', admin.url).toString());
            await page.type('[name="username"]', username); await page.type('[name="password"]', password);
            await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        };
        await login(page, owner.username, 'synthetic browser password');
        await page.goto(new URL('/admin/account.html?serverId=local-default', admin.url).toString());
        await page.waitForSelector('#role-list select');
        await page.select('[aria-label="security-guest szerepköre"]', 'viewer');
        await page.evaluate(() => {
            const select = document.querySelector('[aria-label="security-guest szerepköre"]')!;
            (select.closest('li')!.querySelector('button') as HTMLButtonElement).click();
        });
        await page.waitForFunction(() => document.getElementById('account-message')!.textContent === 'A szerepkör frissült.');
        expect(store.role(guest.id)).toBe('viewer');
        const guestContext = await browser.createBrowserContext(), guestPage = await guestContext.newPage(); guestPage.on('pageerror', error => errors.push(String(error)));
        await login(guestPage, guest.username, 'synthetic guest password'); await guestPage.waitForSelector('.server-card');
        expect(await guestPage.$eval('.server-card', element => element.textContent)).toContain('Szerepkör: néző');
        await guestPage.click('.server-card a'); await guestPage.waitForSelector('#observation-population');
        await guestPage.waitForFunction(() => document.getElementById('observation-population')!.textContent!.includes('Élő tagok: 12'));
        await guestPage.setViewport({ width: 390, height: 844 });
        expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await guestPage.evaluate(async () => (await fetch('/api/admin/bots/x/spectate', { headers: { 'X-Control-Server-ID': 'local-default' } })).status)).toBe(403);
        const otherContext = await browser.createBrowserContext(), otherPage = await otherContext.newPage();
        await login(otherPage, owner.username, 'synthetic browser password');
        await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#session-list li').length === 2);
        await page.evaluate(() => {
            const row = Array.from(document.querySelectorAll('#session-list li')).find(element => element.textContent!.includes('Másik munkamenet'))!;
            (row.querySelector('button') as HTMLButtonElement).click();
        });
        await page.waitForFunction(() => document.querySelectorAll('#session-list li').length === 1);
        expect(await otherPage.evaluate(async () => (await fetch('/api/control-plane/session')).status)).toBe(401);
        store.setRole(owner.id, guest.id, 'local-default', null);
        await guestPage.click('#observation-refresh'); await guestPage.waitForFunction(() => document.getElementById('observation-message')!.textContent!.includes('nem érhető el ezzel'));
        expect(errors).toEqual([]);
    } finally { await browser?.close(); await admin.stop(true); registry.close(); store.close(); }
}, 30000);
