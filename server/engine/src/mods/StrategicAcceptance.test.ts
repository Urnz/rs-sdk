import { afterAll, afterEach, beforeAll, expect, setSystemTime, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../../../agent-state/store.js';
import { NeedsStore } from '../../../../needs/store.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../../../../needs/config.js';
import { buildDecisionContext } from '../../../../agent-state/context.js';
import { buildLlmPlanningInput } from '../../../../llm-runtime/planning.js';
import { CapabilityGapStore } from '../../../../agent-skills/capability-gaps.js';
import { SkillExecutor } from '../../../../agent-skills/executor.js';
import { RsSdkSkillRuntime } from '../../../../agent-skills/rs-sdk-runtime.js';
import type { SkillDefinition } from '../../../../agent-skills/types.js';
import type { BotActions } from '../../../../sdk/actions.js';
import type { BotWorldState } from '../../../../sdk/types.js';
import type { LlmPlanResult, LlmPlanningInput } from '../../../../llm-runtime/types.js';
import type { GatewayBotSnapshot } from '../../../gateway/admin/types.js';
import { BusinessManagerStore } from '../../../gateway/admin/business-manager.js';
import { readEconomicObservation } from '../../../gateway/admin/economic-observer-source.js';
import { ReplanInboxStore } from '../../../gateway/admin/replan-inbox.js';
import { runPlayerStrategy, type PlayerStrategyContext } from '../../../gateway/admin/player-strategy-runtime.js';
import { runEconomicCooperation, cooperationActorBinding } from '../../../gateway/admin/economic-cooperation-runtime.js';
import { EconomicContractStore } from '../../../gateway/admin/economic-contracts.js';
import { acceptFundedEconomicOffer, resolveEconomicContract, recordAndSettleEconomicContractEvidence } from '../../../gateway/admin/economic-contract-settlement.js';
import { InstitutionTreasuryStore } from '../../../gateway/admin/institution-treasury.js';
import { institutionTreasuryPathFor } from '../../../gateway/admin/treasury-paths.js';
import type { CooperationPolicy } from '../../../gateway/admin/economic-cooperation-policy.js';
import type { AdminSkillRun } from '../../../gateway/admin/skill-history.js';
import { verifyFoodSkillRunSources } from '../../../gateway/admin/native-food-skills.js';
import { PlayerRewardStore } from './PlayerRewardStore.js';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import NpcType from '../cache/config/NpcType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import World from '../engine/World.js';
import JavaRandom from '../util/JavaRandom.js';
import { root, kitchen, loadPackedContent, closeNativeFoodFixtures, retainNativeFoodFixture,
    grant, options, sdkHarness, definition, closers } from './native-food-skill-fixture.js';
import { STRATEGIC_SCENARIOS, StrategicTrialPlanner, strategicDigest,
    type StrategicManifest, type StrategicTrace } from '../../../../society-experiments/strategic-acceptance.js';

const output = process.env.SI_B06_OUTPUT ?? join(mkdtempSync(join(tmpdir(), 'si-b06-')), 'attempt');
const baseline = { world: 'fixture-world', clock: 'fixture-clock', lifecycle: 'fixture-lifecycle', profile: 'a'.repeat(64),
    inventory: [[301, 1], [377, 1], [379, 2], [995, 20]] as [number, number][], businessRaw: 1, treasuryGp: 25, wageGp: 5,
    fundedWorkRewards: [5, 4, 3], existingWorkHoldsGp: 12, cooperationTreasuryGp: 25,
    skills: ['procedure.food.gather-lobster@0.1.0', 'procedure.food.consume-lobster@0.1.0'], trust: [30, 20] };
const manifest: StrategicManifest = { protocol: 'si-b06.v2', runId: randomUUID(), provider: process.env.SI_B06_PROVIDER === 'openai' ? 'openai' : 'scripted',
    model: process.env.SI_B06_PROVIDER === 'openai' ? 'gpt-6-luna' : 'deterministic-scripted-v1', credentialWorkspace: root,
    sourceDigest: process.env.SI_B06_SOURCE_DIGEST ?? 'test-only-unpinned', baselineDigest: strategicDigest(baseline),
    startedAt: new Date().toISOString(), scenarios: STRATEGIC_SCENARIOS };
const planner = new StrategicTrialPlanner(output, manifest);
beforeAll(loadPackedContent);
afterEach(() => { closeNativeFoodFixtures(); setSystemTime(); });
afterAll(async () => {
    const report = planner.finish(await planner.ready());
    console.info('[strategic-report]', JSON.stringify({ output, ...report }));
    // A failed real decision is an experiment outcome, not a failed test harness.
    if (manifest.provider === 'scripted') expect(report.technical).toBe('pass');
});

for (const scenario of STRATEGIC_SCENARIOS) test(`SI-B06 ${scenario}: retained native decision trajectory`, async () => {
    const directory = join(output, scenario); mkdirSync(directory);
    const f = kitchen('kitchen-mind', 'worker', directory); retainNativeFoodFixture(f.dir);
    const agentPath = join(directory, '.local/economy/agents.sqlite'), contractsPath = join(directory, 'contracts.sqlite');
    const s = new AgentStateStore(agentPath); closers.push(() => s.close());
    const gather = { ...definition('gather'), status: 'verified' as const }, consume = { ...definition('consume'), status: 'verified' as const };
    const definitions = [gather, consume], start = new Date().toISOString();
    s.createIdentity({ agentId: 'worker', playerUsername: 'prodtest', displayName: 'Independent worker', background: 'Local voluntary livelihood', personalityTraits: ['prudent'] });
    s.createIdentity({ agentId: 'kitchen-mind', displayName: 'Kitchen', background: 'Finite employer', personalityTraits: ['careful'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'fish-kitchen', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 10, dailyLlmBudgetMicros: 50000, dailyOperationalBudgetGp: 25 } });
    s.createIdentity({ agentId: 'cooperation-mind', displayName: 'Independent partner', background: 'New finite work opportunity', personalityTraits: ['careful'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'alternative-kitchen', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 10, dailyLlmBudgetMicros: 50000, dailyOperationalBudgetGp: 25 } });
    const p = s.getControlProfile('worker')!;
    s.setControlProfile('worker', p.revision, { ...p, dailyLlmBudgetMicros: 50000, dailyOperationalBudgetGp: 10 });
    for (const d of definitions) s.setSkillKnowledge('worker', d, 'known', null);
    s.createGoal('worker', { goalId: 'life', horizon: 'life', title: 'Live independently' });
    s.createGoal('worker', { goalId: 'strategy', parentGoalId: 'life', horizon: 'long-term', title: 'Maintain livelihood' });
    s.createGoal('worker', { goalId: 'reserve', parentGoalId: 'strategy', horizon: 'current', title: 'Food and future inputs',
        objective: { policy: 'si-b02.v1', mode: 'maintain', purpose: 'livelihood', predicates: [
            { kind: 'food-reserve-at-least', value: 3 }, { kind: 'cash-reserve-at-least', value: 25 }, { kind: 'hunger-at-most', value: 5000 }] } });
    s.createGoal('worker', { goalId: 'routine', parentGoalId: 'reserve', horizon: 'immediate', title: 'Previous meal routine', skill: consume });
    for (const id of ['worker', 'kitchen-mind', 'cooperation-mind']) {
        s.createAutonomyEnrollment(id, { status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0' });
        s.claimAutonomyEnrollment(id, 1, 'si-b06', new Date(Date.now() + 600000).toISOString());
    }
    s.setRelationship('kitchen-mind', null, { actorKey: 'agent.worker', displayName: 'Worker', trust: 30 });
    s.setRelationship('worker', null, { actorKey: 'agent.kitchen-mind', displayName: 'Kitchen', trust: 20 });
    s.setRelationship('cooperation-mind', null, { actorKey: 'agent.worker', displayName: 'Worker', trust: 30 });
    s.setRelationship('worker', null, { actorKey: 'agent.cooperation-mind', displayName: 'Independent partner', trust: 20 });
    const treasuryPath = institutionTreasuryPathFor(agentPath), treasury = new InstitutionTreasuryStore(treasuryPath);
    treasury.setBalance('business', 'fish-kitchen', 1, 25); treasury.setBalance('business', 'alternative-kitchen', 1, 25); treasury.close();
    const employer = new BusinessManagerStore(f.businessPath);
    const oldEmployment = employer.get('fish-kitchen')!.employments[0]!;
    employer.endEmployment('fish-kitchen', oldEmployment.employmentId, oldEmployment.revision);
    const employment = employer.hire('fish-kitchen', { workerAgentId: 'worker', role: 'worker', title: 'Existing work', wageGp: 5 });
    employer.create({ businessId: 'alternative-kitchen', name: 'Independent partner', summary: 'Finite new work opportunity', ownerAgentId: 'cooperation-mind' });
    const routes: import('../../../gateway/admin/economic-contracts.js').EconomicContract[] = [];
    for (const [index, reward] of [5, 4, 3].entries()) {
        const offers = new EconomicContractStore(contractsPath), offerId = `00000000-0000-4000-8000-00000000000${index + 1}`;
        try { offers.createCooperationOffer({ creatorAgentId: 'kitchen-mind', counterpartyAgentId: 'worker', kind: 'work',
            title: `Existing funded work route ${index + 1}`, summary: `One native invocation for ${reward} GP; no delivered-input claim`,
            creatorProvides: { gp: reward, items: [], service: null }, counterpartyProvides: { gp: 0, items: [], service: 'one-native-invocation', skill: { id: gather.id, version: gather.version } },
            expiresAt: new Date(Date.now() + 300000).toISOString() }, { actionId: offerId, creatorBinding: cooperationActorBinding(s, 'kitchen-mind'),
                counterpartyBinding: cooperationActorBinding(s, 'worker'), grantDigest: manifest.baselineDigest }, new Date().toISOString(), offerId);
        } finally { offers.close(); }
        routes.push((await acceptFundedEconomicOffer(offerId, 'worker', 1, { agentPath, contractsPath, treasuryPath })).contract);
    }
    expect(routes.map(c => c.partyAProvides.gp)).toEqual([5, 4, 3]);
    writeFileSync(join(directory, 'baseline-contracts.json'), JSON.stringify(routes, null, 2));
    f.inv.add(995, 20); f.inv.add(377, 1); f.inv.add(379, 2);
    f.market.checkpoint('prodtest', f.player.save(false), true);
    const original = f.ports.identity;
    f.ports.identity = (...args) => { const v = original(...args); return v ? { ...v, clock: { ...v.clock, wallTime: new Date().toISOString() } } : null; };
    // Explicit fixture admission into the real durable needs store. No invented
    // zero-hunger fact, no production population record or clock mutation.
    const needsPolicy = loadNeedsPolicyCatalog(join(root, 'config/needs-policies.json')).policies[0]!;
    const needsDynamics = loadNeedsDynamicsPolicyCatalog(join(root, 'config/needs-dynamics-policies.json'), needsPolicy).policies[0]!;
    const needs = new NeedsStore(join(directory, 'needs.sqlite'), needsPolicy, needsDynamics); closers.push(() => needs.close());
    const needsBinding = options(f).binding('prodtest')!;
    needs.initialize({ binding: needsBinding, clock: f.ports.identity('prodtest', 'needs-baseline', 0, World.currentTick)!.clock,
        history: [], playerTime: null, admission: { kind: 'genesis', evidenceId: 'si-b06-baseline', evidenceDigest: manifest.baselineDigest } });
    const world = (): BotWorldState => {
        const type = NpcType.get(f.npc.type);
        return { tick: World.currentTick, inGame: true, player: { name: 'prodtest', isDead: false, hp: 20, maxHp: 20,
            worldX: f.player.x, worldZ: f.player.z, level: f.player.level },
        inventory: f.inv.items.flatMap((i, slot) => i ? [{ slot, id: i.id, name: ObjType.get(i.id).name, count: i.count, optionsWithIndex: [] }] : []),
        skills: [{ name: 'Fishing', baseLevel: f.player.baseLevels[PlayerStat.FISHING] }], nearbyLocs: [], nearbyNpcs: [{ id: f.npc.type,
            name: type.name, reachable: true, optionsWithIndex: (type.op ?? []).flatMap((text, index) => text ? [{ text, opIndex: index + 1 }] : []) }],
        shop: { isOpen: false, shopItems: [] }, equipment: [], gameMessages: [] } as unknown as BotWorldState;
    };
    const observe = () => {
        const now = new Date().toISOString(), gateway = { username: 'prodtest', status: 'active', state: world(), lastStateReceivedAt: Date.parse(now) } as unknown as GatewayBotSnapshot;
        const observation = readEconomicObservation('worker', { agentPath, contractsPath, businessPath: f.businessPath, workspace: directory, now,
            gatewayBots: new Map([['prodtest', gateway]]) });
        const ownNeeds = needs.get(needsBinding)!;
        observation.facts = observation.facts.filter(f => f.key !== 'hunger');
        observation.facts.push({ key: 'hunger', value: ownNeeds.state.values.find(v => v.needId === 'hunger')!.value,
            source: 'durable-needs', cursor: String(ownNeeds.revision), observedAt: now, freshness: 'fresh', trust: 'native' });
        return observation;
    };
    const inventoryCounts = new Map<number, number>();
    for (const item of f.inv.items) if (item) inventoryCounts.set(item.id, (inventoryCounts.get(item.id) ?? 0) + item.count);
    const actualBaseline = { ...baseline, inventory: [...inventoryCounts].sort((a, b) => a[0] - b[0]) };
    expect(actualBaseline.inventory).toEqual(baseline.inventory);
    writeFileSync(join(directory, 'baseline.json'), JSON.stringify(actualBaseline, null, 2));
    const inbox = new ReplanInboxStore(join(directory, 'inbox.sqlite')); closers.push(() => inbox.close());
    expect(inbox.observeEconomy(observe())).toBeNull();
    if (scenario === 'income-loss') {
        employer.endEmployment('fish-kitchen', employment.employmentId, employment.revision);
        routes[0] = await resolveEconomicContract(routes[0]!.contractId, 'cancelled', routes[0]!.revision, 'The original income route ended', { agentPath, contractsPath, treasuryPath });
    }
    if (scenario === 'raw-scarcity') { f.inv.remove(377, 1); World.currentTick++; f.market.checkpoint('prodtest', f.player.save(false), true); }
    employer.close();
    await new Promise(resolve => setTimeout(resolve, 2));
    const observation = observe(), recovered = inbox.observeEconomy(observation);
    const event = recovered?.event ?? { eventId: randomUUID(), agentId: 'worker', type: 'significant-economic-change' as const,
        sourceKey: `native-checkpoint:${scenario}`, occurredAt: start, summary: 'Own situation and known voluntary opportunities' };
    if (scenario === 'income-loss' || scenario === 'raw-scarcity') expect(recovered).not.toBeNull();
    writeFileSync(join(directory, 'observation.json'), JSON.stringify({ event, observation }, null, 2));
    const trace: StrategicTrace = { scenario, baselineDigest: manifest.baselineDigest, eventId: event.eventId,
        eventSource: event.sourceKey, observedSource: event.sourceKey, agentId: 'worker', plan: null, alternativeIds: [], selectedStrategy: null,
        adoptedRunId: null, nativeRunId: null, nativeVerified: false,
        outcome: { rawDelta: 0, gpDelta: 0, proposalId: null, partnerAccepted: false }, reason: '' };
    const execute = async (d: SkillDefinition, parameters: Record<string, string | number | boolean>, runId: string) => {
        let terminal: AdminSkillRun | undefined;
        JavaRandom.setSeed(4096); f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
        await sdkHarness(f, async sdk => {
            const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
            const result = await new SkillExecutor(runtime).execute(d, { runId, parameters }); result.username = 'prodtest';
            writeFileSync(join(directory, `${runId}.json`), JSON.stringify(result));
            terminal = { ...result, username: 'prodtest', startedAt: result.events[0]!.timestamp, finishedAt: result.events.at(-1)!.timestamp };
            trace.nativeRunId = runId;
            const proof = verifyFoodSkillRunSources(directory, result, options(f));
            trace.nativeVerified = result.status === 'completed' && proof;
            writeFileSync(join(directory, `${runId}.verification.json`), JSON.stringify(proof));
        });
        return terminal!;
    };
    const settle = async (contractId: string, terminal: AdminSkillRun) => {
        const rewards = new PlayerRewardStore(f.path, false, f.market.db); closers.push(() => rewards.close());
        const rewarder = async (username: string, amount: number, settlementId: string) => {
            let receipt: ReturnType<PlayerRewardStore['credit']>;
            f.market.db.transaction(() => { receipt = rewards.credit(settlementId, username, amount, {
                balance: () => f.inv.getItemCount(995), credit: n => { f.inv.add(995, n); return n; }, remove: n => f.inv.remove(995, n) });
                f.market.checkpoint(username, f.player.save(false), true); }).immediate();
            return { ok: true, commandId: randomUUID(), username, amount, settlementId,
                reward: { status: 'committed' as const, coinsBefore: receipt!.coinsBefore!, coinsAfter: receipt!.coinsAfter! } };
        };
        const paid = await recordAndSettleEconomicContractEvidence(contractId, 'worker', terminal,
            new Map([['worker', 'prodtest'], ['kitchen-mind', null], ['cooperation-mind', null]]), { agentPath, contractsPath, treasuryPath, rewarder,
                nativeEvidence: { workspace: directory, worldId: 'fixture-world', checkpointPath: f.path, businessPath: f.businessPath } });
        expect(paid.contract.status).toBe('fulfilled');
    };
    const runStrategy = async (strategyEvent: typeof event, activeContracts: import('../../../gateway/admin/economic-contracts.js').EconomicContract[] = []) => {
        let terminal: AdminSkillRun | undefined;
            const read = async (): Promise<PlayerStrategyContext> => {
                const view = observe(), now = view.observedAt, old = s.getWorkingMemory('worker');
                s.setWorkingMemory('worker', old?.revision ?? null, { summary: 'Own native inventory and economic situation', observedAt: now }, now);
                s.evaluateGoalStates('worker', view, now);
                const snapshot = s.getSnapshot('worker')!;
                return { snapshot, profile: s.getControlProfile('worker')!, parent: s.getGoal('reserve')!, world: world(), observedAt: now, now,
                    definitions, contracts: activeContracts, incoming: [], spentGp: 0, maxLlmCostMicros: 5000, blockers: [],
                    trustedContext: buildDecisionContext(snapshot, { now, maxCharacters: 2500, economicObservation: { ...view, facts: view.facts.filter(f => f.value !== null) } }),
                    sourceAreas: JSON.parse(readFileSync(join(directory, 'config/native-food-production.json'), 'utf8')).sources,
                    config: { enabled: true, maxOperations: 2, maxTimeoutMs: 15000, allowedSkills: [
                        { ...gather, operations: ['food-gather'], itemNames: ['raw lobster'], maxQuantity: 1 },
                        { ...consume, operations: ['food-consume'], itemNames: ['lobster'], maxQuantity: 1 }] } };
            };
            const result = await runPlayerStrategy(strategyEvent, { agentPath, read, gaps: new CapabilityGapStore(join(directory, 'gaps.json')),
                plan: async (context, request) => {
                    const input = buildLlmPlanningInput(context.snapshot, { context: { now: context.now }, trustedContext: context.trustedContext,
                        runId: strategyEvent.eventId, availableSkills: definitions.map(({ id, version, name, description }) => ({ id, version, name, description })),
                        strategy: { parentGoalId: 'reserve', alternatives: request.options.map(({ binding, ...o }) => o) } });
                    if (scenario !== 'cooperation') {
                        const fact = observation.facts.find(f => scenario === 'income-loss' ? f.key.startsWith('income:')
                            : scenario === 'raw-scarcity' ? f.key === 'stock:377' : f.key === 'own-food-portions')!;
                        trace.eventSource = fact.source;
                        trace.perceivedChange = input.trustedContext.includes(fact.key) && input.trustedContext.includes(fact.source)
                            && input.trustedContext.includes(JSON.stringify(fact.value));
                        trace.observedSource = trace.perceivedChange ? fact.source : '';
                    }
                    if (scenario !== 'cooperation') trace.alternativeIds = request.options.map(o => o.optionId);
                    const plan = await planner.plan(input, request => ({ output: { decision: 'select_alternative', goalId: 'reserve',
                        alternativeId: [...request.alternatives!].sort((a, b) => (b.rewardGp ?? -1) - (a.rewardGp ?? -1))[0]!.optionId,
                        goals: [], tool: null, reason: 'Scripted technical trajectory; not model autonomy evidence' }, usage: { costMicros: 0 } }));
                    if (scenario !== 'cooperation') trace.plan = plan; else trace.executionPlan = plan; return plan;
                }, dispatch: async (goalId, d, binding, decisionId) => {
                    const runId = randomUUID(); trace.adoptedRunId = runId;
                    trace.selectedStrategy = `${d.id}@${d.version}:${binding.sourceKind}:${binding.sourceId}`;
                    s.recordSkillDispatch({ runId, decisionId, agentId: 'worker', goalId, skill: d, binding, policyId: 'private-local-default', policyVersion: '1.0.0' });
                    terminal = await execute(d, binding.parameters, runId); trace.selectedContractId = binding.sourceKind === 'contract-obligation' ? binding.sourceId : null;
                    if (trace.selectedContractId) await settle(trace.selectedContractId, terminal);
                    s.recordSkillRunOutcome(runId, terminal.status === 'completed' ? 'completed' : 'failed', 'completed', terminal.message);
                    await read(); return { runId, status: terminal.status, reason: terminal.message };
                } });
            trace.reason = result.reason;
        return terminal;
    };
    const rawBefore = f.inv.getItemCount(377), gpBefore = f.inv.getItemCount(995);
    try {
        if (scenario === 'cooperation') {
            const pay = { gp: 5, items: [], service: null }, service = { gp: 0, items: [], service: 'one-native-invocation', skill: { id: gather.id, version: gather.version } };
            const policy: CooperationPolicy = { schemaVersion: 1, grants: ['worker', 'cooperation-mind'].map(id => ({ agentId: id,
                role: id === 'worker' ? 'player' : 'institution', subjectKind: id === 'worker' ? 'player' : 'business', subjectId: id === 'worker' ? 'prodtest' : 'alternative-kitchen',
                policyId: 'private-local-default', policyVersion: '1.0.0', minimumTrust: 0, maxGpPerAction: 5, maxGpPerDay: 10, maxItemUnits: 0, maxTtlMs: 300000,
                templates: [5, 4].map(gp => ({ templateId: `gather-${gp}`, kind: 'work', title: 'Native input work', summary: 'One native gathering invocation for finite GP', ttlMs: 300000,
                    ownProvides: id === 'worker' ? service : { ...pay, gp }, partnerProvides: id === 'worker' ? { ...pay, gp } : service })) })) };
            const policyPath = join(directory, 'cooperation.json'); writeFileSync(policyPath, JSON.stringify(policy));
            const plan = async (input: LlmPlanningInput) => {
                if (input.agentId === 'worker' && !trace.plan) {
                    const own = JSON.parse(input.trustedContext);
                    trace.eventSource = `relationship:agent.cooperation-mind`;
                    trace.perceivedChange = own.relationships.some((r: { actor: string; trust: number }) => r.actor === 'cooperation-mind' && r.trust === 20)
                        && (input.economicAlternatives?.length ?? 0) >= 2;
                    trace.observedSource = trace.perceivedChange ? trace.eventSource : '';
                }
                const funding = JSON.parse(input.trustedContext).funding;
                expect(funding).toMatchObject(input.agentId === 'worker' ? { source: 'own-inventory', availableGp: 20 } : { source: 'own-treasury', availableGp: 25 });
                const result = await planner.plan(input, request => ({ output: { decision: 'select_economic_action', goalId: request.goal.goalId,
                    alternativeId: (request.agentId === 'worker'
                        ? request.economicAlternatives!.find(a => a.action === 'accept-offer') ?? request.economicAlternatives!.find(a => a.action === 'propose-work')
                        : request.economicAlternatives!.find(a => a.action === 'propose-work' && a.costGp === 4))!.optionId,
                    goals: [], tool: null, reason: 'Voluntary bounded native input work' }, usage: { costMicros: 0 } }));
                if (input.agentId === 'worker' && !trace.plan) { trace.plan = result; trace.alternativeIds = input.economicAlternatives!.map(a => a.optionId); }
                return result;
            };
            const opts = { agentPath, contractsPath, policyPath, requiredLeaseOwner: 'si-b06', maxLlmCostMicros: 5000,
                playerState: () => ({ world: world(), observedAt: new Date().toISOString() }), plan };
            let turn = 'worker', wakeup = event;
            const previousAction = new Map<string, string>();
            for (let round = 0; round < 4; round++) {
                const previous = previousAction.get(turn), due = previous ? Date.parse(s.getEconomicAction(previous)!.nextEligibleAt) + 1 : 0;
                if (due > Date.now()) {
                    console.info('[strategic-cooldown]', JSON.stringify({ agentId: turn, due: new Date(due).toISOString(), scriptedClock: manifest.provider === 'scripted' }));
                    if (manifest.provider === 'scripted') setSystemTime(new Date(due));
                    else while (Date.now() < due) await new Promise(resolve => setTimeout(resolve, Math.min(10000, due - Date.now())));
                }
                trace.reason = (await runEconomicCooperation(turn, wakeup, opts))?.reason ?? 'No cooperative option';
                if (s.getEconomicAction(wakeup.eventId)) previousAction.set(turn, wakeup.eventId);
                if (turn === 'cooperation-mind') trace.consentPlan = s.getEconomicAction(wakeup.eventId)?.plan ?? undefined;
                const journal = new EconomicContractStore(contractsPath);
                let next: string | undefined, contracted = false;
                try {
                    contracted = journal.listContracts().some(c => c.status === 'active' && [c.partyAAgentId, c.partyBAgentId].includes('cooperation-mind'));
                    next = journal.listOffers().find(o => o.status === 'open' && o.creatorAgentId === turn
                        && journal.cooperationOrigin(o.offerId)?.actionId === wakeup.eventId)?.offerId;
                } finally { journal.close(); }
                appendFileSync(join(directory, 'negotiation.jsonl'), `${JSON.stringify({ round, agentId: turn, event: wakeup, nextOfferId: next, contracted })}\n`);
                if (contracted || !next) break;
                turn = turn === 'worker' ? 'cooperation-mind' : 'worker';
                wakeup = { ...event, agentId: turn, eventId: randomUUID(), sourceKey: `offer:${next}` };
            }
            const c = new EconomicContractStore(contractsPath); const offer = c.listOffers().find(o => o.creatorAgentId === 'worker'); c.close();
            if (offer) {
                trace.outcome.proposalId = offer.offerId;
                const contracts = new EconomicContractStore(contractsPath);
                const contract = contracts.listContracts().find(c => c.status === 'active' && [c.partyAAgentId, c.partyBAgentId].includes('cooperation-mind')); contracts.close();
                if (contract) {
                    trace.contractId = contract.contractId;
                    trace.contractParties = [contract.partyAAgentId, contract.partyBAgentId];
                    trace.outcome.partnerAccepted = true;
                    const terminal = await runStrategy({ ...event, eventId: randomUUID(), sourceKey: 'contract:' + contract.contractId }, [contract]);
                    if (!terminal || trace.selectedContractId !== contract.contractId) return;
                    trace.selectedStrategy = 'voluntary-native-work';
                }
            }
        } else {
            await runStrategy(event, routes.filter(c => c.status === 'active'));
        }
    } finally {
        trace.outcome.rawDelta = f.inv.getItemCount(377) - rawBefore; trace.outcome.gpDelta = f.inv.getItemCount(995) - gpBefore;
        planner.record(trace);
    }
}, 180000);
