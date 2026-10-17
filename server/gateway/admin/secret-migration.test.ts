import { expect, test } from 'bun:test';
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateWorkspaceSecrets } from './secret-migration.js';
import { loadBotCredentials, publicBotEnvironment } from './bot-credentials.js';
import { readAdminLlmSettings, resolveOpenAIApiKey } from './llm-settings.js';
import type { SecretStore } from '../../control-plane/secret-store.js';

function memoryStore(): SecretStore {
    const values = new Map<string, string>();
    return { status: async name => values.has(name), get: async name => values.get(name) ?? null,
        set: async (name, value) => { values.set(name, value); }, delete: async name => { values.delete(name); } };
}
test('legacy provider and bot imports are verified, restartable and remove plaintext; runtime uses only the vault', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rs-secret-migration-')), store = memoryStore();
    const keyFile = join(root, '.local/admin/secrets/openai-api-key.txt'), bot = join(root, 'bots/ada/bot.env');
    try {
        await mkdir(join(root, '.local/admin/secrets'), { recursive: true }); await mkdir(join(root, 'bots/ada'), { recursive: true });
        await writeFile(keyFile, 'synthetic-provider-credential');
        await writeFile(bot, 'BOT_USERNAME=ada\nPASSWORD=synthetic-bot-password\nSERVER=localhost:8888\n');
        await expect(loadBotCredentials(root, 'ada', store)).rejects.toThrow('migráció');
        await expect(resolveOpenAIApiKey({ apiKeyPath: keyFile, secretStore: store }, {})).rejects.toThrow('migráció');
        expect((await migrateWorkspaceSecrets(root, store)).imported).toBe(2);
        expect(await Bun.file(keyFile).exists()).toBe(false);
        expect(await readFile(bot, 'utf8')).not.toContain('PASSWORD');
        expect((await loadBotCredentials(root, 'ada', store)).PASSWORD).toBe('synthetic-bot-password');
        expect(await resolveOpenAIApiKey({ apiKeyPath: keyFile, secretStore: store }, {})).toEqual({ value: 'synthetic-provider-credential', source: 'os-secret-store' });
        expect((await migrateWorkspaceSecrets(root, store)).imported).toBe(0);
        await store.delete('bot-ada');
        await expect(loadBotCredentials(root, 'ada', store)).rejects.toThrow('hiányzik');
    } finally { await rm(root, { recursive: true, force: true }); }
});
test('unavailable or conflicting vault imports retain their legacy source and never fall back to environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rs-secret-conflict-')), store = memoryStore();
    try {
        await mkdir(join(root, '.local/admin/secrets'), { recursive: true });
        const file = join(root, '.local/admin/secrets/openai-api-key.txt'); await writeFile(file, 'synthetic-provider-original');
        await store.set('openai-api-key', 'synthetic-different-credential');
        await expect(migrateWorkspaceSecrets(root, store)).rejects.toThrow('konfliktus');
        expect(await readFile(file, 'utf8')).toBe('synthetic-provider-original');
        await store.delete('openai-api-key');
        const broken = { ...store, set: async () => { throw new Error('synthetic unavailable vault'); } };
        await expect(migrateWorkspaceSecrets(root, broken)).rejects.toThrow('unavailable');
        expect(await readFile(file, 'utf8')).toBe('synthetic-provider-original');
        await expect(resolveOpenAIApiKey({ secretStore: store, apiKeyPath: file }, { OPENAI_API_KEY: 'synthetic-env-provider-key' })).rejects.toThrow('migráció');
    } finally { await rm(root, { recursive: true, force: true }); }
});
test('admin key status never invokes the runtime secret resolver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rs-secret-status-')), store = memoryStore();
    try {
        const config = join(root, 'config.json');
        await writeFile(config, await Bun.file('config/llm-runtime.json').text());
        await store.set('openai-api-key', 'synthetic-write-only-provider');
        store.get = async () => { throw new Error('status must not read secret'); };
        const status = await readAdminLlmSettings({ defaultConfigPath: config, overrideConfigPath: join(root, 'none'), apiKeyPath: join(root, 'none-key'), secretStore: store }, {});
        expect(status.apiKey).toEqual({ configured: true, source: 'os-secret-store' });
        expect(JSON.stringify(status)).not.toContain('synthetic-write-only-provider');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('bot children receive connection data without provider, admin, worker or login-key secrets', () => {
    expect(publicBotEnvironment({ PATH: 'synthetic-path', SERVER: 'localhost:8888', OPENAI_API_KEY: 'synthetic',
        ADMIN_TOKEN: 'synthetic', ENGINE_ADMIN_TOKEN: 'synthetic', MANAGED_CONTROL_TOKEN: 'synthetic', ENGINE_LOGIN_PRIVATE_KEY: 'synthetic' }))
        .toEqual({ PATH: 'synthetic-path', SERVER: 'localhost:8888' });
});

test('migration rejects a shared plaintext source before writing a vault entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rs-secret-alias-')), store = memoryStore();
    try {
        await mkdir(join(root, '.local/admin/secrets'), { recursive: true });
        const original = join(root, 'other-source'); await writeFile(original, 'synthetic-provider-original');
        await link(original, join(root, '.local/admin/secrets/openai-api-key.txt'));
        await expect(migrateWorkspaceSecrets(root, store)).rejects.toThrow('aliases');
        expect(await store.status('openai-api-key')).toBe(false);
        expect(await readFile(original, 'utf8')).toBe('synthetic-provider-original');
    } finally { await rm(root, { recursive: true, force: true }); }
});
