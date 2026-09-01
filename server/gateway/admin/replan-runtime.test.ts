import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { AgentReplanCoordinator } from './replan-coordinator.js';
import { appendReplanRecord, createGatewayAgentReplanCoordinator, dispatchVerifiedCapabilityWakeups,
    evaluateAutonomousSkillPolicy, readReplanRecords } from './replan-runtime.js';
import type { SkillDefinition, SkillOperationName } from '../../../agent-skills/types.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import type { BotSupervisor } from './supervisor.js';
import type { GatewayBotSnapshot, ManagedSkillRunSnapshot } from './types.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function verifiedGap(store: CapabilityGapStore) {
    const reported = await store.report({ agentId: 'agent-14', goalId: 'mine-copper',
        anchorGoalId: 'build-career', title: 'Mine copper' });
    const assigned = await store.transition(reported.gap.gapId, reported.gap.revision, 'assigned', {
        assignedWorkerId: 'skill-builder'
    });
    const draft = await store.transition(assigned.gapId, assigned.revision, 'draft', {
        draftSkill: { id: 'mining.copper', version: '0.1.0' }
    });
    const validating = await store.transition(draft.gapId, draft.revision, 'validating');
    const trial = await store.transition(validating.gapId, validating.revision, 'live-trial');
    return store.transition(trial.gapId, trial.revision, 'verified', {
        resolvedSkill: { id: 'mining.copper', version: '1.0.0' }
    });
}

describe('verified capability wakeups', () => {
    test('retries an offline agent and delivers a verified capability exactly once', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-capability-wakeup-'));
        directories.push(root);
        const store = new CapabilityGapStore(join(root, 'gaps.json'));
        await verifiedGap(store);
        let attempts = 0;
        const coordinator = new AgentReplanCoordinator({
            resolveAgentId: async () => null,
            listAgentIds: async () => [],
            plan: async (_agentId, event) => ({ runId: event.eventId,
                status: ++attempts === 1 ? 'skipped' : 'proposed', reason: attempts === 1 ? 'offline' : 'planned' }),
            append: () => undefined
        });

        const first = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:00.000Z');
        const second = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:01.000Z');
        const third = await dispatchVerifiedCapabilityWakeups(coordinator, store, '2026-08-30T13:00:02.000Z');

        expect(first[0]?.outcome?.status).toBe('skipped');
        expect(second[0]?.outcome?.status).toBe('proposed');
        expect(third).toHaveLength(0);
        expect(attempts).toBe(2);
    });
});

function skill(operation: SkillOperationName = 'gather-loc'): SkillDefinition {
    return { schemaVersion: 1, id: 'mining.safe', version: '1.0.0', name: 'Safe mining',
        description: 'Mine and bank ore.', status: 'verified', tags: ['mining'], parameters: {},
        provenance: { authorKind: 'human', authorId: 'test', createdAt: '2026-08-31T10:00:00.000Z' },
        sharing: { visibility: 'shared' }, limits: { timeoutMs: 60_000, maxOperations: 20 },
        preconditions: [], steps: [{ kind: 'operation', id: 'step', operation, arguments: {} }] };
}

describe('autonomous skill execution policy', () => {
    const config = { enabled: true, allowedSkills: [{ id: 'mining.safe', version: '1.0.0' }],
        maxOperations: 50, maxTimeoutMs: 120_000 };

    test('allows only the exact verified bounded skill reference', () => {
        expect(evaluateAutonomousSkillPolicy(config, skill())).toMatchObject({ allowed: true });
        expect(evaluateAutonomousSkillPolicy({ ...config, allowedSkills: [] }, skill()))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('allowlist') });
        expect(evaluateAutonomousSkillPolicy(config, { ...skill(), limits: { timeoutMs: 60_000, maxOperations: 51 } }))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('limit') });
    });

    test('forbids economic transfers and composed calls even when allowlisted', () => {
        expect(evaluateAutonomousSkillPolicy(config, skill('buy-from-shop')))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('forbidden') });
        expect(evaluateAutonomousSkillPolicy(config, { ...skill(), steps: [{ kind: 'call', id: 'nested',
            skill: { id: 'procedure.route', version: '1.0.0' }, arguments: {} }] }))
            .toMatchObject({ allowed: false, reason: expect.stringContaining('Composed') });
    });
});

