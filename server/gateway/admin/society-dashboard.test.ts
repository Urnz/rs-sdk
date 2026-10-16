import { expect, test } from 'bun:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { dashboardFixture } from '../../../society-metrics/test/dashboard-fixture.js';
import { handleAdminRequest } from './routes.js';
import type { BotSupervisor } from './supervisor.js';

const publicDirectory = join(import.meta.dir, 'public');
const html = readFileSync(join(publicDirectory, 'index.html'), 'utf8');
const panel = html.slice(html.indexOf('<section id="society-dashboard"'), html.indexOf('<section class="summary-grid"')).replace('data-admin-tab-panel="society" hidden', 'data-admin-tab-panel="society"');
async function waitForRequest(condition: () => boolean) {
    const until = Date.now() + 5000;
    while (!condition()) { if (Date.now() > until) throw new Error('Expected browser request did not arrive'); await Bun.sleep(10); }
}
async function browserFixture(hold: { filtered?: boolean; detail?: boolean } = {}) {
    const native = dashboardFixture(); native.addTrade();
    const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor,
        selfSufficiencySources: native.options.sources, dependencyGraphOptions: native.dependencies };
    const requests: Array<{ path: string; method: string }> = [];
    let releaseFilter!: () => void, releaseDetail!: () => void, heldDetail = false;
    const filterGate = new Promise<void>(resolve => { releaseFilter = resolve; }), detailGate = new Promise<void>(resolve => { releaseDetail = resolve; });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
        const url = new URL(req.url); requests.push({ path: url.pathname + url.search, method: req.method });
        if (url.pathname === '/') return new Response(`<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/admin/admin.css"><title>Társadalom dashboard – technikai próba</title></head><body><main>${panel}</main><script type="module" src="/boot.js"></script></body></html>`, {
            headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:" } });
        if (url.pathname === '/boot.js') return new Response(`import {mountSocietyDashboard} from '/admin/society-dashboard.js';
            const api = async (path, options) => { const response = await fetch(path, options); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; };
            mountSocietyDashboard(document.querySelector('#society-dashboard'), api).prepare();`, { headers: { 'Content-Type': 'text/javascript' } });
        if (url.pathname === '/api/admin/simulation-clock') return Response.json({ clock: { clockId: native.scope.clockId,
            profileDigest: native.scope.clockProfileDigest, lastSimulationTime: native.scope.toSimulationTime } });
        const response = await handleAdminRequest(req, url, context) ?? new Response('Not found', { status: 404 });
        if (hold.filtered && url.searchParams.get('agent') === 'bea' && !url.searchParams.has('business')) await filterGate;
        if (hold.detail && !heldDetail && url.pathname.includes('/dashboard/events/')) { heldDetail = true; await detailGate; }
        return response;
    } });
    let browser;
    try { browser = await puppeteer.launch({ headless: true, timeout: 20000 }); }
    catch (error) { server.stop(true); native.close(); throw error; }
    const page = await browser.newPage(), errors: string[] = [];
    const close = async () => { releaseFilter(); releaseDetail(); await browser.close(); server.stop(true); native.close(); };
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.text().includes('Content Security Policy')) errors.push(message.text()); });
    try {
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(server.url.toString());
        await page.waitForFunction(() => (document.querySelector('[name="clockId"]') as HTMLInputElement).value === 'world');
        await page.type('[name="actors"]', 'ada');
        await page.click('#society-scope button[type="submit"]');
        await page.waitForSelector('.society-objective');
        return { native, requests, page, errors, releaseFilter, releaseDetail, close };
    } catch (error) { await close(); throw error; }
}

