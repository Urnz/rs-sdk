import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../../agent-state/store.js';
import { AGENT_STATE_SCHEMA_VERSION } from '../../../agent-state/types.js';
import { STATE_GOAL_POLICY, evaluateStateObjective, type StateObjective } from '../../../agent-state/state-objectives.js';
import type { EconomicObservation } from '../../../agent-state/economic-context.js';
import { selectImmediateGoal } from '../../../agent-state/planner.js';
import { buildLlmPlanningInput } from '../../../llm-runtime/planning.js';
import { LlmOrchestrator } from '../../../llm-runtime/orchestrator.js';
import { ScriptedMockProvider } from '../../../llm-runtime/mock-provider.js';
import { MemoryLlmAuditSink } from '../../../llm-runtime/audit.js';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import { adoptBoundedImmediatePlan, createGatewayAgentReplanCoordinator } from './replan-runtime.js';
import type { BotSupervisor } from './supervisor.js';
import type { GatewayBotSnapshot, ManagedSkillRunSnapshot } from './types.js';
import type { SkillDefinition } from '../../../agent-skills/types.js';
import type { LlmAutonomousExecutionConfig } from '../../../llm-runtime/types.js';

const dirs: string[] = [];
const opened = new Set<AgentStateStore>();
function openStore(path: string) {
    const s = new AgentStateStore(path), close = s.close.bind(s); opened.add(s);
    s.close = () => { if (opened.delete(s)) close(); };
    return s;
}
afterEach(() => { for (const s of opened) s.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const now = '2026-10-23T10:00:00.000Z', later = '2026-10-23T10:00:02.000Z';
const objective: StateObjective = { policy: STATE_GOAL_POLICY, mode: 'achieve', purpose: 'livelihood',
    predicates: [{ kind: 'food-reserve-at-least', value: 2 }] };
const reference = { id: 'food.safe', version: '1.0.0' };
const definition: SkillDefinition = { schemaVersion: 1, ...reference, name: 'Food', description: 'One bounded action',
    status: 'verified', tags: [], parameters: {}, provenance: { authorKind: 'human', authorId: 'test', createdAt: now },
    sharing: { visibility: 'shared' }, limits: { timeoutMs: 1000, maxOperations: 1 }, preconditions: [],
    steps: [{ kind: 'operation', id: 'wait', operation: 'wait-ticks', arguments: { ticks: 1 } }] };
const grant: LlmAutonomousExecutionConfig = { enabled: true, allowedSkills: [reference], maxOperations: 1, maxTimeoutMs: 1000 };
function observation(food: number, at = now): EconomicObservation {
    return { agentId: 'worker', binding: 'a'.repeat(64), observedAt: at, simulationTime: null,
        facts: [{ key: 'own-food-portions', value: food, source: 'own-engine-observation', cursor: at,
            observedAt: at, freshness: 'fresh', trust: 'observed' }] };
}
function setup(purpose: StateObjective['purpose'] = 'livelihood', seedObservation = true) {
    const dir = mkdtempSync(join(tmpdir(), 'state-goal-')); dirs.push(dir);
    const path = join(dir, 'agents.sqlite'), store = openStore(path);
    store.createIdentity({ agentId: 'worker', playerUsername: 'worker', displayName: 'Worker', background: 'Local', personalityTraits: ['patient'] }, now);
    store.createGoal('worker', { goalId: 'life', horizon: 'life', title: 'Live' }, now);
    store.createGoal('worker', { goalId: 'strategy', parentGoalId: 'life', horizon: 'long-term', title: 'Stay sustainable',
        objective: { ...objective, mode: 'maintain' } }, now);
    store.createGoal('worker', { goalId: 'buffer', parentGoalId: 'strategy', horizon: 'current', title: 'Have food',
        objective: { ...objective, purpose } }, now);
    store.setWorkingMemory('worker', null, { summary: 'At home', observedAt: now }, now);
    store.setSkillKnowledge('worker', reference, 'known', null, now);
    store.createAutonomyEnrollment('worker', { status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0' }, now);
    store.claimAutonomyEnrollment('worker', 1, 'test', '2026-10-23T10:10:00.000Z', now);
    if (seedObservation) store.evaluateGoalStates('worker', observation(0), now);
    const profile = store.getControlProfile('worker')!;
    store.recordDecision('worker', profile.revision, { decisionId: 'decision', trigger: 'event' }, now);
    const proposal = () => store.createGoalProposal('worker', { proposalId: 'proposal', runId: 'decision',
        anchorGoalId: 'buffer', anchorGoalRevision: store.getGoal('buffer')!.revision,
        goals: [{ goalId: 'get-food', parentGoalId: 'buffer', horizon: 'immediate', title: 'Get food', priority: 50 }],
        skill: reference, reason: 'Restore the approved reserve' }, now);
    return { store, path, proposal };
}

test('state predicates reject stale, missing, duplicate, wrong-source and non-native needs evidence', () => {
    expect(evaluateStateObjective(objective, observation(2), now).result).toBe('satisfied');
    expect(evaluateStateObjective(objective, observation(1), now).result).toBe('unsatisfied');
    for (const alter of [(o: EconomicObservation) => { o.facts = []; },
        (o: EconomicObservation) => { o.facts[0]!.source = 'model-receipt'; },
        (o: EconomicObservation) => { o.facts.push(o.facts[0]!); },
        (o: EconomicObservation) => { o.facts[0]!.observedAt = '2026-10-23T09:00:00.000Z'; }]) {
        const o = observation(2); alter(o); expect(evaluateStateObjective(objective, o, now).result).toBe('unknown');
    }
    expect(() => evaluateStateObjective(objective, observation(2, later), now)).toThrow('future');
    const hunger = observation(2); hunger.facts[0] = { ...hunger.facts[0]!, key: 'hunger', source: 'durable-needs', value: 0 };
    expect(evaluateStateObjective({ ...objective, predicates: [{ kind: 'hunger-at-most', value: 5000 }] }, hunger, now).result).toBe('unknown');
    expect(() => evaluateStateObjective({ ...objective, policy: 'model-policy' as never }, hunger, now)).toThrow('policy');
});

test('model plan → adoption → dispatch → outcome → source predicates survives every durable boundary', async () => {
    const f = setup();
    const input = buildLlmPlanningInput(f.store.getSnapshot('worker')!, { context: { now }, availableSkills: [
        { ...reference, name: 'Food', description: 'Food action' }], runId: 'decision' });
    const provider = new ScriptedMockProvider([{ output: { decision: 'propose_goal_plan', goalId: 'buffer',
        goals: [{ goalId: 'get-food', parentGoalId: 'buffer', horizon: 'immediate', title: 'Get food', description: 'Approved food buffer', priority: 50 }],
        tool: { name: 'execute_skill', arguments: { skillId: reference.id, version: reference.version } }, reason: 'Have a food reserve' }, usage: { costMicros: 0 } }]);
    const plan = await new LlmOrchestrator(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true,
        provider: 'mock', model: 'scripted', limits: { maxCostMicros: 0, maxDurationMs: 1000,
            maxModelRequests: 1, maxToolCalls: 1, maxOutputTokens: 1000 } }), provider, new MemoryLlmAuditSink()).plan(input);
    expect(plan.decision?.kind).toBe('propose-goal-plan');
    if (plan.decision?.kind !== 'propose-goal-plan') throw new Error(plan.reason);
    f.store.createGoalProposal('worker', { proposalId: 'proposal', runId: 'decision', anchorGoalId: 'buffer', anchorGoalRevision: 1,
        goals: plan.decision.goals, skill: plan.decision.skill, reason: plan.decision.reason }, now);
    f.store.close();
    let s = openStore(f.path);
    const adopted = adoptBoundedImmediatePlan(s, 'proposal', definition, grant, {}, now); s.close();
    s = openStore(f.path);
    expect(adoptBoundedImmediatePlan(s, 'proposal', definition, grant, {}, now).goalId).toBe(adopted.goalId);
    const runId = randomUUID();
    const dispatch = { runId, decisionId: 'decision', agentId: 'worker', goalId: adopted.goalId, skill: reference,
        binding: s.getGoalExecution(adopted.goalId)!.binding, policyId: 'private-local-default', policyVersion: '1.0.0' };
    s.recordSkillDispatch(dispatch, now); s.close();
    s = openStore(f.path);
    expect(() => s.recordSkillDispatch({ ...dispatch, runId: randomUUID() }, now)).toThrow('pending');
    s.recordSkillRunOutcome(runId, 'completed', 'completed', 'Skill exit 0; not enough food', later);
    expect(s.getGoal(adopted.goalId)?.status).toBe('active'); s.close();
    s = openStore(f.path);
    expect(s.recordSkillRunOutcome(runId, 'completed', 'completed', 'Replay', later).created).toBe(false);
    s.evaluateGoalStates('worker', observation(1, later), later);
    expect(s.getGoal(adopted.goalId)?.status).toBe('active');
    expect(() => s.setGoalStatus(adopted.goalId, 1, 'completed', later)).toThrow('evidence');
    const last = '2026-10-23T10:00:04.000Z';
    s.evaluateGoalStates('worker', observation(2, last), last); s.close();
    s = openStore(f.path); s.evaluateGoalStates('worker', observation(2, last), last);
    expect(s.getGoal(adopted.goalId)?.status).toBe('completed');
    expect(s.getGoal('buffer')?.status).toBe('completed');
    expect(s.getGoal('strategy')).toMatchObject({ status: 'active', stateEvaluation: { result: 'satisfied' } });
    s.evaluateGoalStates('worker', observation(0, '2026-10-23T10:00:06.000Z'), '2026-10-23T10:00:06.000Z');
    expect(s.getGoal('strategy')).toMatchObject({ status: 'active', stateEvaluation: { result: 'unsatisfied' } });
    expect(s.listGoalEvents('worker').filter(e => e.goalId === adopted.goalId && e.kind === 'status-changed')).toHaveLength(1);
    s.close();
});

test('adoption refuses stale parents, extra privilege, out-of-envelope parameters and expired leases', () => {
    for (const reason of ['parent', 'skill', 'parameter', 'lease', 'emergency', 'operation']) {
        const f = setup(); f.proposal();
        let config = structuredClone(grant), def = structuredClone(definition);
        if (reason === 'parent') f.store.setGoalStatus('buffer', 1, 'blocked', now);
        if (reason === 'skill') config.allowedSkills = [];
        if (reason === 'lease') { const e = f.store.getAutonomyEnrollment('worker')!;
            f.store.setAutonomyEnrollment('worker', e.revision, { ...e, status: 'paused', leaseOwner: null, leaseExpiresAt: null }, now); }
        if (reason === 'emergency') f.store.setAutonomyEmergencyStop(1, true, 'Test stop', now);
        if (reason === 'operation') def.steps = [{ kind: 'operation', id: 'trade', operation: 'trade-give-item', arguments: {} }];
        expect(() => adoptBoundedImmediatePlan(f.store, 'proposal', def, config, reason === 'parameter' ? { extra: 999 } : {}, now)).toThrow();
        expect(f.store.getGoal('get-food')).toBeNull();
        expect(f.store.getGoalProposal('proposal')?.status).toBe('pending'); f.store.close();
    }
});

test('a successful run with insufficient state yields a bounded replacement instead of repeating the same skill', () => {
    const f = setup(); f.proposal();
    const first = adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, now), runId = randomUUID();
    const dispatch = { runId, decisionId: 'decision', agentId: 'worker', goalId: first.goalId, skill: reference,
        binding: f.store.getGoalExecution(first.goalId)!.binding, policyId: 'private-local-default', policyVersion: '1.0.0' };
    f.store.recordSkillDispatch(dispatch, now);
    f.store.recordSkillRunOutcome(runId, 'completed', 'completed', 'Raw output only', later);
    f.store.evaluateGoalStates('worker', observation(1, later), later);
    expect(f.store.getGoal(first.goalId)).toMatchObject({ status: 'active', stateEvaluation: { needsReplan: true } });
    expect(selectImmediateGoal(f.store.getSnapshot('worker')!, undefined, later)).toBeNull();
    expect(buildLlmPlanningInput(f.store.getSnapshot('worker')!, { availableSkills: [], context: { now: later } }))
        .toMatchObject({ mode: 'derive-immediate-goal', goal: { goalId: 'buffer' } });
    expect(() => f.store.recordSkillDispatch({ ...dispatch, runId: randomUUID() }, later)).toThrow('changed');
    const next = '2026-10-23T10:01:00.000Z';
    f.store.evaluateGoalStates('worker', observation(1, next), next);
    f.store.recordDecision('worker', f.store.getControlProfile('worker')!.revision, { decisionId: 'next-decision', trigger: 'event' }, next);
    f.store.createGoalProposal('worker', { proposalId: 'replacement', runId: 'next-decision', anchorGoalId: 'buffer', anchorGoalRevision: 1,
        goals: [{ goalId: 'cook-food', parentGoalId: 'buffer', horizon: 'immediate', title: 'Process food' }],
        skill: reference, reason: 'Native reserve is insufficient; select a new bounded plan' }, next);
    adoptBoundedImmediatePlan(f.store, 'replacement', definition, grant, {}, next);
    expect(f.store.getGoal(first.goalId)?.status).toBe('blocked');
    expect(f.store.getGoal('cook-food')?.status).toBe('active');
    expect(f.store.getGoal('buffer')?.status).toBe('active');
    expect(adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, next).status).toBe('blocked'); f.store.close();
});

