import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import type { LlmRuntimeConfig } from '../../../llm-runtime/types.js';
import { llmApiKeyPath, llmRuntimeConfigPath, llmRuntimeOverridePath, repoRoot } from './paths.js';
import { ServerSecretStore, type SecretStore } from '../../control-plane/secret-store.js';

export interface AdminLlmSettings {
    config: LlmRuntimeConfig;
    source: 'server-override' | 'project-default';
    apiKey: {
        configured: boolean;
        source: 'os-secret-store' | 'migration-required' | 'none';
    };
}

export interface AdminLlmSettingsPaths {
    defaultConfigPath?: string;
    overrideConfigPath?: string;
    apiKeyPath?: string;
    secretStore?: SecretStore;
}

function secrets(options: AdminLlmSettingsPaths) {
    return options.secretStore ?? new ServerSecretStore(options.defaultConfigPath ? dirname(options.defaultConfigPath) : repoRoot);
}

async function exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
}

function paths(options: AdminLlmSettingsPaths = {}) {
    return {
        defaultConfigPath: options.defaultConfigPath ?? llmRuntimeConfigPath,
        overrideConfigPath: options.overrideConfigPath ?? llmRuntimeOverridePath,
        apiKeyPath: options.apiKeyPath ?? llmApiKeyPath
    };
}

async function readConfig(path: string): Promise<LlmRuntimeConfig> {
    return validateLlmRuntimeConfig(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function loadLlmRuntimeConfig(options: AdminLlmSettingsPaths = {}): Promise<{
    config: LlmRuntimeConfig;
    source: AdminLlmSettings['source'];
}> {
    const resolved = paths(options);
    const override = await exists(resolved.overrideConfigPath);
    return {
        config: await readConfig(override ? resolved.overrideConfigPath : resolved.defaultConfigPath),
        source: override ? 'server-override' : 'project-default'
    };
}

export async function resolveOpenAIApiKey(options: AdminLlmSettingsPaths = {},
    environment: Record<string, string | undefined> = process.env): Promise<{
        value: string;
        source: AdminLlmSettings['apiKey']['source'];
    }> {
    const value = await secrets(options).get('openai-api-key');
    if (value) return { value, source: 'os-secret-store' };
    if (await exists(paths(options).apiKeyPath) || environment.OPENAI_API_KEY?.trim())
        throw new Error('A korábbi API-kulcs titoktár-migrációt igényel; fájlos és környezeti visszaesés nincs.');
    return { value: '', source: 'none' };
}

export async function readAdminLlmSettings(options: AdminLlmSettingsPaths = {},
    environment: Record<string, string | undefined> = process.env): Promise<AdminLlmSettings> {
    const loaded = await loadLlmRuntimeConfig(options);
    const configured = await secrets(options).status('openai-api-key');
    const legacy = await exists(paths(options).apiKeyPath) || Boolean(environment.OPENAI_API_KEY?.trim());
    return {
        ...loaded,
        apiKey: { configured, source: configured ? 'os-secret-store' : legacy ? 'migration-required' : 'none' }
    };
}

export function validateOpenAIApiKey(value: string): string {
    const key = value.trim();
    if (key.length < 20 || key.length > 512 || /\s/.test(key)) {
        throw new Error('Az API-kulcs 20–512 karakteres, szóköz nélküli titok lehet.');
    }
    return key;
}

export async function updateAdminLlmSettings(input: unknown, options: AdminLlmSettingsPaths = {}): Promise<LlmRuntimeConfig> {
    const config = validateLlmRuntimeConfig(input);
    if (!['mock', 'openai'].includes(config.provider)) throw new Error(`Nem támogatott LLM provider: ${config.provider}`);
    const path = paths(options).overrideConfigPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
    return config;
}

export async function replaceOpenAIApiKey(value: string, options: AdminLlmSettingsPaths = {}): Promise<void> {
    const store = secrets(options), key = validateOpenAIApiKey(value);
    await store.set('openai-api-key', key);
    if (await store.get('openai-api-key') !== key) throw new Error('A titoktár írása nem igazolható; a korábbi fájl megmaradt.');
    await rm(paths(options).apiKeyPath, { force: true });
}

export async function removeOpenAIApiKey(options: AdminLlmSettingsPaths = {}): Promise<void> {
    await secrets(options).delete('openai-api-key');
    await rm(paths(options).apiKeyPath, { force: true });
}
