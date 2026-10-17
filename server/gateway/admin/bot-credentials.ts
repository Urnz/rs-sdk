import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerSecretStore, type SecretStore } from '../../control-plane/secret-store.js';

export function publicBotEnvironment(environment: Record<string, string | undefined>) {
    return Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME',
        'LOGIN_RSAN', 'LOGIN_RSAE', 'RS_SDK_LITE_CACHE_DIR', 'ENGINE_ADMIN_URL', 'SERVER', 'GATEWAY_URL', 'NODE_ENV']
        .flatMap(key => environment[key] ? [[key, environment[key]!]] : []));
}

export function parseBotEnvironment(text: string): Record<string, string> {
    return Object.fromEntries(text.split(/\r?\n/).map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
}
function botName(username: string) {
    if (!/^[a-zA-Z0-9]{1,12}$/.test(username)) throw new Error('Invalid bot credential name.');
    return `bot-${username.toLowerCase()}`;
}
export async function loadBotCredentials(root: string, username: string, store: SecretStore = new ServerSecretStore(root)) {
    const name = botName(username);
    let text: string;
    try { text = await readFile(join(root, 'bots', username, 'bot.env'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('A bot helyi konfigurációja nem olvasható.'); }
    const metadata = parseBotEnvironment(text);
    if (metadata.PASSWORD) throw new Error('A bot hitelesítő adata titoktár-migrációt igényel.');
    if (metadata.CREDENTIAL_STORE === 'windows-credential-manager') {
        const password = await store.get(name);
        if (!password) throw new Error('A bot titoktár-bejegyzése hiányzik; fájlos visszaesés nincs.');
        metadata.PASSWORD = password;
    }
    return metadata;
}
export async function rememberBotCredentials(root: string, username: string, password: string, metadata: Record<string, string>, store: SecretStore = new ServerSecretStore(root)) {
    const name = botName(username);
    if (!password || /[\r\n\u0000]/.test(password) || password.length > 1024) throw new Error('Invalid bot credential.');
    const fields = ['BOT_USERNAME', 'SERVER', 'GATEWAY_URL', 'SHOW_CHAT', 'TELEMETRY', 'PROFANITY_FILTER'];
    const lines = fields.filter(key => metadata[key]).map(key => {
        if (/[\r\n\u0000]/.test(metadata[key]!)) throw new Error('Invalid bot configuration.');
        return `${key}=${metadata[key]}`;
    });
    await store.set(name, password);
    if (await store.get(name) !== password) throw new Error('A bot titoktár-írása nem igazolható; a korábbi fájl megmaradt.');
    const directory = join(root, 'bots', username), file = join(directory, 'bot.env');
    await mkdir(directory, { recursive: true });
    const temporary = `${file}.tmp-${crypto.randomUUID()}`;
    await writeFile(temporary, [...lines, 'CREDENTIAL_STORE=windows-credential-manager', ''].join('\n'), { mode: 0o600 });
    await rename(temporary, file);
}