test('abrupt process exits after proposal, adoption, dispatch, outcome and evaluation recover without duplicate activation', async () => {
    const f = setup(); f.store.close(); const runId = randomUUID();
    for (const stage of ['proposal', 'adoption', 'dispatch', 'outcome', 'evaluation']) {
        const child = Bun.spawn([process.execPath, join(import.meta.dir, 'test-fixtures/state-goal-crash-worker.ts'),
            f.path, stage, JSON.stringify({ definition, grant, now, later, runId, observation: observation(2, later) })],
        { stdout: 'pipe', stderr: 'pipe' });
        const timer = setTimeout(() => child.kill(), 5000);
        try {
            const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
            if (code !== 79) throw new Error(`Crash worker ${stage} exited ${code}: ${error}`);
        } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill(); await child.exited; } }
        const s = openStore(f.path);
        expect(s.getGoalProposal('proposal')).not.toBeNull();
        if (stage !== 'proposal') expect(s.listGoals('worker').filter(g => g.goalId === 'get-food')).toHaveLength(1);
        if (stage === 'evaluation') {
            expect(s.getGoal('get-food')?.status).toBe('completed');
            s.evaluateGoalStates('worker', observation(2, later), later);
            expect(s.listGoalEvents('worker').filter(e => e.goalId === 'get-food' && e.kind === 'status-changed')).toHaveLength(1);
        }
        s.close();
    }
}, 30000);

