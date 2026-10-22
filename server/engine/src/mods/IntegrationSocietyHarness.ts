/** SI-A14 test harness. Never imported by the engine runtime. Every writer is confined to a new test workspace. */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import World from '../engine/World.js';
import Player from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import Npc from '../engine/entity/Npc.js';
import Loc from '../engine/entity/Loc.js';
import { EntityLifeCycle } from '../engine/entity/EntityLifeCycle.js';
import { BlockWalk } from '../engine/entity/BlockWalk.js';
import Packet from '../io/Packet.js';
import InvType from '../cache/config/InvType.js';
import NpcType from '../cache/config/NpcType.js';
import LocType from '../cache/config/LocType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import JavaRandom from '../util/JavaRandom.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { OwnedDatabase } from '../io/OwnedDatabase.js';
import { foodDigest, FOOD_POLICY } from './NativeFoodConsumptionStore.js';
import { loadNativeFoodProductionPolicy } from './NativeFoodProductionPolicy.js';
import { executeNativeFoodSkill } from './NativeFoodSkill.js';
import { NativeKitchenExecutor } from './NativeKitchen.js';
import { NativeCommerceExecutor } from './NativeCommerce.js';
import { NativeHousingExecutor } from './NativeHousing.js';
import { TradeEvidenceStore } from './TradeEvidenceStore.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import { nativeIntegrationBootstrapPorts } from './IntegrationFixtureNative.js';
import { PlayerHealthEvidenceStore } from './PlayerHealthEvidenceStore.js';
import { PlayerRewardStore } from './PlayerRewardStore.js';
import { creditNativePlayerReward } from './NativePlayerReward.js';

export const workspace = resolve(import.meta.dir, '../../../..');
const load = (path: string) => import(pathToFileURL(join(workspace, path)).href);
/** These are test preconditions, not route/boat acceptance or publication authority. */
export const TEST_BOUNDARIES = ['reviewed-publication-availability', 'physical-arrival-at-native-site', 'SDK-controller-transport', 'observed-wall-time-driver', 'already-running-shift-admission'] as const;
export async function loadAcceptanceContent() {
    for (const name of ['InvType', 'ObjType', 'NpcType', 'LocType', 'VarPlayerType', 'VarNpcType', 'VarBitType', 'ParamType', 'EnumType', 'StructType', 'SeqType', 'DbRowType', 'DbTableType', 'FontType']) {
        const type = await import(pathToFileURL(join(workspace, `server/engine/src/cache/config/${name}.ts`)).href);
        type.default.load(join(workspace, 'server/engine/data/pack'));
    }
    const index = await import(pathToFileURL(join(workspace, 'server/engine/src/cache/config/DbTableIndex.ts')).href); index.default.init();
    ScriptProvider.load(join(workspace, 'server/engine/data/pack'));
}
export async function bootstrapAcceptanceBaseline() {
    assert.equal(process.env.SI_A14_ISOLATED_WORKSPACE, workspace);
    assert(existsSync(join(workspace, '.integration-stage.json')));
    const [{ loadIntegrationFixture }, { bootstrapIntegrationStage }, { sealIntegrationBaseline }, { SkillRegistry }] = await Promise.all([
        load('society-integration/fixture.ts'), load('society-integration/bootstrap.ts'), load('society-integration/baseline.ts'), load('agent-skills/registry.ts')]);
    const fixture = loadIntegrationFixture(join(workspace, 'config/fixtures/society-lobster-four-v1.json'));
    const ports = await nativeIntegrationBootstrapPorts(workspace);
    try {
        await bootstrapIntegrationStage(workspace, fixture, { ...ports, readVerifiedSkill: async (id: string, version: string) => {
            const definition = JSON.parse(readFileSync(join(workspace, `agent-skills/catalog/${id}@${version}.skill.json`), 'utf8'));
            definition.status = 'verified'; return new SkillRegistry().register(definition, { trusted: true });
        } });
        sealIntegrationBaseline(workspace, fixture);
    } finally { ports.close(); }
}

