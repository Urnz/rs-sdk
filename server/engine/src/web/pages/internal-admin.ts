import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import World, { type AdminTeleportResult } from '#/engine/World.js';

interface AdminTeleportDestination {
    id: string;
    label: string;
    description: string;
    x: number;
    z: number;
    level: number;
}

const destinationPath = fileURLToPath(new URL('../../../../../config/admin-teleport-destinations.json', import.meta.url));
const configuredDestinations = JSON.parse(readFileSync(destinationPath, 'utf8')) as unknown;

function validDestination(value: unknown): value is AdminTeleportDestination {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(entry.id)
        && typeof entry.label === 'string' && entry.label.length > 0 && entry.label.length <= 80
        && typeof entry.description === 'string' && entry.description.length > 0 && entry.description.length <= 240
        && Number.isInteger(entry.x) && Number(entry.x) >= 0 && Number(entry.x) <= 16383
        && Number.isInteger(entry.z) && Number(entry.z) >= 0 && Number(entry.z) <= 16383
        && Number.isInteger(entry.level) && Number(entry.level) >= 0 && Number(entry.level) <= 3;
}

if (!Array.isArray(configuredDestinations) || configuredDestinations.length === 0 || !configuredDestinations.every(validDestination)) {
    throw new Error('Invalid admin teleport destination configuration');
}
const destinations = new Map(configuredDestinations.map(destination => [destination.id, destination]));
if (destinations.size !== configuredDestinations.length) throw new Error('Duplicate admin teleport destination id');

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

function authorized(req: Request): boolean {
    const expected = process.env.ENGINE_ADMIN_TOKEN?.trim() || '';
    const supplied = req.headers.get('x-engine-admin-token') || '';
    if (!expected || expected.length !== supplied.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function handleInternalAdminRequest(req: Request, url: URL): Promise<Response | null> {
    if (url.pathname !== '/api/internal/admin/teleport') return null;
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 4_096) return json({ error: 'Request too large' }, 413);

    let body: Record<string, unknown>;
    try {
        body = await req.json() as Record<string, unknown>;
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const destinationId = typeof body.destinationId === 'string' ? body.destinationId.trim() : '';
    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    if (!/^[a-zA-Z0-9]{1,12}$/.test(username) || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(destinationId)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
        return json({ error: 'Invalid admin teleport request' }, 400);
    }
    const destination = destinations.get(destinationId);
    if (!destination) return json({ error: `Teleport destination is not approved: ${destinationId}` }, 400);

    const result: AdminTeleportResult = await World.enqueueAdminTeleport({
        commandId,
        username,
        destination,
        expiresAt: Date.now() + 2_000
    });
    return json(result, result.ok ? 200 : 409);
}
