import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import World, {
    type AdminOfflineSaveDraft,
    type AdminOfflineSaveResult,
    type AdminPlayerLogoutResult,
    type AdminPlayerRewardResult,
    type AdminWorldDirectorEventResult,
    type AdminPropertyMaintenanceResult,
    type AdminPropertyPurchaseResult,
    type AdminTeleportResult
} from '#/engine/World.js';
import { getActiveWorldMods, reloadHotWorldMods } from '#/mods/WorldMods.js';

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
    const backupListMatch = url.pathname.match(/^\/api\/internal\/admin\/offline-backups\/([a-zA-Z0-9]{1,12})$/);
    const knownPath = url.pathname === '/api/internal/admin/teleport'
        || url.pathname === '/api/internal/admin/properties'
        || url.pathname === '/api/internal/admin/properties/purchase'
        || url.pathname === '/api/internal/admin/properties/reset'
        || url.pathname === '/api/internal/admin/properties/reconcile'
        || url.pathname === '/api/internal/admin/world-mods'
        || url.pathname === '/api/internal/admin/world-mods/reload'
        || url.pathname === '/api/internal/admin/offline-edit'
        || url.pathname === '/api/internal/admin/offline-restore'
        || url.pathname === '/api/internal/admin/player-logout'
        || url.pathname === '/api/internal/admin/player-reward'
        || url.pathname === '/api/internal/admin/world-director/event'
        || !!backupListMatch;
    if (!knownPath) return null;
    if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

    if (url.pathname === '/api/internal/admin/world-mods') {
        if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        return json(getActiveWorldMods());
    }

    if (url.pathname === '/api/internal/admin/world-mods/reload') {
        if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        try {
            return json(reloadHotWorldMods());
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 409);
        }
    }

    if (url.pathname === '/api/internal/admin/properties') {
        if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        try {
            return json(World.listAdminProperties());
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 409);
        }
    }

    if (backupListMatch?.[1]) {
        if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        const username = backupListMatch[1].toLowerCase();
        const readiness = World.getAdminOfflineSaveReadiness(username);
        return json({
            backups: World.listAdminSaveBackups(username),
            readiness,
            state: readiness.editable ? World.getAdminOfflineSaveSummary(username) : null
        });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 128_000) return json({ error: 'Request too large' }, 413);

    let body: Record<string, unknown>;
    try {
        body = await req.json() as Record<string, unknown>;
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const commandId = typeof body.commandId === 'string' ? body.commandId.trim() : '';
    const validCommandId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId);
    if (!validCommandId) return json({ error: 'Invalid admin command identity' }, 400);

    if (url.pathname === '/api/internal/admin/world-director/event') {
        const allowedFields = new Set(['commandId', 'eventId', 'cycleKey', 'selectionDigest', 'kind',
            'templateId', 'templateVersion', 'title', 'summary', 'regions', 'tags']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return json({ error: 'World Director event request contains forbidden fields' }, 400);
        }
        const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        const cycleKey = typeof body.cycleKey === 'string' ? body.cycleKey.trim() : '';
        const selectionDigest = typeof body.selectionDigest === 'string' ? body.selectionDigest.trim() : '';
        const kind = body.kind;
        const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
        const templateVersion = typeof body.templateVersion === 'string' ? body.templateVersion.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
        const validList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 12
            && value.every(entry => typeof entry === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry));
        if (!/^world-event-[a-f0-9]{24}$/.test(eventId)
            || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(cycleKey) || !/^[a-f0-9]{64}$/.test(selectionDigest)
            || !['economic-signal', 'resource-signal', 'social-signal', 'world-flavor'].includes(String(kind))
            || !/^[a-z0-9][a-z0-9.-]{2,63}$/.test(templateId)
            || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(templateVersion)
            || !title || title.length > 120 || !summary || summary.length > 1000
            || !validList(body.regions) || !validList(body.tags)) {
            return json({ error: 'Invalid World Director event request' }, 400);
        }
        const result: AdminWorldDirectorEventResult = await World.enqueueAdminWorldDirectorEvent({ commandId,
            eventId, cycleKey, selectionDigest,
            kind: kind as 'economic-signal' | 'resource-signal' | 'social-signal' | 'world-flavor',
            templateId, templateVersion, title, summary, regions: body.regions, tags: body.tags,
            expiresAt: Date.now() + 2_000 });
        return json(result, result.ok ? 200 : 409);
    }

    if (url.pathname === '/api/internal/admin/properties/reset') {
        const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : '';
        const expectedVersion = body.expectedVersion;
        if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(propertyId)
            || !Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
            return json({ error: 'Invalid property reset request' }, 400);
        }
        try {
            const result: AdminPropertyMaintenanceResult = World.adminResetProperty(propertyId, Number(expectedVersion), commandId);
            return json(result);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 409);
        }
    }

    if (url.pathname === '/api/internal/admin/properties/reconcile') {
        const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
        const resolution = body.resolution;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/.test(transactionId)
            || (resolution !== 'commit-debited' && resolution !== 'release-unpaid')) {
            return json({ error: 'Invalid property reconciliation request' }, 400);
        }
        try {
            const result: AdminPropertyMaintenanceResult = World.adminReconcilePending(transactionId, resolution, commandId);
            return json(result);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 409);
        }
    }

    if (!/^[a-zA-Z0-9]{1,12}$/.test(username)) return json({ error: 'Invalid admin command identity' }, 400);

    if (url.pathname === '/api/internal/admin/player-reward') {
        const settlementId = typeof body.settlementId === 'string' ? body.settlementId.trim() : '';
        const amount = body.amount;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(settlementId)
            || !Number.isSafeInteger(amount) || Number(amount) < 1 || Number(amount) > 2_147_483_647) {
            return json({ error: 'Invalid player reward request' }, 400);
        }
        const result: AdminPlayerRewardResult = await World.enqueueAdminPlayerReward({ commandId,
            settlementId, username, amount: Number(amount), expiresAt: Date.now() + 2_000 });
        return json(result, result.ok ? 200 : 409);
    }

    if (url.pathname === '/api/internal/admin/offline-edit') {
        const draft = body.draft;
        if (!draft || typeof draft !== 'object') return json({ error: 'Invalid offline save draft' }, 400);
        const result: AdminOfflineSaveResult = await World.enqueueAdminOfflineSave({
            commandId,
            username,
            operation: 'edit',
            draft: draft as AdminOfflineSaveDraft,
            expiresAt: Date.now() + 2_000
        });
        return json(result, result.ok ? 200 : 409);
    }

    if (url.pathname === '/api/internal/admin/offline-restore') {
        const backupId = typeof body.backupId === 'string' ? body.backupId.trim() : '';
        const expectedSavedAt = typeof body.expectedSavedAt === 'string' ? body.expectedSavedAt.trim() : '';
        if (!backupId || !expectedSavedAt) return json({ error: 'Invalid offline restore request' }, 400);
        const result: AdminOfflineSaveResult = await World.enqueueAdminOfflineSave({
            commandId,
            username,
            operation: 'restore',
            backupId,
            expectedSavedAt,
            expiresAt: Date.now() + 2_000
        });
        return json(result, result.ok ? 200 : 409);
    }

    if (url.pathname === '/api/internal/admin/player-logout') {
        const result: AdminPlayerLogoutResult = await World.enqueueAdminPlayerLogout({
            commandId,
            username,
            expiresAt: Date.now() + 2_000
        });
        return json(result, result.ok ? 200 : 409);
    }

    if (url.pathname === '/api/internal/admin/properties/purchase') {
        const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : '';
        if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(propertyId)) {
            return json({ error: 'Invalid property purchase request' }, 400);
        }
        const result: AdminPropertyPurchaseResult = await World.enqueueAdminPropertyPurchase({
            commandId,
            username,
            propertyId,
            expiresAt: Date.now() + 2_000
        });
        return json(result, result.ok ? 200 : 409);
    }

    const destinationId = typeof body.destinationId === 'string' ? body.destinationId.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(destinationId)) return json({ error: 'Invalid admin teleport request' }, 400);
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
