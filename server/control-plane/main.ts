import { controlPlaneConfig } from './config.js';
import { createControlPlane } from './service.js';
import { appendFileSync } from 'node:fs';
import { IdentityStore, identityPath } from './identity-store.js';
import { ServerRegistry, serverRegistryPath } from './server-registry.js';
import { LocalManagedRuntime } from './managed-runtime.js';
import { LifecycleManager } from './lifecycle-manager.js';
import { dirname, join, resolve } from 'node:path';

function log(message: string) {
    if (process.env.CONTROL_PLANE_LOG_PATH) appendFileSync(process.env.CONTROL_PLANE_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    console.log(message);
}
try {
    const config = controlPlaneConfig();
    const identityFile = identityPath(), identities = new IdentityStore(identityFile);
    const registry = new ServerRegistry(serverRegistryPath(identityFile));
    registry.ensureConfiguredLocal(config);
    const runtime = new LocalManagedRuntime(resolve(import.meta.dir, '../..'), join(dirname(serverRegistryPath(identityFile)), 'instances'), identityFile);
    const lifecycle = new LifecycleManager(registry, identities, runtime); lifecycle.recover();
    const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, maxRequestBodySize: 16 * 1024 * 1024, fetch: createControlPlane(config, identities, fetch, registry, lifecycle) });
    log(`[Control plane] http://127.0.0.1:${server.port}/admin/`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); registry.close(); identities.close(); process.exit(0); });
} catch (error) { log(error instanceof Error ? error.message : 'Control plane startup failed'); process.exitCode = 1; }
