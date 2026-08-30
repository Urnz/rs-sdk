import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAdminLlmSettings, removeOpenAIApiKey, replaceOpenAIApiKey,
    updateAdminLlmSettings } from './llm-settings.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'rs-llm-settings-'));
    temporaryDirectories.push(directory);
    const paths = {
        defaultConfigPath: join(directory, 'default.json'),
        overrideConfigPath: join(directory, 'server', 'llm-runtime.json'),
        apiKeyPath: join(directory, 'server', 'secrets', 'openai-api-key.txt')
    };
    await writeFile(paths.defaultConfigPath, JSON.stringify({
        schemaVersion: 1, enabled: false, automaticReplanning: false, provider: 'mock',
        model: 'deterministic-scripted-v1', limits: {
            maxDurationMs: 10_000, maxModelRequests: 1, maxToolCalls: 1, maxCostMicros: 0
        }
    }));
    return paths;
}

describe('admin LLM settings', () => {
    test('loads project defaults without returning a secret value', async () => {
        const paths = await fixture();
        const settings = await readAdminLlmSettings(paths, { OPENAI_API_KEY: 'environment-secret-value-123' });

        expect(settings.source).toBe('project-default');
        expect(settings.apiKey).toEqual({ configured: true, source: 'environment' });
        expect(JSON.stringify(settings)).not.toContain('environment-secret-value-123');
        expect(settings.config.plannerPrompt).toContain('RuneScape-style');
        expect(settings.config.limits.maxOutputTokens).toBe(2000);
        expect(settings.config.skillBuilder.enabled).toBeFalse();
    });

    test('persists a validated per-server override', async () => {
        const paths = await fixture();
        await updateAdminLlmSettings({
            schemaVersion: 1, enabled: true, automaticReplanning: false, provider: 'openai', model: 'gpt-test',
            reasoningEffort: 'medium', plannerPrompt: 'Plan actions for this RuneScape agent.',
            pricing: { inputMicrosPerMillionTokens: 10, outputMicrosPerMillionTokens: 20 },
            skillBuilder: { enabled: true, prompt: 'Build reusable RuneScape skills.', intervalMs: 60000,
                cooldownMs: 3600000, maxAttemptsPerGap: 3, maxCostMicrosPerGap: 5000,
                maxDailyCostMicros: 10000, maxDurationMs: 30000, maxOutputTokens: 4000 },
            limits: { maxDurationMs: 5000, maxModelRequests: 1, maxToolCalls: 1,
                maxCostMicros: 1000, maxOutputTokens: 1500 }
        }, paths);

        const settings = await readAdminLlmSettings(paths, {});
        expect(settings.source).toBe('server-override');
        expect(settings.config).toMatchObject({ provider: 'openai', model: 'gpt-test', reasoningEffort: 'medium',
            skillBuilder: { enabled: true, maxDailyCostMicros: 10000 } });
        expect(JSON.parse(await readFile(paths.overrideConfigPath, 'utf8')).plannerPrompt)
            .toBe('Plan actions for this RuneScape agent.');
    });

    test('stores a write-only local secret and can remove it', async () => {
        const paths = await fixture();
        await replaceOpenAIApiKey('sk-local-secret-value-123456789', paths);

        const configured = await readAdminLlmSettings(paths, {});
        expect(configured.apiKey).toEqual({ configured: true, source: 'local-secret' });
        expect(JSON.stringify(configured)).not.toContain('sk-local-secret');

        await removeOpenAIApiKey(paths);
        expect((await readAdminLlmSettings(paths, {})).apiKey.configured).toBeFalse();
    });
});
