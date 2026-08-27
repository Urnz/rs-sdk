import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { appendAudit, readAudit } from './audit';
import { buildBotCatalog, describeLiveActivity, economySnapshot, readEconomy, recordEconomy } from './catalog';
import { adminPublicDir, adminTrashDir, botsDir, experimentsDir, playerSavesDir } from './paths';
import { BotSupervisor } from './supervisor';
import { listAdminSkills, resolveAdminSkill, validateAdminSkillParameters } from './skill-catalog';
import { listAdminTeleportDestinations, requestEngineTeleport, resolveAdminTeleportDestination } from './teleport';
import { readSkillRunHistory } from './skill-history';
import { readEconomyEvents, type EconomyEventKind } from './transaction-telemetry';
import {
    listEngineOfflineBackups,
    requestEngineOfflineEdit,
    requestEngineOfflineRestore,
    requestEnginePlayerLogout,
    validateOfflineSaveDraft
} from './offline-editor';
import type { GatewayBotSnapshot } from './types';
import { listWorldMods, updateWorldMod } from './world-mods';
import { restartLocalEngine } from './engine-supervisor';

export interface AdminRouteContext {
    gatewayBots(): Map<string, GatewayBotSnapshot>;
    supervisor: BotSupervisor;
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || '';
const WORLD_MAP_URL = (() => {
    const fallback = 'http://localhost:8888/mapview/';
    try {
        const value = new URL(process.env.ENGINE_PUBLIC_URL?.trim() || fallback);
        return value.protocol === 'http:' || value.protocol === 'https:' ? value.toString() : fallback;
    } catch {
        return fallback;
    }
})();
const WORLD_MAP_ORIGIN = new URL(WORLD_MAP_URL).origin;

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

function localRequest(req: Request, url: URL): boolean {
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    const origin = req.headers.get('origin');
    const sameOrigin = !origin || origin === url.origin;
    return localHost && sameOrigin && req.headers.get('x-admin-request') === 'rs-sdk-admin';
}

function authorized(req: Request, url: URL): boolean {
    if (ADMIN_TOKEN) {
        const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        return bearer === ADMIN_TOKEN || req.headers.get('x-admin-token') === ADMIN_TOKEN;
    }
    return localRequest(req, url);
}

async function requestBody(req: Request): Promise<Record<string, unknown>> {
    try {
        return await req.json() as Record<string, unknown>;
    } catch {
        throw new Error('A kérés törzse nem érvényes JSON.');
    }
}

function text(body: Record<string, unknown>, key: string, required = false): string {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (required && !value) throw new Error(`Hiányzó mező: ${key}`);
    return value;
}

function contentType(path: string): string {
    if (extname(path) === '.css') return 'text/css; charset=utf-8';
    if (extname(path) === '.js') return 'application/javascript; charset=utf-8';
    if (extname(path) === '.svg') return 'image/svg+xml';
    return 'text/html; charset=utf-8';
}

async function serveAdminAsset(url: URL): Promise<Response | null> {
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
    if (url.pathname === '/admin') return Response.redirect(new URL('/admin/', url), 308);
    const relative = url.pathname === '/admin/'
        ? 'index.html'
        : url.pathname.slice('/admin/'.length);
    if (!/^[a-zA-Z0-9._-]+$/.test(relative)) return new Response('Not found', { status: 404 });
    const path = join(adminPublicDir, relative);
    const file = Bun.file(path);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    return new Response(file, {
        headers: {
            'Content-Type': contentType(path),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${WORLD_MAP_ORIGIN}; frame-ancestors 'none'`
        }
    });
}

async function quarantineBot(username: string): Promise<{ quarantineId: string; moved: string[] }> {
    const key = username.toLowerCase();
    const quarantineId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${key}`;
    const destination = join(adminTrashDir, quarantineId);
    await mkdir(destination, { recursive: true });
    const moved: string[] = [];
    const savePath = join(playerSavesDir, `${key}.sav`);
    if (await Bun.file(savePath).exists()) {
        await rename(savePath, join(destination, `${key}.sav`));
        moved.push('save');
    }
    const botDir = join(botsDir, username);
    if (await Bun.file(join(botDir, 'bot.env')).exists()) {
        await rename(botDir, join(destination, 'bot'));
        moved.push('credentials');
    }
    await writeFile(join(destination, 'metadata.json'), JSON.stringify({ username, quarantineId, moved, deletedAt: new Date().toISOString() }, null, 2));
    return { quarantineId, moved };
}

export async function handleAdminRequest(req: Request, url: URL, context: AdminRouteContext): Promise<Response | null> {
    const asset = await serveAdminAsset(url);
    if (asset) return asset;
    if (!url.pathname.startsWith('/api/admin/')) return null;

    try {
        if (req.method === 'GET' && url.pathname === '/api/admin/config') {
            return json({ authMode: ADMIN_TOKEN ? 'token' : 'local', mutationsEnabled: true, refreshMs: 5000, worldMapUrl: WORLD_MAP_URL });
        }

        const catalog = async () => buildBotCatalog(context.gatewayBots(), context.supervisor.list());

        if (req.method === 'GET' && url.pathname === '/api/admin/bots') {
            const bots = await catalog();
            const economy = economySnapshot(bots);
            await recordEconomy(economy);
            return json({ bots, economy, generatedAt: new Date().toISOString() });
        }

        const botDetailMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)$/);
        if (req.method === 'GET' && botDetailMatch?.[1]) {
            const username = decodeURIComponent(botDetailMatch[1]).toLowerCase();
            const bot = (await catalog()).find(entry => entry.username === username);
            return bot ? json(bot) : json({ error: 'A bot nem található.' }, 404);
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/economy') {
            const limit = Number(url.searchParams.get('limit') || 240);
            return json({ snapshots: await readEconomy(limit) });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
            const limit = Number(url.searchParams.get('limit') || 100);
            return json({ entries: await readAudit(limit) });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/experiments') {
            const files = await readdir(experimentsDir).catch(() => []);
            return json({ snapshots: files.filter(file => file.endsWith('.json')).sort().reverse() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/skills') {
            return json({ skills: await listAdminSkills() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/skill-runs') {
            const limit = Number(url.searchParams.get('limit') || 30);
            return json({ runs: await readSkillRunHistory(limit) });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/economy-events') {
            const limit = Number(url.searchParams.get('limit') || 100);
            const username = url.searchParams.get('username')?.trim() || undefined;
            const rawKind = url.searchParams.get('kind')?.trim() || undefined;
            const allowedKinds = new Set<EconomyEventKind>(['production', 'consumption', 'shop-buy', 'shop-sell', 'player-trade', 'bank-transfer']);
            if (rawKind && !allowedKinds.has(rawKind as EconomyEventKind)) return json({ error: 'Ismeretlen gazdasági eseménytípus.' }, 400);
            return json(await readEconomyEvents({ limit, username, kind: rawKind as EconomyEventKind | undefined }));
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/teleport-destinations') {
            return json({ destinations: await listAdminTeleportDestinations() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/world-mods') {
            return json(await listWorldMods());
        }

        const spectateMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/spectate$/);
        if (req.method === 'GET' && spectateMatch?.[1]) {
            const username = decodeURIComponent(spectateMatch[1]).toLowerCase();
            const gatewayEntry = [...context.gatewayBots().entries()]
                .find(([name]) => name.toLowerCase() === username)?.[1];
            const player = gatewayEntry?.state?.player;
            if (!gatewayEntry || gatewayEntry.status !== 'active' || !gatewayEntry.state || !player) {
                return json({
                    error: 'A bot nem küld friss élő állapotot. A Spectate nem jelentkezik be helyette.',
                    status: gatewayEntry?.status ?? 'offline'
                }, 409);
            }
            const state = gatewayEntry.state;
            const catalogEntry = (await catalog()).find(entry => entry.username === username);
            return json({
                username,
                displayName: player.name,
                status: gatewayEntry.status,
                stateAgeMs: Date.now() - gatewayEntry.lastStateReceivedAt,
                tick: state.tick,
                revision: state.revision ?? null,
                activity: catalogEntry?.currentSkill || describeLiveActivity(gatewayEntry),
                currentSkill: catalogEntry?.currentSkill ?? null,
                player: {
                    x: player.worldX,
                    z: player.worldZ,
                    level: player.level,
                    hp: player.hp,
                    maxHp: player.maxHp,
                    runEnergy: player.runEnergy,
                    animId: player.animId,
                    inCombat: player.combat.inCombat
                },
                nearbyPlayers: state.nearbyPlayers.slice(0, 30).map(player => ({
                    name: player.name, x: player.worldX ?? player.x, z: player.worldZ ?? player.z,
                    combatLevel: player.combatLevel, distance: player.distance
                })),
                nearbyNpcs: state.nearbyNpcs.slice(0, 60).map(npc => ({
                    name: npc.name, x: npc.tileX ?? npc.x, z: npc.tileZ ?? npc.z,
                    combatLevel: npc.combatLevel, distance: npc.distance, inCombat: npc.inCombat
                })),
                nearbyLocs: state.nearbyLocs.filter(loc => loc.options.length > 0).slice(0, 80).map(loc => ({
                    name: loc.name, x: loc.x, z: loc.z, distance: loc.distance
                })),
                groundItems: state.groundItems.slice(0, 40).map(item => ({
                    name: item.name, count: item.count, x: item.x, z: item.z, distance: item.distance
                })),
                inventory: state.inventory.map(item => ({ id: item.id, name: item.name, count: item.count, slot: item.slot })),
                gameMessages: state.gameMessages.slice(-12).map(message => ({
                    sender: message.sender, text: message.text, type: message.type, tick: message.tick
                }))
            });
        }

        if (!authorized(req, url)) {
            return json({ error: ADMIN_TOKEN ? 'Érvénytelen vagy hiányzó admin token.' : 'Adminművelet csak a helyi adminfelületről engedélyezett.' }, 401);
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/engine/restart') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const result = await restartLocalEngine();
                await appendAudit({
                    operator: 'local-admin', action: 'world.engine.restart', reason, success: true,
                    before: { pid: result.previousPid }, after: result
                });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'world.engine.restart', reason, success: false,
                    error: String(error)
                });
                throw error;
            }
        }

        const worldModMatch = url.pathname.match(/^\/api\/admin\/world-mods\/([a-z0-9.-]+)$/);
        if (req.method === 'PUT' && worldModMatch?.[1]) {
            const modId = worldModMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = body.expectedRevision;
            if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) throw new Error('Érvénytelen modkonfiguráció-revízió.');
            try {
                const result = await updateWorldMod(modId, { enabled: body.enabled, config: body.config }, Number(expectedRevision));
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.configure', reason, success: true,
                    before: { revision: result.before.revision, mod: result.before.mods[modId] },
                    after: { revision: result.after.revision, mod: result.after.mods[modId], activation: result.manifest.activation, modId }
                });
                return json({ ok: true, restartRequired: result.manifest.activation === 'restart-required', revision: result.after.revision });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.configure', reason, success: false,
                    after: { modId, expectedRevision }, error: String(error)
                });
                throw error;
            }
        }

