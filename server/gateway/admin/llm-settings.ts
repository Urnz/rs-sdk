import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateLlmRuntimeConfig } from '../../../llm-runtime/config.js';
import type { LlmRuntimeConfig } from '../../../llm-runtime/types.js';
import { llmApiKeyPath, llmRuntimeConfigPath, llmRuntimeOverridePath } from './paths.js';

export interface AdminLlmSettings {
    config: LlmRuntimeConfig;
    source: 'server-override' | 'project-default';
    apiKey: {
        configured: boolean;
        source: 'local-secret' | 'environment' | 'none';
    };
}

export interface AdminLlmSettingsPaths {
    defaultConfigPath?: string;
    overrideConfigPath?: string;
    apiKeyPath?: string;
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
    const path = paths(options).apiKeyPath;
    if (await exists(path)) {
        const value = (await readFile(path, 'utf8')).trim();
        if (value) return { value, source: 'local-secret' };
    }
    const value = environment.OPENAI_API_KEY?.trim() ?? '';
    return { value, source: value ? 'environment' : 'none' };
}

export async function readAdminLlmSettings(options: AdminLlmSettingsPaths = {},
    environment: Record<string, string | undefined> = process.env): Promise<AdminLlmSettings> {
    const loaded = await loadLlmRuntimeConfig(options);
    const secret = await resolveOpenAIApiKey(options, environment);
    return {
        ...loaded,
        apiKey: { configured: Boolean(secret.value), source: secret.source }
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
    const path = paths(options).apiKeyPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${validateOpenAIApiKey(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
}

export async function removeOpenAIApiKey(options: AdminLlmSettingsPaths = {}): Promise<void> {
    await rm(paths(options).apiKeyPath, { force: true });
}
