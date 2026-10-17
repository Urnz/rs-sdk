import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SecretStore {
    status(name: string): Promise<boolean>;
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
}

/** Windows logon-user vault. The API never exposes this runtime-only resolver. */
export class ServerSecretStore implements SecretStore {
    private readonly scope: string;
    constructor(workspace: string) {
        const path = realpathSync(resolve(workspace));
        this.scope = createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex');
    }
    private async call(operation: string, name: string, value?: string): Promise<{ configured?: boolean; value?: string }> {
        if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error('Invalid secret name.');
        if (process.platform !== 'win32') throw new Error('OS secret store unavailable on this platform; plaintext fallback is disabled.');
        if (value !== undefined && (!value.length || Buffer.byteLength(value) > 2560)) throw new Error('Invalid secret length.');
        try {
            const child = Bun.spawn(['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(import.meta.dir, 'windows-secret-store.ps1')], {
                stdin: new Blob([JSON.stringify({ operation, target: `rs-sdk/v1/${this.scope}/${name}`, ...(value === undefined ? {} : { value }) })]),
                stdout: 'pipe', stderr: 'ignore', windowsHide: true,
                env: Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
            });
            const timer = setTimeout(() => child.kill(), 10000);
            try {
                const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
                if (exit) throw new Error();
                return JSON.parse(output);
            } finally { clearTimeout(timer); }
        } catch { throw new Error('Az operációsrendszer-titoktár nem érhető el; a művelet nem használ fájlos vagy környezeti pótlást.'); }
    }
    async status(name: string) { return (await this.call('status', name)).configured === true; }
    async get(name: string) {
        const result = await this.call('get', name);
        if (result.configured && typeof result.value !== 'string') throw new Error('Invalid secret store response.');
        return result.configured ? result.value! : null;
    }
    async set(name: string, value: string) { await this.call('set', name, value); }
    async delete(name: string) { await this.call('delete', name); }
}
