import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { LivelihoodAction, LivelihoodJournalEntry } from '../../../agent-state/livelihood.js';
import type { LlmReplanEvent } from '../../../llm-runtime/events.js';
import type { GatewayBotSnapshot } from './types.js';
import type { BotSupervisor } from './supervisor.js';
import { createGatewayAgentReplanCoordinator } from './replan-runtime.js';
import { GatewayAgentAutonomySupervisor } from './autonomy-supervisor.js';
import { runLivelihoodReplan, type LivelihoodPorts } from './livelihood-runtime.js';
import { LIVELIHOOD_POLICY_KEY, LIVELIHOOD_BINDING_SOURCE, selectLivelihoodAction, type LivelihoodSnapshot } from './livelihood-policy.js';
import { ReplanInboxStore } from './replan-inbox.js';
import { materializeLivelihoodGoal } from './goal-templates.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const skill: LivelihoodAction = { kind: 'skill', skill: { id: 'routine.test', version: '1.0.0' },
    binding: { sourceKind: 'approved-policy', sourceId: LIVELIHOOD_BINDING_SOURCE, parameters: {} } };
const native: LivelihoodAction = { kind: 'housing', operation: 'sleep', operationId: 'existing-paid-period' };
const snapshot = (patch: Partial<LivelihoodSnapshot> = {}): LivelihoodSnapshot => ({ lifecycle: 'test-lifecycle', alive: true,
    role: 'player', clockRunning: true, physicalAllowed: true, needs: { hunger: 0, fatigue: 0, sleeping: false }, ...patch });
function fixture(names = ['ember12']) {
    const root = mkdtempSync(join(tmpdir(), 'si-a11-routine-')); roots.push(root);
    const path = join(root, 'agents.sqlite'), inbox = join(root, 'inbox.sqlite');
    const use = <T>(read: (s: AgentStateStore) => T) => { const s = new AgentStateStore(path); try { return read(s); } finally { s.close(); } };
    use(s => { for (const name of names) {
        s.createIdentity({ agentId: name, playerUsername: name, displayName: name, background: 'Routine integration fixture.', personalityTraits: ['steady'] });
        s.createAutonomyEnrollment(name, { status: 'desired', policyId: 'society-livelihood', policyVersion: '1.0.0' });
    } });
    const claim = (name = names[0]!, now = new Date().toISOString()) => use(s => {
        const e = s.getAutonomyEnrollment(name)!;
        const due = s.setAutonomyEnrollment(name, e.revision, { ...e, status: 'desired', nextWakeupAt: now, leaseOwner: null, leaseExpiresAt: null });
        return s.claimAutonomyEnrollment(name, due.revision, 'gateway:test', new Date(Date.parse(now) + 60000).toISOString(), now);
    });
    return { root, path, inbox, use, claim };
}
const event = (agentId = 'ember12', eventId = randomUUID()): LlmReplanEvent => ({ agentId, eventId,
    type: 'player-action-changed', occurredAt: new Date().toISOString(), sourceKey: `test:${eventId}`, summary: 'Untrusted text cannot set routine parameters.' });
function entry(agentId = 'ember12', actionId = 'routine.fixture'): LivelihoodJournalEntry {
    const now = new Date().toISOString(); return { actionId, agentId, eventId: randomUUID(), policy: LIVELIHOOD_POLICY_KEY,
        lifecycle: 'test-lifecycle', action: native, phase: 'prepared', reason: 'fatigue-relief', receipt: null,
        createdAt: now, updatedAt: now, revision: 1 };
}

