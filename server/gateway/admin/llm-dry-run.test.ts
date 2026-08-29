import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryLlmAuditSink } from '../../../llm-runtime/audit.js';
import { AgentStateStore } from '../../../agent-state/store.js';
import { createAdminAgent, createAdminAgentGoal, listAdminAgents, updateAdminAgentSkill } from './agent-state.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import { adminPublicDir } from './paths.js';

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
