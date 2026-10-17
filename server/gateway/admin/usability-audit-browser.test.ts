import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, HTTPRequest } from 'puppeteer';
import puppeteer from 'puppeteer';
import { adminWorkflowFixture, openWorkflow, fields } from './test-workflow-fixture.js';
import { createControlPlane } from '../../control-plane/service.js';
import { controlPlaneConfig } from '../../control-plane/config.js';
import { IdentityStore } from '../../control-plane/identity-store.js';
import { ServerRegistry } from '../../control-plane/server-registry.js';

const hash = 'a'.repeat(64), experimentId = '00000000-0000-4000-8000-000000000001';
const reason = 'Synthetic usability contract review';
type Fixture = Awaited<ReturnType<typeof adminWorkflowFixture>>;
async function open(page: Page, view: string, card: string) {
    await page.evaluate(view => { location.hash = view; }, view);
    await page.waitForSelector(`#${card}`, { visible: true });
    if (!await page.$eval(`#${card}`, element => (element as HTMLDetailsElement).open)) await page.locator(`#${card} > summary`).click();
}
async function click(page: Page, card: string, index = 0) {
    await page.locator(`#${card} .management-actions > button:nth-child(${index + 1})`).click();
    await page.waitForFunction(card => document.querySelector(`#${card} .management-result`)?.getAttribute('aria-busy') === 'false', {}, card);
}
async function review(page: Page, card: string, index: number, approve = true) {
    await page.locator(`#${card} .management-actions > button:nth-child(${index + 1})`).click();
    await page.waitForSelector('#operation-review[open]');
    const summary = await page.$eval('#operation-review', element => element.textContent);
    await page.click(approve ? '[data-review-approve]' : '[data-review-cancel]');
    await page.waitForFunction(card => document.querySelector(`#${card} .management-result`)?.getAttribute('aria-busy') === 'false', {}, card);
    return summary;
}
const options = { inheritanceRules: [{ ruleId: 'fixture-rule', factionId: 'fixture-faction' }],
    memoryRules: [{ ruleId: 'fixture-rule', sourceAgentId: 'contract-a', recipientAgentId: 'contract-b' }],
    estates: [{ estateId: 'fixture-estate', username: 'Contracta', status: 'custody-ready', revision: 3 }], warnings: [] };
async function intercept(fixture: Fixture, handler: (request: HTTPRequest, path: string) => unknown) {
    await fixture.page.setRequestInterception(true);
    fixture.page.on('request', request => {
        const value = handler(request, new URL(request.url()).pathname);
        if (value === undefined) void request.continue();
        else void request.respond({ status: value instanceof Error ? 400 : 200, contentType: 'application/json', headers: { 'X-Control-Server-ID': 'local-default' }, body: JSON.stringify(value instanceof Error ? { error: value.message } : value) });
    });
}
async function loadChoices(fixture: Fixture) {
    await open(fixture.page, 'agents', 'workflow-options'); await click(fixture.page, 'workflow-options');
    try { await fixture.page.waitForSelector('#agent-timeline-report-agentId option[value="contract-a"]'); }
    catch (error) { throw new Error(`${error}; choices: ${await fixture.page.$eval('#workflow-options', element => element.textContent)}`); }
}

