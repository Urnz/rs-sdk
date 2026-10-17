import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createControlPlane } from '../../control-plane/service.js';
import { controlPlaneConfig } from '../../control-plane/config.js';
import { IdentityStore } from '../../control-plane/identity-store.js';
import { ServerRegistry } from '../../control-plane/server-registry.js';

test('real admin mutations wait for review; cancellation, secret masking, safe text, context changes and failed guide loads never send the request', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:'), config = controlPlaneConfig({});
    const owner = await identities.createAccount('review-owner', 'synthetic review owner password'); registry.ensureConfiguredLocal(config);
    const llm = JSON.parse(await Bun.file(join(import.meta.dir, '../../../config/llm-runtime.json')).text());
    const defaults = { skills: [], destinations: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [], records: [], experiments: [], drafts: [], profiles: [],
        bots: [], runs: [], events: [], players: [], agents: [], grants: [], learningEvents: [], snapshots: [], offers: [], contracts: [], businesses: [], backups: [],
        generatedAt: new Date().toISOString(), economy: { bots: 0, online: 0, totalCoins: 0, totalXp: 0, averageTotalLevel: 0, itemStock: [] } };
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    const app = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async (url, init) => {
        if (init.method && init.method !== 'GET') { writes.push({ path: url.pathname, body: await new Response(init.body).json() }); return Response.json({ ok: true }); }
        if (url.pathname === '/api/admin/config') return Response.json({ authMode: 'local', refreshMs: 60000, worldMapUrl: config.engineOrigin + '/mapview/' });
        if (url.pathname === '/api/admin/llm-settings') return Response.json({ config: llm, source: 'project-default', apiKey: { configured: false, source: 'none' } });
        return Response.json(defaults);
    }, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(), errors: string[] = [];
        await page.setViewport({ width: 1440, height: 1000 });
        page.on('pageerror', error => errors.push(String(error)));
        await page.goto(new URL('/admin/login.html', app.url).toString());
        await page.type('[name="username"]', owner.username); await page.type('[name="password"]', 'synthetic review owner password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.goto(new URL('/admin/index.html?serverId=local-default#bots', app.url).toString());
        await page.waitForFunction(() => document.getElementById('last-refresh')!.textContent!.startsWith('Frissítve:'));
        await page.click('#new-bot-button'); await page.type('#spawn-form [name="username"]', 'Reviewbot');
        await page.type('#spawn-form [name="password"]', 'synthetic hidden bot password');
        await page.click('#spawn-form button[value="submit"]'); await page.waitForSelector('#operation-review[open]');
        expect(writes).toHaveLength(0);
        expect(await page.$eval('#operation-review', element => element.textContent)).not.toContain('synthetic hidden bot password');
        expect(await page.$eval('[data-review-cancel]', element => document.activeElement === element)).toBe(true);
        expect(await page.$eval('#operation-review', element => element.textContent)).toContain('Reviewbot');
        await page.click('[data-review-cancel]'); await page.waitForSelector('#operation-review', { hidden: true });
        expect(writes).toHaveLength(0); expect(await page.$eval('#spawn-dialog', element => (element as HTMLDialogElement).open)).toBe(true);
        expect(await page.$eval('#spawn-form [name="password"]', element => (element as HTMLInputElement).value)).toBe('synthetic hidden bot password');
        await page.click('#spawn-form button[value="submit"]'); await page.waitForSelector('#operation-review[open]');
        await page.evaluate(() => { const button = document.querySelector<HTMLButtonElement>('[data-review-approve]')!; button.click(); button.click(); });
        await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#spawn-dialog')!.open);
        expect(writes).toHaveLength(1); expect(writes[0]!.path).toBe('/api/admin/bots/spawn');
        expect(writes[0]!.body.password).toBe('synthetic hidden bot password');

        // A cancelled experiment must also release its button without an unhandled promise.
        await page.click('#admin-navigation [data-tab="experiments"]');
        await page.evaluate(() => {
            const form = document.querySelector<HTMLFormElement>('#multi-agent-experiment-form')!;
            const profiles = form.elements.namedItem('parameterProfile') as HTMLSelectElement;
            profiles.replaceChildren(new Option('Fixture profile', 'fixture@1.0.0')); profiles.value = 'fixture@1.0.0';
            const candidates = document.getElementById('multi-agent-candidate-list')!;
            for (const value of ['fixture-a', 'fixture-b']) {
                const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'experimentAgentId'; input.value = value; input.checked = true; candidates.append(input);
            }
            form.requestSubmit();
        });
        await page.waitForSelector('#operation-review[open]'); expect(writes).toHaveLength(1);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !(document.getElementById('start-multi-agent-experiment') as HTMLButtonElement).disabled);
        expect(writes).toHaveLength(1);
        await page.click('#admin-navigation [data-tab="bots"]');

        const openReview = async (path: string, body: Record<string, unknown>) => {
            await page.evaluate(async ({ path, body }) => {
                const modulePath = '/admin/operation-review.js';
                const module = await import(modulePath);
                const holder = window as unknown as { reviewResult: string };
                holder.reviewResult = 'pending';
                void module.reviewMutation(path, 'POST', body).then(() => { holder.reviewResult = 'approved'; })
                    .catch((error: { code: string }) => { holder.reviewResult = error.code; });
            }, { path, body });
            await page.waitForSelector('#operation-review[open]');
        };
        await openReview('/api/admin/properties/reconcile', { transactionId: '<img src=x onerror=alert(1)>', resolution: 'commit-debited', reason: 'Verified fixture', password: 'hidden-password', apiKey: 'hidden-api-key' });
        const reviewText = await page.$eval('#operation-review', element => element.textContent!);
        expect(reviewText).toContain('Új pénzlevonás nincs'); expect(reviewText).not.toContain('hidden-password'); expect(reviewText).not.toContain('hidden-api-key');
        expect(await page.$$('#operation-review img')).toHaveLength(0);
        await page.keyboard.press('Escape');
        await openReview('/api/admin/agents/fixture-a/episodes/prune', { reason: 'Elévült, nem hivatkozott emlékek rendezése' });
        const concurrent = await page.evaluate(async () => {
            const modulePath = '/admin/operation-review.js'; const module = await import(modulePath);
            try { await module.reviewMutation('/api/admin/bots/spawn', 'POST', { username: 'Other' }); return 'unexpected'; }
            catch (error) { return (error as { code: string }).code; }
        });
        expect(concurrent).toBe('REVIEW_NOT_SENT'); expect(await page.$$('#operation-review[open]')).toHaveLength(1);
        await page.setViewport({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await mkdir(join(import.meta.dir, '../../../.local/verification'), { recursive: true });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-3-review-mobile.png') });
        await page.setViewport({ width: 1440, height: 1100 });
        await page.screenshot({ path: join(import.meta.dir, '../../../.local/verification/phase26-3-review-desktop.png') });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => (window as unknown as { reviewResult: string }).reviewResult === 'REVIEW_CANCELLED');
        expect(writes).toHaveLength(1);
        await openReview('/api/admin/skill-trials/00000000-0000-0000-0000-000000000000/run', { reason: 'Context fixture' });
        await page.evaluate(() => history.replaceState(null, '', '/admin/index.html?serverId=other-world#bots'));
        await page.click('[data-review-approve]');
        await page.waitForFunction(() => (window as unknown as { reviewResult: string }).reviewResult === 'REVIEW_NOT_SENT');
        expect(writes).toHaveLength(1);

        let fail = true;
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (fail && request.url().endsWith('/capability-matrix.v1.json')) void request.respond({ status: 503, body: '{}' });
            else void request.continue();
        });
        await page.goto(new URL('/admin/index.html?serverId=local-default#bots', app.url).toString());
        await page.waitForFunction(() => document.getElementById('last-refresh')!.textContent!.startsWith('Frissítve:'));
        await page.click('#new-bot-button'); await page.type('#spawn-form [name="username"]', 'Reviewbot');
        await page.type('#spawn-form [name="password"]', 'synthetic hidden bot password');
        await page.click('#spawn-form button[value="submit"]');
        await page.waitForFunction(() => document.getElementById('toast')!.textContent!.includes('A műveleti magyarázat nem tölthető be'));
        expect(writes).toHaveLength(1); expect(await page.$$('#operation-review')).toHaveLength(0);
        fail = false; await page.click('#spawn-form button[value="submit"]'); await page.waitForSelector('#operation-review[open]');
        await page.keyboard.press('Escape'); expect(writes).toHaveLength(1); expect(errors).toEqual([]);
    } finally { await browser?.close(); await app.stop(true); registry.close(); identities.close(); }
}, 30000);
