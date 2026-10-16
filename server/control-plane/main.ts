import { controlPlaneConfig } from './config.js';
import { createControlPlane } from './service.js';
import { appendFileSync } from 'node:fs';
import { IdentityStore, identityPath } from './identity-store.js';

function log(message: string) {
    if (process.env.CONTROL_PLANE_LOG_PATH) appendFileSync(process.env.CONTROL_PLANE_LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    console.log(message);
}
try {
    const config = controlPlaneConfig();
    const identities = new IdentityStore(identityPath());
    const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, maxRequestBodySize: 16 * 1024 * 1024, fetch: createControlPlane(config, identities) });
    log(`[Control plane] http://127.0.0.1:${server.port}/admin/`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); identities.close(); process.exit(0); });
} catch (error) { log(error instanceof Error ? error.message : 'Control plane startup failed'); process.exitCode = 1; }
