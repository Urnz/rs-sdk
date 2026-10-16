import { expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';
import { readAdminLlmSettings } from '../../gateway/admin/llm-settings.js';
import { IdentityStore } from '../identity-store.js';

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
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane({ ...controlPlaneConfig(), gatewayOrigin, engineOrigin }, identities) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined, gateway: ReturnType<typeof Bun.serve> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error))); await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(new URL('/admin/', admin.url).toString());
        expect(new URL(page.url()).pathname).toBe('/admin/login.html');
        await page.type('[name="username"]', 'browser-owner'); await page.type('[name="password"]', 'synthetic browser password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('#connection-status[data-gateway="unavailable"][data-engine="unavailable"]');
        expect(await page.$eval('h1', element => element.textContent)).toBe('Bot adminisztráció');
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
    } finally { await browser?.close(); gateway?.stop(true); admin.stop(true); identities.close(); await rm(temporary, { recursive: true, force: true }); }
}, 40000);

test('owner can create an account, grant/revoke access, and a non-owner can log in without backend privileges', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-account-ui-'));
    const identities = new IdentityStore(join(temporary, 'identity.sqlite'));
    await identities.createAccount('ui-owner', 'synthetic owner password');
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(controlPlaneConfig(), identities, async () => { throw new Error('fixture backend absent'); }) });
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
        await waitOwnership(false); await toggleGuest(); await waitOwnership(true); await toggleGuest(); await waitOwnership(false);
        await page.setViewport({ width: 1024, height: 1000 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase25-2-owner-accounts.png'), fullPage: true });
        expect((await page.cookies()).find(cookie => cookie.name === 'rs-control-session')?.httpOnly).toBe(true);
        await Promise.all([page.waitForNavigation(), page.click('#logout-button')]);
        await page.type('[name="username"]', 'ui-guest'); await page.type('[name="password"]', 'synthetic guest password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.waitForSelector('#account-content:not([hidden])');
        expect(await page.$eval('#owner-management', element => (element as HTMLElement).hidden)).toBe(true);
        expect(await page.evaluate(async () => (await fetch('/api/admin/config')).status)).toBe(403);
        expect(errors).toEqual([]);
    } finally { await browser?.close(); admin.stop(true); identities.close(); await rm(temporary, { recursive: true, force: true }); }
}, 40000);