test('adoption failure rolls back goal, event, budget and receipt; retry activates exactly once', () => {
    const f = setup(); f.proposal(); const sql = new Database(f.path);
    sql.run(`CREATE TRIGGER fail_adoption BEFORE INSERT ON agent_plan_adoption BEGIN SELECT RAISE(ABORT,'simulated crash'); END`);
    expect(() => adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, now)).toThrow('simulated crash');
    expect(f.store.getGoal('get-food')).toBeNull();
    expect(f.store.getGoalProposal('proposal')?.status).toBe('pending');
    expect(f.store.listGoalEvents('worker').some(e => e.goalId === 'get-food')).toBe(false);
    sql.run('DROP TRIGGER fail_adoption'); sql.close();
    adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, now);
    adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, now);
    expect(f.store.listGoals('worker').filter(g => g.goalId === 'get-food')).toHaveLength(1); f.store.close();
});

test('worst-case spend, profile daily budget and a failed paid adoption all fail without leaking a reservation', () => {
    const f = setup(); f.proposal();
    const paid: SkillDefinition = { ...definition, steps: [{ kind: 'operation', id: 'buy', operation: 'buy-from-shop',
        arguments: { name: 'Lobster', amount: 1, match: 'exact' } }] };
    const paidGrant: LlmAutonomousExecutionConfig = { ...grant, allowedSkills: [{ ...reference, risk: 'shop-buy',
        operations: ['buy-from-shop'], itemNames: ['lobster'], maxQuantity: 1, maxUnitPriceGp: 10, maxGpPerRun: 10, maxGpPerDay: 20 }] };
    expect(() => adoptBoundedImmediatePlan(f.store, 'proposal', paid, paidGrant, {}, now)).toThrow('daily GP');
    const profile = f.store.getControlProfile('worker')!;
    f.store.setControlProfile('worker', profile.revision, { ...profile, dailyOperationalBudgetGp: 50 }, now);
    const lowGrant = structuredClone(paidGrant); lowGrant.allowedSkills[0]!.maxGpPerRun = 5;
    expect(() => adoptBoundedImmediatePlan(f.store, 'proposal', paid, lowGrant, {}, now)).toThrow('spend');
    const db = new Database(f.path);
    try {
        db.run(`CREATE TRIGGER fail_paid_adoption BEFORE INSERT ON agent_plan_adoption BEGIN SELECT RAISE(ABORT,'paid crash'); END`);
        expect(() => adoptBoundedImmediatePlan(f.store, 'proposal', paid, paidGrant, {}, now)).toThrow('paid crash');
        expect(f.store.listDecisions('worker')[0]!.operationalBudgetGp).toBe(0);
        expect(f.store.getGoal('get-food')).toBeNull();
        expect(f.store.getGoalProposal('proposal')?.status).toBe('pending');
        db.run('DROP TRIGGER fail_paid_adoption');
    } finally { db.close(); }
    adoptBoundedImmediatePlan(f.store, 'proposal', paid, paidGrant, {}, now);
    expect(f.store.listDecisions('worker')[0]!.operationalBudgetGp).toBe(10); f.store.close();
});