export async function openSocietyHarness(recovery = false) {
    assert.equal(process.env.SI_A14_ISOLATED_WORKSPACE, workspace, 'Test-only isolated workspace capability required');
    const [f, baseline, clockModule, agentsModule, needsModule, kitchenModule, kitchenSources, commerceModule, commerceSources,
        commercePolicy, stockModule, saleModule, housingModule, housingSources, housingPolicy, rolesModule, workModule, skillModule, executorModule, runtimeModule, sdkModule] = await Promise.all([
        load('society-integration/fixture.ts'), load('society-integration/baseline.ts'), load('simulation-clock/store.ts'), load('agent-state/store.ts'),
        load('server/gateway/admin/needs-runtime.ts'), load('server/gateway/admin/native-kitchen.ts'), load('production-workflow/native-kitchen-source.ts'),
        load('agent-operated-shop/native-commerce-runtime.ts'), load('agent-operated-shop/native-commerce-source.ts'), load('agent-operated-shop/native-commerce.ts'),
        load('business-stock-policy/index.ts'), load('sale-channel-policy/index.ts'), load('housing/native-rent-runtime.ts'), load('housing/native-rent-source.ts'),
        load('housing/native-rent.ts'), load('business-roles/index.ts'), load('business-work/index.ts'), load('server/gateway/admin/native-food-skills.ts'),
        load('agent-skills/executor.ts'), load('agent-skills/rs-sdk-runtime.ts'), load('sdk/index.ts')]);
    const fixture = f.loadIntegrationFixture(join(workspace, 'config/fixtures/society-lobster-four-v1.json'));
    if (!recovery) baseline.verifyNativeIntegrationSeal(workspace, fixture);
    const receipt = JSON.parse(readFileSync(join(workspace, '.local/simulation/integration-fixture.json'), 'utf8'));
    const worldId = f.integrationWorldId(fixture), checkpointPath = join(workspace, 'server/engine/data/player-checkpoints.sqlite');
    const businessPath = join(workspace, '.local/economy/businesses.sqlite'), agentPath = join(workspace, '.local/agent-state/agents.sqlite');
    const treasuryPath = join(workspace, '.local/economy/institution-treasury.sqlite'), tradePath = join(workspace, 'server/engine/data/mods/trade-evidence.sqlite');
    const time = new clockModule.SimulationClockStore(join(workspace, '.local/simulation/simulation-clock.sqlite'));
    let wall = Math.max(Date.now(), Date.parse(time.get('world').lastObservedWallTime));
    if (time.get('world').status === 'paused') time.resume('world', time.get('world').revision, new Date(wall).toISOString());
    World.currentTick = 100;
    const clock = () => { wall = Math.max(wall, Date.now()); return time.observe('world', new Date(wall).toISOString(), World.currentTick); };
    const market = new MarketStore(checkpointPath), trades = new TradeEvidenceStore(tradePath);
    const players = new Map<string, Player>(fixture.avatars.map((a: any) => [a.username, PlayerLoading.load(a.username, new Packet(market.saved(a.username)!), null)]));
    for (const p of players.values()) { const add = p.addXp.bind(p); p.addXp = (stat, xp) => add(stat, xp, false); }
    const member = (username: string) => { const s = new agentsModule.AgentStateStore(agentPath); try { return s.getPopulationMember(username); } finally { s.close(); } };
    const binding = (username: string) => needsModule.populationNeedsBinding(worldId, member(username));
    const healthPath = join(workspace, 'server/engine/data/mods/player-health-evidence.sqlite'), health = new PlayerHealthEvidenceStore(healthPath);
    for (const avatar of fixture.avatars) { health.bindFiniteAvatar(member(avatar.username)); time.recordPlayerPresence('world', avatar.username, 'online', new Date(wall).toISOString()); }
    health.heartbeat(clock().wallTime);
    const identity = (username: string, actionId: string, slot: number, tick = World.currentTick) => {
        const b = binding(username), p = players.get(username)!;
        if (!p || p.populationTerminal || p.levels[PlayerStat.HITPOINTS] <= 0 || health.deathFor(username) || member(username).characterLifecycle.status !== 'active') throw new Error('deceased or inactive');
        return { action: { actionId, username, actorId: b.actorId, lifecycleId: b.lifecycleId, worldId,
            clockId: b.clockId, clockProfileDigest: b.clockProfileDigest, itemId: 379, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY) }, clock: { ...clock(), engineTick: tick } };
    };
    const policy = loadNativeFoodProductionPolicy(workspace);
    const nativeKitchenPolicy = (await load('production-workflow/native-kitchen-policy.ts')).loadNativeKitchenPolicy(workspace);
    const npc = new Npc(0, 2926, 3180, 1, 1, EntityLifeCycle.FOREVER, 1, NpcType.getId('0_45_49_rarefish'), BlockWalk.NONE);
    const heat = new Loc(0, 2926, 3180, 1, 1, EntityLifeCycle.FOREVER, LocType.getId('loc_2729'), 10, 0);
    const kitchenOptions = { workspace, worldId, businessPath, checkpointPath };
    const source = new kitchenSources.NativeKitchenReservationSource({ ...kitchenOptions, checkpointPath: businessPath });
    const productionPorts = (player: Player) => ({ market, policy, identity, checkpoint: (save: Uint8Array) => market.checkpoint(player.username, save, true) });
    const createKitchen = () => new NativeKitchenExecutor({ ...productionPorts(players.get('sicook')!), source, clock, heat: () => heat });
    let kitchenExecutor = createKitchen();
    const kitchen = () => kitchenExecutor;
    const commerceOptions = { ...kitchenOptions, treasuryPath, tradePath, journalPath: join(workspace, '.local/economy/food-commerce.sqlite') };
    const commerce = new commerceModule.FoodCommerceCoordinator(commerceOptions), commerceSource = new commerceSources.FoodCommerceSource(commerceOptions);
    const housingOptions = { workspace, worldId, housingPath: join(workspace, '.local/economy/housing.sqlite'), propertyPath: join(workspace, '.local/admin/properties.sqlite'), checkpointPath };
    const housing = new housingModule.NativeRentCoordinator(housingOptions), housingSource = new housingSources.NativeRentSource(housingOptions);
    const save = (p: Player) => { const bytes = p.save(false); market.checkpoint(p.username, bytes, true); return bytes; };
    const count = (name: string, id: number) => players.get(name)!.getInventory(InvType.INV)!.getItemCount(id);
    const at = (name: string, x = 2925, z = 3180, level = 0) => { const p = players.get(name)!; p.x = x; p.z = z; p.level = level; save(p); return p; };
    const sql = <T>(path: string, body: (db: OwnedDatabase) => T) => { const db = new OwnedDatabase(path); try { return body(db); } finally { db.close(true); } };
    const businessStock = (id: number) => sql(businessPath, db => (db.query('SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=?2').get('karamja-kitchen', id) as any)?.count ?? 0);
    const grant = (capabilityId: string) => {
        const entitlement = sql(businessPath, db => db.query('SELECT * FROM business_facility_entitlement WHERE business_id=?1 AND facility_capability=?2')
            .get('karamja-kitchen', capabilityId)) as any;
        const employment = sql(businessPath, db => db.query("SELECT * FROM business_employment WHERE worker_agent_id='sicook' AND status='active'").get()) as any;
        assert(entitlement && employment, 'Actual fixture entitlement and active employment required');
        return { grantId: entitlement.entitlement_id, kind: 'employment', subjectAgentId: 'sicook', facilityId: 'karamja.fishing-hut.utility', capabilityId,
            status: 'active', validFrom: entitlement.valid_from, validUntil: entitlement.valid_until, sourceEvidenceId: employment.employment_id };
    };
    const verifyGrant = (input: any) => foodDigest(input) === foodDigest(grant(input.capabilityId));
    const reserveKitchen = () => kitchenModule.reservePopulationKitchen(kitchenOptions, member('sicook'), clock(),
        { operationId: 'si-a14-reserve', runId: 'si-a14-cook', businessId: 'karamja-kitchen', sourceStorageId: null, targetStorageId: null }, grant('cooking.heat-source'), verifyGrant);
    const kitchenCommand = (operation: 'issue' | 'process' | 'return') => kitchen().execute({ operation, runId: 'si-a14-cook' }, players.get('sicook')!);
    const finishKitchen = () => kitchenModule.finalizePopulationKitchen(kitchenOptions, 'si-a14-cook');
    const commerceIntent = (kind: 'sale' | 'procurement', id = `si-a14-${kind}`) => {
        const catalogs = commerceSources.commerceCatalogs(workspace), itemId = kind === 'sale' ? 379 : 377, counter = kind === 'sale' ? 'sicourier' : 'sifisher';
        const stockPolicy = catalogs.stock.policies.find((p: any) => p.businessId === 'karamja-kitchen' && p.itemId === itemId);
        const b = binding('sicook'), c = binding(counter), k = nativeKitchenPolicy;
        return { operationId: id, kind, businessId: 'karamja-kitchen', worker: { agentId: 'sicook', username: 'sicook', lifecycleId: b.lifecycleId },
            counterparty: { agentId: counter, username: counter, lifecycleId: c.lifecycleId }, worldId, clockId: b.clockId, clockProfileDigest: b.clockProfileDigest,
            itemId, quantity: 1, unitPriceGp: kind === 'sale' ? 40 : 20, expiresAt: new Date(wall + 300000).toISOString(), catalogs,
            decision: stockModule.decideBusinessStock(stockPolicy, catalogs.stock, businessStock(itemId)), facilityPolicyDigest: foodDigest(k), grant: grant('storage.secure'),
            channel: saleModule.decideSaleChannel(catalogs.channels, { offerId: commercePolicy.commerceIds(id).tradeId, channel: kind === 'sale' ? 'player-trade' : 'business-shop',
                sellerAgentId: kind === 'sale' ? 'sicook' : counter, acquirer: { kind: kind === 'sale' ? 'agent' : 'business', id: kind === 'sale' ? counter : 'karamja-kitchen' }, itemId, quantity: 1, assetId: null, provenanceDigest: null }, []) };
    };
    const exchange = (intent: any, operation: 'execute' | 'cancel' = 'execute', partner = intent.counterparty.username) => new NativeCommerceExecutor({ market, trades, source: commerceSource, clock, identity, checkpoint: () => {} })
        .execute({ operation, operationId: intent.operationId }, players.get(intent.worker.username)!, players.get(partner)!);
    const rentIntent = (observed = clock()) => { const catalogs = housingPolicy.nativeHousingCatalogs(workspace), unit = catalogs.units.units.find((u: any) => u.propertyId === fixture.housing.propertyId), b = binding('sicourier'), l = binding('silessor');
        return { operationId: 'si-a14-rent', worldId, clockId: b.clockId, clockProfileDigest: b.clockProfileDigest,
            tenant: { agentId: 'sicourier', username: 'sicourier', lifecycleId: b.lifecycleId }, landlord: { agentId: 'silessor', username: 'silessor', lifecycleId: l.lifecycleId },
            housingUnitId: unit.housingUnitId, bedSlotId: unit.bedSlots[0].bedSlotId, catalogs, amountGp: unit.rentGpPerPeriod,
            propertyVersion: 2, startsAt: observed.simulationTime, endsAt: new Date(Date.parse(observed.simulationTime) + unit.rentPeriodSimulationMinutes * 60000).toISOString(), expiresAt: new Date(Date.parse(observed.wallTime) + 300000).toISOString() }; };
    const rent = (operation: 'pay' | 'cancel' | 'sleep' | 'wake', tenant = 'sicourier') => new NativeHousingExecutor({ market, source: housingSource, time, clock, identity, checkpoint: () => {} })
        .execute({ operation, operationId: 'si-a14-rent' }, players.get(tenant)!, players.get('silessor')!);
    const runFood = async (name: 'gather' | 'cook' | 'consume', username: string, runId: string = randomUUID(), hooks: { afterNativeReturn?(): void; afterNativeWaiting?(): void; dropAcknowledgement?: boolean } = {}) => {
        const player = players.get(username)!, opts = { ...kitchenOptions, binding: (u: string) => binding(u),
            dispatch: async (command: any) => { executeNativeFoodSkill(command, player, productionPorts(player), npc); World.currentTick++; },
            kitchen: async (command: any) => { const row = kitchen().execute(command, player); if (row.wakeTick) World.currentTick = row.wakeTick;
                if (row.phase === 'returned-output') hooks.afterNativeReturn?.(); if (row.phase === 'waiting') hooks.afterNativeWaiting?.(); return { ok: true, record: row }; } };
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req, server) { if (server.upgrade(req)) return; return new Response(null, { status: 404 }); },
            websocket: { async message(ws, raw) { const message = JSON.parse(String(raw)); if (message.type === 'sdk_connect') { ws.send(JSON.stringify({ type: 'sdk_connected', success: true, mode: 'control' })); return; }
                if (message.type !== 'sdk_action') return; let result;
                try { result = await skillModule.executeFoodSkillRequest(opts, username, message.action.request); } catch (error) { result = { success: false, message: String(error), reason: 'food-source-rejected' }; }
                if (hooks.dropAcknowledgement && result.success === true && result.phase === 'completion') {
                    // Drop the transport before delivering the committed source.
                    // Close through the public SDK API: server-side termination
                    // leaves Bun's local stop() pending on this Windows runtime.
                    await sdk.disconnect(); return;
                }
                ws.send(JSON.stringify({ type: 'sdk_action_result', actionId: message.actionId, result })); } } });
        const sdk = new sdkModule.BotSDK({ botUsername: username, gatewayUrl: `ws://127.0.0.1:${server.port}`, autoLaunchBrowser: false, autoReconnect: false, readyTimeout: 0, actionTimeout: 5000 });
        try { await sdk.connect(); const runtime = new runtimeModule.RsSdkSkillRuntime({ walkTo: async () => ({ success: true, message: 'Test arrival precondition' }) }, sdk,
            { operations: ['food-gather', 'food-cook', 'food-consume', 'walk-to'], itemNames: ['raw lobster', 'lobster'], partners: [], maxQuantity: 1, maxUnitPriceGp: 0, maxGpPerRun: 0 });
            runtime.test = async (condition: string, args: any) => {
                if (condition === 'inventory-free-slots-at-least') return player.getInventory(InvType.INV)!.freeSlotCount >= args.slots;
                if (condition === 'skill-level-at-least') return player.baseLevels[args.skill === 'Fishing' ? PlayerStat.FISHING : PlayerStat.COOKING] >= args.level;
                if (condition === 'inventory-contains') return count(username, 379) >= args.amount;
                throw new Error(`Unexpected procedure precondition: ${condition}`);
            };
            const skill = JSON.parse(readFileSync(join(workspace, `agent-skills/catalog/procedure.food.${name}-lobster@0.1.0.skill.json`), 'utf8'));
            const parameters = name === 'cook' ? { 'kitchen-run': 'si-a14-cook', 'batch-id': 'kitchen:si-a14-cook' } : name === 'consume' ? { slot: player.getInventory(InvType.INV)!.items.findIndex(i => i?.id === 379) } : {};
            const result = await new executorModule.SkillExecutor(runtime).execute(skill, { runId, allowDraft: true, parameters }); result.username = username;
            mkdirSync(join(workspace, '.local/agent-skills/runs'), { recursive: true }); writeFileSync(join(workspace, `.local/agent-skills/runs/${runId}.json`), JSON.stringify(result)); return result;
        } finally { await sdk.disconnect(); await server.stop(true); }
    };
    const roles = rolesModule.loadDefaultBusinessRoleCatalog();
    for (const pin of fixture.skills) if (!roles.verifiedSkillKeys.includes(`${pin.id}@${pin.version}`)) roles.verifiedSkillKeys.push(`${pin.id}@${pin.version}`);
    const workOptions = { workspace, worldId, checkpointPath, tradePath, roles, catalog: workModule.loadDefaultBusinessWorkPolicyCatalog(),
        rewardPath: join(workspace, 'server/engine/data/mods/player-action-rewards.sqlite'), runRoot: join(workspace, '.local/agent-skills/runs') };
    const withWork = <T>(body: (work: any) => T) => { const work = new workModule.BusinessWorkStore(businessPath, workOptions.catalog, roles); try { return body(work); } finally { work.close(); } };
    const workRunId = 'afaa1400-0000-4000-8000-000000000001';
    const cookRequest = async () => {
        const api = await load('server/gateway/admin/agent-state.ts');
        withWork(work => { if (!work.get('si-a14-cook-shift')) {
            const employment = sql(businessPath, db => db.query("SELECT employment_id FROM business_employment WHERE worker_agent_id='sicook' AND status='active'").get()) as any;
            const basis = Date.now(), startsAt = new Date(basis - 120000).toISOString(), endsAt = new Date(basis + 600000).toISOString();
            work.createWorkOrder('si-a14-cook-shift', 'karamja-kitchen.cook.v1', employment.employment_id, startsAt, endsAt);
        } });
        const started = (withWork(w => w.get('si-a14-cook-shift')) as any).scheduledStart;
        // Explicit elapsed-shift test precondition, matching the existing SI-A08
        // harness. It does not relax the production minimum one-minute work policy.
        return api.createAdminBusinessWorkRequest('si-a14-cook-shift', 'si-kitchen-mind', { 'kitchen-run': 'si-a14-cook', 'batch-id': 'kitchen:si-a14-cook' },
            { kind: 'cook', kitchenRunId: 'si-a14-cook', batchId: 'kitchen:si-a14-cook' }, agentPath, workOptions, started);
    };
    const payWage = async (hooks: { checkpoint?(save: Uint8Array): void; afterNative?(): void; projectionFault?: boolean } = {}) => {
        const api = await load('server/gateway/admin/agent-state.ts'), request = withWork(work => work.binding('si-a14-cook-shift')) as any;
        return api.settleAdminPlayerActionReward(request.settlementId, agentPath, async (username: string, amount: number, settlementId: string) => {
            const rewards = new PlayerRewardStore(workOptions.rewardPath);
            if (hooks.projectionFault) rewards.projectCheckpoint = () => { throw new Error('reward projection fault'); };
            try { const reward = creditNativePlayerReward(market, rewards, players.get(username)!, settlementId, amount, { checkpoint: hooks.checkpoint });
                hooks.afterNative?.();
                return { ok: true, commandId: randomUUID(), settlementId, username, amount, reward }; } finally { rewards.close(); }
        }, workOptions);
    };
    return { workspace, fixture, receipt, worldId, checkpointPath, businessPath, treasuryPath, tradePath, agentPath, market, time, trades, players,
        clock, binding, member, identity, at, save, count, sql, businessStock, source, reserveKitchen, kitchenCommand, finishKitchen, commerce, commerceSource, commerceOptions,
        commerceIntent, exchange, housing, housingSource, housingOptions, rentIntent, rent, grant, verifyGrant, runFood, rolesModule, workModule, workOptions, withWork, cookRequest, workRunId, payWage, health,
        async gateway() { return load('server/gateway/admin/agent-state.ts'); },
        useAgents<T>(body: (s: any) => T): T { const s = new agentsModule.AgentStateStore(agentPath, { store: time, clockId: 'world' }); try { return body(s); } finally { s.close(); } },
        async verifiedFoodRun(run: any) { return skillModule.verifyFoodSkillRunSources(workspace, run, kitchenOptions); },
        advance(ms: number) { wall += ms; World.currentTick += Math.ceil(ms / 600); },
        restartKitchen() { kitchenExecutor = createKitchen(); },
        seed(seed = 4096) { JavaRandom.setSeed(seed); },
        async applyFood() { closeFoodDeliveryTick(market.db, clock()); health.heartbeat(clock().wallTime);
            const agents = new agentsModule.AgentStateStore(agentPath, { store: time, clockId: 'world' });
            try { return needsModule.runPopulationNeedsCycle(agents, { store: time, clockId: 'world' }, { ...needsModule.populationNeedsOptions(workspace), worldId }, healthPath, clock().wallTime); }
            finally { agents.close(); } },
        async foodApplications() { return needsModule.readPopulationFoodApplications({ ...needsModule.populationNeedsOptions(workspace), worldId }); },
        close() { health.close(); housingSource.close(); housing.close(); commerceSource.close(); commerce.close(); source.close(); trades.close(); market.db.close(true); time.close(); }
    };
}
