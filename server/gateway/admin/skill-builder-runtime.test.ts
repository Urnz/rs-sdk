import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SkillBuilderProvider } from '../../../agent-skills/builder.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { FileSkillStore } from '../../../agent-skills/store.js';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import { GatewaySkillBuilderScheduler, type GatewaySkillBuilderDependencies } from './skill-builder-runtime.js';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function config(enabled = true) {
    return validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true, provider: 'openai', model: 'gpt-test',
        pricing: { inputMicrosPerMillionTokens: 1, outputMicrosPerMillionTokens: 1 },
        skillBuilder: { enabled, prompt: 'Build bounded skills.', intervalMs: 10000, cooldownMs: 60000,
            maxAttemptsPerGap: 3, maxCostMicrosPerGap: 1000, maxDailyCostMicros: 2000,
            maxDurationMs: 1000, maxOutputTokens: 1000 },
        limits: { maxDurationMs: 1000, maxModelRequests: 1, maxToolCalls: 1,
            maxCostMicros: 1000, maxOutputTokens: 1000 } });
}

describe('gateway Skill Builder scheduler', () => {
    test('creates at most one draft per interval and appends cost to the daily ledger', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rs-builder-scheduler-'));
        directories.push(root);
        const gaps = new CapabilityGapStore(join(root, 'gaps.json'));
        await gaps.report({ agentId: 'miner1', goalId: 'mine-copper', title: 'Mine copper' });
        let calls = 0;
        const provider: SkillBuilderProvider = { id: 'openai', build: async () => {
            calls++;
            return { proposal: { id: 'mining.copper', version: '0.1.0', name: 'Mine copper',
                description: 'Mine copper ore.', tags: ['mining'], parameters: {},
                limits: { timeoutMs: 60000, maxOperations: 10 }, preconditions: [],
                steps: [{ kind: 'operation', id: 'walk', operation: 'walk-to', arguments: { x: 1, z: 1 } }] },
            usage: { costMicros: 250 }, providerRequestId: 'resp-1' };
        } };
        const dependencies: GatewaySkillBuilderDependencies = {
            loadConfig: async () => config(), resolveApiKey: async () => 'secret-key', listSkills: async () => [],
            createProvider: () => provider, gaps, skills: new FileSkillStore(join(root, 'skills')),
            ledgerPath: join(root, 'builder.jsonl')
        };
        const scheduler = new GatewaySkillBuilderScheduler(dependencies);

        const built = await scheduler.tick('2026-08-30T15:00:00.000Z');
        const waiting = await scheduler.tick('2026-08-30T15:00:01.000Z');
        const idle = await scheduler.tick('2026-08-30T15:00:11.000Z');

        expect(built).toMatchObject({ status: 'draft-created', dailyCostMicros: 250,
            run: { costMicros: 250, providerRequestId: 'resp-1' } });
        expect(waiting.status).toBe('waiting');
        expect(idle.status).toBe('idle');
        expect(calls).toBe(1);
        expect(await readFile(dependencies.ledgerPath, 'utf8')).toContain('"costMicros":250');
    });

    test('does not resolve a key or create a provider while disabled', async () => {
        let touched = false;
        const root = await mkdtemp(join(tmpdir(), 'rs-builder-disabled-'));
        directories.push(root);
        const dependencies: GatewaySkillBuilderDependencies = {
            loadConfig: async () => config(false), resolveApiKey: async () => { touched = true; return 'secret'; },
            listSkills: async () => [], createProvider: () => { touched = true; throw new Error('not expected'); },
            gaps: new CapabilityGapStore(join(root, 'gaps.json')),
            skills: new FileSkillStore(join(root, 'skills')), ledgerPath: join(root, 'builder.jsonl')
        };
        expect((await new GatewaySkillBuilderScheduler(dependencies).tick()).status).toBe('disabled');
        expect(touched).toBeFalse();
    });
});
