import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';

export interface FixtureReady {
    url: string; root: string;
    paths: { profiles: string; llm: string; director: string; audit: string; modManifest: string; modState: string; modBackups: string };
    publication?: { trialId: string; reportPath: string; skillPath: string; failedTrialId: string };
}
export async function adminWorkflowFixture(scenario = 'default') {
    const root = await mkdtemp(join(tmpdir(), 'rs-admin-contract-'));
    const environment: Record<string, string> = { RS_ADMIN_WORKFLOW_ROOT: root, RS_ADMIN_WORKFLOW_SCENARIO: scenario };
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC'])
        if (process.env[key]) environment[key] = process.env[key]!;
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'test-fixtures/workflow-server.ts')],
        { env: environment, stdout: 'pipe', stderr: 'pipe' });
    const stderr = new Response(child.stderr).text(), reader = child.stdout.getReader();
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    const close = async () => {
        try { await browser?.close(); }
        finally {
            child.kill(); await child.exited; await stderr;
            // Every recursive cleanup is restricted to the mkdtemp prefix, never the checkout.
            const target = resolve(root), temporary = resolve(tmpdir());
            if (!target.startsWith(temporary + sep + 'rs-admin-contract-')) throw new Error('Unsafe fixture cleanup path');
            await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        }
    };
    try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Isolated workflow API did not start')), 15000);
        })]).finally(() => clearTimeout(timeout));
        if (chunk.done) throw new Error('Isolated workflow API exited before readiness');
        const ready = JSON.parse(new TextDecoder().decode(chunk.value).trim()) as FixtureReady;
        if (ready.root !== root) throw new Error('Fixture isolation root mismatch');
        for (const path of [...Object.values(ready.paths), ...Object.values(ready.publication || {}).filter(value => value.includes(sep))])
            if (!resolve(path).startsWith(resolve(root) + sep)) throw new Error('Fixture exposed a path outside its temporary root');
        browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        await page.setViewport({ width: 1440, height: 1000 });
        const errors: string[] = [], writes: { method: string; path: string; body: Record<string, any> }[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('dialog', dialog => { void dialog.accept('Synthetic workflow contract reason'); });
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith('/api/admin/') && !['GET', 'HEAD'].includes(request.method()))
                writes.push({ method: request.method(), path, body: JSON.parse(request.postData() || '{}') });
        });
        await page.goto(ready.url + '/admin/login.html');
        await page.type('[name="username"]', 'contract-owner'); await page.type('[name="password"]', 'synthetic contract owner password');
        await Promise.all([page.waitForNavigation(), page.click('#login-form button')]);
        return { ...ready, page, errors, writes, close };
    } catch (error) {
        child.kill(); await child.exited; const details = await stderr; await close();
        throw new Error(`${error}\nFixture stderr: ${details}`);
    }
}
export async function openWorkflow(page: Page, url: string, view: string) {
    const target = `${url}/admin/index.html?serverId=local-default#${view}`;
    if (page.url() === target) await page.reload(); else await page.goto(target);
    try { await page.waitForFunction(() => document.querySelector('#last-refresh')!.textContent!.startsWith('Frissítve:')); }
    catch (error) {
        const status = await page.$eval('#last-refresh', element => element.textContent);
        throw new Error(`Workflow ${view} did not load: ${status}; ${error}`);
    }
}
export async function fields(page: Page, formId: string, values: Record<string, string | boolean>) {
    await page.evaluate(({ formId, values }) => {
        const form = document.getElementById(formId) as HTMLFormElement;
        for (const [name, value] of Object.entries(values)) {
            const input = form.elements.namedItem(name) as HTMLInputElement;
            if (typeof value === 'boolean') input.checked = value; else input.value = value;
        }
    }, { formId, values });
}
