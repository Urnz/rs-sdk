import { expect, test } from 'bun:test';
import { resolveBotFileCredential } from '../local-credentials.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ServerSecretStore } from '../../server/control-plane/secret-store.js';

test('vault SDK credentials bind the bot name to its local file and never use plaintext fallback', async () => {
    const store = { status: async () => true, get: async (name: string) => name === 'bot-ada' ? 'synthetic-sdk-credential' : null,
        set: async () => {}, delete: async () => {} };
    const metadata = { BOT_USERNAME: 'ada', CREDENTIAL_STORE: 'windows-credential-manager', SERVER: 'localhost:8888' };
    const file = `${process.cwd()}/bots/ada/bot.env`;
    expect((await resolveBotFileCredential(file, metadata, store)).PASSWORD).toBe('synthetic-sdk-credential');
    await expect(resolveBotFileCredential(file, { ...metadata, BOT_USERNAME: 'other' }, store)).rejects.toThrow('binding');
    await expect(resolveBotFileCredential(file, { ...metadata, PASSWORD: 'legacy' }, store)).rejects.toThrow('Conflicting');
    await expect(resolveBotFileCredential(file, metadata, { ...store, get: async () => null })).rejects.toThrow('no file/environment fallback');
});

test('manual SDK CLI resolves a migrated bot from the real OS vault and keeps network failures secret-free', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdk-vault-cli-')), store = new ServerSecretStore(root);
    const secret = 'synthetic-sdk-vault-password';
    let authenticated = false;
    const gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
        authenticated = new URL(req.url).searchParams.get('password') === secret;
        return Response.json({ state: { inGame: true, tick: 7 }, stateAge: 0 });
    } });
    const cli = resolve(import.meta.dir, '../cli.ts');
    const execute = async () => {
        const child = Bun.spawn([process.execPath, '--no-env-file', cli, 'ada', '--json', '--timeout', '1000'], {
            cwd: root, env: Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
            stdout: 'pipe', stderr: 'pipe', windowsHide: true
        });
        const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(output + error).not.toContain(secret);
        return { output, error, exit };
    };
    try {
        await mkdir(join(root, 'bots/ada'), { recursive: true });
        await writeFile(join(root, 'bots/ada/bot.env'), `BOT_USERNAME=ada\nCREDENTIAL_STORE=windows-credential-manager\nSERVER=localhost:8888\nGATEWAY_URL=ws://127.0.0.1:${gateway.port}\n`);
        await store.set('bot-ada', secret);
        const result = await execute();
        expect(result.exit).toBe(0); expect(JSON.parse(result.output).tick).toBe(7); expect(authenticated).toBe(true);
        gateway.stop(true);
        expect((await execute()).exit).toBe(1);
    } finally { gateway.stop(true); await store.delete('bot-ada'); await rm(root, { recursive: true, force: true }); }
}, 20000);

test('bot creation stores generated credentials in the OS vault and writes only local connection metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdk-vault-create-')), store = new ServerSecretStore(root);
    try {
        await mkdir(join(root, 'bots/_template'), { recursive: true });
        await writeFile(join(root, 'bots/_template/bot.env'), 'BOT_USERNAME={{USERNAME}}\nPASSWORD={{PASSWORD}}\nSERVER=rs-sdk-demo.fly.dev\nTELEMETRY=true\n');
        const child = Bun.spawn([process.execPath, '--no-env-file', resolve(import.meta.dir, '../../bots/create-bot.ts'), 'ada'], {
            cwd: root, stdout: 'pipe', stderr: 'pipe', windowsHide: true
        });
        const [output, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(exit).toBe(0);
        const secret = await store.get('bot-ada');
        expect(secret?.length).toBe(32);
        const metadata = await Bun.file(join(root, 'bots/ada/bot.env')).text();
        expect(metadata).toContain('SERVER=localhost:8888');
        expect(metadata).toContain('CREDENTIAL_STORE=windows-credential-manager');
        expect(metadata).not.toContain('PASSWORD=');
        expect(output + error + metadata).not.toContain(secret!);
    } finally { await store.delete('bot-ada'); await rm(root, { recursive: true, force: true }); }
}, 20000);
