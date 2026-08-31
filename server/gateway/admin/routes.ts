import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { appendAudit, readAudit } from './audit';
import { buildBotCatalog, describeLiveActivity, economySnapshot, readEconomy, recordEconomy } from './catalog';
import { adminPublicDir, adminTrashDir, agentSkillsLocalDir, botsDir, experimentsDir, playerSavesDir,
    repoRoot, skillRunsDir, skillTrialsPath, skillVerificationsDir } from './paths';
import { BotSupervisor } from './supervisor';
import { listAdminSkills, resolveAdminSkill, resolveAdminSkillForAgent, validateAdminSkillParameters } from './skill-catalog';
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
import { createWorldModBackup, listWorldModBackups, listWorldMods, requestWorldModHotReload, restoreWorldModBackup, updateWorldMod } from './world-mods';
import { restartLocalEngine } from './engine-supervisor';
import {
    listEngineProperties,
    requestEnginePropertyPurchase,
    requestEnginePropertyReconciliation,
    requestEnginePropertyReset
} from './properties';
import {
    createAdminAgent,
    createAdminAgentCommitment,
    createAdminAgentEpisode,
    createAdminAgentGoal,
    createAdminAgentKnowledge,
    createAdminPlayerActionRequest,
    approveAdminPlayerActionRequest,
    finishAdminPlayerActionRun,
    listAdminAgents,
    pruneAdminAgentEpisodes,
    updateAdminAgent,
    updateAdminAgentControlProfile,
    updateAdminAgentCommitmentStatus,
    updateAdminAgentGoalStatus,
    updateAdminAgentRelationship,
    updateAdminPlayerActionRequest,
    startAdminPlayerActionRequest,
    updateAdminAgentSkill
} from './agent-state';
import { AgentStateStore } from '../../../agent-state/store.js';
import { observeLiveState, runLivePlannerCycle } from '../../../agent-state/live.js';
import type { AgentCommitmentDirection, AgentCommitmentStatus, AgentEpisodeKind, AgentEpisodeTrust,
    AgentKnowledgeKind, AgentPlayerActionManualStatus, AgentRole, AgentSkillKnowledgeStatus,
    AgentSubjectKind, GoalHorizon,
    GoalStatus } from '../../../agent-state/types.js';
import { agentStateDbPath, capabilityGapsPath } from './paths.js';
import { runAdminLlmDryRun } from './llm-dry-run.js';
import type { AgentReplanCoordinator } from './replan-coordinator.js';
import { readReplanRecords } from './replan-runtime.js';
import { readAdminLlmSettings, removeOpenAIApiKey, replaceOpenAIApiKey,
    updateAdminLlmSettings, validateOpenAIApiKey } from './llm-settings.js';
import { CapabilityGapStore } from '../../../agent-skills/capability-gaps.js';
import { SkillTrialStore, type SkillTrial } from '../../../agent-skills/trials.js';
import { SkillLibrary } from '../../../agent-skills/library.js';
import { SkillRegistry } from '../../../agent-skills/registry.js';
import { FileSkillStore } from '../../../agent-skills/store.js';
import { FileSkillVerificationJournal, SKILL_VERIFIER_ID, verifyAndPromoteSkill,
    type SkillVerificationReport } from '../../../agent-skills/verifier.js';
import type { SkillDefinition, SkillRunResult } from '../../../agent-skills/types.js';
import { createAdminSkillGrant, learnAdminSkill, listAdminSkillLearning, revokeAdminSkillGrant } from './skill-learning.js';
import type { SkillGrantKind } from '../../../agent-skills/learning.js';
import { resolveLearnAndPlan } from './deterministic-learning.js';

