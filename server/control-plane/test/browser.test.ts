import { expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createControlPlane } from '../service.js';
import { controlPlaneConfig } from '../config.js';
import { readAdminLlmSettings } from '../../gateway/admin/llm-settings.js';

test('full admin browser survives absent services and bootstraps after gateway recovery without reloading', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'control-plane-browser-'));
    const llm = await readAdminLlmSettings({ defaultConfigPath: join(import.meta.dir, '../../..', 'config/llm-runtime.json'),
        overrideConfigPath: join(temporary, 'missing.json'), apiKeyPath: join(temporary, 'no-secret.txt') }, {});
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unused') });
    const gatewayPort = reservation.port!, gatewayOrigin = reservation.url.origin; reservation.stop(true);
    const engineReservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unused') });
    const engineOrigin = engineReservation.url.origin; engineReservation.stop(true);
    const admin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane({ ...controlPlaneConfig(), gatewayOrigin, engineOrigin }) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined, gateway: ReturnType<typeof Bun.serve> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error))); await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(new URL('/admin/', admin.url).toString());
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
        expect((await fetch(new URL('/admin/', admin.url))).status).toBe(200); expect(errors).toEqual([]);
    } finally { await browser?.close(); gateway?.stop(true); admin.stop(true); await rm(temporary, { recursive: true, force: true }); }
}, 40000);
