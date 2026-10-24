import { expect, test } from 'bun:test';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createControlPlane } from '../../control-plane/service.js';
import { controlPlaneConfig } from '../../control-plane/config.js';
import { IdentityStore } from '../../control-plane/identity-store.js';
import { ServerRegistry } from '../../control-plane/server-registry.js';

test('LLM form waits for its settings, recovers independently and preserves edits during unrelated bootstrap retries', async () => {
    const identities = new IdentityStore(':memory:'), registry = new ServerRegistry(':memory:');
    const owner = await identities.createAccount('settings-owner', 'synthetic settings password');
    const config = controlPlaneConfig({}); registry.ensureConfiguredLocal(config);
    const llm = JSON.parse(await Bun.file(join(import.meta.dir, '../../../config/llm-runtime.json')).text());
    let available = false;
    const defaults = { records: [], gaps: [], trials: [], templates: [], cycles: [], outbox: [] };
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createControlPlane(config, identities, async url => {
        if (url.pathname === '/api/admin/llm-settings') return available
            ? Response.json({ config: llm, source: 'project-default', apiKey: { configured: false, source: 'none' } })
            : Response.json({ error: 'Gateway unavailable' }, { status: 503 });
        if (url.pathname === '/api/admin/skills') return Response.json({ error: 'Unrelated catalog failure' }, { status: 503 });
        return Response.json(defaults);
    }, registry) });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage();
        await page.goto(new URL('/admin/', server.url).toString());
        await page.type('[name="username"]', owner.username); await page.type('[name="password"]', 'synthetic settings password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        await page.goto(new URL('/admin/index.html?serverId=local-default#llm', server.url).toString());
        await page.waitForFunction(() => document.querySelector('#llm-config-status')!.textContent!.includes('nem tölthetők be'));
        expect(await page.$eval('#llm-settings-form', el => (el as HTMLFormElement).inert)).toBe(true);
        expect(await page.$eval('#save-llm-settings', el => (el as HTMLButtonElement).disabled)).toBe(true);
        available = true;
        await page.click('#reload-llm-settings');
        await page.waitForFunction(() => !(document.querySelector('#llm-settings-form') as HTMLFormElement).inert);
        expect(await page.$eval('[name="autonomousMaxOperations"]', el => (el as HTMLInputElement).value)).toBe('100');
        expect(await page.$eval('[name="plannerPrompt"]', el => (el as HTMLTextAreaElement).value.length)).toBeGreaterThan(10);
        await page.$eval('[name="model"]', el => { (el as HTMLInputElement).value = 'unsaved-model'; });
        await page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/skills', { timeout: 12000 });
        expect(await page.$eval('[name="model"]', el => (el as HTMLInputElement).value)).toBe('unsaved-model');
        expect(await page.$eval('#save-llm-settings', el => (el as HTMLButtonElement).disabled)).toBe(false);
    } finally { await browser?.close(); await server.stop(true); registry.close(); identities.close(); }
}, 30000);
