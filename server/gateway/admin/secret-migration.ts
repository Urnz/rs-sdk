import { createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ServerSecretStore, type SecretStore } from '../../control-plane/secret-store.js';
import { parseBotEnvironment, rememberBotCredentials } from './bot-credentials.js';
import { validateOpenAIApiKey } from './llm-settings.js';

/** Restartable import: verify OS storage before changing any legacy source. Never export secrets. */
export async function migrateWorkspaceSecrets(root: string, store: SecretStore = new ServerSecretStore(root), environment: Record<string, string | undefined> = {}, options: { offlineSourceUpgrade?: boolean } = {}) {
    root = resolve(root);
    const checkSource = async (file: string, base = root) => {
        const path = relative(base, file);
        if (isAbsolute(path) || path.startsWith(`..${sep}`) || path === '..') throw new Error('Invalid migration source.');
        let current = base;
        for (const part of ['', ...path.split(sep)]) {
            current = join(current, part);
            try {
                const stat = await lstat(current);
                if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error('Migration source aliases are forbidden.');
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
    };
    let imported = 0;
    const protect = async (name: string, value: string) => {
        const previous = await store.get(name);
        if (previous !== null && previous !== value) throw new Error('Titoktár-migrációs konfliktus; a forrás megmaradt.');
        if (previous === null) await store.set(name, value);
        if (await store.get(name) !== value) throw new Error('A titoktár-migráció írása nem igazolható; a forrás megmaradt.');
        imported++;
    };
    const managed = existsSync(join(root, '.local/instance.json'));
    if (managed && !options.offlineSourceUpgrade && !existsSync(join(root, 'server/control-plane/secret-store.ts')))
        throw new Error('A pinnelt régi világ előbb kompatibilis forrásmigrációt igényel; titkai változatlanok.');
    const keyFile = join(root, '.local/admin/secrets/openai-api-key.txt');
    await checkSource(keyFile);
    const fileKey = existsSync(keyFile) ? (await readFile(keyFile, 'utf8')).trim() : '';
    const envKey = environment.OPENAI_API_KEY?.trim() ?? '';
    if (fileKey && envKey && fileKey !== envKey) throw new Error('Eltérő korábbi API-kulcsforrások; a migráció nem választ automatikusan.');
    if (fileKey || envKey) {
        await protect('openai-api-key', validateOpenAIApiKey(fileKey || envKey));
        await rm(keyFile, { force: true });
    }
    const botRoot = join(root, 'bots');
    if (existsSync(botRoot)) for (const entry of await readdir(botRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9]{1,12}$/.test(entry.name)) continue;
        const file = join(botRoot, entry.name, 'bot.env');
        await checkSource(file);
        if (!existsSync(file)) continue;
        const metadata = parseBotEnvironment(await readFile(file, 'utf8'));
        if (!metadata.PASSWORD) continue;
        await protect(`bot-${entry.name.toLowerCase()}`, metadata.PASSWORD);
        await rememberBotCredentials(root, entry.name, metadata.PASSWORD, metadata, store);
    }
    if (managed) {
        const privateFile = join(root, 'server/engine/data/config/private.pem');
        await checkSource(privateFile);
        if (existsSync(privateFile)) {
            const value = await readFile(privateFile, 'utf8');
            const publicFile = await readFile(join(root, 'server/engine/data/config/public.pem'), 'utf8');
            if (!createPublicKey(value).export({ type: 'spki', format: 'der' }).equals(createPublicKey(publicFile).export({ type: 'spki', format: 'der' })))
                throw new Error('A login-kulcs nem egyezik a világ nyilvános kulcsával.');
            await protect('engine-login-key', value); await rm(privateFile);
        }
        const journal = resolve(root, '../runtime.json');
        await checkSource(journal, resolve(root, '..'));
        if (existsSync(journal)) {
            const run = JSON.parse(await readFile(journal, 'utf8'));
            if (run.token) {
                if (!/^[a-f0-9]{64}$/.test(run.token)) throw new Error('Érvénytelen korábbi futási token.');
                await protect('worker-control-token', run.token);
                delete run.token; run.secretStore = 'windows-credential-manager';
                const temporary = `${journal}.tmp-${crypto.randomUUID()}`;
                await writeFile(temporary, JSON.stringify(run), { mode: 0o600 }); await rename(temporary, journal);
            }
        }
    }
    return { imported, environmentSourceImported: Boolean(envKey), managed };
}
