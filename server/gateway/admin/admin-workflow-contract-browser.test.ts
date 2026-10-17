import { expect, test } from 'bun:test';
import type { HTTPRequest } from 'puppeteer';
import { adminWorkflowFixture, fields, openWorkflow } from './test-workflow-fixture.js';
import { approveOperation } from './test-review-helper.js';
import { WorldDirectorStore } from './world-director-runtime.js';
import { updateWorldMod } from './world-mods.js';

test('profile UI crosses the real API: loading, empty, invalid JSON, durable success and immutable-version rejection', async () => {
    const fixture = await adminWorkflowFixture(); const { page } = fixture;
    const held: HTTPRequest[] = []; let hold = true;
    try {
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (hold && new URL(request.url()).pathname === '/api/admin/experiment-parameter-profiles') held.push(request);
            else void request.continue();
        });
        await page.goto(`${fixture.url}/admin/index.html?serverId=local-default#experiments`);
        await page.waitForSelector('[data-guide="experiments"]');
        expect(await page.$eval('#experiment-parameter-profile-list', element => element.textContent)).toContain('Betöltés');
        hold = false; expect(held.length).toBeGreaterThan(0); await Promise.all(held.map(request => request.continue()));
        await page.waitForFunction(() => document.getElementById('last-refresh')!.textContent!.startsWith('Frissítve:'));
        expect(await page.$eval('#experiment-parameter-profile-list', element => element.textContent)).toContain('Még nincs paraméterprofil');
        await fields(page, 'experiment-parameter-profile-form', { parameters: '{ broken JSON' });
        await page.click('#experiment-parameter-profile-form button[type="submit"]');
        await page.waitForFunction(() => document.getElementById('toast')!.textContent!.includes('nem érvényes JSON'));
        expect(fixture.writes).toHaveLength(0);
        const parameters = { respawns: [{ targetKey: 'loc:2090', ticks: 100 }], xpRewards: [], marketPrices: [], finishedProducts: [] };
        await fields(page, 'experiment-parameter-profile-form', { profileId: 'contract.profile', label: 'Contract profile', parameters: JSON.stringify(parameters) });
        const created = page.waitForResponse(response => response.url().endsWith('/api/admin/experiment-parameter-profiles') && response.request().method() === 'POST');
        await page.click('#experiment-parameter-profile-form button[type="submit"]');
        const response = await created; expect(response.status()).toBe(201);
        const { profile } = await response.json(); expect(profile.parameters).toEqual(parameters); expect(profile.digest).toMatch(/^[a-f0-9]{64}$/);
        await page.waitForFunction(() => document.getElementById('experiment-parameter-profile-list')!.textContent!.includes('Contract profile'));
        expect(fixture.writes[0]!.body).toMatchObject({ profileId: 'contract.profile', version: '1.0.0', parameters, origin: 'manual' });
        await fields(page, 'experiment-parameter-profile-form', { label: 'Changed immutable version' });
        const rejected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/experiment-parameter-profiles'));
        await page.click('#experiment-parameter-profile-form button[type="submit"]');
        expect((await rejected).status()).toBe(400);
        await page.waitForSelector('#operation-progress li[data-state="failed"]');
        expect(await page.$eval('#operation-progress li[data-state="failed"]', element => element.textContent)).toContain('immutable');
        expect(await page.$eval('#experiment-parameter-profile-form [name="label"]', element => (element as HTMLInputElement).value)).toBe('Changed immutable version');
        await openWorkflow(page, fixture.url, 'experiments');
        expect(await page.$eval('#experiment-parameter-profile-list', element => element.textContent)).toContain('Contract profile');
        expect(await page.$eval('#experiment-parameter-profile-list', element => element.textContent)).not.toContain('Changed immutable version');
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);

