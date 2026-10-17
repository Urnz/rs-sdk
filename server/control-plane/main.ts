import { controlPlaneConfig } from './config.js';
import { createControlPlane } from './service.js';
import { appendFileSync } from 'node:fs';
import { IdentityStore, identityPath } from './identity-store.js';
import { ServerRegistry, serverRegistryPath } from './server-registry.js';
import { LocalManagedRuntime } from './managed-runtime.js';
import { LifecycleManager } from './lifecycle-manager.js';
import { dirname, join, resolve } from 'node:path';
import { controlPlaneLease } from './runtime-leases.js';
import { ServerSecretStore } from './secret-store.js';
import { loadTls } from './tls.js';

function log(message: string) {
    if (process.env.CONTROL_PLANE_LOG_PATH) appendFileSync(process.env.CONTROL_PLANE_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    console.log(message);
}
let writerLease: Awaited<ReturnType<typeof controlPlaneLease>> | undefined;
try {
    const config = controlPlaneConfig();
    const identityFile = identityPath();
    const tls = config.transport ? await loadTls(config, new ServerSecretStore(dirname(identityFile))) : undefined;
    writerLease = await controlPlaneLease(serverRegistryPath(identityFile));
    const identities = new IdentityStore(identityFile);
    const registry = new ServerRegistry(serverRegistryPath(identityFile));
    registry.ensureConfiguredLocal(config);
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../..'), join(dirname(serverRegistryPath(identityFile)), 'instances'), identityFile);
    const lifecycle = new LifecycleManager(registry, identities, runtime); lifecycle.recover();
    await lifecycle.idle();
    const handle = createControlPlane(config, identities, fetch, registry, lifecycle);
    const server = Bun.serve({ hostname: config.transport?.hostname ?? '127.0.0.1', port: config.port, tls,
        maxRequestBodySize: 16 * 1024 * 1024, fetch(req, server) { return handle(req, server.requestIP(req)?.address ?? 'unresolved'); } });
    log(`[Control plane] ${config.transport?.origin ?? `http://127.0.0.1:${server.port}`}/admin/`);
    let supervision: Promise<void> | undefined;
    const supervisor = setInterval(() => {
        if (!supervision) supervision = lifecycle.supervise().catch(() => log('[Control plane] Supervisor check failed; private state retained.')).finally(() => { supervision = undefined; });
    }, 10000);
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
        if (shuttingDown) return; shuttingDown = true; clearInterval(supervisor); await server.stop(true);
        await supervision; await lifecycle.idle(); registry.close(); identities.close(); process.exit(0);
    });
} catch (error) { writerLease?.close(); log(error instanceof Error ? error.message : 'Control plane startup failed'); process.exitCode = 1; }