test('native dashboard browser component filters, pages, drills into original receipts and renders untrusted names as text', async () => {
    const f = await browserFixture();
    try {
        const { page } = f;
        expect(await page.$$('.society-objective')).toHaveLength(10);
        expect(await page.$eval('#society-status', node => node.textContent)).toContain('Részleges');
        expect(await page.$eval('#society-events', node => node.textContent)).toContain('ismeretlen');
        await page.click('[data-society-metric="specialization/stage-hhi:ada"]');
        await page.waitForFunction(() => document.querySelector('#society-event-count')!.textContent!.startsWith('2 egyező'));
        await page.click('[data-society-event]'); await page.waitForSelector('#society-detail pre');
        expect(await page.$eval('#society-detail', node => node.textContent)).toContain('recordedActorAgentId');
        await page.click('[data-society-action="reset-filters"]');
        await page.waitForFunction(() => document.querySelector('#society-event-count')!.textContent!.startsWith('3 egyező'));
        await page.select('#society-filters [name="agent"]', 'bea');
        await page.waitForFunction(() => document.querySelector('#society-event-count')!.textContent!.startsWith('1 egyező'));
        await page.click('[data-society-event]'); await page.waitForSelector('#society-detail pre');
        expect(await page.$eval('#society-detail', node => node.textContent)).toContain('<img src=x onerror=');
        expect(await page.$('#society-detail img')).toBeNull(); expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
        await page.click('[data-society-action="reset-filters"]');
        await page.waitForFunction(() => document.querySelector('#society-event-count')!.textContent!.startsWith('3 egyező'));
        await page.select('#society-filters [name="limit"]', '1');
        await page.waitForFunction(() => document.querySelectorAll('#society-events tr').length === 1 && !(document.querySelector('[data-society-action="next"]') as HTMLButtonElement).disabled);
        const first = await page.$eval('[data-society-event]', node => (node as HTMLElement).dataset.societyEvent);
        await page.click('[data-society-action="next"]');
        await page.waitForFunction(id => (document.querySelector('[data-society-event]') as HTMLElement)?.dataset.societyEvent !== id, {}, first);
        await page.click('[data-society-action="previous"]');
        await page.waitForFunction(id => (document.querySelector('[data-society-event]') as HTMLElement)?.dataset.societyEvent === id, {}, first);
        expect(f.requests.filter(req => req.path.startsWith('/api/admin/society/')).every(req => req.method === 'GET')).toBeTrue();
        expect(f.errors).toEqual([]);
        // Retain a real rendered view for visual QA, without running an engine or bot.
        await page.click('[data-society-action="reset-filters"]');
        await page.waitForFunction(() => document.querySelectorAll('#society-events tr').length === 3);
        const output = join(import.meta.dir, '../../../.local/verification'); mkdirSync(output, { recursive: true });
        await page.screenshot({ path: join(output, 'phase24-10-dashboard-desktop.png'), fullPage: true });
        await page.setViewport({ width: 390, height: 844 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBeFalse();
        await page.screenshot({ path: join(output, 'phase24-10-dashboard-mobile.png'), fullPage: true });
    } finally { await f.close(); }
}, 60000);

test('browser discards detail when native backing changes, and scope edits invalidate old values', async () => {
    const f = await browserFixture();
    try {
        await f.page.click('[data-society-event]'); await f.page.waitForSelector('#society-detail pre');
        f.native.addTrade(4);
        await f.page.click('[data-society-event]');
        await f.page.waitForFunction(() => document.querySelector('#society-status')!.textContent!.includes('megváltozott'));
        expect(await f.page.$$('.society-objective')).toHaveLength(0);
        expect(await f.page.$eval('#society-detail', node => (node as HTMLElement).hidden)).toBeTrue();
        await f.page.click('#society-scope button[type="submit"]'); await f.page.waitForSelector('.society-objective');
        await f.page.type('[name="actors"]', ', bea');
        expect(await f.page.$$('.society-objective')).toHaveLength(0);
        expect(await f.page.$eval('#society-status', node => node.textContent)).toContain('feltételek megváltoztak');
        expect(f.errors).toEqual([]);
    } finally { await f.close(); }
}, 60000);

test('late filter and detail responses cannot overwrite the most recent browser selection', async () => {
    const f = await browserFixture({ filtered: true, detail: true });
    try {
        const { page } = f;
        await page.select('#society-filters [name="agent"]', 'bea');
        await waitForRequest(() => f.requests.some(row => row.path.includes('agent=bea')));
        await page.select('#society-filters [name="business"]', 'forge');
        await page.waitForFunction(() => document.querySelector('#society-event-count')!.textContent!.startsWith('0 egyező'));
        f.releaseFilter(); await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(await page.$eval('#society-event-count', node => node.textContent)).toContain('0 egyező');
        await page.click('[data-society-action="reset-filters"]');
        await page.waitForFunction(() => document.querySelectorAll('#society-events [data-society-event]').length === 3);
        const buttons = await page.$$('[data-society-event]');
        await buttons[0]!.click();
        await waitForRequest(() => f.requests.filter(row => row.path.includes('/dashboard/events/')).length === 1);
        const secondId = await buttons[1]!.evaluate(node => (node as HTMLElement).dataset.societyEvent!);
        const secondRecord = f.native.read().events.find(row => row.id === secondId)!.recordId;
        await buttons[1]!.click();
        await page.waitForFunction(id => document.querySelector('#society-detail')!.textContent!.includes(id), {}, secondRecord);
        f.releaseDetail(); await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(await page.$eval('#society-detail', node => node.textContent)).toContain(secondRecord);
        expect(f.errors).toEqual([]);
    } finally { await f.close(); }
}, 60000);
