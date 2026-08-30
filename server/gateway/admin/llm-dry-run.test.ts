import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryLlmAuditSink } from '../../../llm-runtime/audit.js';
import { OpenAIResponsesProvider } from '../../../llm-runtime/openai-provider.js';
import { ScriptedMockProvider } from '../../../llm-runtime/mock-provider.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { createAdminAgent, createAdminAgentGoal, listAdminAgents, updateAdminAgentSkill } from './agent-state.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import { adminPublicDir } from './paths.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test('admin LLM dry-run shows the bounded request and never executes the proposed skill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-admin-llm-'));
    directories.push(root);
    const databasePath = join(root, 'agents.sqlite');
    const configPath = join(root, 'llm.json');
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, provider: 'mock',
        model: 'deterministic-scripted-v1', limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 0 } }));
    createAdminAgent({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'A miner.', personalityTraits: ['patient'] }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Become independent' }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'career', parentGoalId: 'life', horizon: 'long-term',
        title: 'Build a mining career' }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'stockpile', parentGoalId: 'career', horizon: 'current',
        title: 'Build an ore stockpile' }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'mine-ore', parentGoalId: 'stockpile', horizon: 'immediate', title: 'Mine iron ore',
        description: 'Mine iron ore and put it in the bank.', priority: 90,
        skill: { id: 'varrock-east-mining', version: '1.0.0' } }, databasePath);
    updateAdminAgentSkill('ferrye14', { id: 'varrock-east-mining', version: '1.0.0' }, 'known', null, databasePath);
    const store = new AgentStateStore(databasePath);
    store.setWorkingMemory('ferrye14', null, { summary: 'At the mine.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: ['Rune pickaxe'],
        observedAt: '2026-08-29T12:00:00.000Z' }, '2026-08-29T12:00:00.000Z');
    store.close();
    const catalog = await listAdminAgents(databasePath);
    const skill = { reference: 'varrock-east-mining@1.0.0', id: 'varrock-east-mining', version: '1.0.0',
        name: 'Varrock East mining', description: 'Mine iron ore and bank it.', tags: ['mining'], parameters: {},
        limits: { timeoutMs: 60_000, maxOperations: 100 } };
    const audit = new MemoryLlmAuditSink();
    const result = await runAdminLlmDryRun(catalog.agents[0]!, [skill], {
        now: '2026-08-29T12:00:00.000Z', runId: '11111111-1111-4111-8111-111111111111', configPath, audit
    });
    expect(result.simulation).toBeTrue();
    expect(result.configuredEnabled).toBeFalse();
    expect(result.plan.status).toBe('proposed');
    expect(result.plan.decision).toMatchObject({ kind: 'execute-skill',
        skill: { id: 'varrock-east-mining', version: '1.0.0' } });
    expect(result.request?.trustedContext).toContain('Mine iron ore');
    expect(result.request?.tools[0].allowedSkills).toHaveLength(1);
    expect(audit.events.at(-1)?.type).toBe('decision.proposed');
});

test('admin UI exposes the LLM preview without an execution control', () => {
    const html = readFileSync(join(adminPublicDir, 'index.html'), 'utf8');
    const script = readFileSync(join(adminPublicDir, 'admin.js'), 'utf8');
    expect(html).toContain('id="llm-dry-run-dialog"');
    expect(html).toContain('id="llm-dry-run-context"');
    expect(script).toContain('data-action="agent-llm-dry-run"');
    expect(script).toContain('/llm-dry-run`');
    expect(html).not.toContain('id="llm-dry-run-execute"');
});

test('admin UI exposes server LLM settings without an API-key readback field', () => {
    const html = readFileSync(join(adminPublicDir, 'index.html'), 'utf8');
    const script = readFileSync(join(adminPublicDir, 'admin.js'), 'utf8');
    expect(html).toContain('data-tab="llm"');
    expect(html).toContain('id="llm-settings-form"');
    expect(html).toContain('name="plannerPrompt"');
    expect(html).toContain('name="skillBuilderEnabled"');
    expect(html).toContain('name="skillBuilderPrompt"');
    expect(html).toContain('name="apiKey" type="password"');
    expect(script).toContain('/api/admin/llm-settings');
    expect(html).toContain('id="capability-gap-list"');
    expect(script).toContain('/api/admin/capability-gaps');
    expect(script).toContain('gap.builderAttempts');
    expect(script).toContain('gap.builderCostMicros');
    expect(script).toContain('gap.lastBuilderError');
    expect(script).toContain('config.skillBuilder');
    expect(script).not.toContain('settings.apiKey.value');
});

