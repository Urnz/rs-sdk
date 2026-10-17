import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';

export async function controlPlaneLease(registryPath: string): Promise<Server> {
    // Windows named pipes are released by the OS on process death, without stale PID adoption.
    if (process.platform !== 'win32') throw new Error('Managed control-plane supervision currently requires Windows.');
    const path = resolve(registryPath); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const canonical = existsSync(path) ? realpathSync(path) : join(realpathSync(dirname(path)), basename(path));
    const name = createHash('sha256').update(canonical.toLowerCase()).digest('hex');
    const lease = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => { lease.once('error', reject); lease.listen(`\\\\.\\pipe\\rs-sdk-admin-${name}`, resolve); });
    return lease;
}

export async function reservePorts(ports: number[]) {
    const leases = new Map<number, Server>();
    const release = async (selected = ports) => {
        await Promise.all(selected.map(port => new Promise<void>(resolve => {
            const lease = leases.get(port); leases.delete(port);
            if (lease?.listening) lease.close(() => resolve()); else resolve();
        })));
    };
    try {
        for (const port of ports) await new Promise<void>((resolve, reject) => {
            const lease = createServer(); leases.set(port, lease); lease.once('error', reject); lease.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
        });
    } catch (error) { await release(); throw error; }
    return { release };
}