describe('SI-A11 fixed livelihood policy', () => {
    test('hunger and fatigue preempt due work and do not invent inputs', () => {
        expect(selectLivelihoodAction(snapshot({ needs: { hunger: 6000, fatigue: 9000, sleeping: false }, food: skill, rest: native, work: skill })))
            .toEqual({ action: skill, reason: 'hunger-relief' });
        expect(selectLivelihoodAction(snapshot({ needs: { hunger: 6000, fatigue: 9000, sleeping: false }, work: skill })))
            .toEqual({ action: null, reason: 'food-input-or-authority-required' });
        expect(selectLivelihoodAction(snapshot({ needs: { hunger: 1000, fatigue: 7000, sleeping: false }, rest: native, work: skill })))
            .toEqual({ action: native, reason: 'fatigue-relief' });
        expect(selectLivelihoodAction(snapshot({ needs: { hunger: 0, fatigue: 8000, sleeping: false }, work: skill }))).toMatchObject({ action: null });
    });
    test('sleep hysteresis wakes only for recovery or urgent hunger, never starts physical work asleep', () => {
        expect(selectLivelihoodAction(snapshot({ physicalAllowed: false, needs: { hunger: 0, fatigue: 4000, sleeping: true }, wake: native, work: skill })))
            .toEqual({ action: null, reason: 'rest-in-progress' });
        for (const needs of [{ hunger: 0, fatigue: 2500, sleeping: true }, { hunger: 6000, fatigue: 9000, sleeping: true }])
            expect(selectLivelihoodAction(snapshot({ physicalAllowed: false, needs, wake: native, work: skill })).reason).toBe('wake-for-self-care');
    });
    test('terminal lifecycle, paused clock, unknown needs and offline execution fail closed', () => {
        for (const patch of [{ alive: false }, { clockRunning: false }, { needs: null }, { physicalAllowed: false }])
            expect(selectLivelihoodAction(snapshot({ ...patch, food: skill, work: skill, supply: skill })).action).toBeNull();
    });
    test('work precedes approved supply/rent and institutions only use finite stock orders', () => {
        expect(selectLivelihoodAction(snapshot({ work: skill, supply: native, rent: native })).reason).toBe('due-work');
        expect(selectLivelihoodAction(snapshot({ role: 'business', work: skill, supply: skill, stock: native })).reason).toBe('stock-order');
        expect(selectLivelihoodAction(snapshot({ role: 'business', work: skill, supply: skill })).action).toBeNull();
    });
    test('satisfied stock and an existing stock shift are normal waiting, not a shortage/quarantine trigger', async () => {
        const f = fixture(); f.claim();
        for (const stockWaiting of ['stock-satisfied', 'stock-work-in-progress', 'stock-input-required'] as const) {
            const result = await runLivelihoodReplan('ember12', event(), { agentPath: f.path,
                ports: { snapshot: async () => snapshot({ role: 'business', stockWaiting }),
                    execute: async () => { throw new Error('No duplicate order'); }, reconcile: async () => { throw new Error('No pending intent'); } },
                dispatchSkill: async () => { throw new Error('No institution skill'); } });
            expect(result).toMatchObject({ status: 'waiting', reason: `livelihood:${stockWaiting}` });
        }
    });
});

describe('SI-A11 agent journal and shared leases', () => {
    test('readonly observation before the first action returns no history without installing a schema', () => {
        const f = fixture(), readonly = new AgentStateStore(f.path, undefined, true);
        try { expect(readonly.listLivelihoodJournal('ember12')).toEqual([]); } finally { readonly.close(); }
        const db = new Database(f.path);
        try {
            expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE 'agent_livelihood_%'").all()).toEqual([]);
            db.run('CREATE TABLE agent_livelihood_action(action_id TEXT)');
        } finally { db.close(); }
        const damaged = new AgentStateStore(f.path, undefined, true);
        try { expect(() => damaged.listLivelihoodJournal('ember12')).toThrow('Incomplete'); } finally { damaged.close(); }
    });
    test('additive migration preserves existing identity, binds immutable parameters and survives reopen', () => {
        const f = fixture(); const original = f.use(s => s.getIdentity('ember12'));
        const e = f.use(s => s.writeLivelihoodJournal(entry(), null));
        expect(f.use(s => s.listLivelihoodJournal('ember12'))).toEqual([e]);
        expect(f.use(s => s.getIdentity('ember12'))).toEqual(original);
        expect(() => f.use(s => s.writeLivelihoodJournal({ ...e, revision: 2, action: { kind: 'housing', operation: 'wake', operationId: 'changed' } }, 1))).toThrow('binding');
        expect(() => f.use(s => s.writeLivelihoodJournal({ ...e, revision: 2 }, 0))).toThrow('revision');
        expect(() => f.use(s => s.writeLivelihoodJournal(entry('ember12', 'routine.second'), null))).toThrow();
        const completed = f.use(s => s.writeLivelihoodJournal({ ...e, phase: 'completed', receipt: 'canonical-source:1', revision: 2 }, 1));
        expect(() => f.use(s => s.writeLivelihoodJournal({ ...completed, phase: 'submitted', revision: 3 }, 2))).toThrow('terminal');
        expect(f.use(s => s.writeLivelihoodJournal(entry('ember12', 'routine.next'), null)).revision).toBe(1);
    });
    test('completion needs source proof and tampered/truncated projection is rejected', () => {
        const f = fixture(), e = entry();
        expect(() => f.use(s => s.writeLivelihoodJournal({ ...e, phase: 'completed' }, null))).toThrow('proof');
        f.use(s => s.writeLivelihoodJournal(e, null));
        const db = new Database(f.path); db.run('DELETE FROM agent_livelihood_action'); db.close(true);
        expect(() => f.use(s => s.listLivelihoodJournal('ember12'))).toThrow('coverage');
    });
    test('bilateral claims reuse the enrollment CAS and cannot take a paused or already claimed peer', () => {
        const f = fixture(['ember12', 'wave34']); f.claim();
        f.use(s => s.claimLivelihoodParticipant('ember12', 'wave34', 'routine.trade'));
        f.use(s => s.claimLivelihoodParticipant('ember12', 'wave34', 'routine.trade'));
        expect(f.use(s => s.getAutonomyEnrollment('wave34'))).toMatchObject({ status: 'running', leaseOwner: 'livelihood:routine.trade' });
        expect(() => f.use(s => s.claimLivelihoodParticipant('ember12', 'wave34', 'routine.other'))).toThrow('busy');
        f.use(s => s.releaseLivelihoodParticipants('routine.other'));
        expect(f.use(s => s.getAutonomyEnrollment('wave34')?.status)).toBe('running');
        f.use(s => s.releaseLivelihoodParticipants('routine.trade'));
        f.use(s => { const p = s.getAutonomyEnrollment('wave34')!; s.setAutonomyEnrollment('wave34', p.revision,
            { ...p, failureCount: 1, lastFailureFingerprint: 'b'.repeat(64) }); });
        expect(() => f.use(s => s.claimLivelihoodParticipant('ember12', 'wave34', 'routine.backoff'))).toThrow('backoff');
        f.use(s => { const p = s.getAutonomyEnrollment('wave34')!; s.setAutonomyEnrollment('wave34', p.revision, { ...p, status: 'paused', nextWakeupAt: null }); });
        expect(() => f.use(s => s.claimLivelihoodParticipant('ember12', 'wave34', 'routine.other'))).toThrow('paused');
    });
});

