import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { appendAudit, readAudit } from './audit';
import { buildBotCatalog, describeLiveActivity, economySnapshot, readEconomy, recordEconomy } from './catalog';
import { adminPublicDir, adminTrashDir, botsDir, experimentsDir, playerSavesDir } from './paths';
import { BotSupervisor } from './supervisor';
import type { GatewayBotSnapshot } from './types';

export interface AdminRouteContext {
    gatewayBots(): Map<string, GatewayBotSnapshot>;
    supervisor: BotSupervisor;
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || '';

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
    const relative = url.pathname === '/admin' || url.pathname === '/admin/'
        ? 'index.html'
        : url.pathname.slice('/admin/'.length);
    if (!/^[a-zA-Z0-9._-]+$/.test(relative)) return new Response('Not found', { status: 404 });
    const path = join(adminPublicDir, relative);
    const file = Bun.file(path);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    return new Response(file, {
        headers: {
            'Content-Type': contentType(path),
            'Cache-Control': relative === 'index.html' ? 'no-store' : 'public, max-age=60',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
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
            return json({ authMode: ADMIN_TOKEN ? 'token' : 'local', mutationsEnabled: true, refreshMs: 5000 });
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

        const actionMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)\/(despawn|restart|stop-skill)$/);
        if (req.method === 'POST' && actionMatch?.[1] && actionMatch[2]) {
            const username = decodeURIComponent(actionMatch[1]);
            const action = actionMatch[2];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            let result: unknown;
            if (action === 'despawn') result = await context.supervisor.despawn(username, reason);
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
