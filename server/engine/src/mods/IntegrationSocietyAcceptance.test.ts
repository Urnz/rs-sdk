import { test, expect } from 'bun:test';
import { writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapAcceptanceBaseline, loadAcceptanceContent, openSocietyHarness, workspace, TEST_BOUNDARIES } from './IntegrationSocietyHarness.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import World from '../engine/World.js';
import InvType from '../cache/config/InvType.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { NativeCommerceExecutor } from './NativeCommerce.js';
import { recordPopulationDamage } from './PopulationDeathRuntime.js';
import { NativeFoodProductionStore } from './NativeFoodProductionStore.js';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const scenario = process.env.SI_A14_CASE;
if (!scenario || process.env.SI_A14_ISOLATED_WORKSPACE !== workspace) throw new Error('Run SI-A14 through the isolated gateway harness');
test(`SI-A14 ${scenario}`, async () => {
    await loadAcceptanceContent();
    if (scenario === 'baseline') { await bootstrapAcceptanceBaseline(); return; }
    const h = await openSocietyHarness(process.env.SI_A14_RECOVER === '1');
    const recovery = process.env.SI_A14_RECOVER === '1', correlations: string[] = [];
    const load = (path: string) => import(pathToFileURL(join(workspace, path)).href);
    const boundary = () => { process.stdout.write(`SI_A14_BOUNDARY:${scenario}\n`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    const treasury = () => h.sql(h.treasuryPath, db => db.query("SELECT balance_gp,reserved_gp FROM institution_treasury WHERE actor_kind='business' AND actor_id='karamja-kitchen'").get()) as any;
    const totalGp = () => h.fixture.avatars.reduce((n: number, a: any) => n + h.count(a.username, 995), 0) + treasury().balance_gp;
    const gather = async () => { h.at('sifisher'); h.seed(); const run = await h.runFood('gather', 'sifisher');
        expect(run.status, run.message).toBe('completed'); correlations.push(run.runId); return run; };
    const procure = async () => { await gather(); const intent = h.commerceIntent('procurement');
        h.commerce.prepare(intent, h.clock(), h.verifyGrant); h.exchange(intent); h.commerce.finalize(intent.operationId); correlations.push(intent.operationId);
        expect(h.count('sifisher', 377)).toBe(0); expect(h.count('sifisher', 995)).toBe(720); expect(h.businessStock(377)).toBe(1); };
    const prepareWork = async () => { const request = await h.cookRequest(), api = await h.gateway();
        api.delegateBusinessPlayerAction(request.requestId, h.workRunId, h.agentPath, h.withWork(w => w.get('si-a14-cook-shift')).scheduledStart, h.workOptions); return request; };
    const cook = async (paidWork = false, burnt = false, hooks = {}) => {
        await procure(); h.reserveKitchen(); if (paidWork) await prepareWork(); h.seed(burnt ? 1 : 4096);
        const run = await h.runFood('cook', 'sicook', paidWork ? h.workRunId : randomUUID(), hooks);
        expect(run.status, run.message).toBe(burnt ? 'failed' : 'completed'); correlations.push(run.runId); return run;
    };
    const earn = async () => { const api = await h.gateway(); const request = api.finishAdminPlayerActionRun(h.workRunId, true, 'Source-backed terminal journal', h.agentPath, null, h.workOptions);
        expect(request.status).toBe('settling'); return request; };
    const paid = async () => { await h.payWage(); await h.payWage(); expect(h.count('sicook', 995)).toBe(725);
        expect(h.withWork(w => w.get('si-a14-cook-shift')).wageStatus).toBe('paid'); expect(totalGp()).toBe(3800); };
    const sale = () => { h.at('sicourier'); const i = h.commerceIntent('sale'); h.commerce.prepare(i, h.clock(), h.verifyGrant); correlations.push(i.operationId); return i; };
    const rent = () => { h.at('sicourier', 2970, 3330); const observed = h.clock(), i = h.rentIntent(observed); h.housing.reserve(i, observed); correlations.push(i.operationId); return i; };
    try {
        if (scenario === 'happy') {
            await cook(true); await earn(); await paid(); const i = sale(); h.exchange(i); h.commerce.finalize(i.operationId);
            expect(h.count('sicourier', 379)).toBe(2); expect(h.count('sicourier', 995)).toBe(660); expect(h.businessStock(379)).toBe(0);
            const r = rent(); h.rent('pay'); expect(h.housing.finalize(r.operationId).phase).toBe('active');
            expect(h.rent('sleep')).toBe('sleeping'); expect(h.rent('wake')).toBe('awake');
            for (let n = 0; n < 2; n++) { h.advance(60000); const result = await h.runFood('consume', 'sicourier'); expect(result.status, result.message).toBe('completed'); await h.applyFood(); correlations.push(result.runId); }
            expect(h.count('sicourier', 379)).toBe(0); const applications = await h.foodApplications();
            expect(applications.applications).toHaveLength(2); expect(applications.applications.every((a: any) => a.hungerRelief > 0)).toBeTrue();
            expect(h.count('sicourier', 995)).toBe(160); expect(h.count('silessor', 995)).toBe(1200); expect(totalGp()).toBe(3800);
        } else if (scenario === 'empty-input') {
            expect(() => h.reserveKitchen()).toThrow(); expect(h.businessStock(379)).toBe(0); expect(totalGp()).toBe(3800);
        } else if (scenario === 'empty-gp') {
            await gather(); const { InstitutionTreasuryStore } = await load('server/gateway/admin/institution-treasury.ts');
            const t = new InstitutionTreasuryStore(h.treasuryPath); try { t.setBalance('business', 'karamja-kitchen', t.get('business', 'karamja-kitchen').revision, 0); } finally { t.close(); }
            const i = h.commerceIntent('procurement'); expect(() => h.commerce.prepare(i, h.clock(), h.verifyGrant)).toThrow();
            expect(() => h.exchange(i)).toThrow(); expect(h.count('sifisher', 377)).toBe(1); expect(treasury().reserved_gp).toBe(0);
        } else if (scenario === 'full-inventory') {
            await procure(); h.reserveKitchen(); const p = h.players.get('sicook')!; while (p.getInventory(InvType.INV)!.freeSlotCount) p.invAdd(InvType.INV, 2347, 1); h.save(p);
            expect(() => h.kitchenCommand('issue')).toThrow('full'); p.invDel(InvType.INV, 2347, 1); h.save(p);
            expect(h.kitchenCommand('issue').phase).toBe('issued'); p.invAdd(InvType.INV, 2347, 1); h.save(p); expect(() => h.kitchenCommand('process')).toThrow('full');
            expect(h.kitchenCommand('return').phase).toBe('returned-input'); expect(h.finishKitchen().status).toBe('cancelled'); expect(h.businessStock(377)).toBe(1);
        } else if (scenario === 'burnt-batch') {
            await cook(true, true); const api = await h.gateway(); const request = api.finishAdminPlayerActionRun(h.workRunId, true, 'Exit 0 cannot earn burnt food', h.agentPath, null, h.workOptions);
            expect(request.status).toBe('running'); expect(h.withWork(w => w.get('si-a14-cook-shift')).wageStatus).toBe('unearned');
            expect(h.businessStock(379)).toBe(0); expect(h.businessStock(381)).toBe(1); expect(h.count('sicook', 995)).toBe(700);
        } else if (scenario === 'too-high-price') {
            await gather(); const i = h.commerceIntent('procurement'); i.unitPriceGp = 21;
            expect(() => h.commerce.prepare(i, h.clock(), h.verifyGrant)).toThrow(); expect(h.commerce.get(i.operationId)).toBeNull(); expect(totalGp()).toBe(3800);
        } else if (scenario === 'wrong-partner') {
            await gather(); const i = h.commerceIntent('procurement'); h.commerce.prepare(i, h.clock(), h.verifyGrant); h.at('sicourier');
            expect(() => h.exchange(i, 'execute', 'sicourier')).toThrow(); expect(h.count('sifisher', 377)).toBe(1); expect(h.commerce.get(i.operationId).phase).toBe('prepared');
        } else if (scenario === 'wrong-tenant') {
            rent(); expect(() => h.rent('pay', 'sifisher')).toThrow(); expect(h.count('sicourier', 995)).toBe(700); expect(h.housing.get('si-a14-rent').phase).toBe('reserved');
        } else if (scenario === 'receipt-replay-tamper') {
            await cook(); const i = sale(); h.exchange(i); h.commerce.finalize(i.operationId); const before = h.count('sicourier', 995);
            h.exchange(i); h.commerce.finalize(i.operationId); expect(h.count('sicourier', 995)).toBe(before);
            h.market.db.run("UPDATE native_food_commerce_operation SET record_json=replace(record_json,'completed','forged') WHERE operation_id=?1", [i.operationId]);
            expect(() => h.commerce.finalize(i.operationId)).toThrow(); expect(h.count('sicourier', 379)).toBe(2);
        } else if (scenario === 'missing-source') {
            await cook(); const i = sale(); h.exchange(i); h.market.db.run('DELETE FROM native_food_commerce_operation WHERE operation_id=?1', [i.operationId]);
            expect(() => h.commerce.finalize(i.operationId)).toThrow(); expect(h.commerce.get(i.operationId).phase).toBe('prepared');
        } else if (scenario === 'death-during-work') {
            await procure(); h.reserveKitchen(); await prepareWork(); h.kitchenCommand('issue');
            const p = h.players.get('sicook')!, maxHp = p.baseLevels[PlayerStat.HITPOINTS];
            expect(recordPopulationDamage({ username: p.username, sessionId: 'si-a14-death', engineTick: World.currentTick, occurredAt: h.clock().wallTime,
                hpBefore: p.levels[PlayerStat.HITPOINTS], hpAfter: 0, maxHp, damageType: 0 })).toBeTrue();
            p.populationTerminal = true; p.levels[PlayerStat.HITPOINTS] = 0; h.save(p);
            expect(() => h.kitchenCommand('process')).toThrow(); expect(h.health.deathFor('sicook')).not.toBeNull();
            expect(h.kitchenCommand('return').phase).toBe('returned-input'); expect(h.finishKitchen().status).toBe('cancelled');
            expect(h.withWork(w => w.get('si-a14-cook-shift')).wageStatus).toBe('unearned'); expect(h.count('sicook', 995)).toBe(700);
        } else if (scenario === 'engine-unavailable') {
            rent(); const { runLivelihoodReplan } = await load('server/gateway/admin/livelihood-runtime.ts');
            const event = { eventId: randomUUID(), agentId: 'sicourier', type: 'goal-changed', occurredAt: new Date().toISOString(), sourceKey: 'si-a14:engine-offline', summary: 'Native transport interruption.' };
            const ports = { snapshot: async () => ({ lifecycle: h.binding('sicourier').lifecycleId, alive: true, role: 'player', clockRunning: true, physicalAllowed: true,
                needs: { hunger: 0, fatigue: 0, sleeping: false }, rent: { kind: 'housing', operation: 'pay', operationId: 'si-a14-rent' } }),
                execute: async () => { throw new Error('engine connection unavailable'); }, reconcile: async () => ({ status: 'pending', reason: 'native-receipt-missing', source: null }) };
            const opts = { agentPath: h.agentPath, ports, dispatchSkill: async () => { throw new Error('No skill fallback'); } };
            expect((await runLivelihoodReplan('sicourier', event, opts)).status).toBe('bounded-wait');
            expect((await runLivelihoodReplan('sicourier', event, opts)).status).toBe('bounded-wait');
            expect(h.useAgents(s => s.listLivelihoodJournal('sicourier'))).toHaveLength(1); expect(h.count('sicourier', 995)).toBe(700);
        } else if (scenario === 'gateway-unavailable') {
            h.at('sifisher'); h.seed(); const runId = 'afaa1400-0000-4000-8000-000000000005';
            const interrupted = await h.runFood('gather', 'sifisher', runId, { dropAcknowledgement: true });
            expect(interrupted.status).not.toBe('completed'); expect(h.count('sifisher', 377)).toBe(1);
            const recovered = await h.runFood('gather', 'sifisher', runId);
            expect(recovered.status, recovered.message).toBe('completed'); expect(await h.verifiedFoodRun(recovered)).toBeTrue();
            expect(h.count('sifisher', 377)).toBe(1); expect(totalGp()).toBe(3800); correlations.push(runId);
        } else if (scenario === 'uncertain-trade') {
            await cook(); const i = sale(); let calls = 0;
            const executor = new NativeCommerceExecutor({ market: h.market, trades: h.trades, source: h.commerceSource, clock: h.clock, identity: h.identity,
                checkpoint: () => { if (++calls === 2) throw new Error('native checkpoint interruption'); } });
            expect(() => executor.execute({ operation: 'execute', operationId: i.operationId }, h.players.get('sicook')!, h.players.get('sicourier')!)).toThrow();
            expect(() => h.commerce.finalize(i.operationId)).toThrow('uncertain'); expect(() => h.exchange(i, 'cancel')).toThrow(); expect(() => h.exchange(i)).toThrow();
            expect(h.count('sicourier', 995)).toBe(700); expect(h.count('sicourier', 379)).toBe(1); expect(h.commerce.get(i.operationId).phase).toBe('prepared');
        } else if (scenario === 'wage-checkpoint-rollback' || scenario === 'wage-projection-failure') {
            await cook(true); await earn();
            if (scenario === 'wage-checkpoint-rollback') {
                await expect(h.payWage({ checkpoint: () => { throw new Error('wage checkpoint fault'); } })).rejects.toThrow('wage checkpoint fault');
                expect(h.count('sicook', 995)).toBe(700);
            } else { await expect(h.payWage({ projectionFault: true })).rejects.toThrow('reward projection fault'); expect(h.count('sicook', 995)).toBe(725); }
            expect(treasury()).toMatchObject({ balance_gp: 980, reserved_gp: 25 }); await paid();
        } else if (scenario === 'wage-source-missing' || scenario === 'wage-receipt-tamper') {
            await cook(true); await earn();
            await expect(h.payWage({ afterNative: () => { throw new Error('lost wage ACK'); } })).rejects.toThrow('lost wage ACK');
            expect(h.count('sicook', 995)).toBe(725);
            if (scenario === 'wage-source-missing') h.market.db.run('DELETE FROM player_action_reward');
            else h.market.db.run('UPDATE player_action_reward SET coins_after=coins_after+1');
            await expect(h.payWage()).rejects.toThrow('checkpoint proof');
            expect(h.count('sicook', 995)).toBe(725); expect(treasury()).toMatchObject({ balance_gp: 980, reserved_gp: 25 });
            expect(h.withWork(w => w.get('si-a14-cook-shift')).wageStatus).toBe('earned');
        } else if (['crash-reservation', 'crash-native-commit', 'crash-suspended-cook', 'crash-domain-apply', 'crash-wage-commit'].includes(scenario)) {
            if (!recovery) {
                await procure(); h.reserveKitchen(); await h.cookRequest(); if (scenario === 'crash-reservation') boundary();
                await prepareWork(); h.seed(); const result = await h.runFood('cook', 'sicook', h.workRunId,
                    scenario === 'crash-native-commit' ? { afterNativeReturn: boundary } : scenario === 'crash-suspended-cook' ? { afterNativeWaiting: boundary } : {}); expect(result.status, result.message).toBe('completed');
                await earn(); if (scenario === 'crash-domain-apply') boundary(); await h.payWage({ afterNative: boundary });
            } else {
                if (scenario === 'crash-reservation') await prepareWork();
                if (['crash-reservation', 'crash-native-commit', 'crash-suspended-cook'].includes(scenario)) { h.seed(); const result = await h.runFood('cook', 'sicook', h.workRunId); expect(result.status, result.message).toBe('completed'); await earn(); }
                await paid(); expect(h.businessStock(377)).toBe(0); expect(h.businessStock(379)).toBe(1);
                expect(h.market.db.query('SELECT COUNT(*) AS n FROM player_action_reward').get()).toMatchObject({ n: 1 });
            }
        } else if (scenario === 'crash-rent-commit' || scenario === 'crash-routine-update') {
            if (scenario === 'crash-rent-commit') {
                if (!recovery) { rent(); h.rent('pay'); boundary(); }
                expect(h.housing.finalize('si-a14-rent').phase).toBe('active'); expect(h.rent('pay')).toBe('paid');
            } else {
                if (!recovery) rent(); const { runLivelihoodReplan } = await load('server/gateway/admin/livelihood-runtime.ts'); let executed = 0;
                const event = { eventId: 'afaa1400-0000-4000-8000-000000000004', agentId: 'sicourier', type: 'goal-changed', occurredAt: new Date().toISOString(), sourceKey: 'si-a14:rent-proof', summary: 'Native housing state.' };
                const proof = async () => { const order = h.housing.finalize('si-a14-rent'); return { status: 'completed', reason: 'native-rent-source', source: order.nativeDigest }; };
                const ports = { snapshot: async () => ({ lifecycle: h.binding('sicourier').lifecycleId, alive: true, role: 'player', clockRunning: true, physicalAllowed: true,
                    needs: { hunger: 0, fatigue: 0, sleeping: false }, rent: { kind: 'housing', operation: 'pay', operationId: 'si-a14-rent' } }),
                    execute: async () => { executed++; h.rent('pay'); const result = await proof(); boundary(); return result; }, reconcile: proof };
                const opts = { agentPath: h.agentPath, ports, dispatchSkill: async () => { throw new Error('No skill fallback'); } };
                expect((await runLivelihoodReplan('sicourier', event, opts)).status).toBe('completed');
                expect((await runLivelihoodReplan('sicourier', event, opts)).status).toBe('completed'); expect(executed).toBe(0);
                expect(h.useAgents(s => s.listLivelihoodJournal('sicourier').filter((e: any) => e.phase === 'completed'))).toHaveLength(1);
            }
            expect(h.count('sicourier', 995)).toBe(200); expect(h.count('silessor', 995)).toBe(1200); expect(totalGp()).toBe(3800);
        } else if (scenario === 'crash-goal-update') {
            const runId = 'afaa1400-0000-4000-8000-000000000002', goalId = 'si-supply-sifisher';
            const { recoverSkillTerminalWakeups } = await load('server/gateway/admin/skill-terminal-recovery.ts');
            if (!recovery) {
                const { createSkillParameterBinding } = await load('agent-state/skill-binding.ts');
                h.useAgents(s => { const now = new Date().toISOString(), e = s.getAutonomyEnrollment('sifisher'); s.claimAutonomyEnrollment('sifisher', e.revision, 'gateway:si-a14', new Date(Date.now() + 60000).toISOString(), now);
                    const p = s.getControlProfile('sifisher'); s.recordDecision('sifisher', p.revision, { decisionId: 'si-a14-goal', trigger: 'scheduled', llmCostMicros: 0, operationalBudgetGp: 0, contextDigest: foodDigest(['si-a14']) }, now);
                    s.recordSkillDispatch({ runId, agentId: 'sifisher', goalId, decisionId: 'si-a14-goal', skill: { id: 'procedure.food.gather-lobster', version: '0.1.0' },
                        binding: createSkillParameterBinding({ sourceKind: 'approved-policy', sourceId: 'society-livelihood:1.0.0', parameters: {} }), policyId: 'society-livelihood', policyVersion: '1.0.0' }, now); });
                h.at('sifisher'); h.seed(); const run = await h.runFood('gather', 'sifisher', runId); expect(run.status).toBe('completed'); expect(await h.verifiedFoodRun(run)).toBeTrue();
                h.sql(h.agentPath, db => db.run("CREATE TRIGGER si_a14_goal_fault BEFORE UPDATE ON agent_goal_execution BEGIN SELECT RAISE(ABORT,'goal-update interruption'); END"));
                await expect(recoverSkillTerminalWakeups(join(workspace, '.local/admin/replan-inbox.sqlite'), { agentPath: h.agentPath, skillRunRoot: h.workOptions.runRoot, simulationClock: { store: h.time, clockId: 'world' } })).rejects.toThrow('goal-update interruption');
                expect(h.useAgents(s => s.getSkillRunOutcome(runId))).toBeNull(); boundary();
            }
            h.sql(h.agentPath, db => db.run('DROP TRIGGER si_a14_goal_fault'));
            const run = JSON.parse(readFileSync(join(h.workOptions.runRoot, `${runId}.json`), 'utf8')); expect(await h.verifiedFoodRun(run)).toBeTrue();
            const options = { agentPath: h.agentPath, skillRunRoot: h.workOptions.runRoot, simulationClock: { store: h.time, clockId: 'world' } };
            await recoverSkillTerminalWakeups(join(workspace, '.local/admin/replan-inbox.sqlite'), options); await recoverSkillTerminalWakeups(join(workspace, '.local/admin/replan-inbox.sqlite'), options);
            expect(h.useAgents(s => s.getGoalExecution(goalId)).progress.successfulRuns).toBe(1); expect(h.count('sifisher', 377)).toBe(1); correlations.push(runId);
        } else throw new Error(`Unknown SI-A14 scenario: ${scenario}`);
        const record = { schemaVersion: 1, caseId: scenario, fixtureDigest: h.fixture.digest, worldId: h.worldId, boundaries: TEST_BOUNDARIES,
            actors: h.fixture.avatars.map((a: any) => ({ actorId: a.agentId, gp: h.count(a.username, 995) })),
            nativeCheckpointDigest: foodDigest(h.fixture.avatars.map((a: any) => [...h.market.saved(a.username)!])),
            correlations, processKilled: recovery };
        writeFileSync(join(workspace, '.local/si-a14-case.json'), JSON.stringify(record));
    } finally { h.close(); }
}, 120000);