test('admin LLM dry-run proposes the missing goal hierarchy from a long-term goal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-admin-llm-goals-'));
    directories.push(root);
    const databasePath = join(root, 'agents.sqlite');
    const configPath = join(root, 'llm.json');
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, provider: 'mock',
        model: 'deterministic-scripted-v1', limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 0 } }));
    createAdminAgent({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'An ambitious miner.', personalityTraits: ['patient'] }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Become wealthy' }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'workshop', parentGoalId: 'life', horizon: 'long-term',
        title: 'Buy the Varrock workshop', priority: 90 }, databasePath);
    updateAdminAgentSkill('ferrye14', { id: 'varrock-east-mining', version: '1.0.0' }, 'known', null, databasePath);
    const store = new AgentStateStore(databasePath);
    store.setWorkingMemory('ferrye14', null, { summary: 'Ready to work.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: [],
        observedAt: '2026-08-29T12:00:00.000Z' }, '2026-08-29T12:00:00.000Z');
    store.close();
    const catalog = await listAdminAgents(databasePath);
    const skill = { reference: 'varrock-east-mining@1.0.0', id: 'varrock-east-mining', version: '1.0.0',
        name: 'Varrock East mining', description: 'Mine ore and bank it.', tags: ['mining'], parameters: {},
        limits: { timeoutMs: 60_000, maxOperations: 100 } };
    const result = await runAdminLlmDryRun(catalog.agents[0]!, [skill], {
        now: '2026-08-29T12:00:00.000Z', configPath, audit: new MemoryLlmAuditSink()
    });
    expect(result.request?.mode).toBe('derive-immediate-goal');
    expect(result.plan.decision).toMatchObject({ kind: 'propose-goal-plan', goals: [
        { horizon: 'current', parentGoalId: 'workshop' }, { horizon: 'immediate' }
    ], skill: { id: 'varrock-east-mining', version: '1.0.0' } });
    expect(result.plan.approvalId).toBeNull();
});

test('keeps an accessible catalog skill out of LLM tools until the agent learns it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-admin-unlearned-skill-'));
    directories.push(root);
    const databasePath = join(root, 'agents.sqlite');
    const configPath = join(root, 'llm.json');
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, provider: 'mock',
        model: 'deterministic-scripted-v1', limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 0 } }));
    createAdminAgent({ agentId: 'newminer', playerUsername: 'NewMiner', displayName: 'New Miner',
        background: 'A new arrival.', personalityTraits: ['curious'] }, databasePath);
    createAdminAgentGoal('newminer', { goalId: 'life', horizon: 'life', title: 'Become self-sufficient' }, databasePath);
    const store = new AgentStateStore(databasePath);
    store.setWorkingMemory('newminer', null, { summary: 'Ready.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: [],
        observedAt: '2026-08-30T12:00:00.000Z' }, '2026-08-30T12:00:00.000Z');
    store.close();
    const agent = (await listAdminAgents(databasePath)).agents[0]!;
    const skill = { reference: 'mining.varrock-east.copper-to-bank@1.0.0',
        id: 'mining.varrock-east.copper-to-bank', version: '1.0.0', name: 'Varrock copper mining',
        description: 'Mine copper ore and bank the copper.', tags: ['mining', 'copper'], parameters: {},
        limits: { timeoutMs: 60_000, maxOperations: 100 } };
    const provider = new ScriptedMockProvider([{ output: { decision: 'propose_goal_plan', goalId: 'life', goals: [
        { goalId: 'career', parentGoalId: 'life', horizon: 'long-term', title: 'Build a mining career', description: '', priority: 80 },
        { goalId: 'capital', parentGoalId: 'career', horizon: 'current', title: 'Build capital', description: '', priority: 80 },
        { goalId: 'mine-copper', parentGoalId: 'capital', horizon: 'immediate', title: 'Mine copper ore',
            description: 'Bank the copper afterwards.', priority: 80 }
    ], reason: 'Find a safe source of income.' }, usage: { costMicros: 0 }, providerRequestId: 'unlearned' }]);
    const result = await runAdminLlmDryRun(agent, [skill], {
        now: '2026-08-30T12:00:00.000Z', configPath, provider, audit: new MemoryLlmAuditSink()
    });
    expect(result.request?.tools[0].allowedSkills).toHaveLength(0);
    expect(result.capability).toMatchObject({ kind: 'skill-discovered', resolution: {
        source: 'shared-library', knowledge: 'unlearned', requiresLearning: true,
        skill: { id: skill.id, version: skill.version }
    } });
});

