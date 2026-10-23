import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BusinessWorkStore, loadDefaultBusinessWorkPolicyCatalog, workDigest } from '../../../business-work/index.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { BusinessManagerStore } from './business-manager.js';
import { businessManagerPathFor } from './business-agent-port.js';
import { createAdminAgent, createAdminBusinessWorkRequest, createAdminPlayerActionRequest, delegateBusinessPlayerAction, finishAdminPlayerActionRun,
    institutionTreasuryPathFor, recoverAdminPlayerActionSettlements, settleAdminPlayerActionReward, updateAdminPlayerActionRequest } from './agent-state.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
import { PlayerRewardStore } from '../../engine/src/mods/PlayerRewardStore.js';
import { TradeEvidenceStore } from '../../engine/src/mods/TradeEvidenceStore.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';
import { businessWorkNeedsRecovery, type BusinessWorkRuntimeOptions } from './business-work-runtime.js';
import { reportNativeIntegration } from '../../../society-metrics/integration-report.js';
import { nativeIntegrationOptions } from '../../../society-metrics/integration-sources.js';
import { runInstitutionStrategy } from './institution-strategy-runtime.js';
import { LlmOrchestrator } from '../../../llm-runtime/orchestrator.js';
import { ScriptedMockProvider } from '../../../llm-runtime/mock-provider.js';
import { MemoryLlmAuditSink } from '../../../llm-runtime/audit.js';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import { readFileSync } from 'node:fs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(funds = 100, offsetMs = 0, prepareOrders = true) {
    const workspace = mkdtempSync(join(tmpdir(), 'business-shift-')); dirs.push(workspace);
    const stateDir = join(workspace, '.local/economy'); mkdirSync(stateDir, { recursive: true });
    const path = join(stateDir, 'agents.sqlite'), businessPath = businessManagerPathFor(path),
        tradePath = join(workspace, 'trade.sqlite'), rewardPath = join(workspace, 'rewards.sqlite'), runRoot = join(workspace, '.local/runs');
    mkdirSync(runRoot, { recursive: true });
    const now = new Date(Date.now() + offsetMs), start = new Date(+now - 120_000).toISOString(), end = new Date(+now + 600_000).toISOString();
    const options: BusinessWorkRuntimeOptions = { workspace, worldId: 'fixture-world', tradePath, rewardPath, runRoot, checkpointPath: join(workspace, 'checkpoint.sqlite') };
    createAdminAgent({ agentId: 'kitchen-mind', displayName: 'Kitchen', background: 'Kitchen institution.', personalityTraits: ['prudent'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'karamja-kitchen', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 24, dailyLlmBudgetMicros: 100000, dailyOperationalBudgetGp: 1000 } }, path);
    const manager = new BusinessManagerStore(businessPath);
    manager.create({ businessId: 'karamja-kitchen', name: 'Kitchen', summary: 'Food work.', ownerAgentId: 'owner', propertyId: 'karamja.fishing-hut' });
    const policy = manager.proposePolicy('karamja-kitchen', { proposalId: randomUUID(), proposerAgentId: 'kitchen-mind',
        objective: 'Deliver cooked lobster.', mode: 'balanced', maxRewardGp: 25, preferredSkills: [] });
    manager.resolvePolicy('karamja-kitchen', policy.proposalId, policy.revision, 'approve', 'Approved.');
    const work = new BusinessWorkStore(businessPath);
    work.grantEntitlement({ entitlementId: 'kitchen-storage', businessId: 'karamja-kitchen', propertyId: 'karamja.fishing-hut',
        facilityCapability: 'storage.secure', validFrom: start, validUntil: end });
    const skill = { id: 'trade.lumbridge.give-item', version: '1.0.0' };
    for (const worker of ['courierone', 'couriertwo']) {
        createAdminAgent({ agentId: worker, playerUsername: worker, displayName: worker, background: 'Delivery worker.', personalityTraits: ['reliable'] }, path);
        const agents = new AgentStateStore(path); agents.setSkillKnowledge(worker, skill, 'known', null); agents.close();
        const employment = manager.hire('karamja-kitchen', { workerAgentId: worker, roleDefinitionId: 'business.delivery.v1',
            title: 'Courier', wageGp: 25, requiredSkill: skill });
        if (prepareOrders) work.createWorkOrder(`order-${worker}`, 'karamja-kitchen.delivery.v1', employment.employmentId, start, end);
    }
    work.close(); manager.close();
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(path)); treasury.setBalance('business', 'karamja-kitchen', 1, funds); treasury.close();
    new TradeEvidenceStore(tradePath).close(); new PlayerRewardStore(rewardPath, false).close();
    function create(worker = 'courierone') { return createAdminBusinessWorkRequest(`order-${worker}`, 'kitchen-mind',
        { recipient: 'consumer', 'item-name': 'Lobster', amount: 1 }, { kind: 'delivery', recipient: 'consumer' }, path, options, start); }
    function launch(worker = 'courierone') {
        const request = create(worker), runId = randomUUID();
        delegateBusinessPlayerAction(request.requestId, runId, path, start, options); return { request, runId, worker };
    }
    function complete(run: ReturnType<typeof launch>, changes: { amount?: number; recipient?: string; status?: string; parameters?: object; time?: string } = {}) {
        const committedAt = changes.time ?? new Date(+now - 1000).toISOString(), trades = new TradeEvidenceStore(tradePath);
        trades.record({ tick: 500, fromUsername: run.worker, toUsername: changes.recipient ?? 'consumer', fromItems: [
            { id: 379, name: 'Lobster', count: changes.amount ?? 1 }], toItems: [], fromValue: 0, toValue: 0, committedAt }); trades.close();
        const journal = { runId: run.runId, username: run.worker, skill, status: changes.status ?? 'completed', reason: 'completed', message: 'Delivered.',
            operations: 1, durationMs: 1000, parameters: changes.parameters ?? run.request.parameters,
            events: [{ runId: run.runId, type: 'skill.started', timestamp: start, skill },
                { runId: run.runId, type: 'step.succeeded', operation: 'trade-give-item', timestamp: committedAt, stepId: 'give-item' },
                { runId: run.runId, type: 'skill.completed', timestamp: now.toISOString(), skill }] };
        writeFileSync(join(runRoot, `${run.runId}.json`), JSON.stringify(journal)); return journal;
    }
    function read(worker = 'courierone') { const agents = new AgentStateStore(path), work = new BusinessWorkStore(businessPath), treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(path));
        try { const binding = work.binding(`order-${worker}`)!; return { binding, order: work.get(binding.workOrderId)!,
            request: agents.getPlayerActionRequest(binding.request.requestId)!, treasury: treasury.get('business', 'karamja-kitchen')!,
            reservation: treasury.getReservation(binding.request.requestId) }; } finally { agents.close(); work.close(); treasury.close(); } }
    let balance = 0, credits = 0;
    const rewarder = async (username: string, amount: number, settlementId: string) => {
        const store = new PlayerRewardStore(rewardPath, false);
        try { const result = store.credit(settlementId, username, amount, { balance: () => balance,
            credit: n => { balance += n; credits++; return n; }, remove: n => { balance -= n; return n; } });
            return { ok: true, commandId: randomUUID(), username, amount, settlementId,
                reward: { status: 'committed' as const, coinsBefore: result.coinsBefore!, coinsAfter: result.coinsAfter! } };
        } finally { store.close(); }
    };
    return { workspace, path, businessPath, options, start, end, create, launch, complete, read, rewarder, credits: () => credits };
}