export interface AdminRouteContext {
    gatewayBots(): Map<string, GatewayBotSnapshot>;
    supervisor: BotSupervisor;
    replanCoordinator?: AgentReplanCoordinator;
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

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
    if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Érvénytelen mező: ${field}`);
    return value as T;
}

function stringList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(`Érvénytelen mező: ${field}`);
    return value.map(entry => entry.trim());
}

async function loadTrialDraft(trial: Pick<SkillTrial, 'draft'>): Promise<SkillDefinition> {
    const library = new SkillLibrary(new SkillRegistry(), new FileSkillStore(agentSkillsLocalDir));
    await library.loadAgentDrafts('admin-trial-runner');
    const registered = library.registry.get(trial.draft, 'admin-trial-runner');
    if (!registered || registered.definition.status !== 'draft'
        || registered.definition.sharing.visibility !== 'shared'
        || registered.definition.provenance.authorKind !== 'agent') {
        throw new Error('A megadott megosztott agent-draft nem található vagy már nem futtatható.');
    }
    return registered.definition;
}

function sameTrialParameters(left: unknown, right: SkillTrial['parameters']): boolean {
    if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
    const entries = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

async function collectTrialEvidence(trial: SkillTrial): Promise<SkillRunResult[]> {
    const files = (await readdir(skillRunsDir).catch(() => [])).filter(file => /^[0-9a-f-]{36}\.json$/i.test(file));
    const runs = await Promise.all(files.slice(0, 2_000).map(async file => {
        try {
            const contents = await readFile(join(skillRunsDir, file), 'utf8');
            if (contents.length > 1_000_000) return null;
            const run = JSON.parse(contents) as SkillRunResult;
            const startedAt = run.events?.[0]?.timestamp;
            return run.runId === file.slice(0, -5) && run.username?.toLowerCase() === trial.testBotUsername
                && run.skill?.id === trial.draft.id && run.skill.version === trial.draft.version
                && run.status === 'completed' && typeof startedAt === 'string' && startedAt >= trial.createdAt
                && sameTrialParameters(run.parameters, trial.parameters) ? run : null;
        } catch { return null; }
    }));
    return runs.filter((run): run is SkillRunResult => !!run)
        .sort((left, right) => left.events[0]!.timestamp.localeCompare(right.events[0]!.timestamp)).slice(0, 20);
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

        if (req.method === 'GET' && url.pathname === '/api/admin/llm-replans') {
            return json({ records: await readReplanRecords(Number(url.searchParams.get('limit') || 100)) });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/llm-settings') {
            return json(await readAdminLlmSettings());
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/capability-gaps') {
            return json({ gaps: await new CapabilityGapStore(capabilityGapsPath).list() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/skill-trials') {
            return json({ trials: await new SkillTrialStore(skillTrialsPath).list() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/experiments') {
            const files = await readdir(experimentsDir).catch(() => []);
            return json({ snapshots: files.filter(file => file.endsWith('.json')).sort().reverse() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/skills') {
            return json({ skills: await listAdminSkills() });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/agents') {
            const bots = await catalog();
            let properties: Awaited<ReturnType<typeof listEngineProperties>>['properties'] = [];
            const unavailableSources: string[] = [];
            try { properties = (await listEngineProperties()).properties; }
            catch { unavailableSources.push('properties'); }
            return json(await listAdminAgents(agentStateDbPath, {
                bots, properties, unavailableSources, observedAt: new Date().toISOString()
            }));
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/skill-learning') {
            return json(await listAdminSkillLearning());
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

        if (req.method === 'GET' && url.pathname === '/api/admin/world-mods/backups') {
            const limit = Number(url.searchParams.get('limit') || 30);
            return json({ backups: await listWorldModBackups(limit) });
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/properties') {
            return json(await listEngineProperties());
        }

        if (req.method === 'GET' && url.pathname === '/api/admin/world-players') {
            const response = await fetch(`${WORLD_MAP_ORIGIN}/playerpositions`, { signal: AbortSignal.timeout(4_000) });
            if (!response.ok) return json({ error: `Az engine játékoslistája nem elérhető (HTTP ${response.status}).` }, 502);
            const players = await response.json();
            return json({ players: Array.isArray(players) ? players : [] });
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

        const gapTrialMatch = url.pathname.match(/^\/api\/admin\/capability-gaps\/(gap-[a-f0-9]{20})\/trials$/);
        if (req.method === 'POST' && gapTrialMatch?.[1]) {
            const gapId = gapTrialMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            if (body.acknowledgeDraftRisk !== true) throw new Error('A draft tesztfuttatás kockázatát külön meg kell erősíteni.');
            const username = text(body, 'testBotUsername', true).toLowerCase();
            const targetVersion = text(body, 'targetVersion', true);
            const gaps = new CapabilityGapStore(capabilityGapsPath);
            const gap = (await gaps.list()).find(entry => entry.gapId === gapId);
            if (!gap || gap.status !== 'draft' || !gap.draftSkill) throw new Error('A gaphez nincs tesztelhető draft.');
            const draft = await loadTrialDraft({ draft: gap.draftSkill });
            if (draft.provenance.authorId !== gap.assignedWorkerId) throw new Error('A draft szerzője nem egyezik a gap kijelölt builderével.');
            const bot = (await catalog()).find(entry => entry.username === username);
            if (!bot || bot.status !== 'active' || !bot.hasCredentials || bot.currentSkill) {
                throw new Error('A kijelölt tesztbotnak friss online, credentiallel rendelkező és tétlen botnak kell lennie.');
            }
            const parameters = validateAdminSkillParameters(draft, body.parameters);
            const trials = new SkillTrialStore(skillTrialsPath);
            let trial = await trials.create({ gapId, draft: gap.draftSkill, targetVersion, testBotUsername: username, parameters });
            let liveGap = await gaps.transition(gap.gapId, gap.revision, 'validating');
            liveGap = await gaps.transition(liveGap.gapId, liveGap.revision, 'live-trial');
            try {
                const process = await context.supervisor.startSkill(username,
                    `${draft.id}@${draft.version}`, parameters, { allowDraft: true });
                trial = await trials.transition(trial.trialId, trial.revision, 'running');
                await appendAudit({ operator: 'local-admin', action: 'skill-trial.create', username, reason, success: true,
                    after: { trial, process } });
                return json({ ok: true, trial, process }, 202);
            } catch (error) {
                await trials.transition(trial.trialId, trial.revision, 'cancelled').catch(() => undefined);
                await gaps.transition(liveGap.gapId, liveGap.revision, 'draft').catch(() => undefined);
                await appendAudit({ operator: 'local-admin', action: 'skill-trial.create', username, reason,
                    success: false, after: { trialId: trial.trialId }, error: String(error) });
                throw error;
            }
        }

        const trialRunMatch = url.pathname.match(/^\/api\/admin\/skill-trials\/([0-9a-f-]{36})\/run$/i);
        if (req.method === 'POST' && trialRunMatch?.[1]) {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            if (body.acknowledgeDraftRisk !== true) throw new Error('A draft tesztfuttatás kockázatát külön meg kell erősíteni.');
            const trials = new SkillTrialStore(skillTrialsPath);
            const trial = await trials.get(trialRunMatch[1]);
            if (!trial || !['running', 'verification-failed'].includes(trial.status)) throw new Error('Ez a próba nem futtatható újra.');
            const draft = await loadTrialDraft(trial);
            const bot = (await catalog()).find(entry => entry.username === trial.testBotUsername);
            if (!bot || bot.status !== 'active' || !bot.hasCredentials || bot.currentSkill) throw new Error('A próba kijelölt tesztbotja nem áll készen.');
            const process = await context.supervisor.startSkill(trial.testBotUsername,
                `${draft.id}@${draft.version}`, trial.parameters, { allowDraft: true });
            const updated = await trials.transition(trial.trialId, trial.revision, 'running', {
                verificationReportId: null, verificationChecks: []
            });
            await appendAudit({ operator: 'local-admin', action: 'skill-trial.run', username: trial.testBotUsername,
                reason, success: true, before: trial, after: { trial: updated, process } });
            return json({ ok: true, trial: updated, process }, 202);
        }

        const trialVerifyMatch = url.pathname.match(/^\/api\/admin\/skill-trials\/([0-9a-f-]{36})\/verify$/i);
        if (req.method === 'POST' && trialVerifyMatch?.[1]) {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const trials = new SkillTrialStore(skillTrialsPath);
            const trial = await trials.get(trialVerifyMatch[1]);
            if (!trial || !['running', 'verification-failed'].includes(trial.status)) throw new Error('Ez a próba nem ellenőrizhető.');
            const draft = await loadTrialDraft(trial);
            const evidence = await collectTrialEvidence(trial);
            const verificationLibrary = new SkillLibrary(new SkillRegistry(), new FileSkillStore(agentSkillsLocalDir));
            await verificationLibrary.loadReviewedCatalog(join(repoRoot, 'agent-skills', 'catalog'));
            await verificationLibrary.loadAgentDrafts('admin-trial-runner');
            const report = verifyAndPromoteSkill(draft, evidence, {
                targetVersion: trial.targetVersion,
                parameters: trial.parameters,
                resolveDefinition: reference => verificationLibrary.registry
                    .get(reference, 'admin-trial-runner')?.definition ?? null
            });
            await new FileSkillVerificationJournal(skillVerificationsDir).save(report);
            const updated = await trials.transition(trial.trialId, trial.revision,
                report.passed ? 'verification-passed' : 'verification-failed', {
                    runIds: report.evidenceRunIds, verificationReportId: report.id, verificationChecks: report.checks
                });
            await appendAudit({ operator: 'local-admin', action: 'skill-trial.verify', username: trial.testBotUsername,
                reason, success: report.passed, before: trial, after: { trial: updated, report },
                error: report.passed ? undefined : 'A determinisztikus verifier legalább egy ellenőrzése sikertelen.' });
            return json({ ok: report.passed, trial: updated, report }, report.passed ? 200 : 422);
        }

        const trialPublishMatch = url.pathname.match(/^\/api\/admin\/skill-trials\/([0-9a-f-]{36})\/publish$/i);
        if (req.method === 'POST' && trialPublishMatch?.[1]) {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            if (body.confirmHumanApproval !== true) throw new Error('A publikáláshoz külön emberi jóváhagyás szükséges.');
            const trials = new SkillTrialStore(skillTrialsPath);
            const trial = await trials.get(trialPublishMatch[1]);
            if (!trial || trial.status !== 'verification-passed' || !trial.verificationReportId) throw new Error('Csak sikeresen ellenőrzött próba publikálható.');
            const report = JSON.parse(await readFile(join(skillVerificationsDir,
                `${trial.verificationReportId}.json`), 'utf8')) as SkillVerificationReport;
            if (report.id !== trial.verificationReportId || !report.passed || !report.promoted
                || report.draft.id !== trial.draft.id || report.draft.version !== trial.draft.version
                || report.targetVersion !== trial.targetVersion) throw new Error('A verifier-jelentés nem használható publikálásra.');
            const path = await new FileSkillStore(agentSkillsLocalDir).save(report.promoted, {
                actorKind: 'system', actorId: SKILL_VERIFIER_ID
            });
            const gaps = new CapabilityGapStore(capabilityGapsPath);
            const gap = (await gaps.list()).find(entry => entry.gapId === trial.gapId);
            if (!gap || gap.status !== 'live-trial') throw new Error('A capability gap nincs élő próba állapotban.');
            const verifiedGap = await gaps.transition(gap.gapId, gap.revision, 'verified', {
                resolvedSkill: { id: report.promoted.id, version: report.promoted.version }
            });
            const updated = await trials.transition(trial.trialId, trial.revision, 'published');
            await appendAudit({ operator: 'local-admin', action: 'skill-trial.publish', username: trial.testBotUsername,
                reason, success: true, before: trial, after: { trial: updated, gap: verifiedGap, path } });
            return json({ ok: true, trial: updated, gap: verifiedGap, path }, 201);
        }

        const trialCancelMatch = url.pathname.match(/^\/api\/admin\/skill-trials\/([0-9a-f-]{36})\/cancel$/i);
        if (req.method === 'POST' && trialCancelMatch?.[1]) {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const trials = new SkillTrialStore(skillTrialsPath);
            const trial = await trials.get(trialCancelMatch[1]);
            if (!trial || !['ready', 'running', 'verification-failed', 'verification-passed'].includes(trial.status)) {
                throw new Error('Ez a próba nem vethető el.');
            }
            const bot = (await catalog()).find(entry => entry.username === trial.testBotUsername);
            if (bot?.currentSkill) throw new Error('Az elvetés előtt állítsd le vagy várd meg az aktív tesztfutást.');
            const gaps = new CapabilityGapStore(capabilityGapsPath);
            const gap = (await gaps.list()).find(entry => entry.gapId === trial.gapId);
            if (!gap || gap.status !== 'live-trial') throw new Error('A capability gap nincs élő próba állapotban.');
            const revertedGap = await gaps.transition(gap.gapId, gap.revision, 'draft');
            const updated = await trials.transition(trial.trialId, trial.revision, 'cancelled');
            await appendAudit({ operator: 'local-admin', action: 'skill-trial.cancel', username: trial.testBotUsername,
                reason, success: true, before: trial, after: { trial: updated, gap: revertedGap } });
            return json({ ok: true, trial: updated, gap: revertedGap });
        }

        if (req.method === 'PUT' && url.pathname === '/api/admin/llm-settings') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
                throw new Error('Hiányzó vagy érvénytelen LLM-konfiguráció.');
            }
            const apiKey = text(body, 'apiKey');
            const removeApiKey = body.removeApiKey === true;
            if (apiKey && removeApiKey) throw new Error('Az API-kulcs egyszerre nem cserélhető és törölhető.');
            if (apiKey) validateOpenAIApiKey(apiKey);
            try {
                const before = await readAdminLlmSettings();
                const config = await updateAdminLlmSettings(body.config);
                if (apiKey) await replaceOpenAIApiKey(apiKey);
                else if (removeApiKey) await removeOpenAIApiKey();
                const after = await readAdminLlmSettings();
                await appendAudit({ operator: 'local-admin', action: 'llm.settings.update', reason, success: true,
                    before: { config: before.config, apiKey: before.apiKey },
                    after: { config, apiKey: after.apiKey } });
                return json({ ok: true, ...after });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'llm.settings.update', reason, success: false,
                    error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/skill-grants') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const agentId = text(body, 'agentId', true).toLowerCase();
            try {
                const result = await createAdminSkillGrant({
                    agentId,
                    kind: oneOf<SkillGrantKind>(body.kind,
                        ['organization-membership', 'teacher-relationship', 'license'], 'kind'),
                    resourceId: text(body, 'resourceId', true),
                    validFrom: body.validFrom ? text(body, 'validFrom') : undefined,
                    validUntil: body.validUntil ? text(body, 'validUntil') : null
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.skill-grant.create', reason,
                    success: true, username: agentId, after: result.grant });
                return json({ ok: true, ...result }, result.created ? 201 : 200);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.skill-grant.create', reason,
                    success: false, username: agentId, error: String(error) });
                throw error;
            }
        }

        const skillGrantRevokeMatch = url.pathname.match(/^\/api\/admin\/skill-grants\/([^/]+)\/revoke$/);
        if (req.method === 'POST' && skillGrantRevokeMatch?.[1]) {
            const grantId = decodeURIComponent(skillGrantRevokeMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = Number(body.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
                throw new Error('Érvénytelen grant revízió.');
            }
            try {
                const before = (await listAdminSkillLearning()).grants.find(grant => grant.grantId === grantId);
                const grant = await revokeAdminSkillGrant(grantId, expectedRevision, reason);
                await appendAudit({ operator: 'local-admin', action: 'agent.skill-grant.revoke', reason,
                    success: true, username: grant.agentId, before, after: grant });
                return json({ ok: true, grant });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.skill-grant.revoke', reason,
                    success: false, error: String(error), before: { grantId, expectedRevision } });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/agents') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const role = oneOf<AgentRole>(body.role ?? 'player',
                ['player', 'institution', 'service', 'world-director'], 'role');
            const playerUsername = role === 'player' ? text(body, 'playerUsername', true).toLowerCase() : null;
            if (playerUsername && !(await catalog()).some(bot => bot.username === playerUsername)) {
                throw new Error('Player agent csak a botkatalógusban létező játékoshoz hozható létre.');
            }
            const allowedSubjectKinds: Record<AgentRole, readonly AgentSubjectKind[]> = {
                player: ['player'], institution: ['business', 'faction'], service: ['service'],
                'world-director': ['world']
            };
            const subjectKind = role === 'player' ? 'player' : oneOf<AgentSubjectKind>(body.subjectKind,
                allowedSubjectKinds[role], 'subjectKind');
            const subjectId = role === 'player' ? playerUsername! : text(body, 'subjectId', true);
            try {
                const identity = createAdminAgent({
                    agentId: text(body, 'agentId', true), playerUsername,
                    displayName: text(body, 'displayName', true), background: text(body, 'background', true),
                    personalityTraits: stringList(body.personalityTraits, 'personalityTraits'),
                    values: body.values === undefined ? [] : stringList(body.values, 'values'),
                    controlProfile: { role, subjectKind, subjectId,
                        avatarPlayerUsername: playerUsername,
                        decisionIntervalMs: Number(body.decisionIntervalMs ?? 300000),
                        maxDecisionsPerDay: Number(body.maxDecisionsPerDay ?? 96),
                        dailyLlmBudgetMicros: Number(body.dailyLlmBudgetMicros ?? 0),
                        dailyOperationalBudgetGp: Number(body.dailyOperationalBudgetGp ?? 0) }
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.identity.create',
                    username: playerUsername ?? identity.agentId,
                    reason, success: true, after: identity });
                return json({ ok: true, identity }, 201);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.identity.create',
                    username: playerUsername ?? text(body, 'agentId'),
                    reason, success: false, error: String(error) });
                throw error;
            }
        }

        const agentMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)$/);
        if (req.method === 'PUT' && agentMatch?.[1]) {
            const agentId = agentMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = Number(body.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Érvénytelen identity revízió.');
            const before = (await listAdminAgents()).agents.find(agent => agent.identity.agentId === agentId)?.identity;
            const identity = updateAdminAgent(agentId, expectedRevision, {
                ...(body.displayName !== undefined ? { displayName: text(body, 'displayName', true) } : {}),
                ...(body.background !== undefined ? { background: text(body, 'background', true) } : {}),
                ...(body.personalityTraits !== undefined ? { personalityTraits: stringList(body.personalityTraits, 'personalityTraits') } : {}),
                ...(body.values !== undefined ? { values: stringList(body.values, 'values') } : {})
            });
            await appendAudit({ operator: 'local-admin', action: 'agent.identity.update',
                username: identity.playerUsername ?? identity.agentId,
                reason, success: true, before, after: identity });
            return json({ ok: true, identity });
        }

        const controlProfileMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/control-profile$/);
        if (req.method === 'PUT' && controlProfileMatch?.[1]) {
            const agentId = controlProfileMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = Number(body.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
                throw new Error('Érvénytelen control profile revízió.');
            }
            const before = (await listAdminAgents()).agents
                .find(agent => agent.identity.agentId === agentId)?.controlProfile;
            const profile = updateAdminAgentControlProfile(agentId, expectedRevision, {
                role: oneOf<AgentRole>(body.role,
                    ['player', 'institution', 'service', 'world-director'], 'role'),
                subjectKind: oneOf<AgentSubjectKind>(body.subjectKind,
                    ['player', 'business', 'faction', 'service', 'world'], 'subjectKind'),
                subjectId: text(body, 'subjectId', true),
                avatarPlayerUsername: body.avatarPlayerUsername === null ? null
                    : text(body, 'avatarPlayerUsername'),
                decisionIntervalMs: Number(body.decisionIntervalMs),
                maxDecisionsPerDay: Number(body.maxDecisionsPerDay),
                dailyLlmBudgetMicros: Number(body.dailyLlmBudgetMicros),
                dailyOperationalBudgetGp: Number(body.dailyOperationalBudgetGp)
            });
            await appendAudit({ operator: 'local-admin', action: 'agent.control-profile.update', reason,
                success: true, username: agentId, before, after: profile });
            return json({ ok: true, profile });
        }

        const playerActionCreateMatch = url.pathname
            .match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/player-actions$/);
        if (req.method === 'POST' && playerActionCreateMatch?.[1]) {
            const requesterAgentId = playerActionCreateMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const assigneeAgentId = text(body, 'assigneeAgentId', true).toLowerCase();
            const requestedSkill = text(body, 'skill', true);
            const candidate = await resolveAdminSkillForAgent(requestedSkill, assigneeAgentId);
            const parameters = validateAdminSkillParameters(candidate.definition,
                body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
                    ? body.parameters as Record<string, unknown> : {});
            try {
                const request = createAdminPlayerActionRequest(requesterAgentId, {
                    requestId: crypto.randomUUID(), assigneeAgentId,
                    skill: { id: candidate.definition.id, version: candidate.definition.version },
                    parameters, objective: text(body, 'objective', true), rewardGp: Number(body.rewardGp ?? 0)
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.player-action.create', reason,
                    username: requesterAgentId, success: true, after: request });
                return json({ ok: true, request }, 201);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.player-action.create', reason,
                    username: requesterAgentId, success: false, error: String(error),
                    after: { assigneeAgentId, skill: requestedSkill } });
                throw error;
            }
        }

        const playerActionUpdateMatch = url.pathname.match(/^\/api\/admin\/player-actions\/([a-z0-9.-]+)$/);
        if (req.method === 'PUT' && playerActionUpdateMatch?.[1]) {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const actorAgentId = text(body, 'actorAgentId', true).toLowerCase();
            const expectedRevision = Number(body.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
                throw new Error('Érvénytelen player-action revízió.');
            }
            const status = oneOf<AgentPlayerActionManualStatus>(body.status,
                ['accepted', 'rejected', 'cancelled'], 'status');
            try {
                const request = updateAdminPlayerActionRequest(playerActionUpdateMatch[1], actorAgentId,
                    expectedRevision, status, text(body, 'responseNote'));
                await appendAudit({ operator: 'local-admin', action: 'agent.player-action.status', reason,
                    username: actorAgentId, success: true, after: request });
                return json({ ok: true, request });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.player-action.status', reason,
                    username: actorAgentId, success: false, error: String(error),
                    after: { requestId: playerActionUpdateMatch[1], expectedRevision, status } });
                throw error;
            }
        }

        const playerActionStartMatch = url.pathname
            .match(/^\/api\/admin\/player-actions\/([a-z0-9.-]+)\/approve-and-start$/);
        if (req.method === 'POST' && playerActionStartMatch?.[1]) {
            const requestId = playerActionStartMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = Number(body.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
                throw new Error('Érvénytelen player-action revízió.');
            }
            const agents = await listAdminAgents();
            const request = agents.agents.flatMap(agent => agent.outgoingPlayerActions)
                .find(item => item.requestId === requestId);
            if (!request || request.status !== 'accepted' || request.revision !== expectedRevision) {
                throw new Error('A megbízás már nem elfogadott vagy közben megváltozott.');
            }
            const assignee = agents.agents.find(agent => agent.identity.agentId === request.assigneeAgentId);
            const avatar = assignee?.controlProfile.avatarPlayerUsername;
            if (!assignee || !avatar || assignee.controlProfile.role !== 'player') {
                throw new Error('A címzettnek nincs exact player-avatar kötése.');
            }
            const requested = `${request.skill.id}@${request.skill.version}`;
            const learned = assignee.skillRelationships.find(skill => skill.reference.id === request.skill.id
                && skill.reference.version === request.skill.version);
            if (!learned?.executable) {
                throw new Error(`A címzett már nem ismeri vagy nem futtathatja ezt a skillt: ${requested}`);
            }
            const bot = (await catalog()).find(entry => entry.username === avatar);
            if (!bot || bot.status !== 'active' || !bot.hasCredentials || bot.currentSkill) {
                throw new Error('A címzett botnak online, credentiallel rendelkező és szabad állapotban kell lennie.');
            }
            const candidate = await resolveAdminSkillForAgent(requested, assignee.identity.agentId);
            const parameters = validateAdminSkillParameters(candidate.definition, request.parameters);
            const approvalId = crypto.randomUUID(), runId = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
            try {
                const approved = approveAdminPlayerActionRequest(requestId, request.assigneeAgentId,
                    expectedRevision, approvalId, expiresAt);
                const running = startAdminPlayerActionRequest(requestId, request.assigneeAgentId,
                    approved.revision, approvalId, runId);
                try {
                    const process = await context.supervisor.startSkill(avatar, requested, parameters, { runId });
                    await appendAudit({ operator: 'local-admin', action: 'agent.player-action.start', reason,
                        username: avatar, success: true, before: request, after: { request: running, process } });
                    return json({ ok: true, request: running, process }, 202);
                } catch (error) {
                    finishAdminPlayerActionRun(runId, false, `Skill start failed: ${String(error)}`);
                    throw error;
                }
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.player-action.start', reason,
                    username: avatar, success: false, error: String(error), before: request,
                    after: { approvalId, runId } });
                throw error;
            }
        }

        const agentGoalMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/goals$/);
        if (req.method === 'POST' && agentGoalMatch?.[1]) {
            const agentId = agentGoalMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const goal = createAdminAgentGoal(agentId, {
                goalId: text(body, 'goalId', true), parentGoalId: body.parentGoalId === null ? null : text(body, 'parentGoalId'),
                horizon: oneOf<GoalHorizon>(body.horizon, ['life', 'long-term', 'current', 'immediate'], 'horizon'),
                title: text(body, 'title', true), description: text(body, 'description'),
                priority: Number(body.priority),
                skill: body.skill && typeof body.skill === 'object' ? body.skill as { id: string; version: string } : null
            });
            await appendAudit({ operator: 'local-admin', action: 'agent.goal.create', reason, success: true,
                username: agentId, after: goal });
            if (goal.horizon === 'immediate') {
                const occurredAt = new Date().toISOString();
                void context.replanCoordinator?.submit({ eventId: crypto.randomUUID(), agentId,
                    type: 'goal-changed', sourceKey: `goal:${goal.goalId}:revision:${goal.revision}`,
                    occurredAt, summary: `Immediate goal ${goal.goalId} was created or changed.` }, occurredAt)
                    .catch(error => console.error('[AgentReplan] Goal event failed:', error));
            }
            return json({ ok: true, goal }, 201);
        }

        const agentEpisodeMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/episodes$/);
        if (req.method === 'POST' && agentEpisodeMatch?.[1]) {
            const agentId = agentEpisodeMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const episode = createAdminAgentEpisode(agentId, {
                    episodeId: text(body, 'episodeId') || crypto.randomUUID(),
                    kind: oneOf<AgentEpisodeKind>(body.kind,
                        ['observation', 'action', 'outcome', 'interaction', 'discovery', 'economic'], 'kind'),
                    summary: text(body, 'summary', true), details: text(body, 'details'),
                    importance: Number(body.importance),
                    goalIds: body.goalIds === undefined ? [] : stringList(body.goalIds, 'goalIds'),
                    actors: body.actors === undefined ? [] : stringList(body.actors, 'actors'),
                    tags: body.tags === undefined ? [] : stringList(body.tags, 'tags'),
                    source: 'manual',
                    trust: oneOf<AgentEpisodeTrust>(body.trust ?? 'trusted', ['trusted', 'untrusted'], 'trust'),
                    occurredAt: text(body, 'occurredAt', true), expiresAt: body.expiresAt ? text(body, 'expiresAt') : null
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.episode.create', reason, success: true,
                    username: agentId, after: episode });
                return json({ ok: true, episode }, 201);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.episode.create', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentEpisodePruneMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/episodes\/prune$/);
        if (req.method === 'POST' && agentEpisodePruneMatch?.[1]) {
            const agentId = agentEpisodePruneMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const result = pruneAdminAgentEpisodes(agentId);
                await appendAudit({ operator: 'local-admin', action: 'agent.episodes.prune', reason, success: true,
                    username: agentId, after: result });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.episodes.prune', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentKnowledgeMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/knowledge$/);
        if (req.method === 'POST' && agentKnowledgeMatch?.[1]) {
            const agentId = agentKnowledgeMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const knowledge = createAdminAgentKnowledge(agentId, {
                    knowledgeId: text(body, 'knowledgeId') || crypto.randomUUID(),
                    kind: oneOf<AgentKnowledgeKind>(body.kind, ['world', 'economic', 'route', 'procedure'], 'kind'),
                    subject: text(body, 'subject', true), predicate: text(body, 'predicate', true),
                    object: text(body, 'object', true), summary: text(body, 'summary', true),
                    confidence: Number(body.confidence),
                    goalIds: body.goalIds === undefined ? [] : stringList(body.goalIds, 'goalIds'),
                    tags: body.tags === undefined ? [] : stringList(body.tags, 'tags'),
                    evidenceEpisodeIds: body.evidenceEpisodeIds === undefined
                        ? [] : stringList(body.evidenceEpisodeIds, 'evidenceEpisodeIds'),
                    source: 'manual', supersedesId: body.supersedesId ? text(body, 'supersedesId') : null,
                    validFrom: text(body, 'validFrom', true), validUntil: body.validUntil ? text(body, 'validUntil') : null
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.knowledge.create', reason, success: true,
                    username: agentId, after: knowledge });
                return json({ ok: true, knowledge }, 201);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.knowledge.create', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentRelationshipMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/relationships$/);
        if (req.method === 'PUT' && agentRelationshipMatch?.[1]) {
            const agentId = agentRelationshipMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const relationship = updateAdminAgentRelationship(agentId,
                    body.expectedRevision === null ? null : Number(body.expectedRevision), {
                        actorKey: text(body, 'actorKey', true), displayName: text(body, 'displayName', true),
                        trust: Number(body.trust), affinity: Number(body.affinity), familiarity: Number(body.familiarity),
                        agentOwesGp: Number(body.agentOwesGp), actorOwesGp: Number(body.actorOwesGp),
                        notes: text(body, 'notes'), tags: body.tags === undefined ? [] : stringList(body.tags, 'tags'),
                        evidenceEpisodeIds: body.evidenceEpisodeIds === undefined
                            ? [] : stringList(body.evidenceEpisodeIds, 'evidenceEpisodeIds'),
                        lastInteractionAt: body.lastInteractionAt ? text(body, 'lastInteractionAt') : null
                    });
                await appendAudit({ operator: 'local-admin', action: 'agent.relationship.update', reason, success: true,
                    username: agentId, after: relationship });
                return json({ ok: true, relationship });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.relationship.update', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentCommitmentMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/relationships\/([^/]+)\/commitments$/);
        if (req.method === 'POST' && agentCommitmentMatch?.[1] && agentCommitmentMatch[2]) {
            const agentId = agentCommitmentMatch[1];
            const actorKey = decodeURIComponent(agentCommitmentMatch[2]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const commitment = createAdminAgentCommitment(agentId!, {
                    commitmentId: text(body, 'commitmentId') || crypto.randomUUID(), actorKey,
                    direction: oneOf<AgentCommitmentDirection>(body.direction,
                        ['owed-by-agent', 'owed-to-agent'], 'direction'),
                    description: text(body, 'description', true),
                    valueGp: body.valueGp === null || body.valueGp === undefined ? null : Number(body.valueGp),
                    dueAt: body.dueAt ? text(body, 'dueAt') : null,
                    evidenceEpisodeIds: body.evidenceEpisodeIds === undefined
                        ? [] : stringList(body.evidenceEpisodeIds, 'evidenceEpisodeIds')
                });
                await appendAudit({ operator: 'local-admin', action: 'agent.commitment.create', reason, success: true,
                    username: agentId, after: commitment });
                return json({ ok: true, commitment }, 201);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.commitment.create', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentCommitmentStatusMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/commitments\/([a-z0-9.-]+)\/status$/);
        if (req.method === 'PUT' && agentCommitmentStatusMatch?.[1] && agentCommitmentStatusMatch[2]) {
            const [agentId, commitmentId] = [agentCommitmentStatusMatch[1], agentCommitmentStatusMatch[2]];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const commitment = updateAdminAgentCommitmentStatus(agentId!, commitmentId!,
                    Number(body.expectedRevision), oneOf<AgentCommitmentStatus>(body.status,
                        ['open', 'fulfilled', 'broken', 'cancelled'], 'status'));
                await appendAudit({ operator: 'local-admin', action: 'agent.commitment.status', reason, success: true,
                    username: agentId, after: commitment });
                return json({ ok: true, commitment });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.commitment.status', reason, success: false,
                    username: agentId, error: String(error) });
                throw error;
            }
        }

        const agentGoalStatusMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/goals\/([a-z0-9.-]+)\/status$/);
        if (req.method === 'PUT' && agentGoalStatusMatch?.[1] && agentGoalStatusMatch[2]) {
            const [agentId, goalId] = [agentGoalStatusMatch[1], agentGoalStatusMatch[2]];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const goal = updateAdminAgentGoalStatus(agentId!, goalId!, Number(body.expectedRevision),
                oneOf<GoalStatus>(body.status, ['active', 'completed', 'blocked', 'abandoned'], 'status'));
            await appendAudit({ operator: 'local-admin', action: 'agent.goal.status', reason, success: true,
                username: agentId, after: goal });
            if (goal.horizon === 'immediate') {
                const occurredAt = new Date().toISOString();
                void context.replanCoordinator?.submit({ eventId: crypto.randomUUID(), agentId: agentId!,
                    type: 'goal-changed', sourceKey: `goal:${goal.goalId}:revision:${goal.revision}`,
                    occurredAt, summary: `Immediate goal ${goal.goalId} changed to ${goal.status}.` }, occurredAt)
                    .catch(error => console.error('[AgentReplan] Goal event failed:', error));
            }
            return json({ ok: true, goal });
        }

        const agentSkillMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/skills$/);
        const agentSkillLearnMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/skills\/learn$/);
        if (req.method === 'POST' && agentSkillLearnMatch?.[1]) {
            const agentId = agentSkillLearnMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const requested = text(body, 'skill', true);
            try {
                const candidate = await resolveAdminSkillForAgent(requested, agentId);
                const result = await learnAdminSkill(agentId, candidate.definition, { policy: candidate.policy });
                await appendAudit({ operator: 'local-admin', action: 'agent.skill.learn', reason, success: true,
                    username: agentId, after: { event: result.event, knowledge: result.knowledge } });
                return json({ ok: true, ...result }, result.created || result.knowledgeCreated ? 201 : 200);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.skill.learn', reason, success: false,
                    username: agentId, after: { requested }, error: String(error) });
                throw error;
            }
        }
        if (req.method === 'PUT' && agentSkillMatch?.[1]) {
            const agentId = agentSkillMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const requested = text(body, 'skill', true);
            const candidate = await resolveAdminSkillForAgent(requested, agentId);
            const reference = { id: candidate.definition.id, version: candidate.definition.version };
            const knowledge = updateAdminAgentSkill(agentId, reference,
                oneOf<AgentSkillKnowledgeStatus>(body.status, ['known', 'preferred', 'blocked'], 'status'),
                body.expectedRevision === null ? null : Number(body.expectedRevision));
            await appendAudit({ operator: 'local-admin', action: 'agent.skill-knowledge.update', reason, success: true,
                username: agentId, after: knowledge });
            return json({ ok: true, knowledge });
        }

        const agentPlanMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/plan$/);
        if (req.method === 'POST' && agentPlanMatch?.[1]) {
            const agentId = agentPlanMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const execute = body.execute === true;
            const agents = await listAdminAgents();
            const agent = agents.agents.find(entry => entry.identity.agentId === agentId);
            if (!agent) throw new Error('Az agent nem található.');
            const avatar = agent.controlProfile.avatarPlayerUsername;
            if (!avatar) throw new Error('Ennek az agentnek nincs vezérelhető player avatarja.');
            const gatewayEntry = [...context.gatewayBots().entries()]
                .find(([name]) => name.toLowerCase() === avatar)?.[1];
            if (!gatewayEntry?.state?.player || gatewayEntry.status !== 'active'
                || Date.now() - gatewayEntry.lastStateReceivedAt > 5_000) throw new Error('A kapcsolt botnak friss online állapotban kell lennie.');
            const store = new AgentStateStore(agentStateDbPath);
            try {
                if (execute) {
                    const immediate = agent.goals.filter(goal => goal.status === 'active' && goal.horizon === 'immediate')
                        .sort((left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId))[0];
                    if (immediate) await resolveLearnAndPlan(agentId, immediate, agent.catalogSkills,
                        agent.knownSkills, { now: new Date().toISOString() });
                }
                const cycle = await runLivePlannerCycle({ store, agentId, state: gatewayEntry.state,
                    availableSkills: agent.catalogSkills.map(skill => ({ id: skill.id, version: skill.version })) });
                let process = null;
                let episode = null;
                let episodeError = null;
                if (execute) {
                    if (cycle.decision.kind !== 'execute-skill' || !cycle.decision.skill) {
                        throw new Error(`A planner nem adott végrehajtható döntést: ${cycle.decision.reason}`);
                    }
                    const bot = (await catalog()).find(entry => entry.username === avatar);
                    if (!bot?.hasCredentials || bot.currentSkill) throw new Error('A bot nem indíthat új skillt: nincs credential vagy már fut skill.');
                    const requested = `${cycle.decision.skill.id}@${cycle.decision.skill.version}`;
                    const candidate = await resolveAdminSkillForAgent(requested, agentId);
                    const parameters = validateAdminSkillParameters(candidate.definition, {});
                    process = await context.supervisor.startSkill(avatar, requested, parameters);
                    try {
                        episode = store.createEpisode(agentId, {
                            episodeId: crypto.randomUUID(), kind: 'action', source: 'planner', trust: 'trusted',
                            summary: `Started ${requested} for goal ${cycle.decision.goalId}.`,
                            details: cycle.decision.reason, importance: 60,
                            goalIds: cycle.decision.goalId ? [cycle.decision.goalId] : [],
                            tags: ['planner', 'skill-start'], actors: [], occurredAt: process.startedAt,
                            externalKey: `planner:${process.startedAt}:${requested}`
                        });
                    } catch (error) {
                        episodeError = error instanceof Error ? error.message : String(error);
                    }
                }
                await appendAudit({ operator: 'local-admin', action: execute ? 'agent.plan.execute' : 'agent.plan.preview',
                    username: avatar, reason, success: true,
                    after: { decision: cycle.decision, process, episode, episodeError } });
                return json({ ok: true, decision: cycle.decision, process, episode, episodeError }, execute ? 202 : 200);
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: execute ? 'agent.plan.execute' : 'agent.plan.preview',
                    username: avatar, reason, success: false, error: String(error) });
                throw error;
            } finally { store.close(); }
        }

        const agentLlmDryRunMatch = url.pathname.match(/^\/api\/admin\/agents\/([a-z0-9.-]+)\/llm-dry-run$/);
        if (req.method === 'POST' && agentLlmDryRunMatch?.[1]) {
            const agentId = agentLlmDryRunMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const initial = await listAdminAgents();
            const agent = initial.agents.find(entry => entry.identity.agentId === agentId);
            if (!agent) throw new Error('Az agent nem található.');
            const avatar = agent.controlProfile.avatarPlayerUsername;
            if (!avatar) throw new Error('Az LLM player dry-runhoz az agentnek player avatárra van szüksége.');
            const gatewayEntry = [...context.gatewayBots().entries()]
                .find(([name]) => name.toLowerCase() === avatar)?.[1];
            if (!gatewayEntry?.state?.player || gatewayEntry.status !== 'active'
                || Date.now() - gatewayEntry.lastStateReceivedAt > 5_000) {
                throw new Error('Az LLM dry-runhoz a kapcsolt botnak friss online állapotban kell lennie.');
            }
            const now = new Date().toISOString();
            const store = new AgentStateStore(agentStateDbPath);
            try {
                const previous = store.getWorkingMemory(agentId);
                store.setWorkingMemory(agentId, previous?.revision ?? null,
                    observeLiveState(gatewayEntry.state, now), now);
            } finally { store.close(); }
            try {
                const refreshed = await listAdminAgents();
                const current = refreshed.agents.find(entry => entry.identity.agentId === agentId)!;
                const result = await runAdminLlmDryRun(current, current.catalogSkills, { now,
                    capabilityGapStore: new CapabilityGapStore(capabilityGapsPath) });
                await appendAudit({ operator: 'local-admin', action: 'agent.llm.dry-run', reason, success: true,
                    username: avatar, after: { runId: result.plan.runId,
                        status: result.plan.status, decision: result.plan.decision, usage: result.plan.usage } });
                return json({ ok: true, ...result });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'agent.llm.dry-run', reason, success: false,
                    username: avatar, error: String(error) });
                throw error;
            }
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

        const propertyPurchaseMatch = url.pathname.match(/^\/api\/admin\/properties\/([a-z0-9.-]+)\/purchase$/);
        if (req.method === 'POST' && propertyPurchaseMatch?.[1]) {
            const propertyId = propertyPurchaseMatch[1];
            const body = await requestBody(req);
            const username = text(body, 'username', true);
            const reason = text(body, 'reason', true);
            const commandId = crypto.randomUUID();
            try {
                const result = await requestEnginePropertyPurchase(username, propertyId, commandId);
                await appendAudit({
                    operator: 'local-admin', action: 'property.purchase', username, reason, success: true,
                    before: { propertyId, coins: result.coinsBefore },
                    after: { property: result.property, coins: result.coinsAfter, engineTick: result.tick, commandId }
                });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'property.purchase', username, reason, success: false,
                    before: { propertyId }, after: { commandId }, error: String(error)
                });
                throw error;
            }
        }

        const propertyResetMatch = url.pathname.match(/^\/api\/admin\/properties\/([a-z0-9.-]+)\/reset$/);
        if (req.method === 'POST' && propertyResetMatch?.[1]) {
            const propertyId = propertyResetMatch[1];
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedVersion = body.expectedVersion;
            if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
                return json({ error: 'Érvénytelen ingatlanverzió.' }, 400);
            }
            const commandId = crypto.randomUUID();
            const before = (await listEngineProperties()).properties.find(property => property.propertyId === propertyId);
            try {
                const result = await requestEnginePropertyReset(propertyId, Number(expectedVersion), commandId);
                await appendAudit({
                    operator: 'local-admin', action: 'property.developer-reset', reason, success: true,
                    before, after: { property: result.property, engineTick: result.tick, commandId }
                });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'property.developer-reset', reason, success: false,
                    before, after: { propertyId, expectedVersion, commandId }, error: String(error)
                });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/properties/reconcile') {
            const body = await requestBody(req);
            const transactionId = text(body, 'transactionId', true);
            const reason = text(body, 'reason', true);
            const resolution = body.resolution;
            if (resolution !== 'commit-debited' && resolution !== 'release-unpaid') {
                return json({ error: 'Ismeretlen egyeztetési döntés.' }, 400);
            }
            const commandId = crypto.randomUUID();
            const before = (await listEngineProperties()).pendingPurchases
                .find(purchase => purchase.transactionId === transactionId);
            try {
                const result = await requestEnginePropertyReconciliation(transactionId, resolution, commandId);
                await appendAudit({
                    operator: 'local-admin', action: 'property.pending-reconcile', reason, success: true,
                    before, after: { ...result, resolution }
                });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'property.pending-reconcile', reason, success: false,
                    before, after: { transactionId, resolution, commandId }, error: String(error)
                });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/world-mods/backups') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const backup = await createWorldModBackup(reason);
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.backup', reason, success: true,
                    after: backup
                });
                return json({ ok: true, backup });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.backup', reason, success: false,
                    error: String(error)
                });
                throw error;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/admin/world-mods/reload') {
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            try {
                const result = await requestWorldModHotReload();
                await appendAudit({ operator: 'local-admin', action: 'world-mod.hot-reload', reason, success: true, after: result });
                return json({ ok: true, result });
            } catch (error) {
                await appendAudit({ operator: 'local-admin', action: 'world-mod.hot-reload', reason, success: false, error: String(error) });
                throw error;
            }
        }

        const worldModRestoreMatch = url.pathname.match(/^\/api\/admin\/world-mods\/backups\/([^/]+)\/restore$/);
        if (req.method === 'POST' && worldModRestoreMatch?.[1]) {
            const backupId = decodeURIComponent(worldModRestoreMatch[1]);
            const body = await requestBody(req);
            const reason = text(body, 'reason', true);
            const expectedRevision = body.expectedRevision;
            if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) throw new Error('Érvénytelen modkonfiguráció-revízió.');
            try {
                const result = await restoreWorldModBackup(backupId, Number(expectedRevision), reason);
                let activation = null;
                let activationError = null;
                try { activation = await requestWorldModHotReload(); }
                catch (error) { activationError = error instanceof Error ? error.message : String(error); }
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.restore', reason, success: true,
                    before: { revision: result.before.revision },
                    after: { revision: result.after.revision, restoredBackupId: result.restored.id, safetyBackupId: result.safetyBackup.id, activation, activationError }
                });
                return json({ ok: true, revision: result.after.revision, restoredBackupId: result.restored.id, activation, activationError });
            } catch (error) {
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.restore', reason, success: false,
                    after: { backupId, expectedRevision }, error: String(error)
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
                const result = await updateWorldMod(modId, { enabled: body.enabled, config: body.config }, Number(expectedRevision), undefined, undefined, undefined, reason);
                let activation = null;
                let activationError = null;
                if (result.manifest.activation === 'hot-reload') {
                    try { activation = await requestWorldModHotReload(); }
                    catch (error) { activationError = error instanceof Error ? error.message : String(error); }
                }
                await appendAudit({
                    operator: 'local-admin', action: 'world-mod.configure', reason, success: true,
                    before: { revision: result.before.revision, mod: result.before.mods[modId] },
                    after: { revision: result.after.revision, mod: result.after.mods[modId], activationMode: result.manifest.activation, activation, activationError, modId, backupId: result.backup.id }
                });
                return json({ ok: true, restartRequired: result.manifest.activation === 'restart-required', hotReloaded: !!activation && !activationError, activation, activationError, revision: result.after.revision, backupId: result.backup.id });
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