test('admin LLM dry-run can use the real provider boundary without executing the plan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-admin-openai-'));
    directories.push(root);
    const databasePath = join(root, 'agents.sqlite');
    const configPath = join(root, 'llm.json');
    const pricing = { inputMicrosPerMillionTokens: 2_000_000, outputMicrosPerMillionTokens: 12_000_000 };
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: true, provider: 'openai',
        model: 'gpt-5.6-terra', pricing, limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 50_000 } }));
    createAdminAgent({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'A miner.', personalityTraits: ['patient'] }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Become wealthy' }, databasePath);
    const store = new AgentStateStore(databasePath);
    store.setWorkingMemory('ferrye14', null, { summary: 'Idle.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: [],
        observedAt: '2026-08-29T12:00:00.000Z' }, '2026-08-29T12:00:00.000Z');
    store.close();
    const catalog = await listAdminAgents(databasePath);
    const capabilityGapStore = new CapabilityGapStore(join(root, 'capability-gaps.json'));
    const provider = new OpenAIResponsesProvider({ apiKey: 'not-a-real-key', pricing, fetch: async () =>
        new Response(JSON.stringify({ id: 'resp_test', status: 'completed', usage: {
            input_tokens: 100, output_tokens: 50 }, output_text: JSON.stringify({ decision: 'propose_goal_plan',
            goalId: 'life', goals: [
                { goalId: 'wealth-strategy', parentGoalId: 'life', horizon: 'long-term', title: 'Build wealth',
                    description: '', priority: 80 },
                { goalId: 'earn-money', parentGoalId: 'wealth-strategy', horizon: 'current', title: 'Earn money',
                    description: '', priority: 80 },
                { goalId: 'find-work', parentGoalId: 'earn-money', horizon: 'immediate', title: 'Find work',
                    description: '', priority: 80 }
            ], tool: null, reason: 'No reviewed skill is known yet.' }) }), { status: 200 }) });
    const result = await runAdminLlmDryRun(catalog.agents[0]!, [], {
        now: '2026-08-29T12:00:00.000Z', configPath, provider, audit: new MemoryLlmAuditSink(), capabilityGapStore
    });
    expect(result.configuredEnabled).toBeTrue();
    expect(result.plan).toMatchObject({ status: 'proposed', approvalId: null,
        decision: { kind: 'propose-goal-plan', skill: null } });
    expect(result.request?.model).toBe('gpt-5.6-terra');
    expect(result.capability).toMatchObject({ kind: 'gap-reported', gap: { created: true,
        gap: { title: 'Find work', status: 'open' } } });
    expect(await capabilityGapStore.list()).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
    await expect(runAdminLlmDryRun(catalog.agents[0]!, [], {
        now: '2026-08-29T12:00:00.000Z', configPath, provider, automatic: true,
        audit: new MemoryLlmAuditSink()
    })).rejects.toThrow('automatikus LLM újratervezés ki van kapcsolva');
    expect(provider.requests).toHaveLength(1);
});

test('automatic replanning does not call the model again while its capability gap is pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-admin-pending-gap-'));
    directories.push(root);
    const databasePath = join(root, 'agents.sqlite');
    const configPath = join(root, 'llm.json');
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, provider: 'mock',
        model: 'deterministic-scripted-v1', automaticReplanning: true,
        limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0 } }));
    createAdminAgent({ agentId: 'ferrye14', playerUsername: 'Ferrye14', displayName: 'Ferrye',
        background: 'A worker.', personalityTraits: ['patient'] }, databasePath);
    createAdminAgentGoal('ferrye14', { goalId: 'life', horizon: 'life', title: 'Build a livelihood' }, databasePath);
    const state = new AgentStateStore(databasePath);
    state.setWorkingMemory('ferrye14', null, { summary: 'Ready.', currentActivity: null,
        location: { x: 3285, z: 3367, level: 0 }, observations: [],
        observedAt: '2026-08-30T12:00:00.000Z' }, '2026-08-30T12:00:00.000Z');
    state.close();
    const agent = (await listAdminAgents(databasePath)).agents[0]!;
    const response = { output: { decision: 'propose_goal_plan', goalId: 'life', goals: [
        { goalId: 'work', parentGoalId: 'life', horizon: 'long-term', title: 'Find work', description: '', priority: 80 },
        { goalId: 'income', parentGoalId: 'work', horizon: 'current', title: 'Earn income', description: '', priority: 80 },
        { goalId: 'first-job', parentGoalId: 'income', horizon: 'immediate', title: 'Complete a paid job',
            description: '', priority: 80 }
    ], reason: 'A practical job skill is missing.' }, usage: { costMicros: 0 }, providerRequestId: 'mock-gap' };
    const provider = new ScriptedMockProvider([response, response]);
    const gapStore = new CapabilityGapStore(join(root, 'capability-gaps.json'));

    const first = await runAdminLlmDryRun(agent, [], { now: '2026-08-30T12:00:00.000Z', configPath,
        provider, automatic: true, audit: new MemoryLlmAuditSink(), capabilityGapStore: gapStore });
    expect(first.capability.kind).toBe('gap-reported');
    expect(provider.requests).toHaveLength(1);

    const blocked = await runAdminLlmDryRun(agent, [], { now: '2026-08-30T12:00:10.000Z', configPath,
        provider, automatic: true, audit: new MemoryLlmAuditSink(), capabilityGapStore: gapStore });
    expect(blocked).toMatchObject({ plan: { status: 'stopped' }, capability: { kind: 'gap-pending' }, request: null });
    expect(provider.requests).toHaveLength(1);
});