describe('SI-A11 supervisor, inbox, adapter and receipt integration (trusted backend fixtures)', () => {
    test('a failed process preserves its pending native source; an audited no-output settles as a failed attempt without quarantining', async () => {
        const f = fixture(); f.claim(); let dispatches = 0, terminalSource = false;
        const runId = randomUUID();
        const options = { agentPath: f.path, ports: {
            snapshot: async () => snapshot({ supply: skill }),
            execute: async () => { throw new Error('No native command'); },
            reconcile: async () => { throw new Error('No replay'); },
            reconcileFailedSkill: async (): Promise<import('./livelihood-runtime.js').LivelihoodReceipt> => terminalSource
                ? { status: 'expected-failure', reason: 'food-no-output', source: 'test-native-attempt:audited' }
                : { status: 'pending', reason: 'food-source-reconciliation-required', source: null }
        }, dispatchSkill: async (e: LivelihoodJournalEntry & { action: Extract<LivelihoodAction, { kind: 'skill' }> }) => {
            dispatches++;
            f.use(s => {
                const goalId = materializeLivelihoodGoal(s, e), execution = s.getGoalExecution(goalId)!;
                s.recordSkillDispatch({ runId, decisionId: e.eventId, agentId: e.agentId, goalId, skill: e.action.skill,
                    binding: execution.binding, policyId: 'society-livelihood', policyVersion: '1.0.0' });
                s.recordSkillRunOutcome(runId, 'failed', 'authorization', 'Native source uncertain');
            });
            return { runId, status: 'executing', reason: 'Existing dispatcher accepted' };
        } };
        expect((await runLivelihoodReplan('ember12', event(), options)).status).toBe('executing');
        for (let i = 0; i < 2; i++) {
            expect((await runLivelihoodReplan('ember12', event(), options)).status).toBe('bounded-wait');
            expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.phase)).toBe('submitted');
        }
        terminalSource = true;
        expect(await runLivelihoodReplan('ember12', event(), options)).toMatchObject({ status: 'waiting', reason: 'livelihood:food-no-output' });
        expect(dispatches).toBe(1);
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0])).toMatchObject({ phase: 'blocked', receipt: 'test-native-attempt:audited' });
        expect(f.use(s => s.getSkillRunOutcome(runId)?.status)).toBe('failed');
    });
    test('four arbitrary avatars use one policy, with zero provider/config access and one action each', async () => {
        const names = ['ember12', 'wave34', 'pine56', 'clay78'], f = fixture(names), executed: string[] = [];
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ needs: { hunger: 0, fatigue: 8000, sleeping: false }, rest: native, work: skill }),
            execute: async e => { executed.push(e.agentId); return { status: 'completed', reason: 'native-sleep-proof', source: `test-native:${e.actionId}` }; },
            reconcile: async () => { throw new Error('Unexpected replay'); } };
        const bot = { activeSkillSnapshot: () => null } as unknown as BotSupervisor;
        const coordinator = createGatewayAgentReplanCoordinator(() => new Map(), bot, async () => {}, {
            agentPath: f.path, replanInboxPath: f.inbox, requiredAutonomyLeaseOwner: 'gateway:test',
            llmConfigPath: join(f.root, 'must-never-read.json'), livelihoodPorts: ports });
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator, { agentPath: f.path, leaseOwner: 'gateway:test' });
        const first = await supervisor.tick();
        expect(first).toHaveLength(4); expect(executed.sort()).toEqual(names.sort());
        expect(first.every(r => r.record?.outcome?.status === 'completed')).toBe(true);
        expect(await supervisor.tick()).toEqual([]);
        for (const name of names) {
            expect(f.use(s => s.listDecisions(name)[0]?.llmCostMicros)).toBe(0);
            expect(f.use(s => s.listLivelihoodJournal(name)[0])).toMatchObject({ phase: 'completed', reason: 'native-sleep-proof' });
        }
    });
    test('timeout/restart reconciles the same intent once and never resends a physical command', async () => {
        const f = fixture(); f.claim(); let calls = 0, proven = false;
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ needs: { hunger: 0, fatigue: 8000, sleeping: false }, rest: native }),
            execute: async () => { calls++; throw new Error('ACK lost after native commit'); },
            reconcile: async () => ({ status: proven ? 'completed' : 'pending', reason: proven ? 'canonical-receipt' : 'source-pending', source: proven ? 'test-source:committed' : null }) };
        const make = () => createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => {}, {
            agentPath: f.path, replanInboxPath: f.inbox, requiredAutonomyLeaseOwner: 'gateway:test', livelihoodPorts: ports });
        expect((await make().submit(event())).outcome?.status).toBe('bounded-wait');
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.phase)).toBe('submitted');
        expect((await make().submit(event())).outcome?.status).toBe('bounded-wait');
        proven = true;
        expect((await make().submit(event())).outcome?.status).toBe('completed');
        expect(calls).toBe(1);
        expect(f.use(s => s.listLivelihoodJournal('ember12'))).toHaveLength(1);
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.receipt)).toBe('test-source:committed');
        const inbox = new ReplanInboxStore(f.inbox); try { expect(inbox.nextClaimableForAgent('ember12')).toBeNull(); } finally { inbox.close(); }
    });
    test('death holds pending custody for reconciliation without another adapter command', async () => {
        const f = fixture(); f.claim(); let alive = true, calls = 0;
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ alive, needs: { hunger: 0, fatigue: 8000, sleeping: false }, rest: native }),
            execute: async () => { calls++; return { status: 'pending', reason: 'custody-pending', source: null }; },
            reconcile: async () => { throw new Error('Dead lifecycle may not execute'); } };
        const options = { agentPath: f.path, ports, dispatchSkill: async () => { throw new Error('No SDK run allowed'); } };
        await runLivelihoodReplan('ember12', event(), options); alive = false;
        expect(await runLivelihoodReplan('ember12', event(), options)).toMatchObject({ status: 'operator-warning', reason: expect.stringContaining('lifecycle-terminal') });
        expect(calls).toBe(1);
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0])).toMatchObject({ phase: 'submitted', reason: 'lifecycle-terminal-reconciliation-required' });
    });
    test('an unsubmitted shift is revalidated after restart so new hunger preempts work', async () => {
        const f = fixture(); f.claim(); f.use(s => s.writeLivelihoodJournal({ ...entry(), action: skill, reason: 'due-work' }, null));
        let calls = 0;
        const result = await runLivelihoodReplan('ember12', event(), { agentPath: f.path,
            ports: { snapshot: async () => snapshot({ needs: { hunger: 9000, fatigue: 0, sleeping: false }, work: skill }),
                execute: async () => { throw new Error('Must not execute'); }, reconcile: async () => { throw new Error('Must not reconcile'); } },
            dispatchSkill: async () => { calls++; throw new Error('Must not dispatch'); } });
        expect(result.reason).toContain('prepared-context-changed'); expect(calls).toBe(0);
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.phase)).toBe('blocked');
    });
    test('input shortage backs off and quarantines even when queued events change their type', async () => {
        const f = fixture(); const now = new Date().toISOString(); let seq = 0;
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ needs: { hunger: 9000, fatigue: 0, sleeping: false }, work: skill }),
            execute: async () => { throw new Error('No invented food'); }, reconcile: async () => { throw new Error('No native intent'); } };
        const coordinator = createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => {}, {
            agentPath: f.path, livelihoodPorts: ports });
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator, { agentPath: f.path, leaseOwner: 'gateway:test', retryMs: 1000,
            nextEvent: () => ({ ...event(), type: ++seq % 2 ? 'offer-received' : 'goal-changed' }) });
        expect((await supervisor.tick(now))[0]?.status).toBe('released');
        expect(await supervisor.tick(new Date(Date.parse(now) + 100).toISOString())).toEqual([]);
        await supervisor.tick(new Date(Date.parse(now) + 310000).toISOString());
        await supervisor.tick(new Date(Date.parse(now) + 620000).toISOString());
        expect(f.use(s => s.getAutonomyEnrollment('ember12'))).toMatchObject({ status: 'quarantined', failureCount: 3 });
        expect(f.use(s => s.listSkillDispatches('ember12'))).toEqual([]);
    });
    test('sleeping control replans pass the supervisor but physical work stays blocked', async () => {
        const f = fixture(); let calls = 0;
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ physicalAllowed: false,
            needs: { hunger: 0, fatigue: 1000, sleeping: true }, wake: { ...native, operation: 'wake' }, work: skill }),
            execute: async e => { calls++; expect(e.action).toMatchObject({ kind: 'housing', operation: 'wake' });
                return { status: 'completed', reason: 'awake-proof', source: 'test-player-time:3' }; }, reconcile: async () => { throw new Error('No replay'); } };
        const coordinator = createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => {}, { agentPath: f.path, livelihoodPorts: ports });
        const supervisor = new GatewayAgentAutonomySupervisor(coordinator, { agentPath: f.path, leaseOwner: 'gateway:test', sleeping: () => true,
            timeCapabilities: () => ({ worldClockAdvances: true, physicalExecutionAllowed: false, offlineDelegationAllowed: false, reason: 'sleeping' }) });
        expect((await supervisor.tick())[0]?.record?.outcome?.status).toBe('completed'); expect(calls).toBe(1);
    });
    test('manual replan and unsupported routine versions never enter a provider path', async () => {
        const f = fixture(); let snapshots = 0;
        const ports: LivelihoodPorts = { snapshot: async () => { snapshots++; return snapshot(); },
            execute: async () => { throw new Error('No action'); }, reconcile: async () => { throw new Error('No action'); } };
        const coordinator = createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => {}, { agentPath: f.path, livelihoodPorts: ports });
        expect((await coordinator.submit({ ...event(), type: 'manual-request' })).outcome?.status).toBe('skipped');
        f.use(s => { const e = s.getAutonomyEnrollment('ember12')!; s.setAutonomyEnrollment('ember12', e.revision, { ...e, policyVersion: '2.0.0' }); });
        const other = createGatewayAgentReplanCoordinator(() => new Map(), {} as BotSupervisor, async () => {}, { agentPath: f.path, livelihoodPorts: ports });
        expect((await other.submit({ ...event(), type: 'manual-request' })).outcome?.reason).toContain('Unsupported');
        expect(snapshots).toBe(0);
    });
    test('a known food draft is not published or dispatched and never falls back to a provider', async () => {
        const f = fixture(); f.claim(); let calls = 0;
        const food: LivelihoodAction = { kind: 'skill', skill: { id: 'procedure.food.consume-lobster', version: '0.1.0' },
            binding: { sourceKind: 'approved-policy', sourceId: LIVELIHOOD_BINDING_SOURCE, parameters: { slot: 5 } } };
        f.use(s => s.setSkillKnowledge('ember12', food.skill, 'known', null));
        const bots = new Map<string, GatewayBotSnapshot>([['ember12', { username: 'ember12', status: 'active', controllers: 0,
            lastStateReceivedAt: Date.now(), state: { player: { isDead: false } } } as GatewayBotSnapshot]]);
        const supervisor = { activeSkillSnapshot: () => null, startSkill: async () => { calls++; throw new Error('Draft cannot execute'); } } as unknown as BotSupervisor;
        const coordinator = createGatewayAgentReplanCoordinator(() => bots, supervisor, async () => {}, { agentPath: f.path,
            llmConfigPath: join(f.root, 'must-never-open.json'), skillCatalog: { learningPath: join(f.root, 'learning.json'), policyRoot: join(f.root, 'policies'), localRoot: join(f.root, 'local-skills') },
            livelihoodPorts: { snapshot: async () => snapshot({ needs: { hunger: 9000, fatigue: 0, sleeping: false }, food }),
                execute: async () => { throw new Error('No native bypass'); }, reconcile: async () => { throw new Error('No intent'); } } });
        expect((await coordinator.submit(event())).outcome?.status).toBe('input-required');
        expect(calls).toBe(0); expect(f.use(s => s.listSkillDispatches('ember12'))).toEqual([]);
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.phase)).toBe('blocked');
    });
    test('exact verified known SDK skill uses existing dispatch, goal progress and terminal receipt', async () => {
        const f = fixture(); f.claim(); const catalog = join(f.root, 'catalog'); mkdirSync(catalog);
        writeFileSync(join(catalog, 'routine.test@1.0.0.skill.json'), JSON.stringify({ schemaVersion: 1, id: 'routine.test', version: '1.0.0',
            name: 'Bounded test wait', description: 'Isolated fixture, never a published production capability.', status: 'verified', tags: ['test'],
            parameters: {}, sharing: { visibility: 'shared' }, provenance: { authorKind: 'human', authorId: 'test', createdAt: new Date().toISOString() },
            limits: { timeoutMs: 10000, maxOperations: 1 }, preconditions: [], steps: [{ kind: 'operation', id: 'wait', operation: 'wait-ticks', arguments: { ticks: 1 } }] }));
        const config = join(f.root, 'llm.json'); writeFileSync(config, JSON.stringify({ schemaVersion: 1, enabled: false, automaticReplanning: true,
            provider: 'mock', model: 'deterministic-scripted-v1', autonomousExecution: { enabled: true, allowedSkills: [skill.skill], maxOperations: 10, maxTimeoutMs: 20000 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0, maxOutputTokens: 1000 } }));
        f.use(s => s.setSkillKnowledge('ember12', skill.skill, 'known', null));
        let calls = 0, active = false;
        const bot = { activeSkillSnapshot: () => active ? {} : null,
            startSkill: async (_name: string, _skill: string, _parameters: unknown, options: { runId: string }) => {
                calls++; active = true; return { runId: options.runId }; } } as unknown as BotSupervisor;
        const gateway = new Map<string, GatewayBotSnapshot>([['ember12', { username: 'ember12', status: 'active', controllers: 0,
            lastStateReceivedAt: Date.now(), state: { player: { isDead: false } } } as GatewayBotSnapshot]]);
        const ports: LivelihoodPorts = { snapshot: async () => snapshot({ work: skill }), execute: async () => { throw new Error('SDK only'); }, reconcile: async () => { throw new Error('SDK only'); } };
        const make = () => createGatewayAgentReplanCoordinator(() => gateway, bot, async () => {}, { agentPath: f.path, livelihoodPorts: ports,
            llmConfigPath: config, skillCatalog: { catalogRoot: catalog, localRoot: join(f.root, 'local-skills'), policyRoot: join(f.root, 'policies'), learningPath: join(f.root, 'learning.json') } });
        const first = await make().submit(event());
        expect(first.outcome).toMatchObject({ status: 'executing' });
        expect(f.use(s => s.listSkillDispatches('ember12'))).toHaveLength(1);
        expect((await make().submit(event())).outcome?.status).toBe('bounded-wait'); expect(calls).toBe(1);
        active = false;
        f.use(s => s.recordSkillRunOutcome(first.outcome!.runId, 'completed', 'completed', 'Trusted terminal fixture'));
        expect((await make().submit(event())).outcome?.status).toBe('completed'); expect(calls).toBe(1);
        const dispatch = f.use(s => s.listSkillDispatches('ember12')[0])!;
        expect(f.use(s => s.listGoals('ember12').find(g => g.goalId === dispatch.goalId)?.status)).toBe('completed');
        expect(f.use(s => s.listLivelihoodJournal('ember12')[0]?.receipt)).toBe(`skill-run:${dispatch.runId}`);
    });
});
