import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Player, { getExpByLevel } from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import Packet from '../io/Packet.js';
import InvType from '../cache/config/InvType.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { PropertyStore } from './PropertyStore.js';
import { loadPropertyCatalog } from './Properties.js';
import { NativeFoodConsumptionStore, FOOD_POLICY, foodDigest } from './NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore } from './NativeFoodProductionStore.js';
import { NativeTravelFareStore } from './NativeTravelFareStore.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import { openSharedPlayerEscrowAuthority } from './SharedPlayerEscrowAuthority.js';
import { initializeNativeKitchen } from './NativeKitchenStore.js';
import { initializeNativeCommerce } from './NativeCommerceStore.js';
import { TradeEvidenceStore } from './TradeEvidenceStore.js';
import { PlayerRewardStore } from './PlayerRewardStore.js';
import { recordNativeFoodOpening } from './NativeFoodOpening.js';
import {equalNativeInventoryQuantities,nativeInventoryQuantities} from '../../../../society-integration/native-inventory.js';

/** Private offline bootstrap bridge. It only accepts an empty, unpublished integration staging workspace.
 * Root gateway modules are loaded dynamically to preserve the engine's independent NodeNext build boundary. */
export async function nativeIntegrationBootstrapPorts(workspace: string) {
    const root = resolve(workspace), source = resolve(import.meta.dir, '../../../..');
    const load = (path: string) => import(pathToFileURL(join(source, path)).href);
    const [{ LocalLostCityWorldGenesisAdapter }, { BusinessManagerStore }, { InstitutionTreasuryStore },
        { populationNeedsOptions, populationNeedsBinding }, { AgentStateStore }, { saveValueSnapshot }, { withSocietyValueMutation },
        { parsePlayerSaveBytes }, { initializeRentJournal }, { ProductionWorkInProgressStore, loadDefaultProductionWorkflowCatalog }, { FoodCommerceCoordinator }, { NativeRentCoordinator }, { integrationWorldId }] = await Promise.all([
        load('server/gateway/admin/local-world-genesis-adapter.ts'), load('server/gateway/admin/business-manager.ts'),
        load('server/gateway/admin/institution-treasury.ts'), load('server/gateway/admin/needs-runtime.ts'), load('agent-state/store.ts'),
        load('society-integrity/store.ts'), load('society-integrity/runtime.ts'), load('server/gateway/admin/save-reader.ts'),
        load('housing/native-rent.ts'), load('production-workflow/index.ts'), load('agent-operated-shop/native-commerce-runtime.ts'), load('housing/native-rent-runtime.ts'), load('society-integration/fixture.ts')
    ]);
    let market: MarketStore | undefined;
    const checkpointPath = join(root, 'server/engine/data/player-checkpoints.sqlite');
    const integrityPath = join(root, '.local/simulation/society-integrity.sqlite');
    const playerPath = (name: string) => join(root, 'server/engine/data/players/main', `${name}.sav`);
    let fixture: any, shared: any;
    const stamp = () => {
        const clock = shared.store.get(shared.clockId);
        return { clockId: clock.clockId, profileDigest: clock.profileDigest, simulationTime: clock.lastSimulationTime, wallTime: clock.lastObservedWallTime };
    };
    const boundary = { path: integrityPath, observe: stamp };
    const business = (work: (store: any) => any) => { const store = new BusinessManagerStore(join(root, '.local/economy/businesses.sqlite'), undefined, boundary);
        try { return work(store); } finally { store.close(); } };
    const treasury = (work: (store: any) => any) => { const store = new InstitutionTreasuryStore(join(root, '.local/economy/institution-treasury.sqlite'), boundary);
        try { return work(store); } finally { store.close(); } };
    const snapshot = (name: string) => {
        const bytes = market!.saved(name); if (!bytes || !PlayerLoading.verify(new Packet(bytes))) throw new Error('Native bootstrap checkpoint missing/corrupt');
        const save = parsePlayerSaveBytes(bytes, '2026-10-19T00:00:00.000Z');
        if (!save.valid) throw new Error(`Native bootstrap save unreadable: ${save.error}`);
        return { savedAt: new Date(1_600_000_000_000 + parseInt(foodDigest([...bytes]).slice(0, 8), 16)).toISOString(),
            coins: save.coins, coinPlacement: save.coins === 0 || save.inventory.some((i: any) => i.id === 995) ? 'inventory' : 'bank', skills: save.skills.map((s: any) => ({ name: s.name, experience: s.experience })),
            inventory: nativeInventoryQuantities(save.inventory.filter((i: any) => i.id !== 995).map(({ id, count }: any) => ({ id, count }))),
            equipment: save.equipment.map(({ id, count, slot }: any) => ({ id, count, slot })),
            bank: save.bank.filter((i: any) => i.id !== 995).map(({ id, count }: any) => ({ id, count })), position: save.position };
    };
    return {
        async seedNativeAvatars(target: string, definition: any) {
            if (resolve(target) !== root || !existsSync(join(root, '.integration-stage.json')) || existsSync(checkpointPath)) throw new Error('Native seed requires a new fixture stage');
            fixture = definition; market = new MarketStore(checkpointPath); new NativeFoodConsumptionStore(market); new NativeFoodProductionStore(market.db);
            new NativeTravelFareStore(market.db);
            mkdirSync(join(root, 'server/engine/data/players/main'), { recursive: true });
            for (const avatar of fixture.avatars) {
                const p = new Player(avatar.username, 2n, 2n); p.x = avatar.position.x; p.z = avatar.position.z; p.level = avatar.position.level;
                for (let stat = 0; stat < 21; stat++) p.levels[stat] = p.baseLevels[stat] = 1;
                p.stats[PlayerStat.HITPOINTS] = getExpByLevel(10);
                p.levels[PlayerStat.HITPOINTS] = p.baseLevels[PlayerStat.HITPOINTS] = 10;
                for (const [stat, level] of [[PlayerStat.FISHING, avatar.personalSkills.Fishing], [PlayerStat.COOKING, avatar.personalSkills.Cooking]] as const) {
                    p.stats[stat] = getExpByLevel(level) ?? 0; p.levels[stat] = p.baseLevels[stat] = level;
                }
                const bytes = p.save(false); market.checkpoint(avatar.username, bytes, true); writeFileSync(playerPath(avatar.username), bytes, { flag: 'wx' });
            }
        },
        genesis(_target: string, definition: any, clock: any) {
            fixture = definition; shared = { store: clock, clockId: fixture.clock.clockId };
            const catalog = loadPropertyCatalog(join(root, 'config/properties.json')), propertyPath = join(root, '.local/admin/properties.sqlite');
            const properties = (work: (store: PropertyStore) => any) => { const store = new PropertyStore(catalog, propertyPath, fixture.clock.initialSimulationTime);
                try { return work(store); } finally { store.close(); } };
            const dependencies = {
                async inspectPlayer(name: string) { return { readiness: { editable: true, code: 'ready' }, state: snapshot(name), backups: [] }; },
                async editPlayer(name: string, draft: any, commandId: string) {
                    const before = snapshot(name), original = market!.saved(name)!;
                    if (before.savedAt !== draft.expectedSavedAt) throw new Error('Native bootstrap checkpoint changed');
                    const p = PlayerLoading.load(name, new Packet(original), null);
                    // PlayerLoading prefers the enrolled canonical checkpoint. Preserve
                    // the before image before publishing the new checkpoint below.
                    const originalPlayer = PlayerLoading.load(name, new Packet(original), null);
                    // This is an additive genesis allocation over a fresh empty save, never a general editor/refill endpoint.
                    if (before.coins || before.inventory.length || before.bank.length || before.equipment.length) throw new Error('Native genesis target is not empty');
                    for (const [container, items] of [[InvType.INV, draft.inventory], [InvType.getId('bank'), draft.bank], [InvType.WORN, draft.equipment]] as const)
                        for (const item of items) if (p.invAdd(container, item.id, item.count) !== item.count) throw new Error('Native genesis item capacity differs');
                    if (draft.coins && p.invAdd(draft.coinPlacement === 'inventory' ? InvType.INV : InvType.getId('bank'), 995, draft.coins) !== draft.coins) throw new Error('Native genesis GP capacity differs');
                    const bytes = p.save(false);
                    const planned = { ...draft, position: before.position, equipment: draft.equipment ?? [] };
                    const mutation = { source: 'engine.offline-save' as const, operationId: `offline-save:${commandId}`, actor: `player:${name}`,
                        payload: { before: saveValueSnapshot(before), after: saveValueSnapshot(planned) } };
                    withSocietyValueMutation(mutation, () => market!.checkpoint(name, bytes, true), boundary);
                    const agents = new AgentStateStore(join(root, '.local/agent-state/agents.sqlite'), shared);
                    let binding: any; try { binding = populationNeedsBinding(integrationWorldId(fixture), agents.getPopulationMember(name)); } finally { agents.close(); }
                    recordNativeFoodOpening(mutation, originalPlayer, p, bytes, {
                        market: market!, integrityPath, identity: (username, actionId, slot) => ({ action: { actionId, username, actorId: name, lifecycleId: binding.lifecycleId,
                            worldId: binding.worldId, clockId: binding.clockId, clockProfileDigest: binding.clockProfileDigest, itemId: 379, quantity: 1, slot, policyDigest: foodDigest(FOOD_POLICY) },
                            clock: { ...stamp(), wallTime: stamp().wallTime, status: 'paused', revision: 1, engineTick: 0 } }) });
                    writeFileSync(playerPath(name), bytes);
                    const after = snapshot(name);
                    for (const key of ['coins', 'coinPlacement', 'skills', 'inventory', 'bank', 'equipment', 'position'] as const)
                        if (!(key==='inventory'?equalNativeInventoryQuantities(after[key],planned[key]):isDeepStrictEqual(after[key], planned[key]))) throw new Error(`Native bootstrap roundtrip differs: ${key}`);
                    return { ok: true, commandId, username: name, operation: 'edit', backupId: foodDigest([...original]), before, after };
                },
                async listProperties() { return { enabled: true, pendingPurchases: [], properties: properties(store => store.listProperties()).map((state: any) => ({
                    ...catalog.properties.find(p => p.propertyId === state.propertyId), state })) }; },
                async assignProperty(request: any) { return { ok: true, commandId: request.commandId, tick: 0,
                    assignment: properties(store => store.assignGenesis(request.allocationId, request.propertyId, request.expectedVersion, request.owner, fixture.clock.initialSimulationTime)) }; },
                async resetProperty() { throw new Error('Unpublished fixture rollback discards the entire stage; no live reset'); },
                getBusiness: (id: string) => business(s => s.get(id)), getBusinessInventory: (id: string) => business(s => s.listInventory(id)),
                createBusiness: (id: string, input: any, now: string) => business(s => s.createGenesis(id, input, now)), resetBusiness: (id: string, now: string) => business(s => s.resetGenesisBusiness(id, now)),
                creditBusinessItem: (id: string, owner: string, item: number, count: number, now: string) => business(s => s.creditGenesisInventory(id, owner, item, count, now)),
                resetBusinessItem: (id: string, now: string) => business(s => s.resetGenesisInventory(id, now)),
                getTreasury: (kind: string, id: string) => treasury(s => s.get(kind, id)), creditTreasury: (kind: string, owner: string, id: string, amount: number, now: string) => treasury(s => s.creditGenesis(kind, owner, id, amount, now)),
                resetTreasury: (id: string, now: string) => treasury(s => s.resetGenesis(id, now))
            };
            return new LocalLostCityWorldGenesisAdapter(dependencies, { agentPath: join(root, '.local/agent-state/agents.sqlite'), simulationClock: shared,
                profileCatalogPath: join(root, 'config/world-genesis-profiles.json'), policyCatalogPath: join(root, 'config/population-lifecycle-policies.json'),
                bindingCatalogPath: join(root, 'config/population-world-profile-bindings.json'), integrityDbPath: integrityPath,
                needs: { ...populationNeedsOptions(root), worldId: integrationWorldId(fixture) } });
        },
        async closeNativeBaseline(_target: string, definition: any, clock: any) {
            const row = clock.get(definition.clock.clockId);
            openSharedPlayerEscrowAuthority(join(root, 'server/engine/data/mods/player-inventory-escrow.sqlite'), checkpointPath, () => market!, definition.clock.initialSimulationTime);
            initializeNativeKitchen(market!.db); initializeNativeCommerce(market!.db); initializeRentJournal(market!.db, 'native_rent');
            closeFoodDeliveryTick(market!.db, { clockId: row.clockId, profileDigest: row.profileDigest, simulationTime: row.lastSimulationTime,
                wallTime: row.lastObservedWallTime, status: 'paused', revision: row.revision, engineTick: 0 });
            const trades = new TradeEvidenceStore(join(root, 'server/engine/data/mods/trade-evidence.sqlite')); trades.close();
            const rewards = new PlayerRewardStore(join(root, 'server/engine/data/mods/player-action-rewards.sqlite'), false); rewards.close();
            const wip = new ProductionWorkInProgressStore(join(root, '.local/economy/businesses.sqlite'), loadDefaultProductionWorkflowCatalog(), undefined, false); wip.close();
            const commerce = new FoodCommerceCoordinator({ workspace: root, worldId: integrationWorldId(definition), businessPath: join(root, '.local/economy/businesses.sqlite'),
                treasuryPath: join(root, '.local/economy/institution-treasury.sqlite'), checkpointPath, tradePath: join(root, 'server/engine/data/mods/trade-evidence.sqlite'), journalPath: join(root, '.local/economy/food-commerce.sqlite') }); commerce.close();
            const housing = new NativeRentCoordinator({ workspace: root, worldId: integrationWorldId(definition), housingPath: join(root, '.local/economy/housing.sqlite'),
                propertyPath: join(root, '.local/admin/properties.sqlite'), checkpointPath }); housing.close();
            market!.db.close(true); market = undefined;
        },
        close() { market?.db.close(true); market = undefined; }
    };
}