test('commercial forms serialize real agents, money/items and revisions; declining an offer and creating a business survive reload', async () => {
    const fixture = await adminWorkflowFixture('commerce'); const { page } = fixture;
    try {
        await openWorkflow(page, fixture.url, 'contracts');
        await page.waitForSelector('#economic-offer-form [name="creatorAgentId"] option[value="contract-a"]');
        expect(await page.$eval('#economic-contract-list', element => element.textContent)).toContain('Még nincs');
        await fields(page, 'economic-offer-form', { creatorAgentId: 'contract-a', counterpartyAgentId: 'contract-b',
            title: 'Contract exchange', creatorGp: '7', creatorItems: '436,broken,Copper ore', counterpartyService: 'Fixture service',
            counterpartySkill: 'fixture.walk@1.0.0' });
        await page.click('#economic-offer-form button[type="submit"]');
        await page.waitForFunction(() => document.getElementById('toast')!.textContent!.includes('Érvénytelen tárgysor'));
        expect(fixture.writes).toHaveLength(0);
        await fields(page, 'economic-offer-form', { creatorItems: '436,2,Copper ore' });
        const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/economic-offers'));
        await page.click('#economic-offer-form button[type="submit"]');
        const response = await created; expect(response.status()).toBe(201); const { offer } = await response.json();
        expect(await page.$$('#operation-review[open]')).toHaveLength(0);
        expect(offer.creatorProvides).toMatchObject({ gp: 7, items: [{ id: 436, count: 2, name: 'Copper ore' }] });
        expect(offer.counterpartyProvides.skill).toEqual({ id: 'fixture.walk', version: '1.0.0' });
        const decline = `[data-offer-id="${offer.offerId}"][data-offer-action="decline"]`;
        await page.waitForSelector(decline);
        const declined = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/economic-offers/${offer.offerId}`));
        await page.click(decline); await approveOperation(page);
        expect((await declined).status()).toBe(200);
        expect(fixture.writes[1]!.body).toMatchObject({ expectedRevision: 1, actorAgentId: 'contract-b', action: 'decline' });
        await page.waitForFunction(() => document.getElementById('economic-offer-list')!.textContent!.includes('Elutasítva'));
        await openWorkflow(page, fixture.url, 'contracts');
        expect(await page.$eval('#economic-offer-list', element => element.textContent)).toContain('Elutasítva');
        expect(await page.$eval('#economic-contract-list', element => element.textContent)).toContain('Még nincs');
        await page.click('#admin-navigation [data-tab="businesses"]');
        await page.waitForSelector('#business-form [name="ownerAgentId"] option[value="contract-a"]');
        await fields(page, 'business-form', { businessId: 'contract-workshop', ownerAgentId: 'contract-a', name: 'Contract workshop', summary: 'Isolated business fixture' });
        const business = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/businesses'));
        await page.click('#business-form button[type="submit"]');
        const result = await business; expect(result.status()).toBe(201); expect((await result.json()).business.ownerAgentId).toBe('contract-a');
        await openWorkflow(page, fixture.url, 'businesses');
        expect(await page.$eval('#business-list', element => element.textContent)).toContain('Contract workshop');
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);

test('world-rule UI preserves the saved revision on activation failure and rejects an obsolete form without overwriting newer settings', async () => {
    const fixture = await adminWorkflowFixture('world-mod'); const { page } = fixture;
    let stage = 'bootstrap';
    try {
        await openWorkflow(page, fixture.url, 'world'); stage = 'open rule dialog'; await page.click('#world-admin-button');
        await page.waitForSelector('#world-admin-dialog[open] [data-mod-id="fixture.signal"]');
        await page.click('[data-mod-id="fixture.signal"] [data-world-mod-enabled]');
        await page.$eval('[data-mod-setting="limit"]', element => { (element as HTMLInputElement).value = '3'; });
        await page.$eval('[data-world-mod-reason]', element => { (element as HTMLInputElement).value = 'Synthetic configuration contract'; });
        stage = 'review rule'; await page.click('[data-action="world-mod-save"]'); await page.waitForSelector('#operation-review[open]');
        expect(await page.$eval('#operation-review', element => element.textContent)).toContain('Fixture limit: 3');
        expect(fixture.writes).toHaveLength(0);
        const accepted = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/world-mods/fixture.signal'));
        stage = 'partial activation'; await page.click('[data-review-approve]');
        const response = await accepted; expect(response.status()).toBe(200); expect((await response.json()).activationError).toBe('Synthetic activation unavailable');
        await page.waitForSelector('#operation-progress li[data-state="partial"]');
        expect(await page.$eval('#world-admin-dialog .operation-inline', element => element.textContent)).toContain('Synthetic activation unavailable');
        expect(fixture.writes[0]!.body).toMatchObject({ expectedRevision: 0, enabled: true, config: { limit: 3 } });
        expect((await Bun.file(fixture.paths.modState).json()).revision).toBe(1);
        stage = 'read saved revision'; await page.waitForFunction(() => document.getElementById('world-mod-summary')!.textContent!.includes('Kért revízió: 1'));
        await updateWorldMod('fixture.signal', { enabled: true, config: { limit: 4 } }, 1,
            fixture.paths.modManifest, fixture.paths.modState, fixture.paths.modBackups);
        await page.$eval('[data-mod-setting="limit"]', element => { (element as HTMLInputElement).value = '5'; });
        await page.$eval('[data-world-mod-reason]', element => { (element as HTMLInputElement).value = 'Obsolete form contract'; });
        const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/world-mods/fixture.signal'));
        stage = 'obsolete form'; await page.click('[data-action="world-mod-save"]'); await approveOperation(page);
        expect((await rejected).status()).toBe(400);
        await page.waitForSelector('#operation-progress li[data-state="failed"]');
        const state = await Bun.file(fixture.paths.modState).json(); expect(state.revision).toBe(2); expect(state.mods['fixture.signal'].config.limit).toBe(4);
        expect(await page.$eval('[data-mod-setting="limit"]', element => (element as HTMLInputElement).value)).toBe('5');
        expect(fixture.errors).toEqual([]);
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({ toast: document.getElementById('toast')?.textContent,
            progress: document.getElementById('operation-progress')?.textContent }));
        throw new Error(`${stage}: ${error}; ${JSON.stringify(diagnostics)}`);
    } finally { await fixture.close(); }
}, 30000);

test('AI settings review sends the exact validated values to the real route and persists without exposing a secret', async () => {
    const fixture = await adminWorkflowFixture(); const { page } = fixture;
    try {
        await openWorkflow(page, fixture.url, 'llm');
        await fields(page, 'llm-settings-form', { provider: 'mock', model: 'contract-model', enabled: false, automaticReplanning: false,
            autonomousExecutionEnabled: false, skillBuilderEnabled: false, autonomousAllowedSkills: '', maxCostMicros: '12345',
            apiKey: 'sk-synthetic-contract-secret-value' });
        await page.click('#save-llm-settings'); await page.waitForSelector('#operation-review[open]');
        expect(fixture.writes).toHaveLength(0);
        expect(await page.$eval('#operation-review', element => element.textContent)).not.toContain('sk-synthetic-contract-secret-value');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !(document.getElementById('save-llm-settings') as HTMLButtonElement).disabled);
        expect(await Bun.file(fixture.paths.llm).exists()).toBe(false);
        const saved = page.waitForResponse(response => response.url().endsWith('/api/admin/llm-settings') && response.request().method() === 'PUT');
        await page.click('#save-llm-settings'); await approveOperation(page);
        const response = await saved; expect(response.status()).toBe(200);
        const result = await response.json(); expect(result.config.model).toBe('contract-model');
        expect(result.config.limits.maxCostMicros).toBe(12345); expect(result.apiKey.configured).toBe(true);
        expect(JSON.stringify(result)).not.toContain('sk-synthetic-contract-secret-value');
        expect((await Bun.file(fixture.paths.llm).json()).limits.maxCostMicros).toBe(12345);
        expect(fixture.writes[0]!.method).toBe('PUT'); expect(fixture.writes[0]!.body.config.limits.maxCostMicros).toBe(12345);
        await page.waitForFunction(() => !(document.getElementById('save-llm-settings') as HTMLButtonElement).disabled);
        await fields(page, 'llm-settings-form', { model: '   ' });
        const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/llm-settings'));
        await page.click('#save-llm-settings'); await approveOperation(page);
        expect((await rejected).status()).toBe(400);
        await page.waitForSelector('#operation-progress li[data-state="failed"]');
        expect((await Bun.file(fixture.paths.llm).json()).model).toBe('contract-model');
        await openWorkflow(page, fixture.url, 'llm');
        expect(await page.$eval('#llm-settings-form [name="model"]', element => (element as HTMLInputElement).value)).toBe('contract-model');
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);

test('event preview is inert; real queue is idempotent and a delivery failure remains visible in the UI', async () => {
    const fixture = await adminWorkflowFixture(); const { page } = fixture;
    try {
        await openWorkflow(page, fixture.url, 'world-events');
        expect(await page.$eval('#world-director-cycle-list', element => element.textContent)).toContain('Még nincs tartós');
        await fields(page, 'world-director-preview-form', { seed: 'contract-seed', cycleKey: 'contract:1' });
        const preview = page.waitForResponse(response => response.url().endsWith('/world-director/preview'));
        await page.click('#preview-world-event'); const selected = await (await preview).json();
        expect(selected.simulation).toBe(true);
        await page.waitForFunction(() => document.getElementById('world-director-preview-result')!.textContent!.includes('Csak előnézet'));
        let store = new WorldDirectorStore(fixture.paths.director);
        expect(store.listCycles()).toHaveLength(0); expect(store.listOutbox()).toHaveLength(0); store.close();
        const queued = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/world-director/cycles'));
        await page.click('#queue-world-event'); await approveOperation(page);
        const queuedResponse = await queued; expect(queuedResponse.status()).toBe(201);
        const data = await queuedResponse.json(); expect(data.cycle.selectionDigest).toBe(selected.selection.digest);
        await page.waitForFunction(() => document.getElementById('world-director-cycle-list')!.textContent!.includes('contract:1'));
        const duplicate = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/world-director/cycles'));
        await page.click('#queue-world-event'); await approveOperation(page);
        const duplicated = await duplicate; expect(duplicated.status()).toBe(200); expect((await duplicated.json()).created).toBe(false);
        store = new WorldDirectorStore(fixture.paths.director); expect(store.listCycles()).toHaveLength(1);
        const claim = store.claimNext('contract-adapter', [selected.selection.template.kind], 1000);
        expect(claim).not.toBeNull(); store.fail(claim!.signal.eventId, claim!.leaseToken!, 'Synthetic delivery unavailable'); store.close();
        await openWorkflow(page, fixture.url, 'world-events');
        expect(await page.$eval('#world-director-cycle-list', element => element.textContent)).toContain('Synthetic delivery unavailable');
        store = new WorldDirectorStore(fixture.paths.director);
        const retry = store.claimNext('contract-adapter', [selected.selection.template.kind], 1000);
        store.complete(retry!.signal.eventId, retry!.leaseToken!); store.close();
        await openWorkflow(page, fixture.url, 'world-events');
        expect(await page.$eval('#world-director-cycle-list', element => element.textContent)).toContain('outbox: delivered');
        expect(fixture.writes.filter(write => write.path.endsWith('/world-director/cycles'))).toHaveLength(2);
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);

test('publication UI binds a real approval digest, rejects changed evidence and only then publishes the isolated verified version', async () => {
    const fixture = await adminWorkflowFixture('publication'); const { page, publication } = fixture;
    try {
        await openWorkflow(page, fixture.url, 'skills');
        expect(await page.$$(`[data-action="skill-trial-publish"][data-trial-id="${publication!.failedTrialId}"]`)).toHaveLength(0);
        expect(await page.$eval('#skill-trial-list', element => element.textContent)).toContain('fixture-live');
        const button = `[data-action="skill-trial-publish"][data-trial-id="${publication!.trialId}"]`;
        await page.click(button); await page.waitForSelector('#operation-review[open]');
        expect(fixture.writes).toHaveLength(0); expect(await Bun.file(publication!.skillPath).exists()).toBe(false);
        expect(await page.$eval('#operation-review', element => element.textContent)).toContain('fixture.walk@1.0.0');
        await page.keyboard.press('Escape');
        await page.click(button); await page.waitForSelector('#operation-review[open]');
        const report = await Bun.file(publication!.reportPath).json(); report.checks[0].message += ' Revised evidence';
        await Bun.write(publication!.reportPath, JSON.stringify(report));
        const rejected = page.waitForResponse(response => response.url().endsWith('/publish') && response.request().method() === 'POST');
        await page.click('[data-review-approve]'); expect((await rejected).status()).toBe(400);
        await page.waitForSelector('#operation-progress li[data-state="failed"]');
        expect(await Bun.file(publication!.skillPath).exists()).toBe(false);
        expect(await page.$eval('#operation-progress li[data-state="failed"]', element => element.textContent)).toContain('megváltoztak');
        const published = page.waitForResponse(response => response.url().endsWith('/publish') && response.request().method() === 'POST');
        await page.click(button); await approveOperation(page);
        const response = await published; expect(response.status()).toBe(201);
        expect((await response.json()).trial.status).toBe('published');
        expect((await Bun.file(publication!.skillPath).json()).status).toBe('verified');
        expect(fixture.writes).toHaveLength(2);
        expect(fixture.writes[1]!.body.confirmHumanApproval).toBe(true);
        expect(fixture.writes[1]!.body.approvalDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(fixture.writes[1]!.body.approvalDigest).not.toBe(fixture.writes[0]!.body.approvalDigest);
        await page.waitForSelector(button, { hidden: true }); expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);
