import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { assertManagedModuleRoot } from './instance-context.js';

const role = process.env.MANAGED_ROLE, id = process.env.CONTROL_PLANE_SERVER_ID;
const token = process.env.MANAGED_CONTROL_TOKEN, generation = process.env.MANAGED_GENERATION;
if (!['engine', 'gateway'].includes(role!) || !id || !token || !generation) throw new Error('Invalid managed worker configuration');
assertManagedModuleRoot(resolve(import.meta.dir, '../..'));
if (resolve(process.cwd()) !== resolve(process.env.MANAGED_WORKSPACE!, 'server', role!)) throw new Error('Managed worker cwd mismatch');
let application: { shutdownManagedGateway?: () => Promise<void> };
let ready = false, stopping = false;
const control = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.MANAGED_CONTROL_PORT), async fetch(req) {
    const supplied = req.headers.get('authorization') ?? '', expected = `Bearer ${token}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response(null, { status: 401 });
    if (req.method === 'GET') return Response.json({ id, role, generation, pid: process.pid, ready, stopping });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/stop') return new Response(null, { status: 405 });
    if (!stopping) {
        stopping = true;
        setTimeout(async () => {
            if (role === 'engine' && ready) {
                const { default: world } = await import(pathToFileURL(resolve('src/engine/World.ts')).href);
                world.rebootTimer(0);
            } else {
                try {
                    await application?.shutdownManagedGateway?.();
                    if (role === 'gateway') await writeFile(resolve(process.env.MANAGED_WORKSPACE!, '../gateway-quiesced.json'), JSON.stringify({ id, generation }), { mode: 0o600 });
                    control.stop(true); process.exit(0);
                }
                catch { console.error('Managed child shutdown failed.'); stopping = false; }
            }
        }, 100);
    }
    return Response.json({ stopping: true });
} });
try {
    application = await import(pathToFileURL(resolve(role === 'engine' ? 'src/app.ts' : 'gateway.ts')).href);
    ready = true;
} catch { console.error('Managed worker startup failed.'); control.stop(true); process.exit(1); }