describe('bounded autonomous lifecycle acceptance', () => {
    test('persists one admitted decision and starts only the exact policy-approved skill', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-autonomous-lifecycle-'));
        directories.push(root);
        const agentPath = join(root, 'agents.sqlite');
        const configPath = join(root, 'llm.json');
        const gapPath = join(root, 'gaps.json');
        const logPath = join(root, 'replans.jsonl');
        const reference = { id: 'mining.varrock-east.copper-to-bank', version: '1.0.0' };
        const store = new AgentStateStore(agentPath);
        store.createIdentity({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
            background: 'A test miner.', personalityTraits: ['patient'] });
        store.createGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Prosper' });
        store.createGoal('ferrye14', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term',
            title: 'Build a mining career' });
        store.createGoal('ferrye14', { goalId: 'capital', parentGoalId: 'career', horizon: 'current',
            title: 'Build capital' });
        store.createGoal('ferrye14', { goalId: 'mine', parentGoalId: 'capital', horizon: 'immediate',
            title: 'Mine copper', skill: reference });
        store.setSkillKnowledge('ferrye14', reference, 'known', null);
        store.close();
        await writeFile(configPath, JSON.stringify({ schemaVersion: 1, enabled: false,
            automaticReplanning: true, provider: 'mock', model: 'deterministic-scripted-v1',
            autonomousExecution: { enabled: true, allowedSkills: [reference],
                maxOperations: 100, maxTimeoutMs: 900_000 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1,
                maxCostMicros: 0, maxOutputTokens: 1000 } }));

        const started: Array<{ username: string; skill: string; runId: string | undefined }> = [];
        const supervisor = { startSkill: async (username: string, requested: string, _parameters: unknown,
            options: { runId?: string }): Promise<ManagedSkillRunSnapshot> => {
            started.push({ username, skill: requested, runId: options.runId });
            return { runId: options.runId!, status: 'starting', pid: 42, skill: requested,
                startedAt: new Date().toISOString(), exitCode: null, logPath: join(root, 'skill.log') };
        } } as unknown as BotSupervisor;
        const worldState = { tick: 1, inGame: true, player: { name: 'Ferrye14', combatLevel: 50,
            hp: 40, maxHp: 50, x: 50, z: 50, worldX: 3285, worldZ: 3367, level: 0,
            runEnergy: 75, runWeight: 0, animId: -1, spotanimId: -1,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 },
            isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null },
        inventory: [{ slot: 0, id: 1275, name: 'Rune pickaxe', count: 1, optionsWithIndex: [] }],
        dialog: { isOpen: false, options: [], isWaiting: false },
        bank: { isOpen: false, items: [], noteMode: false },
        shop: { isOpen: false, title: '', shopItems: [], playerItems: [] }, modalOpen: false,
        nearbyNpcs: [], nearbyLocs: [], gameMessages: [] } as any;
        const gateway = new Map<string, GatewayBotSnapshot>([['ferrye14', { username: 'Ferrye14',
            status: 'active', connected: true, connectedAt: Date.now(), lastStateReceivedAt: Date.now(),
            state: worldState, controllers: 1, observers: 0 }]]);
        const coordinator = createGatewayAgentReplanCoordinator(() => gateway, supervisor,
            record => appendReplanRecord(record, logPath), { agentPath, capabilityGapPath: gapPath,
                llmConfigPath: configPath });

        const record = await coordinator.submit({ eventId: 'manual-cycle-1', agentId: 'ferrye14',
            type: 'manual-request', sourceKey: 'admin:manual-cycle-1', occurredAt: new Date().toISOString(),
            summary: 'Run the bounded acceptance cycle.' });

        expect(record).toMatchObject({ gate: { accepted: true }, outcome: { status: 'executing',
            decision: { kind: 'execute-skill', skill: reference } }, error: null });
        expect(started).toHaveLength(1);
        expect(started[0]).toMatchObject({ username: 'ferrye14',
            skill: 'mining.varrock-east.copper-to-bank@1.0.0' });
        expect(record.outcome).not.toBeNull();
        expect(started[0]!.runId).toBe(record.outcome!.runId);
        const reopened = new AgentStateStore(agentPath);
        expect(reopened.listDecisions('ferrye14').map(item => item.decisionId)).toEqual(['manual-cycle-1']);
        reopened.close();
        expect(await readReplanRecords(10, logPath)).toEqual([record]);

        await writeFile(configPath, JSON.stringify({ schemaVersion: 1, enabled: false,
            automaticReplanning: true, provider: 'mock', model: 'deterministic-scripted-v1',
            autonomousExecution: { enabled: true, allowedSkills: [reference],
                maxOperations: 10, maxTimeoutMs: 900_000 },
            limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1,
                maxCostMicros: 0, maxOutputTokens: 1000 } }));
        const blocked = await coordinator.submit({ eventId: 'manual-cycle-2', agentId: 'ferrye14',
            type: 'manual-request', sourceKey: 'admin:manual-cycle-2', occurredAt: new Date().toISOString(),
            summary: 'Verify the operation limit.' });
        expect(blocked).toMatchObject({ gate: { accepted: true }, outcome: {
            status: 'approval-required', reason: expect.stringContaining('limit') }, error: null });
        expect(started).toHaveLength(1);
        const finalStore = new AgentStateStore(agentPath);
        const decisionIds = finalStore.listDecisions('ferrye14').map(item => item.decisionId);
        finalStore.close();
        expect(decisionIds).toEqual(['manual-cycle-2', 'manual-cycle-1']);
        expect((await readReplanRecords(10, logPath)).map(item => item.event.eventId))
            .toEqual(['manual-cycle-2', 'manual-cycle-1']);
    });
});