test('model output cannot author goal predicates or execution authority', async () => {
    const f = setup();
    const input = buildLlmPlanningInput(f.store.getSnapshot('worker')!, { context: { now }, availableSkills: [
        { ...reference, name: 'Food', description: 'One bounded food action' }] });
    const provider = new ScriptedMockProvider([{ output: { decision: 'propose_goal_plan', goalId: 'buffer',
        goals: [{ goalId: 'new-food', parentGoalId: 'buffer', horizon: 'immediate', title: 'Food', description: '',
            priority: 50, objective: { predicates: [] } }], reason: 'Pretend to be satisfied' }, usage: { costMicros: 0 } }]);
    const plan = await new LlmOrchestrator(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true,
        provider: 'mock', model: 'scripted', limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 0, maxOutputTokens: 1000 } }), provider, new MemoryLlmAuditSink()).plan(input);
    expect(plan.status).toBe('rejected'); expect(plan.reason).toContain('cannot author'); f.store.close();
});

test('the real gateway replan path adopts and dispatches a scoped model plan without admin approval', async () => {
    const f = setup('livelihood', false), dir = join(f.path, '..'), at = new Date().toISOString();
    const enrollment = f.store.getAutonomyEnrollment('worker')!;
    const desired = f.store.setAutonomyEnrollment('worker', enrollment.revision, { ...enrollment,
        status: 'desired', leaseOwner: null, leaseExpiresAt: null }, at);
    f.store.claimAutonomyEnrollment('worker', desired.revision, 'gateway-test', new Date(Date.now() + 60000).toISOString(), at);
    f.store.close();
    const catalogRoot = join(dir, 'catalog'), configPath = join(dir, 'llm.json'); mkdirSync(catalogRoot);
    writeFileSync(join(catalogRoot, 'food.safe@1.0.0.skill.json'), JSON.stringify(definition));
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, automaticReplanning: true,
        provider: 'mock', model: 'scripted', autonomousExecution: grant, limits: { maxDurationMs: 1000,
            maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0, maxOutputTokens: 1000 } }));
    const world = { tick: 1, inGame: true, player: { name: 'worker', combatLevel: 3, hp: 10, maxHp: 10,
        x: 50, z: 50, worldX: 3200, worldZ: 3200, level: 0, runEnergy: 100, runWeight: 0, animId: -1,
        spotanimId: -1, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 },
        isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null }, inventory: [], equipment: [], skills: [],
        dialog: { isOpen: false, options: [], isWaiting: false }, bank: { isOpen: false, items: [], noteMode: false },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] }, modalOpen: false,
        nearbyNpcs: [], nearbyLocs: [], gameMessages: [] };
    const gateway = new Map([['worker', { username: 'worker', status: 'active', state: world,
        lastStateReceivedAt: Date.now(), bankKnown: true, controllers: 0, observers: 0 } as unknown as GatewayBotSnapshot]]);
    const started: string[] = [];
    const supervisor = { activeSkillSnapshot: () => null,
        startSkill: async (_username: string, _skill: string, _parameters: unknown, options: { runId: string }) => {
            started.push(options.runId); return { runId: options.runId, status: 'starting', skill: _skill,
                startedAt: at, pid: 1, exitCode: null, logPath: join(dir, 'skill.log') } as ManagedSkillRunSnapshot;
        } } as unknown as BotSupervisor;
    const coordinator = createGatewayAgentReplanCoordinator(() => gateway, supervisor, async () => {}, {
        agentPath: f.path, capabilityGapPath: join(dir, 'gaps.json'), llmConfigPath: configPath,
        skillCatalog: { catalogRoot, localRoot: join(dir, 'drafts') } });
    const record = await coordinator.submit({ eventId: 'gateway-plan', agentId: 'worker', type: 'manual-request',
        sourceKey: 'gateway-plan', occurredAt: at, summary: 'Restore the existing approved reserve' }, at);
    expect(record).toMatchObject({ error: null, outcome: { status: 'executing',
        decision: { kind: 'propose-goal-plan', adoptedGoalId: expect.any(String) } } });
    expect(started).toHaveLength(1);
    const reopened = openStore(f.path);
    expect(reopened.getSkillDispatch(started[0]!)?.decisionId).toBe('gateway-plan');
    expect(reopened.listGoalProposals('worker')[0]).toMatchObject({ status: 'completed', approvalId: null }); reopened.close();
});

