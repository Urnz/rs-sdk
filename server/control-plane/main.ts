import { controlPlaneConfig } from './config.js';
import { createControlPlane } from './service.js';
import { appendFileSync } from 'node:fs';
import { IdentityStore, identityPath } from './identity-store.js';
import { ServerRegistry, serverRegistryPath } from './server-registry.js';
import { LocalManagedRuntime } from './managed-runtime.js';
import { LifecycleManager } from './lifecycle-manager.js';
import { dirname, join, resolve } from 'node:path';
import { controlPlaneLease } from './runtime-leases.js';

function log(message: string) {
    if (process.env.CONTROL_PLANE_LOG_PATH) appendFileSync(process.env.CONTROL_PLANE_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    console.log(message);
}
let writerLease: Awaited<ReturnType<typeof controlPlaneLease>> | undefined;
try {
    const config = controlPlaneConfig();
    const identityFile = identityPath();
    writerLease = await controlPlaneLease(serverRegistryPath(identityFile));
    const identities = new IdentityStore(identityFile);
    const registry = new ServerRegistry(serverRegistryPath(identityFile));
    registry.ensureConfiguredLocal(config);
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../..'), join(dirname(serverRegistryPath(identityFile)), 'instances'), identityFile);
    const lifecycle = new LifecycleManager(registry, identities, runtime); lifecycle.recover();
    await lifecycle.idle();
    const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, maxRequestBodySize: 16 * 1024 * 1024, fetch: createControlPlane(config, identities, fetch, registry, lifecycle) });
    log(`[Control plane] http://127.0.0.1:${server.port}/admin/`);
    const supervisor = setInterval(() => { void lifecycle.supervise().catch(() => log('[Control plane] Supervisor check failed; private state retained.')); }, 10000);
    let shuttingDown = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
        if (shuttingDown) return; shuttingDown = true; clearInterval(supervisor); server.stop(true);
        await lifecycle.idle(); registry.close(); identities.close(); process.exit(0);
    });
} catch (error) { writerLease?.close(); log(error instanceof Error ? error.message : 'Control plane startup failed'); process.exitCode = 1; }
