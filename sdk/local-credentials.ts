import { basename, dirname, resolve } from 'node:path';
import { ServerSecretStore, type SecretStore } from '../server/control-plane/secret-store.js';

/** Fork-specific OS-vault adapter; upstream direct/env credentials remain explicit caller inputs. */
export async function resolveBotFileCredential(envPath: string, metadata: Record<string, string>, store?: SecretStore): Promise<Record<string, string>> {
    if (metadata.CREDENTIAL_STORE !== 'windows-credential-manager') return metadata;
    const directory = dirname(resolve(envPath)), name = basename(directory), bots = dirname(directory);
    if (basename(bots).toLowerCase() !== 'bots' || !/^[a-zA-Z0-9]{1,12}$/.test(name)
        || metadata.BOT_USERNAME?.toLowerCase() !== name.toLowerCase()) throw new Error('Bot vault binding mismatch.');
    if (metadata.PASSWORD) throw new Error('Conflicting plaintext/vault bot credentials require migration.');
    const password = await (store ?? new ServerSecretStore(dirname(bots))).get(`bot-${name.toLowerCase()}`);
    if (!password) throw new Error('Bot credential unavailable in OS vault; no file/environment fallback.');
    return { ...metadata, PASSWORD: password };
}