test('self-care overrides higher-priority work at the next skill boundary, then work remains available', () => {
    const f = setup('self-care');
    f.store.createGoal('worker', { goalId: 'work', parentGoalId: 'strategy', horizon: 'current', title: 'Work' }, now);
    f.store.createGoal('worker', { goalId: 'shift', parentGoalId: 'work', horizon: 'immediate', title: 'Shift', priority: 100 }, now);
    const snapshot = f.store.getSnapshot('worker')!;
    expect(selectImmediateGoal(snapshot, undefined, now)).toBeNull();
    expect(buildLlmPlanningInput(snapshot, { context: { now }, availableSkills: [] })).toMatchObject({ mode: 'derive-immediate-goal', goal: { goalId: 'buffer' } });
    f.proposal(); adoptBoundedImmediatePlan(f.store, 'proposal', definition, grant, {}, now);
    expect(selectImmediateGoal(f.store.getSnapshot('worker')!, undefined, now)?.goalId).toBe('get-food');
    f.store.evaluateGoalStates('worker', observation(2, later), later);
    expect(selectImmediateGoal(f.store.getSnapshot('worker')!, undefined, later)?.goalId).toBe('shift'); f.store.close();
});

test('v25 upgrade/reopen preserves legacy run goals; failed additive migration is atomic and future schema fails closed', () => {
    const f = setup(); f.store.close();
    let sql = new Database(f.path); sql.run('DROP TABLE agent_player_strategy'); sql.run('DROP TABLE agent_plan_adoption'); sql.run('DROP TABLE agent_state_evaluation');
    sql.run('DROP TABLE agent_state_objective'); sql.run('PRAGMA user_version=25'); sql.close();
    let s = openStore(f.path); expect(s.getGoal('buffer')?.objective).toBeUndefined(); s.close();
    sql = new Database(f.path); expect(sql.query('PRAGMA user_version').get()).toEqual({ user_version: AGENT_STATE_SCHEMA_VERSION });
    sql.run('DROP TABLE agent_player_strategy');
    sql.run('DROP TABLE agent_plan_adoption'); sql.run('DROP TABLE agent_state_evaluation'); sql.run('DROP TABLE agent_state_objective');
    sql.run('CREATE TABLE agent_plan_adoption(dummy TEXT)'); sql.run('PRAGMA user_version=25'); sql.close();
    expect(() => openStore(f.path)).toThrow();
    sql = new Database(f.path); expect(sql.query('PRAGMA user_version').get()).toEqual({ user_version: 25 });
    expect(sql.query("SELECT name FROM sqlite_master WHERE name='agent_state_objective'").get()).toBeNull();
    sql.run(`PRAGMA user_version=${AGENT_STATE_SCHEMA_VERSION+1}`); sql.close(); expect(() => openStore(f.path)).toThrow();
});