        const offlineEditMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/offline-save$/);
        if (offlineEditMatch?.[1]) {
            const username = decodeURIComponent(offlineEditMatch[1]);
            const bot = (await catalog()).find(entry => entry.username === username.toLowerCase());
            if (!bot) return json({ error: 'A bot nem található.' }, 404);

            if (req.method === 'GET') {
                if (!bot.hasSave) return json({ error: 'A botnak nincs mentésfájlja.' }, 404);
                return json(await listEngineOfflineBackups(username));
            }

            if (req.method === 'POST') {
                const body = await requestBody(req);
                const reason = text(body, 'reason', true);
                const commandId = crypto.randomUUID();
                try {
                    if (!bot.canEditOffline) throw new Error('A mentés csak teljesen offline, nem futó botnál szerkeszthető.');
                    const draft = validateOfflineSaveDraft(body.draft);
                    if (draft.expectedSavedAt !== bot.saveSavedAt) throw new Error('A mentés megváltozott az editor megnyitása óta; töltsd újra az adatokat.');
                    const result = await requestEngineOfflineEdit(username, draft, commandId);
                    await appendAudit({
                        operator: 'local-admin', action: 'bot.offline-save.edit', username, reason, success: true,
                        before: result.before, after: { state: result.after, backupId: result.backupId, engineTick: result.tick, commandId }
                    });
                    return json({ ok: true, result });
                } catch (error) {
                    await appendAudit({
                        operator: 'local-admin', action: 'bot.offline-save.edit', username, reason, success: false,
                        after: { commandId }, error: String(error)
                    });
                    throw error;
                }
            }
        }

        const offlineRestoreMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/offline-save\/restore$/);
        if (req.method === 'POST' && offlineRestoreMatch?.[1]) {
            const username = decodeURIComponent(offlineRestoreMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const backupId = text(body, 'backupId', true);
            const expectedSavedAt = text(body, 'expectedSavedAt', true);
            const commandId = crypto.randomUUID();
            try {
                const bot = (await catalog()).find(entry => entry.username === username.toLowerCase());
                if (!bot) throw new Error('A bot nem található.');
                if (!bot.canEditOffline) throw new Error('Mentés csak teljesen offline, nem futó botnál állítható vissza.');
                if (bot.saveSavedAt !== expectedSavedAt) throw new Error('A mentés megváltozott; frissítsd az oldalt a visszaállítás előtt.');
                const result = await requestEngineOfflineRestore(username, backupId, expectedSavedAt, commandId);
                await appendAudit({
                    operator: 'local-admin', action: 'bot.offline-save.restore', username, reason, success: true,
                    before: result.before, after: { state: result.after, restoredFrom: backupId, backupId: result.backupId, engineTick: result.tick, commandId }
                });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'bot.offline-save.restore', username, reason, success: false,
                    after: { backupId, commandId }, error: String(error)
                });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/bots/spawn') {
            const body = await requestBody(req);
            const username = text(body, 'username', true);
            const reason = text(body, 'reason', true);
            try {
                const process = await context.supervisor.spawn({
                    username,
                    password: text(body, 'password'),
                    server: text(body, 'server'),
                    rememberCredentials: body.rememberCredentials === true
                });
                await appendAudit({ operator: 'local-admin', action: 'bot.spawn', username, reason, success: true, after: process });
                return json({ ok: true, process }, 202);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'bot.spawn', username, reason, success: false, error: String(error) });
                throw error;
            }
        }

        const startSkillMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/start-skill$/);
        if (req.method === 'POST' && startSkillMatch?.[1]) {
            const username = decodeURIComponent(startSkillMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const requested = text(body, 'skill', true);
            try {
                const bot = (await catalog()).find(entry => entry.username === username.toLowerCase());
                if (!bot) throw new Error('A bot nem található.');
                if (bot.status !== 'active') throw new Error('Agent skill csak friss, online bothoz indítható.');
                if (!bot.hasCredentials) throw new Error('Skill indításához a bot helyi bot.env hitelesítő adata szükséges.');
                if (bot.currentSkill) throw new Error(`${bot.displayName} már a(z) ${bot.currentSkill} skillt futtatja.`);
                const registered = await resolveAdminSkill(requested);
                const parameters = validateAdminSkillParameters(registered.definition, body.parameters);
                const skill = `${registered.definition.id}@${registered.definition.version}`;
                const process = await context.supervisor.startSkill(username, skill, parameters);
                await appendAudit({
                    operator: 'local-admin', action: 'bot.start-skill', username, reason, success: true,
                    before: { currentSkill: bot.currentSkill }, after: { skill, parameters, process }
                });
                return json({ ok: true, skill, parameters, process }, 202);
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'bot.start-skill', username, reason, success: false,
                    after: { requested }, error: String(error)
                });
                throw error;
            }
        }

        const teleportMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/teleport$/);
        if (req.method === 'POST' && teleportMatch?.[1]) {
            const username = decodeURIComponent(teleportMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const destinationId = text(body, 'destinationId', true);
            const commandId = crypto.randomUUID();
            try {
                const bot = (await catalog()).find(entry => entry.username === username.toLowerCase());
                if (!bot) throw new Error('A bot nem található.');
                if (bot.status !== 'active') throw new Error('Csak friss, online bot teleportálható.');
                if (bot.currentSkill) throw new Error('Teleport előtt állítsd le a bot aktív agent skilljét.');
                const gatewayEntry = [...context.gatewayBots().entries()]
                    .find(([name]) => name.toLowerCase() === username.toLowerCase())?.[1];
                if (!gatewayEntry?.state?.player) throw new Error('A bot nem küld friss játékállapotot.');
                if (gatewayEntry.state.player.combat.inCombat) throw new Error('Harcban lévő bot nem teleportálható.');
                const destination = await resolveAdminTeleportDestination(destinationId);
                const result = await requestEngineTeleport(username, destination.id, commandId);
                await appendAudit({
                    operator: 'local-admin', action: 'bot.teleport', username, reason, success: true,
                    before: result.before ?? bot.position, after: { destination, position: result.after, engineTick: result.tick, commandId }
                });
                return json({ ok: true, destination, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'bot.teleport', username, reason, success: false,
                    after: { destinationId, commandId }, error: String(error)
                });
                throw error;
            }
        }

        const actionMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/(despawn|restart|stop-skill)$/);
        if (req.method === 'POST' && actionMatch?.[1] && actionMatch[2]) {
            const username = decodeURIComponent(actionMatch[1]);
            const action = actionMatch[2];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            let result: unknown;
            if (action === 'despawn') {
                const process = await context.supervisor.despawn(username, reason);
                const engine = await requestEnginePlayerLogout(username, crypto.randomUUID());
                result = { process, engine };
            }
            else if (action === 'restart') result = await context.supervisor.restart({
                username,
                password: text(body, 'password'),
                server: text(body, 'server')
            }, reason);
            else result = { stopped: await context.supervisor.stopSkill(username) };
            await appendAudit({ operator: 'local-admin', action: `bot.${action}`, username, reason, success: true, after: result });
            return json({ ok: true, result }, 202);
        }

        if (req.method === 'DELETE' && botDetailMatch?.[1]) {
            const username = decodeURIComponent(botDetailMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            if (text(body, 'confirmUsername', true).toLowerCase() !== username.toLowerCase()) {
                throw new Error('A megerősítéshez pontosan be kell írni a bot nevét.');
            }
            const bot = (await catalog()).find(entry => entry.username === username.toLowerCase());
            if (!bot) return json({ error: 'A bot nem található.' }, 404);
            if (bot.status !== 'offline' && bot.status !== 'error') throw new Error('Futó bot nem törölhető; előbb despawn szükséges.');
            const before = { hasSave: bot.hasSave, hasCredentials: bot.hasCredentials };
            const result = await quarantineBot(bot.displayName);
            await appendAudit({ operator: 'local-admin', action: 'bot.quarantine', username, reason, success: true, before, after: result });
            return json({ ok: true, recoverable: true, ...result });
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/experiments') {
            const body = await requestBody(req);
            const label = text(body, 'label', true).replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ _-]/g, '').slice(0, 80);
            const reason = text(body, 'reason', true);
            const bots = await catalog();
            const snapshot = { id: crypto.randomUUID(), label, reason, createdAt: new Date().toISOString(), economy: economySnapshot(bots), bots };
            await mkdir(experimentsDir, { recursive: true });
            const filename = `${snapshot.createdAt.replace(/[:.]/g, '-')}-${snapshot.id}.json`;
            await writeFile(join(experimentsDir, filename), JSON.stringify(snapshot, null, 2), 'utf8');
            await appendAudit({ operator: 'local-admin', action: 'experiment.snapshot', reason, success: true, after: { filename, label } });
            return json({ ok: true, filename, snapshot }, 201);
        }

        return json({ error: 'Ismeretlen admin végpont.' }, 404);
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
}