test('SI-B04 Business demand → model policy/work choice → typed player → canonical delivery/reward survives replay', async () => {
    const f=fixture(100,0,false), policyPath=join(f.workspace,'institution.json'), now=new Date().toISOString();
    const agents=new AgentStateStore(f.path);agents.createAutonomyEnrollment('kitchen-mind',{status:'desired',policyId:'private-local-default',policyVersion:'1.0.0'},now);
    agents.claimAutonomyEnrollment('kitchen-mind',1,'test',new Date(Date.parse(now)+600000).toISOString(),now);agents.close();
    const manager=new BusinessManagerStore(f.businessPath), employment=manager.get('karamja-kitchen')!.employments.find(e=>e.workerAgentId==='courierone')!;manager.close();
    writeFileSync(policyPath,JSON.stringify({schemaVersion:1,grants:[{agentId:'kitchen-mind',businessId:'karamja-kitchen',policyId:'private-local-default',policyVersion:'1.0.0',
        maxGpPerDecision:25,maxGpPerDay:50,options:[{optionId:'deliver-demand',objective:'Deliver one meal for changed demand',mode:'growth',maxRewardGp:25,preferredSkills:[],stockPolicies:[],
            work:{policyId:'karamja-kitchen.delivery.v1',employmentId:employment.employmentId,durationMinutes:5,
                parameters:{recipient:'consumer','item-name':'Lobster',amount:1},target:{kind:'delivery',recipient:'consumer'}}}]}]}));
    const provider=new ScriptedMockProvider([r=>({output:{decision:'select_business_policy',goalId:r.goal.goalId,alternativeId:'deliver-demand',goals:[],tool:null,reason:'Meet observed meal demand'},usage:{costMicros:0}})]);
    const config=validateLlmRuntimeConfig({...JSON.parse(readFileSync(join(import.meta.dir,'../../../config/llm-runtime.json'),'utf8')),enabled:true});
    const event={eventId:'institution-demand',agentId:'kitchen-mind',sourceKey:'demand-delivery',type:'significant-economic-change' as const,occurredAt:now,summary:'Own addressed meal demand'};
    const options={agentPath:f.path,policyPath,requiredLeaseOwner:'test',maxLlmCostMicros:0,workOptions:f.options,
        plan:(input:Parameters<LlmOrchestrator['plan']>[0])=>new LlmOrchestrator(config,provider,new MemoryLlmAuditSink()).plan(input)};
    const crash=new OwnedDatabase(f.path);crash.run(`CREATE TRIGGER institution_request_crash BEFORE INSERT ON agent_player_action_request BEGIN SELECT RAISE(ABORT,'request crash'); END`);crash.close();
    expect((await runInstitutionStrategy('kitchen-mind',event,options)).status).toBe('bounded-wait');
    const recover=new OwnedDatabase(f.path);recover.run('DROP TRIGGER institution_request_crash');recover.close();
    expect((await runInstitutionStrategy('kitchen-mind',{...event,eventId:'new-supervisor-wakeup',sourceKey:'new-wakeup'},options)).status).toBe('completed');
    const work=new BusinessWorkStore(f.businessPath), binding=work.bindings()[0]!;expect(work.get(binding.workOrderId)?.workerAgentId).toBe('courierone');work.close();
    const runId=randomUUID(), started=new Date().toISOString(), committedAt=new Date(Date.parse(started)+60000).toISOString(), finished=new Date(Date.parse(started)+61000).toISOString();
    delegateBusinessPlayerAction(binding.request.requestId,runId,f.path,started,f.options);
    const trades=new TradeEvidenceStore(f.options.tradePath!);trades.record({tick:10,fromUsername:'courierone',toUsername:'consumer',
        fromItems:[{id:379,name:'Lobster',count:1}],toItems:[],fromValue:0,toValue:0,committedAt});trades.close();
    writeFileSync(join(f.options.runRoot!,`${runId}.json`),JSON.stringify({runId,username:'courierone',skill:binding.request.skill,status:'completed',parameters:binding.request.parameters,
        events:[{runId,type:'skill.started',timestamp:started},{runId,type:'step.succeeded',operation:'trade-give-item',timestamp:committedAt},{runId,type:'skill.completed',timestamp:finished}]}));
    expect(finishAdminPlayerActionRun(runId,true,'Completed.',f.path,null,f.options,finished)?.status).toBe('settling');
    await settleAdminPlayerActionReward(binding.settlementId,f.path,f.rewarder,f.options);
    expect((await runInstitutionStrategy('kitchen-mind',event,options)).status).toBe('completed');
    await settleAdminPlayerActionReward(binding.settlementId,f.path,f.rewarder,f.options);
    const reopened=new BusinessWorkStore(f.businessPath);expect(reopened.bindings()).toHaveLength(1);expect(reopened.get(binding.workOrderId)?.wageStatus).toBe('paid');reopened.close();
    const treasury=new InstitutionTreasuryStore(institutionTreasuryPathFor(f.path));expect(treasury.get('business','karamja-kitchen')?.balanceGp).toBe(75);treasury.close();
    expect(f.credits()).toBe(1);expect(provider.requests).toHaveLength(1);
},30000);

