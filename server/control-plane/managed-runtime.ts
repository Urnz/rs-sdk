import { cp, mkdir, readFile, writeFile, symlink, lstat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { resolve, join, sep } from 'node:path';
import { createServer, type Server } from 'node:net';
import { IdentityError } from './identity-store.js';
import type { ManagedServer } from './lifecycle-store.js';
import { assertPrivateInstanceTree, verifyInstanceBinding } from './instance-files.js';
import { ServerSecretStore } from './secret-store.js';

export const worldTemplates = [
    { id: 'classic', label: 'Klasszikus bolti gazdaság', shopEconomyMode: 'legacy', xpRate: 25 },
    { id: 'closed-economy', label: 'Szereplők által finanszírozott gazdaság', shopEconomyMode: 'closed-society', xpRate: 1 }
] as const;
export interface ManagedRuntime {
    version: string;
    prepare(server: ManagedServer): Promise<void>;
    start(server: ManagedServer): Promise<void>;
    stop(server: ManagedServer): Promise<void>;
    inspect(server: ManagedServer): Promise<'running' | 'stopped' | 'unknown'>;
    connection?(server: ManagedServer): Promise<{ gateway: boolean; engine: boolean }>;
}
interface Run { generation: string; token: string; ports: number[] }
const failure = (code: string, message: string) => new IdentityError(409, code, message);
async function portsFree(ports: number[]) {
    for (const port of ports) {
        const free = await new Promise<boolean>(resolve => {
            const listener = createServer(); listener.once('error', () => resolve(false));
            listener.listen(port, '127.0.0.1', () => listener.close(() => resolve(true)));
        });
        if (!free) return false;
    }
    return true;
}
export class LocalManagedRuntime implements ManagedRuntime {
    readonly version: string;
    private base: string;
    constructor(private source: string, base: string, private identityFile: string) {
        this.source = resolve(source); this.base = resolve(base);
        const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: source, stdout: 'pipe', stderr: 'ignore', windowsHide: true });
        this.version = result.stdout.toString().trim();
        if (result.exitCode || !/^[a-f0-9]{40}$/.test(this.version)) throw new Error('Managed version unavailable');
    }
    private directory(server: ManagedServer) {
        if (server.serverId.length !== 40 || !/^srv-[a-f0-9-]{36}$/.test(server.serverId)
            || !/^[a-f0-9]{40}$/.test(server.version) || !worldTemplates.some(template => template.id === server.template)
            || server.ports.length !== 6 || new Set(server.ports).size !== 6 || server.ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535))
            throw failure('INVALID_INSTANCE', 'Érvénytelen szerverkönyvtár vagy indítási kötés.');
        const path = resolve(this.base, server.serverId);
        if (!path.startsWith(this.base + sep)) throw failure('INVALID_INSTANCE', 'Érvénytelen szerverkönyvtár.');
        return path;
    }
    private systemEnvironment() {
        const environment: Record<string, string> = {};
        for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) environment[key] = process.env[key]!;
        return environment;
    }
    private async command(args: string[], cwd: string, errorLog: string, environment?: Record<string, string>) {
        const child = Bun.spawn(args, { cwd, env: environment, stdout: 'ignore', stderr: Bun.file(errorLog), windowsHide: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const exit = await Promise.race([child.exited, new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => { if (child.exitCode === null) child.kill(); reject(failure('PROVISION_TIMEOUT', 'A forráscsomag előkészítése túllépte az időkorlátot.')); }, 120000);
            })]);
            if (exit !== 0) throw failure('PROVISION_COMMAND_FAILED', 'A szerver forráscsomagja nem készíthető elő. A privát előkészítési napló megmaradt.');
        } finally { clearTimeout(timer); }
    }
    async prepare(server: ManagedServer) {
        const dir = this.directory(server), workspace = join(dir, 'workspace'), manifest = join(dir, 'prepared.json');
        const expected = { id: server.serverId, version: server.version, template: server.template, ports: server.ports };
        if (existsSync(manifest)) {
            if ((await lstat(dir)).isSymbolicLink()) throw failure('INVALID_INSTANCE', 'A szerverkönyvtár nem lehet hivatkozás.');
            const previous = JSON.parse(await readFile(manifest, 'utf8'));
            if (JSON.stringify(previous.binding) !== JSON.stringify(expected)) throw failure('INSTANCE_BINDING_CONFLICT', 'A munkakönyvtár másik szerverhez tartozik.');
            if (previous.isolationVersion !== 1) throw failure('ISOLATION_UPGRADE_REQUIRED', 'Ez a korábbi világ még nem tartalmazza az izolációs kötést. Az adatait megőriztük; indítás előtt ellenőrzött verziómigráció szükséges.');
            await verifyInstanceBinding(workspace, expected);
            return;
        }
        if (existsSync(workspace)) throw failure('INSTANCE_PARTIAL', 'Félbemaradt munkakönyvtár; az adatokat megőriztük. Archiváld a hibás szervert, majd hozz létre újat.');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        if ((await lstat(dir)).isSymbolicLink()) throw failure('INVALID_INSTANCE', 'A szerverkönyvtár nem lehet hivatkozás.');
        await mkdir(workspace);
        const archive = join(dir, 'source.tar');
        await this.command(['git', 'archive', '--format=tar', `--output=${archive}`, server.version], this.source, join(dir, 'archive.err.log'));
        // Upstream instruction aliases are symlinks, unsupported by ordinary Windows extraction.
        // They are not runtime inputs; exclude these two entries without suppressing other errors.
        await this.command(['tar', '-xf', archive, '-C', workspace, '--exclude=AGENTS.md', '--exclude=GEMINI.md'], this.source, join(dir, 'extract.err.log'));
        if (!existsSync(join(workspace, 'server/control-plane/managed-worker.ts'))) throw failure('VERSION_UNSUPPORTED', 'Ez a forrásverzió még nem tartalmaz kezelt szerverindítót.');
        if (!existsSync(join(workspace, 'server/control-plane/instance-context.ts'))) throw failure('VERSION_UNSUPPORTED', 'Ez a forrásverzió még nem támogatja a szerverenkénti izolációt.');
        for (const relative of ['node_modules', 'server/engine/node_modules', 'server/webclient/node_modules']) {
            const dependency = join(this.source, relative);
            if (!existsSync(dependency)) throw failure('DEPENDENCIES_MISSING', 'Hiányzó helyi függőségek; az admin naplója alapján ellenőrizd a telepítést.');
            await symlink(dependency, join(workspace, relative), 'junction');
        }
        for (const relative of ['server/engine/data/pack', 'server/webclient/out'])
            await cp(join(this.source, relative), join(workspace, relative), { recursive: true, dereference: true });
        await assertPrivateInstanceTree(workspace);
        const template = worldTemplates.find(value => value.id === server.template)!;
        const configDir = join(workspace, 'server/engine/data/config'); await mkdir(configDir, { recursive: true });
        await writeFile(join(configDir, 'world.json'), JSON.stringify({ easyStartup: false, website: { registration: false },
            web: { port: server.ports[1], managementPort: server.ports[2] },
            node: { port: server.ports[3], xpRate: template.xpRate, shopEconomyMode: template.shopEconomyMode },
            build: { startup: false, liveReload: false }, login: { enabled: false }, friend: { enabled: false }, logger: { enabled: false } }));
        const llmPath = join(workspace, 'config/llm-runtime.json'), llm = JSON.parse(await readFile(llmPath, 'utf8'));
        llm.enabled = false; llm.automaticReplanning = false; llm.autonomousExecution.enabled = false; llm.skillBuilder.enabled = false;
        await writeFile(llmPath, JSON.stringify(llm));
        // Revision 274 uses a length-prefixed RSA login packet; generate a compatible private key per world.
        const keys = generateKeyPairSync('rsa', { modulusLength: 1024 });
        const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        await new ServerSecretStore(workspace).set('engine-login-key', keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
        await rm(join(configDir, 'private.pem'), { force: true });
        await writeFile(join(configDir, 'public.pem'), publicPem);
        const jwk = keys.publicKey.export({ format: 'jwk' });
        const decimal = (value: string) => BigInt(`0x${Buffer.from(value, 'base64url').toString('hex')}`).toString();
        await this.command([process.execPath, '--no-env-file', 'run', 'bundle.ts', 'dev'], join(workspace, 'server/webclient'), join(dir, 'client-build.err.log'),
            { ...this.systemEnvironment(), LOGIN_RSAN: decimal(jwk.n!), LOGIN_RSAE: decimal(jwk.e!), BUILD_MODE: 'both' });
        await mkdir(join(workspace, '.local'), { recursive: true, mode: 0o700 });
        await writeFile(join(workspace, '.local/instance.json'), JSON.stringify({ schemaVersion: 1, binding: expected, workspace }), { mode: 0o600 });
        const pack = await readFile(join(workspace, 'server/engine/data/pack/main_file_cache.dat'));
        await writeFile(manifest, JSON.stringify({ binding: expected, isolationVersion: 1, cacheSha256: createHash('sha256').update(pack).digest('hex'),
            publicKeySha256: createHash('sha256').update(publicPem).digest('hex') }), { mode: 0o600 });
    }
    private async run(server: ManagedServer): Promise<Run | null> {
        try { const stored = JSON.parse(await readFile(join(this.directory(server), 'runtime.json'), 'utf8'));
            if (stored.token || stored.secretStore !== 'windows-credential-manager') throw failure('SECRET_MIGRATION_REQUIRED', 'A korábbi futási token titoktár-migrációt igényel.');
            const run = { ...stored, token: await new ServerSecretStore(join(this.directory(server), 'workspace')).get('worker-control-token') } as Run;
            if (JSON.stringify(run.ports) !== JSON.stringify(server.ports) || !/^[a-f0-9]{64}$/.test(run.token) || !/^[a-f0-9-]{36}$/.test(run.generation)) throw new Error();
            return run;
        } catch (error) {
            if (error instanceof IdentityError) throw error;
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw failure('RUNTIME_INVALID', 'A szerver folyamatregisztere vagy titoktára nem olvasható; idegen folyamatot nem állítottunk le.');
        }
    }
    private async control(server: ManagedServer, run: Run, role: 'engine' | 'gateway', stop = false) {
        try {
            const response = await fetch(`http://127.0.0.1:${server.ports[role === 'engine' ? 4 : 5]}/${stop ? 'stop' : ''}`, {
                method: stop ? 'POST' : 'GET', headers: { Authorization: `Bearer ${run.token}` }, signal: AbortSignal.timeout(800) });
            if (!response.ok) return null;
            const result = await response.json();
            if (!stop && (result.id !== server.serverId || result.generation !== run.generation || result.role !== role)) return null;
            return result;
        } catch { return null; }
    }
    async connection(server: ManagedServer) {
        const run = await this.run(server); if (!run) return { gateway: false, engine: false };
        const [engine, gateway] = await Promise.all([this.control(server, run, 'engine'), this.control(server, run, 'gateway')]);
        return { gateway: !!gateway?.ready && !gateway.stopping, engine: !!engine?.ready && !engine.stopping };
    }
    async inspect(server: ManagedServer) {
        const run = await this.run(server); if (!run) return 'stopped';
        const [engine, gateway] = await Promise.all([this.control(server, run, 'engine'), this.control(server, run, 'gateway')]);
        if (engine?.ready && gateway?.ready && !engine.stopping && !gateway.stopping) return 'running';
        return !engine && !gateway && await portsFree(server.ports) ? 'stopped' : 'unknown';
    }
    async start(server: ManagedServer) {
        if (await this.inspect(server) !== 'stopped') {
            // A completed previous stop leaves its run journal; verify all reserved ports are free below.
            const run = await this.run(server);
            if (run && (await this.control(server, run, 'engine') || await this.control(server, run, 'gateway'))) throw failure('INSTANCE_RUNNING', 'A szerver valamelyik folyamata még fut.');
        }
        const listeners: Server[] = [];
        try {
            for (const port of server.ports) await new Promise<void>((resolve, reject) => {
                const listener = createServer(); listeners.push(listener); listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve);
            });
        } catch { throw failure('PORT_OCCUPIED', 'Egy lefoglalt portot más folyamat használ; semmit nem állítottunk le.'); }
        finally { await Promise.all(listeners.map(listener => new Promise<void>(resolve => { if (listener.listening) listener.close(() => resolve()); else resolve(); }))); }
        const dir = this.directory(server), workspace = join(dir, 'workspace');
        await verifyInstanceBinding(workspace, { id: server.serverId, version: server.version, template: server.template, ports: server.ports });
        const publicKey = createPublicKey(await readFile(join(workspace, 'server/engine/data/config/public.pem')));
        const manifest = JSON.parse(await readFile(join(dir, 'prepared.json'), 'utf8'));
        if (manifest.publicKeySha256 !== createHash('sha256').update(await readFile(join(workspace, 'server/engine/data/config/public.pem'))).digest('hex'))
            throw failure('INSTANCE_KEY_MISMATCH', 'A világ login-kulcsa nem az előkészített példányhoz tartozik.');
        const loginKey = await new ServerSecretStore(workspace).get('engine-login-key');
        if (!loginKey) throw failure('SECRET_MIGRATION_REQUIRED', 'A világ login-kulcsa hiányzik a titoktárból; ellenőrzött migráció szükséges.');
        const privatePublic = createPublicKey(loginKey);
        if (!publicKey.export({ type: 'spki', format: 'der' }).equals(privatePublic.export({ type: 'spki', format: 'der' }))) throw failure('INSTANCE_KEY_MISMATCH', 'A világ login-kulcskötése eltér.');
        const jwk = publicKey.export({ format: 'jwk' });
        const decimal = (value: string) => BigInt(`0x${Buffer.from(value, 'base64url').toString('hex')}`).toString();
        const run: Run = { token: randomBytes(32).toString('hex'), generation: randomUUID(), ports: server.ports };
        await new ServerSecretStore(workspace).set('worker-control-token', run.token);
        await writeFile(join(dir, 'runtime.json'), JSON.stringify({ generation: run.generation, ports: run.ports, secretStore: 'windows-credential-manager' }), { mode: 0o600 });
        const template = worldTemplates.find(value => value.id === server.template)!;
        const environment = this.systemEnvironment();
        Object.assign(environment, { CONTROL_PLANE_IDENTITY_PATH: this.identityFile, CONTROL_PLANE_SERVER_ID: server.serverId,
            MANAGED_WORKSPACE: workspace, GATEWAY_URL: `ws://127.0.0.1:${server.ports[0]}`, SERVER: `127.0.0.1:${server.ports[1]}`,
            RS_SDK_LITE_CACHE_DIR: join(workspace, '.local/lite-cache'), LOGIN_RSAN: decimal(jwk.n!), LOGIN_RSAE: decimal(jwk.e!),
            MANAGED_CONTROL_TOKEN: run.token, MANAGED_GENERATION: run.generation, ENGINE_ADMIN_TOKEN: run.token,
            AGENT_PORT: String(server.ports[0]), WEB_PORT: String(server.ports[1]), WEB_MANAGEMENT_PORT: String(server.ports[2]), NODE_PORT: String(server.ports[3]),
            ENGINE_ADMIN_URL: `http://127.0.0.1:${server.ports[1]}`, ENGINE_PUBLIC_URL: `http://127.0.0.1:${server.ports[1]}/mapview/`,
            LOGIN_SERVER: 'false', FRIEND_SERVER: 'false', LOGGER_SERVER: 'false', EASY_STARTUP: 'false', WEBSITE_REGISTRATION: 'false',
            BUILD_STARTUP: 'false', BUILD_LIVE_RELOAD: 'false', NODE_SHOP_ECONOMY_MODE: template.shopEconomyMode, NODE_XPRATE: String(template.xpRate) });
        const children: ReturnType<typeof Bun.spawn>[] = [];
        try {
            for (const role of ['engine', 'gateway'] as const) {
                const child = Bun.spawn([process.execPath, '--no-env-file', join(workspace, 'server/control-plane/managed-worker.ts')], {
                    cwd: join(workspace, 'server', role), env: { ...environment, ...(role === 'engine' ? { ENGINE_LOGIN_PRIVATE_KEY: loginKey } : {}), MANAGED_ROLE: role, MANAGED_CONTROL_PORT: String(server.ports[role === 'engine' ? 4 : 5]) },
                    stdout: Bun.file(join(dir, `${role}.out.log`)), stderr: Bun.file(join(dir, `${role}.err.log`)), windowsHide: true });
                children.push(child);
                const deadline = Date.now() + 60000;
                while (true) {
                    if (child.exitCode !== null) throw failure('PROCESS_EXITED', 'A szerverfolyamat indítás közben leállt. A privát napló megmaradt.');
                    if ((await this.control(server, run, role))?.ready) break;
                    if (Date.now() >= deadline) throw failure('START_TIMEOUT', 'A szerver nem készült el az időkorláton belül.');
                    await Bun.sleep(200);
                }
            }
        } catch (error) { for (const child of children) if (child.exitCode === null) child.kill(); throw error; }
    }
    async stop(server: ManagedServer) {
        const run = await this.run(server); if (!run) return;
        for (const role of ['gateway', 'engine'] as const) {
            const ports = role === 'engine' ? server.ports.slice(1, 5) : [server.ports[0]!, server.ports[5]!];
            if (!await this.control(server, run, role)) {
                if (!await portsFree(ports)) throw failure('RUNTIME_UNREACHABLE', 'A folyamat nem azonosítható biztonságosan; foglalt porthoz tartozó idegen folyamatot nem állítottunk le.');
                continue;
            }
            await this.control(server, run, role, true);
            const deadline = Date.now() + 20000;
            while (await this.control(server, run, role)) {
                if (Date.now() >= deadline) throw failure('STOP_TIMEOUT', 'A szabályos leállítás nem fejeződött be; a mentéseket és a folyamatot megőriztük.');
                await Bun.sleep(200);
            }
            while (!await portsFree(ports)) {
                if (Date.now() >= deadline) throw failure('PORT_RELEASE_PENDING', 'A folyamat még nem engedte el a portjait; ellenőrizd az állapotot újrapróbálás előtt.');
                await Bun.sleep(200);
            }
        }
    }
}