test('read-only workflow choices, audit and timeline use real isolated handlers and preserve empty policies honestly', async () => {
    const fixture = await adminWorkflowFixture('audit');
    try {
        const { page } = fixture; await openWorkflow(page, fixture.url, 'agents'); await loadChoices(fixture);
        expect(await page.$eval('#workflow-options .management-result', element => element.textContent)).toContain('Nincs engedélyezett öröklési szabály');
        expect(await page.$$('#inheritance-workflow-ruleId option')).toHaveLength(1);
        await open(page, 'agents', 'agent-timeline-report');
        await fields(page, 'agent-timeline-report-form', { agentId: 'contract-a' }); await click(page, 'agent-timeline-report');
        expect(await page.$eval('#agent-timeline-report .management-result', element => element.textContent)).toContain('contract-a');
        await open(page, 'bots', 'admin-audit-report'); await click(page, 'admin-audit-report');
        expect(await page.$eval('#admin-audit-report .management-result', element => element.textContent)).toContain('Nincs bejegyzés');
        expect(fixture.writes).toEqual([]); expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 30000);

test('all twenty formerly missing read operations submit the exact route, scope and selected identifiers', async () => {
    const fixture = await adminWorkflowFixture('audit'); const seen: URL[] = [];
    try {
        await intercept(fixture, (request, path) => {
            if (path === '/api/admin/workflow-options') return options;
            if (request.method() !== 'GET' || !path.startsWith('/api/admin/')) return;
            if (/timeline|autonomy-control|\/audit$|\/environment$|\/experiments$|economy\/depend|population-memory|long-experiment|xp-baseline|xp-execution|evaluation|self-sufficiency|world-genesis|business-role/.test(path)) {
                seen.push(new URL(request.url()));
                if (path.endsWith('/runs')) return { runs: [] };
                return { status: 'unavailable', agentId: 'constructor', businessId: 'active', reason: '<img src=x onerror=alert(1)> Native data unavailable', entries: [] };
            }
        });
        const { page } = fixture; await openWorkflow(page, fixture.url, 'agents'); await loadChoices(fixture);
        const scope = { from: '2030-01-01T00:00:00.000Z', to: '2030-01-02T00:00:00.000Z', clockId: 'fixture-clock', clockProfileDigest: hash, actors: 'contract-a, contract-b' };
        const cases: [string, string, Record<string, string>, number, string][] = [
            ['agents','agent-timeline-report',{agentId:'contract-a'},0,'/agents/contract-a/timeline'],
            ['agents','autonomy-control-report',{},0,'/autonomy-control'], ['bots','admin-audit-report',{},0,'/audit'],
            ['experiments','experiment-environment-report',{},0,'/multi-agent-experiments/environment'],
            ['experiments','experiment-snapshots-report',{},0,'/experiments'],
            ['economy','dependency-report',{from:scope.from,to:scope.to,clockId:scope.clockId,clockProfileDigest:hash},2,'/economy/dependencies'],
            ['economy','dependency-report',{from:scope.from,to:scope.to,clockId:scope.clockId,clockProfileDigest:hash},3,'/economy/dependency-risk'],
            ['society','memory-transfer-workflow',{sourceAgentId:'contract-a'},0,'/population-memory/contract-a/archive'],
            ['society','long-experiment-report',{control:'session-a'},0,'/society/long-experiments/session-a'],
            ['society','long-experiment-report',{control:'session-a',treatment:'session-b'},1,'/society/long-experiment-comparison'],
            ['experiments','xp-baseline-workflow',{cohort:'contracta, contractb',reason},0,'/society/xp-baseline'],
            ['experiments','xp-execution-workflow',{experimentId,reason},0,`/society/xp-execution/${experimentId}`],
            ['society','evaluation-contract',{},0,'/society/evaluation/contract'],
            ['society','evaluation-report',scope,2,'/society/evaluation'], ['society','evaluation-report',scope,3,'/society/self-sufficiency'],
            ['world','external-trade-workflow',{resultId:'genesis-fixture',from:scope.from,to:scope.to,reason},0,'/world-genesis/genesis-fixture/external-trade'],
            ['world','external-trade-workflow',{resultId:'genesis-fixture',reason},1,'/world-genesis/genesis-fixture/integrity'],
            ['world','genesis-history-workflow',{},0,'/world-genesis/profiles'], ['world','genesis-history-workflow',{},1,'/world-genesis/runs'],
            ['businesses','business-roles-report',{},0,'/business-role-definitions']
        ];
        for (const [view, card, data, button, path] of cases) {
            await open(page, view, card); await fields(page, card + '-form', data); await click(page, card, button);
            expect(seen.some(url => url.pathname === '/api/admin' + path)).toBe(true);
        }
        const evaluation = seen.find(url => url.pathname === '/api/admin/society/evaluation')!;
        expect(evaluation.searchParams.getAll('actor')).toEqual(['contract-a','contract-b']); expect(evaluation.searchParams.get('clockProfileDigest')).toBe(hash);
        expect(seen.find(url => url.pathname.endsWith('/xp-baseline'))!.searchParams.getAll('player')).toEqual(['contracta','contractb']);
        expect(seen.find(url => url.pathname.endsWith('/long-experiment-comparison'))!.searchParams.get('treatment')).toBe('session-b');
        expect(await page.$eval('#business-roles-report .management-result',element=>element.textContent)).toContain('constructor');
        expect(await page.$eval('#business-roles-report .management-result',element=>element.textContent)).toContain('active');
        expect(await page.$eval('#business-roles-report .management-result',element=>element.textContent)).not.toContain('[native code]');
        expect(await page.$$('.management-result img')).toHaveLength(0); expect(fixture.writes).toEqual([]); expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 45000);

test('experiment preflight reads the existing form and checks selected online participants without starting a run', async () => {
    const fixture = await adminWorkflowFixture('audit');
    try {
        await intercept(fixture, (request, path) => {
            if (path === '/api/admin/bots') return { bots: ['contracta','contractb'].map(username => ({ username,displayName:username,status:'active',skills:[],coins:0,totalLevel:1,combatLevel:1,xpPerHour:null })),
                economy: { bots:2,online:2,totalCoins:0,totalXp:0,averageTotalLevel:1,itemStock:[] },generatedAt:new Date().toISOString() };
            if (path === '/api/admin/experiment-parameter-profiles' && request.method() === 'GET') return { profiles: [{ profileId:'fixture',version:'1.0.0',label:'Fixture profile',origin:'manual',createdAt:new Date().toISOString(),digest:hash,parameters:{respawns:[],xpRewards:[],marketPrices:[],finishedProducts:[]} }] };
            if (path === '/api/admin/multi-agent-experiments/preflight') return { definitionDigest:hash,environmentDigest:hash,parameterProfileDigest:hash };
        });
        const {page}=fixture;await openWorkflow(page,fixture.url,'experiments');
        await page.waitForSelector('[name="experimentAgentId"]:not(:disabled)');
        await page.select('#multi-agent-experiment-form [name="parameterProfile"]','fixture@1.0.0');
        await page.click('[name="experimentAgentId"][value="contract-a"]');await page.click('[name="experimentAgentId"][value="contract-b"]');
        await open(page,'experiments','experiment-preflight');await click(page,'experiment-preflight');
        expect(fixture.writes).toHaveLength(1);expect(fixture.writes[0]!.path).toBe('/api/admin/multi-agent-experiments/preflight');
        expect(fixture.writes[0]!.body).toMatchObject({agentIds:['contract-a','contract-b'],parameterProfileId:'fixture',parameterProfileVersion:'1.0.0'});
        expect(await page.$eval('#experiment-preflight .management-result',element=>element.textContent)).toContain(hash);
        expect(await page.$$('#operation-review')).toHaveLength(0);expect(fixture.errors).toEqual([]);
    }finally{await fixture.close();}
},30000);

test('population entry, memory and inheritance require fresh previews, retain exact digests, and cancellation sends no apply', async () => {
    const fixture = await adminWorkflowFixture('audit'); let blocked = true;
    try {
        await intercept(fixture, (request, path) => {
            if (path === '/api/admin/workflow-options') return options;
            if (request.method() !== 'POST') return;
            if (path.endsWith('/transfer-preview')) return { digest: hash, knowledgeIds: ['fixture-fact'], blockers: blocked ? ['Synthetic policy blocker'] : [] };
            if (path.endsWith('/inheritance-preview')) return { digest: hash, revision: 3, assets: [{ propertyId: 'fixture-home' }], blockers: [] };
            if (path === '/api/admin/population-entry/preview') return { result: { digest: hash, entrants: [{ identity: { agentId: 'arrival-fixture' } }] } };
            if (/population-entry\/apply|\/transfer$|\/inheritance$/.test(path)) return { ok: true, receipt: { status: 'completed' } };
        });
        const { page } = fixture; await openWorkflow(page, fixture.url, 'society'); await loadChoices(fixture);
        await open(page, 'society', 'memory-transfer-workflow');
        await fields(page,'memory-transfer-workflow-form',{ sourceAgentId:'contract-a',recipientAgentId:'contract-b',ruleId:'fixture-rule',reason });
        await click(page,'memory-transfer-workflow',1);
        expect(await page.$eval('#memory-transfer-workflow .management-actions button:last-child',button=>(button as HTMLButtonElement).disabled)).toBe(true);
        expect(await page.$eval('#memory-transfer-workflow .management-result',element=>element.textContent)).toContain('Synthetic policy blocker');
        blocked=false; await click(page,'memory-transfer-workflow',1);
        const before=fixture.writes.length; const summary=await review(page,'memory-transfer-workflow',2,false);
        expect(summary).toContain('contract-a → contract-b'); expect(fixture.writes).toHaveLength(before);
        expect(await page.$eval('#memory-transfer-workflow .management-actions button:last-child',button=>(button as HTMLButtonElement).disabled)).toBe(true);
        await click(page,'memory-transfer-workflow',1);
        await page.type('#memory-transfer-workflow-reason',' edited');
        expect(await page.$eval('#memory-transfer-workflow .management-actions button:last-child',button=>(button as HTMLButtonElement).disabled)).toBe(true);
        await click(page,'memory-transfer-workflow',1); await review(page,'memory-transfer-workflow',2);
        const transfer=fixture.writes.find(write=>write.path.endsWith('/transfer'))!;
        expect(transfer.body.previewDigest).toBe(hash); expect(transfer.body.transferId).toMatch(/^[a-f0-9-]{36}$/); expect(transfer.body.recipientAgentId).toBe('contract-b');
        await open(page,'society','inheritance-workflow'); await fields(page,'inheritance-workflow-form',{estateId:'fixture-estate',heirAgentId:'contract-b',ruleId:'fixture-rule',reason});
        await click(page,'inheritance-workflow'); expect(await review(page,'inheritance-workflow',1)).toContain('fixture-home');
        expect(fixture.writes.find(write=>write.path.endsWith('/inheritance'))!.body).toMatchObject({ expectedRevision:3,previewDigest:hash,heirAgentId:'contract-b' });
        await open(page,'society','population-entry-workflow'); await fields(page,'population-entry-workflow-form',{anchorAgentId:'contract-a',batchId:'fixture-arrivals',seed:'fixture-seed',count:'2',reason});
        await click(page,'population-entry-workflow'); await review(page,'population-entry-workflow',1);
        expect(fixture.writes.find(write=>write.path.endsWith('/population-entry/apply'))!.body).toEqual({request:{anchorAgentId:'contract-a',batchId:'fixture-arrivals',seed:'fixture-seed',count:2},reason,expectedPlanDigest:hash});
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
}, 45000);

test('XP recovery and genesis use selected snapshots and file previews, and report HTTP errors without losing input', async () => {
    const fixture=await adminWorkflowFixture('audit');
    const result={resultId:'genesis-fixture',resultDigest:hash,profile:{profileId:'frontier'},seed:'fixture-seed'};
    try {
        await intercept(fixture,(request,path)=>{
            if(path==='/api/admin/society/long-experiments/missing-session')return new Error('Synthetic missing session');
            if(path==='/api/admin/society/xp-baseline'&&request.method()==='GET')return {storeDigest:hash,cohort:['contracta']};
            if(path===`/api/admin/society/xp-execution/${experimentId}`)return {experimentId,status:'sealed'};
            if(path==='/api/admin/world-genesis/preview')return {result,confirmationDigest:hash,preview:{ok:true,warnings:[],checks:[]}};
            if(path==='/api/admin/world-genesis/runs')return {runs:[{...result,result,status:'applied',revision:2}]};
            if(path==='/api/admin/world-genesis/start'||path.endsWith('/reset')||path.endsWith('/observe')||path==='/api/admin/society/xp-baseline')return {ok:true};
        });
        const {page}=fixture; await openWorkflow(page,fixture.url,'experiments');
        await open(page,'experiments','xp-baseline-workflow'); await fields(page,'xp-baseline-workflow-form',{cohort:'contracta',reason});
        await click(page,'xp-baseline-workflow'); await review(page,'xp-baseline-workflow',1);
        expect(fixture.writes.find(write=>write.path.endsWith('/xp-baseline'))!.body).toMatchObject({kind:'reset',cohort:['contracta'],expectedStoreDigest:hash,sourceCommandId:null,reason});
        await fields(page,'xp-baseline-workflow-form',{kind:'restore',sourceCommandId:experimentId});
        await page.select('#xp-baseline-workflow-kind','restore'); await click(page,'xp-baseline-workflow'); await review(page,'xp-baseline-workflow',1);
        expect(fixture.writes.filter(write=>write.path.endsWith('/xp-baseline')).at(-1)!.body.sourceCommandId).toBe(experimentId);
        await open(page,'experiments','xp-execution-workflow'); await fields(page,'xp-execution-workflow-form',{experimentId,reason});
        await click(page,'xp-execution-workflow'); await review(page,'xp-execution-workflow',1);
        expect(fixture.writes.find(write=>write.path.endsWith('/xp-execution/'+experimentId))!.body).toEqual({action:'seal',reason});
        await open(page,'world','genesis-start-workflow');
        await page.$eval('#genesis-start-workflow-resultFile',(element,result)=>{
            const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(result)],'fixture.json',{type:'application/json'}));
            (element as HTMLInputElement).files=transfer.files;element.dispatchEvent(new Event('change',{bubbles:true}));
        },result);
        await fields(page,'genesis-start-workflow-form',{reason}); await click(page,'genesis-start-workflow');
        expect(await review(page,'genesis-start-workflow',1)).toContain('genesis-fixture');
        expect(fixture.writes.find(write=>write.path.endsWith('/world-genesis/start'))!.body).toEqual({result,confirmationDigest:hash,reason});
        await open(page,'world','genesis-history-workflow');await click(page,'genesis-history-workflow',1);
        await open(page,'world','genesis-reset-workflow');await fields(page,'genesis-reset-workflow-form',{resultId:'genesis-fixture',reason});
        await click(page,'genesis-reset-workflow');await review(page,'genesis-reset-workflow',1);
        expect(fixture.writes.find(write=>write.path.endsWith('/reset'))!.body).toEqual({expectedRevision:2,confirmationDigest:hash,reason});
        await open(page,'world','external-trade-workflow');await fields(page,'external-trade-workflow-form',{resultId:'genesis-fixture',reason});
        await review(page,'external-trade-workflow',2);
        expect(fixture.writes.find(write=>write.path.endsWith('/observe'))!.body).toEqual({reason});
        // A rejected request preserves both its explanation and the user's original input.
        await open(page,'society','long-experiment-report');await fields(page,'long-experiment-report-form',{control:'missing-session'});
        await click(page,'long-experiment-report');
        expect(await page.$eval('#long-experiment-report [role="status"]',element=>element.textContent)).toContain('Synthetic missing session');
        expect(await page.$eval('#long-experiment-report-control',element=>(element as HTMLInputElement).value)).toBe('missing-session');
        expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
},45000);

test('all admin views have named accessible controls and reflow at 320, 390, 768 and 1440 pixels',async()=>{
    const fixture=await adminWorkflowFixture('audit');
    try{
        const {page}=fixture;await openWorkflow(page,fixture.url,'agents');
        const cdp=await page.createCDPSession();await cdp.send('Accessibility.enable');
        const views=['overview','bots','agents','map','economy','businesses','contracts','society','skills','experiments','world','world-events','llm'];
        for(const width of [320,390,768,1440]){
            await page.setViewport({width,height:1000});
            for(const view of views){
                await page.evaluate(view=>{location.hash=view;},view);
                await page.waitForFunction(view=>document.querySelector('#admin-view-select')?.getAttribute('id')&& (document.querySelector('#admin-view-select') as HTMLSelectElement).value===view,{},view);
                await page.evaluate(()=>document.querySelectorAll('.management-workflow').forEach(element=>{(element as HTMLDetailsElement).open=true;}));
                const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
                expect({...overflow,view}).toEqual({width,scroll:width,view});
                const tree=await cdp.send('Accessibility.getFullAXTree');
                const unnamed=tree.nodes.filter(node=>!node.ignored&&['button','textbox','combobox','checkbox','link'].includes(node.role?.value)&&!node.name?.value).map(node=>({role:node.role?.value,id:node.backendDOMNodeId}));
                expect({view,width,unnamed}).toEqual({view,width,unnamed:[]});
            }
        }
        await page.setViewport({width:390,height:844});await open(page,'society','population-entry-workflow');
        await mkdir(join(import.meta.dir,'../../../.local/verification'),{recursive:true});
        await (await page.$('#population-entry-workflow'))!.screenshot({path:join(import.meta.dir,'../../../.local/verification/phase26-7-audit-mobile.png')});
        await page.setViewport({width:1440,height:1000});await (await page.$('#population-entry-workflow'))!.screenshot({path:join(import.meta.dir,'../../../.local/verification/phase26-7-audit-desktop.png')});
        await page.focus('#population-entry-workflow > summary'); await page.keyboard.press('Enter');
        expect(await page.$eval('#population-entry-workflow',element=>(element as HTMLDetailsElement).open)).toBe(false);
        await page.keyboard.press('Enter');await page.keyboard.press('Tab');
        expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe('SELECT');
        const lowContrast=await page.evaluate(()=>{
            const rgb=(value:string)=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
            const luminance=(color:number[])=>color.map(value=>{const channel=value/255;return channel<=0.04045?channel/12.92:Math.pow((channel+0.055)/1.055,2.4);}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index]!,0);
            return Array.from(document.querySelectorAll('.management-workflow summary,.management-workflow label,.management-workflow small,.management-workflow button:not(:disabled),.management-workflow input,.management-workflow select'))
                .filter(element=>(element as HTMLElement).offsetParent!==null&&!element.matches(':disabled'))
                .flatMap(element=>{
                    const foreground=luminance(rgb(getComputedStyle(element).color));let parent:Element|null=element,background='';
                    while(parent){background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}
                    const behind=luminance(rgb(background)),ratio=(Math.max(foreground,behind)+0.05)/(Math.min(foreground,behind)+0.05);
                    return ratio<4.5?[{label:element.textContent?.slice(0,60),ratio}]:[];
                });
        });
        expect(lowContrast).toEqual([]);
        for(const path of ['servers.html','account.html','capabilities.html']){
            await page.goto(`${fixture.url}/admin/${path}?serverId=local-default`);await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
            for(const width of [320,1440]){await page.setViewport({width,height:1000});expect({path,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}).toEqual({path,width,overflow:false});}
            const tree=await cdp.send('Accessibility.getFullAXTree');
            expect({path,unnamed:tree.nodes.filter(node=>!node.ignored&&['button','textbox','combobox','checkbox','link'].includes(node.role?.value)&&!node.name?.value).map(node=>node.role?.value)}).toEqual({path,unnamed:[]});
        }
        expect(fixture.errors).toEqual([]);
    }finally{await fixture.close();}
},60000);

test('viewer and operator can use their read-only reports with real role gates, named controls and mobile reflow',async()=>{
    const identities=new IdentityStore(':memory:'),registry=new ServerRegistry(':memory:'),config=controlPlaneConfig({});
    const owner=await identities.createAccount('audit-owner','synthetic audit owner password');registry.ensureConfiguredLocal(config);
    for(const role of ['viewer','operator'] as const){const account=await identities.createAccount('audit-'+role,'synthetic audit guest password',owner.id);identities.setRole(owner.id,account.id,'local-default',role);}
    const reads:string[]=[],writes:string[]=[];
    const app=Bun.serve({hostname:'127.0.0.1',port:0,fetch:createControlPlane(config,identities,async(url,init)=>{
        if(init.method&&init.method!=='GET')writes.push(url.pathname);else reads.push(url.pathname);
        if(url.pathname==='/api/admin/simulation-clock')return Response.json({clock:{clockId:'fixture-clock',profileDigest:hash,lastSimulationTime:'2030-01-02T00:00:00.000Z'}});
        return Response.json({status:'unavailable',reason:'Synthetic native evidence absent'});
    },registry)});
    let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
    try{
        browser=await puppeteer.launch({headless:true});
        for(const role of ['viewer','operator']){
            const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(5000);
            await page.goto(app.url.origin+'/admin/login.html');await page.type('[name="username"]','audit-'+role);await page.type('[name="password"]','synthetic audit guest password');
            await Promise.all([page.waitForNavigation(),page.click('#login-form button')]);
            await page.goto(app.url.origin+'/admin/observations.html?serverId=local-default');await page.setViewport({width:320,height:844});
            await page.waitForSelector('#dependency-report');await page.click('#dependency-report > summary');
            await click(page,'dependency-report');
            expect(await page.$eval('#dependency-report-clockId',element=>(element as HTMLInputElement).value)).toBe('fixture-clock');
            expect(await page.$eval('#dependency-report-from',element=>(element as HTMLInputElement).value)).toBe('2030-01-01T00:00:00.000Z');
            await click(page,'dependency-report',1);await click(page,'dependency-report',2);
            await page.click('#evaluation-contract > summary');await click(page,'evaluation-contract');
            await page.click('#evaluation-report > summary');await fields(page,'evaluation-report-form',{from:'2030-01-01T00:00:00.000Z',to:'2030-01-02T00:00:00.000Z',clockId:'fixture-clock',clockProfileDigest:hash,actors:'contract-a,contract-b'});await click(page,'evaluation-report',1);
            expect(await page.$eval('#evaluation-report .management-result',element=>element.textContent)).toContain('Synthetic native evidence absent');
            expect(await page.$$eval('#evaluation-report button',buttons=>buttons.map(button=>button.textContent))).not.toContain('Önfenntartás');
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            const cdp=await page.createCDPSession();const tree=await cdp.send('Accessibility.getFullAXTree');
            expect(tree.nodes.filter(node=>!node.ignored&&['button','textbox','combobox','link'].includes(node.role?.value)&&!node.name?.value)).toHaveLength(0);
            await context.close();
        }
        for(const route of ['/api/admin/economy/dependencies','/api/admin/economy/dependency-risk','/api/admin/society/evaluation/contract','/api/admin/society/evaluation'])expect(reads.filter(path=>path===route)).toHaveLength(2);
        expect(writes).toEqual([]);
    }finally{await browser?.close();await app.stop(true);registry.close();identities.close();}
},30000);