test('two role-bound workers share the existing queue and receive exactly one wage each after reopening every store', async () => {
    const f = fixture();
    for (const worker of ['courierone', 'couriertwo']) {
        const run = f.launch(worker); f.complete(run);
        expect(finishAdminPlayerActionRun(run.runId, true, 'Process OK.', f.path, randomUUID(), f.options)).toMatchObject({ status: 'settling' });
        const earned = f.read(worker); expect(earned.order).toMatchObject({ wageStatus: 'earned', status: 'completed' });
        await settleAdminPlayerActionReward(earned.binding.settlementId, f.path, f.rewarder, f.options);
        await settleAdminPlayerActionReward(earned.binding.settlementId, f.path, f.rewarder, f.options);
        expect(f.read(worker).order).toMatchObject({ wageStatus: 'paid', wageSettlementId: earned.binding.settlementId });
    }
    expect(f.read().treasury).toMatchObject({ balanceGp: 50, reservedGp: 0 }); expect(f.credits()).toBe(2);
    const report = reportNativeIntegration({ fromSimulationTime: f.start, toSimulationTime: f.end, clockId: 'fixture-clock',
        clockProfileDigest: 'a'.repeat(64), actorAgentIds: ['courierone', 'couriertwo', 'consumer', 'owner'] },
    { ...nativeIntegrationOptions(f.workspace), worldId: f.options.worldId!, businessPath: f.businessPath,
        treasuryPath: institutionTreasuryPathFor(f.path), rewardsPath: f.options.rewardPath! });
    expect(report.wages).toHaveLength(2);
    expect(report.wages.every(row => row.status === 'reconciled-payment' && row.paidGp === '25' && row.simulationTime === null)).toBeTrue();
    expect(report.wages.every(row => row.evidenceIds.length === 3)).toBeTrue();
    expect(report.needs.internalHungerRelief.status).toBe('inconclusive');
});
test('empty treasury leaves a visible stable binding and retries the same request after funding', () => {
    const f = fixture(0); expect(() => f.create()).toThrow('Insufficient');
    const before = f.read(); expect(before.request).toBeNull(); expect(before.order.wageStatus).toBe('unearned');
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(f.path)); treasury.setBalance('business', 'karamja-kitchen', before.treasury.revision, 25); treasury.close();
    expect(f.create().requestId).toBe(before.binding.request.requestId); expect(f.create().requestId).toBe(before.binding.request.requestId);
    expect(f.read().treasury.reservedGp).toBe(25);
});
test('ended role denies before treasury reservation', () => {
    const f = fixture(), manager = new BusinessManagerStore(f.businessPath), employment = manager.get('karamja-kitchen')!.employments[0]!;
    manager.endEmployment('karamja-kitchen', employment.employmentId, employment.revision); manager.close();
    expect(() => f.create()).toThrow('authority changed');
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(f.path)); expect(treasury.get('business', 'karamja-kitchen')!.reservedGp).toBe(0); treasury.close();
});
test('missing active policy and standalone paid food requests deny before reservation', () => {
    const f = fixture(), db = new OwnedDatabase(f.businessPath); db.run("UPDATE business_policy_proposal SET status='rejected' WHERE status='approved'"); db.close();
    expect(() => f.create()).toThrow('approved active policy');
    expect(() => createAdminPlayerActionRequest('kitchen-mind', { requestId: 'standalone-food', assigneeAgentId: 'courierone',
        skill: { id: 'trade.lumbridge.give-item', version: '1.0.0' }, parameters: { 'item-name': 'Lobster', recipient: 'consumer', amount: 1 },
        objective: 'Duplicated food work.', rewardGp: 25 }, f.path)).toThrow('exact Business work order');
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(f.path)); expect(treasury.get('business', 'karamja-kitchen')!.reservedGp).toBe(0); treasury.close();
});
for (const [name, changes] of Object.entries({ partial: { amount: 2 }, recipient: { recipient: 'other' },
    failed: { status: 'failed' }, parameters: { parameters: { recipient: 'other', 'item-name': 'Lobster', amount: 1 } } })) {
    test(`${name} native delivery never earns a wage and expiry releases only an unpaid reservation`, () => {
        const f = fixture(), run = f.launch(); f.complete(run, changes);
        expect(finishAdminPlayerActionRun(run.runId, true, 'Process OK.', f.path, randomUUID(), f.options)).toMatchObject({ status: 'running', responseNote: expect.stringContaining('reconciliation') });
        expect(f.read().order.wageStatus).toBe('unearned'); expect(f.read().treasury.reservedGp).toBe(25);
        expect(finishAdminPlayerActionRun(run.runId, true, 'Process OK.', f.path, randomUUID(), f.options,
            new Date(Date.parse(f.end) + 1).toISOString())).toMatchObject({ status: 'failed' });
        expect(f.read().order).toMatchObject({ status: 'cancelled', wageStatus: 'unearned' }); expect(f.read().treasury.reservedGp).toBe(0);
    });
}
test('process ACK without native ledger evidence and a missing journal cannot earn wages', () => {
    const f = fixture(), run = f.launch();
    expect(finishAdminPlayerActionRun(run.runId, true, 'Success.', f.path, randomUUID(), f.options)?.status).toBe('running');
    f.complete(run, { time: new Date(Date.parse(f.start) - 1).toISOString() });
    expect(finishAdminPlayerActionRun(run.runId, true, 'Success.', f.path, randomUUID(), f.options)?.status).toBe('running');
});
test('engine ACK without its persisted exact receipt keeps earned claim and reservation', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read();
    await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, async (username, amount, settlementId) =>
        ({ ok: true, username, amount, settlementId, commandId: randomUUID(), reward: { status: 'committed', coinsBefore: 0, coinsAfter: amount } }), f.options)).rejects.toThrow('receipt is missing');
    expect(f.read().order.wageStatus).toBe('earned'); expect(f.read().reservation?.status).toBe('reserved');
    expect(await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options)).toMatchObject({ completedSettlementIds: [binding.settlementId], errors: [] });
    expect(f.credits()).toBe(1);
});
test('lost reward ACK recovers from the engine receipt without a second credit', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read();
    await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, async (username, amount, settlementId) => {
        await f.rewarder(username, amount, settlementId); throw new Error('lost ACK'); }, f.options)).rejects.toThrow('lost ACK');
    expect(f.read().order.wageStatus).toBe('earned');
    await recoverAdminPlayerActionSettlements(f.path, async () => { throw new Error('must not redispatch'); }, f.options);
    expect(f.read().order.wageStatus).toBe('paid'); expect(f.credits()).toBe(1);
});
test('recovery joins native completion committed before the request transition', async () => {
    const f = fixture(), run = f.launch(); f.complete(run);
    expect(await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options)).toMatchObject({ errors: [] });
    expect(f.read().order.wageStatus).toBe('paid'); expect(f.credits()).toBe(1);
});
test('binding and native target cannot be reused with another run or bypassed through legacy completion', () => {
    const f = fixture(), run = f.launch(), work = new BusinessWorkStore(f.businessPath);
    try {
        expect(() => work.bindRun('order-courierone', randomUUID(), f.start)).toThrow('another run');
        expect(() => work.complete('order-courierone', {} as any, () => true)).toThrow('native completion');
        expect(() => work.settleWage('order-courierone', randomUUID(), () => true)).toThrow('engine receipt');
    } finally { work.close(); }
    expect(() => delegateBusinessPlayerAction(run.request.requestId, randomUUID(), f.path, f.start, f.options)).toThrow('already used');
});
test('binding audit detects edited wage projection and deleted binding rows after restart', () => {
    const f = fixture(); f.create();
    const db = new OwnedDatabase(f.businessPath); db.run("UPDATE business_work_order SET wage_status='paid' WHERE work_order_id='order-courierone'"); db.close();
    expect(() => new BusinessWorkStore(f.businessPath)).toThrow('projection differs');
});
test('cook work policy remains blocked while its exact procedure is a draft', () => {
    const f = fixture(), manager = new BusinessManagerStore(f.businessPath);
    const employment = manager.hire('karamja-kitchen', { workerAgentId: 'draftcook', roleDefinitionId: 'business.cook.v1', title: 'Cook', wageGp: 25,
        requiredSkill: { id: 'procedure.food.cook-lobster', version: '0.1.0' } }); manager.close();
    const work = new BusinessWorkStore(f.businessPath);
    try { expect(loadDefaultBusinessWorkPolicyCatalog().policies).toHaveLength(3);
        expect(() => work.createWorkOrder('draft-cook', 'karamja-kitchen.cook.v1', employment.employmentId, f.start, f.end)).toThrow('not verified');
    } finally { work.close(); }
});

