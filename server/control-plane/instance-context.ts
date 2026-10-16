import { isAbsolute, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

type Environment = Record<string, string | undefined>;
export function managedContext(environment: Environment = process.env) {
    const id = environment.CONTROL_PLANE_SERVER_ID;
    if (!id) return null;
    const workspace = environment.MANAGED_WORKSPACE;
    const engine = environment.ENGINE_ADMIN_URL, gateway = environment.GATEWAY_URL;
    if (!/^srv-[a-f0-9-]{36}$/.test(id) || !workspace || !isAbsolute(workspace)
        || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(engine ?? '')
        || !/^ws:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(gateway ?? ''))
        throw new Error('Incomplete managed instance binding; legacy defaults are forbidden.');
    for (const endpoint of [engine!, gateway!]) {
        const port = Number(new URL(endpoint).port);
        if (port < 1024 || port > 65535) throw new Error('Invalid managed instance port.');
    }
    return { id, workspace: resolve(workspace), server: new URL(engine!).host, gateway: gateway!, cache: join(workspace, '.local', 'lite-cache') };
}

export function assertManagedModuleRoot(root: string, environment: Environment = process.env) {
    const context = managedContext(environment);
    if (context && realpathSync(root) !== realpathSync(context.workspace)) throw new Error('Managed module loaded outside its instance workspace.');
}

/** Only the selected bot's credentials and public instance connection data reach children. */
export function managedBotEnvironment(stored: Environment, username: string, requestedServer?: string, environment: Environment = process.env): Environment | null {
    const context = managedContext(environment); if (!context) return null;
    if ((requestedServer && requestedServer !== context.server) || (stored.SERVER && stored.SERVER !== context.server)
        || (stored.GATEWAY_URL && stored.GATEWAY_URL !== context.gateway)
        || (stored.BOT_USERNAME && stored.BOT_USERNAME.toLowerCase() !== username.toLowerCase()))
        throw new Error('A bot kapcsolata másik szerverhez tartozik.');
    if (stored.PASSWORD && (/[\r\n\u0000]/.test(stored.PASSWORD) || stored.PASSWORD.length > 1024)) throw new Error('Érvénytelen bot-hitelesítő adat.');
    const child: Environment = {};
    for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOGIN_RSAN', 'LOGIN_RSAE'])
        if (environment[key]) child[key] = environment[key];
    for (const key of ['PASSWORD', 'SHOW_CHAT', 'TELEMETRY', 'PROFANITY_FILTER']) if (stored[key]) child[key] = stored[key];
    return { ...child, CONTROL_PLANE_SERVER_ID: context.id, MANAGED_WORKSPACE: context.workspace,
        ENGINE_ADMIN_URL: `http://${context.server}`, SERVER: context.server, GATEWAY_URL: context.gateway,
        BOT_USERNAME: username, RS_SDK_LITE_CACHE_DIR: context.cache };
}