test('reserve committed before request creation recovers the same outbox without double reservation', async () => {
    const f = fixture(), db = new OwnedDatabase(f.path);
    db.run("CREATE TRIGGER fail_request BEFORE INSERT ON agent_player_action_request BEGIN SELECT RAISE(ABORT,'request crash'); END"); db.close();
    expect(() => f.create()).toThrow('request crash'); const held = f.read(); expect(held.treasury.reservedGp).toBe(25);
    const reopen = new OwnedDatabase(f.path); reopen.run('DROP TRIGGER fail_request'); reopen.close();
    expect(await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options)).toMatchObject({ errors: [] });
    expect(f.read().request.requestId).toBe(held.binding.request.requestId); expect(f.read().treasury.reservedGp).toBe(25);
});
test('earned claim survives a failed request transition and restart pays its original settlement once', async () => {
    const f = fixture(), run = f.launch(); f.complete(run);
    const db = new OwnedDatabase(f.path); db.run("CREATE TRIGGER fail_earned BEFORE UPDATE ON agent_player_action_request WHEN NEW.status='settling' BEGIN SELECT RAISE(ABORT,'earned crash'); END"); db.close();
    expect(() => finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options)).toThrow('earned crash');
    const earned = f.read(); expect(earned.order.wageStatus).toBe('earned'); expect(earned.request.status).toBe('running');
    const reopen = new OwnedDatabase(f.path); reopen.run('DROP TRIGGER fail_earned'); reopen.close();
    await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options);
    expect(f.read().order).toMatchObject({ wageStatus: 'paid', wageSettlementId: earned.binding.settlementId }); expect(f.credits()).toBe(1);
});
test('receipt and treasury commit survive a failed paid projection and reopen without redispatch', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const db = new OwnedDatabase(f.businessPath); db.run("CREATE TRIGGER fail_paid BEFORE UPDATE ON business_work_order WHEN NEW.wage_status='paid' BEGIN SELECT RAISE(ABORT,'paid crash'); END"); db.close();
    const { binding } = f.read(); await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, f.rewarder, f.options)).rejects.toThrow('paid crash');
    expect(f.read().reservation?.status).toBe('committed'); expect(f.read().order.wageStatus).toBe('earned');
    const reopen = new OwnedDatabase(f.businessPath); reopen.run('DROP TRIGGER fail_paid'); reopen.close();
    await recoverAdminPlayerActionSettlements(f.path, async () => { throw new Error('must not redispatch'); }, f.options);
    expect(f.read().order.wageStatus).toBe('paid'); expect(f.credits()).toBe(1);
});
test('an uncertain bound payment cannot release its treasury reservation', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read(); await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, async () => { throw new Error('offline'); }, f.options)).rejects.toThrow('offline');
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(f.path));
    try { expect(() => treasury.release(binding.request.requestId)).toThrow('cannot be blindly released'); } finally { treasury.close(); }
    expect(f.read().reservation?.status).toBe('reserved');
});
test('audit coverage rejects deleted binding projections after reopening', () => {
    const f = fixture(); f.create(); const db = new OwnedDatabase(f.businessPath); db.run('DELETE FROM business_work_binding'); db.close();
    expect(() => new BusinessWorkStore(f.businessPath)).toThrow('coverage differs');
});
test('one native delivery cannot earn two overlapping shift claims', () => {
    const f = fixture(), first = f.launch(), work = new BusinessWorkStore(f.businessPath), original = work.get('order-courierone')!;
    work.createWorkOrder('overlapping-shift', original.policyId, original.employmentId, f.start, f.end); work.close();
    const second = createAdminBusinessWorkRequest('overlapping-shift', 'kitchen-mind', first.request.parameters,
        { kind: 'delivery', recipient: 'consumer' }, f.path, f.options, f.start), runId = randomUUID();
    delegateBusinessPlayerAction(second.requestId, runId, f.path, f.start, f.options);
    const journal = f.complete(first);
    writeFileSync(join(f.options.runRoot!, `${runId}.json`), JSON.stringify({ ...journal, runId,
        events: journal.events.map(e => ({ ...e, runId })) }));
    expect(finishAdminPlayerActionRun(first.runId, true, 'OK.', f.path, null, f.options)?.status).toBe('settling');
    expect(finishAdminPlayerActionRun(runId, true, 'OK.', f.path, null, f.options)?.status).toBe('running');
    const reopened = new BusinessWorkStore(f.businessPath); expect(reopened.get('overlapping-shift')!.wageStatus).toBe('unearned'); reopened.close();
});
test('an exact pending engine reward blocks redispatch and keeps earned entitlement', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read(), db = new OwnedDatabase(f.options.rewardPath!);
    db.run("INSERT INTO player_action_reward VALUES(?1,'courierone',25,'pending',0,NULL,?2,?2,NULL)", [binding.settlementId, new Date().toISOString()]); db.close();
    await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, async () => { throw new Error('must not redispatch'); }, f.options)).rejects.toThrow('pending or differs');
    expect(f.read().order.wageStatus).toBe('earned'); expect(f.read().reservation?.status).toBe('reserved');
});
test('queued shifts that expire before dispatch fail without a wage and release their unused hold', async () => {
    const f = fixture(100, -900000); f.create();
    expect(await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options)).toMatchObject({ errors: [], attemptedSettlementIds: [] });
    expect(f.read().order).toMatchObject({ status: 'cancelled', wageStatus: 'unearned' }); expect(f.read().request.status).toBe('failed');
    expect(f.read().treasury).toMatchObject({ balanceGp: 100, reservedGp: 0 }); expect(f.credits()).toBe(0);
});
test('rejected queue work cancels the same shift and releases its unused wage hold', () => {
    const f = fixture(), request = f.create();
    updateAdminPlayerActionRequest(request.requestId, request.assigneeAgentId, request.revision, 'rejected', 'Unavailable.', f.path);
    expect(f.read().order).toMatchObject({ status: 'cancelled', wageStatus: 'unearned' }); expect(f.read().request.status).toBe('rejected');
    expect(f.read().treasury.reservedGp).toBe(0);
});
test('a deleted receipt after paid never dispatches a replacement wage', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read(); await settleAdminPlayerActionReward(binding.settlementId, f.path, f.rewarder, f.options);
    const db = new OwnedDatabase(f.options.rewardPath!); db.run('DELETE FROM player_action_reward'); db.close();
    await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, async () => { throw new Error('must not redispatch'); }, f.options)).rejects.toThrow('Previously paid');
    expect(f.credits()).toBe(1); expect(f.read().treasury.balanceGp).toBe(75);
});
test('changing the institution subject cannot redirect an earned Business wage', async () => {
    const f = fixture(), run = f.launch(); f.complete(run); finishAdminPlayerActionRun(run.runId, true, 'OK.', f.path, null, f.options);
    const { binding } = f.read(), db = new OwnedDatabase(f.path);
    db.run("UPDATE agent_control_profile SET subject_id='different-business' WHERE agent_id='kitchen-mind'"); db.close();
    await expect(settleAdminPlayerActionReward(binding.settlementId, f.path, f.rewarder, f.options)).rejects.toThrow('Business subject binding differs');
    expect(f.credits()).toBe(0); expect(f.read().order.wageStatus).toBe('earned');
});
test('terminal history is excluded before the recovery limit, while interrupted hold cleanup remains actionable', () => {
    const end = '2026-10-18T12:00:00.000Z', now = '2026-10-18T11:00:00.000Z';
    const rows = [...Array.from({ length: 150 }, () => ({ status: 'completed' as const, wageStatus: 'paid' as const, scheduledEnd: end })),
        { status: 'running' as const, wageStatus: 'unearned' as const, scheduledEnd: end }];
    expect(rows.filter(order => businessWorkNeedsRecovery(order, { status: 'running' }, false, randomUUID(), now)).slice(0, 100)).toHaveLength(1);
    const cancelled = { status: 'cancelled' as const, wageStatus: 'unearned' as const, scheduledEnd: end };
    expect(businessWorkNeedsRecovery(cancelled, { status: 'failed' }, true, randomUUID(), now)).toBeTrue();
    expect(businessWorkNeedsRecovery(cancelled, { status: 'failed' }, false, randomUUID(), now)).toBeFalse();
    expect(businessWorkNeedsRecovery({ ...cancelled, status: 'scheduled' }, { status: 'pending' }, true, null, now)).toBeFalse();
});
test('recovery finishes reservation cleanup interrupted after shift expiry and request failure', async () => {
    const f = fixture(), run = f.launch(), treasuryPath = institutionTreasuryPathFor(f.path);
    const db = new OwnedDatabase(treasuryPath); db.run("CREATE TRIGGER fail_release BEFORE UPDATE ON institution_treasury_reservation WHEN NEW.status='released' BEGIN SELECT RAISE(ABORT,'release crash'); END"); db.close();
    expect(() => finishAdminPlayerActionRun(run.runId, false, 'Expired.', f.path, null, f.options,
        new Date(Date.parse(f.end) + 1).toISOString())).toThrow('release crash');
    expect(f.read().request.status).toBe('failed'); expect(f.read().order.status).toBe('cancelled'); expect(f.read().reservation?.status).toBe('reserved');
    const reopened = new OwnedDatabase(treasuryPath); reopened.run('DROP TRIGGER fail_release'); reopened.close();
    expect(await recoverAdminPlayerActionSettlements(f.path, f.rewarder, f.options)).toMatchObject({ errors: [], attemptedSettlementIds: [] });
    expect(f.read().reservation?.status).toBe('released'); expect(f.credits()).toBe(0);
});
