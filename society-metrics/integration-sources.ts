import type { Database } from 'bun:sqlite';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { assertNativeFoodPath, assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { foodDigest, readFoodResult, assertFoodSchema, type FoodAction } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { NeedsStore, type DurableNeedsState } from '../needs/store.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../needs/config.js';
import { validateNeedsState } from '../needs/profile.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { playerTimeHistoryDigest } from '../simulation-clock/store.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION, type PlayerTimeHistoryEntry } from '../simulation-clock/types.js';
import { readPopulationFoodApplications, readPopulationFoodLineage, populationNeedsOptions,
    openPopulationFoodSource, type PopulationNeedsOptions } from '../server/gateway/admin/needs-runtime.js';
import { assertFoodProductionSchema, readFoodProductionReceipt } from '../server/engine/src/mods/NativeFoodProductionStore.js';
import { readNativeKitchen } from '../server/engine/src/mods/NativeKitchenStore.js';
import { readNativeCommerce } from '../server/engine/src/mods/NativeCommerceStore.js';
import { readNativeKitchenWip } from '../production-workflow/native-kitchen-wip.js';
import { readFoodCommerce } from '../agent-operated-shop/native-commerce.js';
import { readRentJournal, type NativeRentOrder, type NativeRentReceipt } from '../housing/native-rent.js';
import { readWorkBindings } from '../business-work/binding.js';
import { readNativeRentReceipt } from '../housing/native-rent-source.js';
import { PlayerInventoryEscrowStore } from '../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { readNativeTrades } from '../external-trade/source.js';
import type { EvaluationScope } from './evaluation.js';
import { parsePlayerSaveBytes } from '../server/gateway/admin/save-reader.js';
import { readFoodDeliveries } from '../server/engine/src/mods/NativeFoodDeliveryStore.js';
import { NativeFoodConsumptionProjection } from '../food-loop/native-consumption-store.js';
import { loadFoodLoopCatalog } from '../food-loop/catalog.js';
import { readNativeTravelFares } from '../server/engine/src/mods/NativeTravelFareStore.js';
import { readNativeFoodBoundary,loadFoodBoundaryInputs,type NativeFoodBoundaryPaths } from './food-boundaries.js';
import { readHousingAccessPoint,loadHousingBoundaryInputs,type NativeHousingBoundaryPaths } from './housing-access.js';
import { readNativeToolCapacityBoundary } from './tool-capacity.js';

export interface NativeWealthPaths { checkpointPath: string; businessPath: string; treasuryPath: string; clockPath: string; needsPath: string }

/** Backend-selected paths only. No request parameter or supplied observation can select a source. */
export interface NativeIntegrationOptions extends PopulationNeedsOptions {
    clockPath: string; businessPath: string; housingPath: string; treasuryPath: string; rewardsPath: string;
    /** Optional frozen native database sets selected by the backend, never a report JSON upload. */
    openingBoundary?: NativeWealthPaths; closingBoundary?: NativeWealthPaths;
    /** Explicit frozen snapshots only; no inferred/current-state boundary or HTTP-supplied path. */
    foodBoundaries?:Array<{at:string;paths:NativeFoodBoundaryPaths}>;
    housingBoundaries?:Array<{at:string;paths:NativeHousingBoundaryPaths}>;
    toolBoundaries?:Array<{at:string;paths:NativeFoodBoundaryPaths}>;
}
export function nativeIntegrationOptions(workspace: string): NativeIntegrationOptions {
    return { ...populationNeedsOptions(workspace), clockPath: join(workspace, '.local/simulation/simulation-clock.sqlite'),
        businessPath: join(workspace, '.local/economy/businesses.sqlite'), housingPath: join(workspace, '.local/economy/housing.sqlite'),
        treasuryPath: join(workspace, '.local/economy/institution-treasury.sqlite'),
        rewardsPath: join(workspace, 'server/engine/data/mods/player-action-rewards.sqlite') };
}
export type NativeObservation<T> = { status: 'available'; value: T; digest: string }
    | { status: 'unavailable' | 'invalid'; reason: string };
const MAX_ROWS = 100_000;
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function capture<T>(read: () => T): NativeObservation<T> {
    try { const value = read(); return { status: 'available', value, digest: digest(value) }; }
    catch (error) { return { status: error instanceof AbsentSource ? 'unavailable' : 'invalid',
        reason: error instanceof Error ? error.message : 'Invalid native source' }; }
}
class AbsentSource extends Error {}
/** Bounded before invoking the existing audit readers, including their otherwise unbounded history queries. */
function database<T>(options: NativeIntegrationOptions, path: string, tables: string[], read: (db: Database) => T): T {
    const domainRelative = relative(resolve(options.workspace, '.local'), resolve(path));
    if (domainRelative && !domainRelative.startsWith('..')) assertNativeFoodDomainPath({ ...options, checkpointPath: path });
    else assertNativeFoodPath({ ...options, checkpointPath: path });
    if (!existsSync(path)) throw new AbsentSource('Native database absent; no database or history created');
    const db = new OwnedDatabase(path, { readonly: true, strict: true });
    try { let result!: T; db.transaction(() => {
        for (const table of tables) {
            check(/^[a-z_]+$/.test(table), 'Invalid internal table name');
            if (!db.query('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?1').get(table))
                throw new AbsentSource(`Native channel not initialized: ${table}`);
            check((db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n <= MAX_ROWS,
                `Native source exceeds row limit: ${table}; no truncated success`);
        }
        result = read(db);
    }).deferred(); return result; } finally { db.close(true); }
}
export interface NativeAssetLocation { location: string; owner: string; itemId: number; count: string; evidence: unknown }
function readWealth(options: NativeIntegrationOptions, paths: NativeWealthPaths) {
    const assets: NativeAssetLocation[] = [];
    const playerVitals:Array<{username:string;currentHitpoints:number|null}>=[];
    const pendingEffects: string[] = [];
    const add = (location: string, owner: string, itemId: number, count: number, evidence: unknown) => {
        check(Number.isSafeInteger(count) && count >= 0 && Number.isSafeInteger(itemId) && itemId >= 0 && itemId <= 65535,
            'Invalid native asset quantity');
        assets.push({ location, owner, itemId, count: String(count), evidence });
    };
    const players = database(options, paths.checkpointPath, ['accounts', 'player_inventory_escrow', 'player_inventory_escrow_audit'], db => {
        const players = db.query('SELECT owner,save FROM accounts ORDER BY owner').all() as { owner: string; save: Uint8Array }[];
        for (const player of players) {
            const save = parsePlayerSaveBytes(player.save, '1970-01-01T00:00:00.000Z', true,true), checkpointDigest = digest([...player.save]);
            check(save.valid, `Invalid canonical player checkpoint: ${player.owner}`);
            playerVitals.push({username:player.owner,currentHitpoints:save.currentHitpoints??null});
            for (const container of ['inventory', 'equipment', 'bank'] as const) for (const item of save[container])
                add(`player-${container}`, player.owner, item.id, item.count, { checkpointDigest, container, slot: item.slot });
        }
        const escrow = new PlayerInventoryEscrowStore({ db, checkpoint: () => { throw new Error('Readonly assets'); } }, true);
        const held = (db.query('SELECT escrow_id FROM player_inventory_escrow ORDER BY escrow_id').all() as { escrow_id: string }[]).map(row => escrow.get(row.escrow_id)!);
        check(held.every(row => !['settling', 'reconcile', 'releasing'].includes(row.status)), 'Uncertain physical custody prevents a wealth boundary');
        for (const row of held.filter(row => row.status === 'held')) {
            add('native-escrow', row.username, 995, row.assets.gp, row);
            for (const item of row.assets.items) add('native-escrow', row.username, item.id, item.count, row);
        }
        const kitchens = db.query("SELECT 1 FROM sqlite_master WHERE name='native_kitchen_schema'").get() ? readNativeKitchen(db) : [];
        const commerces = db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_commerce_schema'").get() ? readNativeCommerce(db) : [];
        return { owners: players.map(row => row.owner), nativeRuns: kitchens.map(row => row.binding.intent.runId), kitchens, commerces };
    });
    database(options, paths.businessPath, ['business_inventory', 'business_storage_item', 'business_production_material'], db => {
        const inventory = db.query('SELECT * FROM business_inventory ORDER BY business_id,item_id').all() as any[];
        for (const row of inventory) add('business-inventory', row.business_id, row.item_id, row.count, row);
        for (const row of db.query('SELECT * FROM business_storage_item ORDER BY storage_id,item_id').all() as any[])
            add('business-storage', row.storage_id, row.item_id, row.count, row);
        // Before native issue a WIP reservation is the actual location; afterwards it is a mirror of escrow/consumption.
        for (const row of db.query('SELECT * FROM business_production_material ORDER BY material_id').all() as any[])
            if (!players.nativeRuns.includes(row.run_id)) add('unissued-wip', row.run_id, row.item_id, row.count, row);
        const wips = players.kitchens.length ? readNativeKitchenWip(db) : [];
        for (const native of players.kitchens) {
            const domain = wips.find(row => row.binding.intent.runId === native.binding.intent.runId);
            const expected = native.phase === 'returned-output' ? native.receipt?.outcome === 'cooked' ? 'completed' : 'burnt'
                : native.phase === 'returned-input' ? 'cancelled' : 'prepared';
            if (!domain || domain.phase !== expected || foodDigest(domain.binding) !== foodDigest(native.binding)
                || expected !== 'prepared' && domain.nativeDigest !== native.digest) pendingEffects.push(`kitchen:${native.binding.intent.runId}`);
        }
        const orders = players.commerces.length ? readFoodCommerce(db) : [];
        for (const native of players.commerces) {
            const domain = orders.find(row => row.binding.intent.operationId === native.binding.intent.operationId);
            if (!domain || foodDigest(domain.binding) !== foodDigest(native.binding) || domain.phase !== (native.phase === 'admitted' ? 'prepared' : native.phase)
                || native.phase !== 'admitted' && domain.nativeDigest !== native.digest) pendingEffects.push(`commerce:${native.binding.intent.operationId}`);
        }
    });
    database(options, paths.treasuryPath, ['institution_treasury', 'institution_treasury_reservation'], db => {
        for (const row of db.query('SELECT * FROM institution_treasury ORDER BY actor_kind,actor_id').all() as any[]) {
            check(Number.isSafeInteger(row.reserved_gp) && row.reserved_gp >= 0 && row.reserved_gp <= row.balance_gp, 'Invalid reserved treasury GP');
            // Reserved GP is included in the treasury balance, never an additional asset.
            add('institution-treasury', `${row.actor_kind}:${row.actor_id}`, 995, row.balance_gp, row);
        }
    });
    return { assets, playerUsernames: players.owners, pendingEffects,playerVitals };
}
export function readWealthBoundary(scope: EvaluationScope, options: NativeIntegrationOptions, paths: NativeWealthPaths | undefined, at: string) {
    if (!paths) throw new AbsentSource('Frozen native boundary databases not configured');
    const clock = database(options, paths.clockPath, ['simulation_clock'], db => {
        check((db.query('PRAGMA user_version').get() as { user_version: number }).user_version === SIMULATION_CLOCK_STORE_SCHEMA_VERSION, 'Unsupported boundary clock schema');
        const row = db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(scope.clockId) as any;
        check(row && row.profile_digest === scope.clockProfileDigest && row.last_simulation_ms === Date.parse(at) && row.status === 'paused',
            'Frozen wealth boundary must carry the exact paused simulation clock/profile');
        check(simulationClockProfileDigest(JSON.parse(row.profile_json)) === row.profile_digest, 'Boundary clock profile digest differs'); return row;
    });
    const cohort = database(options, paths.needsPath, ['needs_schema', 'needs_state', 'needs_event'], db => {
        const policy = loadNeedsPolicyCatalog(join(options.configDirectory, 'needs-policies.json')).policies[0]!;
        const dynamics = loadNeedsDynamicsPolicyCatalog(join(options.configDirectory, 'needs-dynamics-policies.json'), policy).policies[0]!;
        const store = new NeedsStore(db, policy, dynamics, { readonly: true });
        const rows = (db.query('SELECT snapshot_json FROM needs_state ORDER BY state_key').all() as { snapshot_json: string }[])
            .map(row => JSON.parse(row.snapshot_json) as DurableNeedsState);
        return scope.actorAgentIds.map(id => {
            const matches = rows.filter(row => row.binding.actorId === id);
            check(matches.length === 1, 'Frozen boundary omits or duplicates an actor');
            const row = store.get(matches[0]!.binding)!;
            check(row.binding.worldId === options.worldId && row.binding.clockId === scope.clockId && row.binding.clockProfileDigest === scope.clockProfileDigest
                && row.state.observedAtSimulationTime === at, 'Frozen boundary needs world/time/profile differs'); return row;
        });
    });
    const delivery = database(options, paths.checkpointPath, ['native_food_actions', 'native_food_delivery'], db => { assertFoodSchema(db); return readFoodDeliveries(db); });
    check(delivery.watermark?.clock.simulationTime === at && delivery.watermark.clock.clockId === scope.clockId
        && delivery.watermark.clock.profileDigest === scope.clockProfileDigest, 'Frozen boundary needs an exact native closed-tick watermark');
    database(options, paths.needsPath, ['native_food_consumption_event', 'native_food_receipt_use'], db => {
        const policy = loadNeedsPolicyCatalog(join(options.configDirectory, 'needs-policies.json')).policies[0]!;
        const dynamics = loadNeedsDynamicsPolicyCatalog(join(options.configDirectory, 'needs-dynamics-policies.json'), policy).policies[0]!;
        const needs = new NeedsStore(db, policy, dynamics, { readonly: true });
        const applications = new NativeFoodConsumptionProjection(db, needs, loadFoodLoopCatalog(join(options.configDirectory, 'food-loops.json')), true).list();
        check(applications.length === delivery.entries.length && applications.every((app, index) => app.sourceId === delivery.sourceId
            && app.actionId === delivery.entries[index]!.actionId && app.sourceDigest === delivery.entries[index]!.digest),
            'Frozen boundary contains unapplied/replaced native food receipts');
        for (const app of applications.filter(app => app.quantity === 1)) {
            check(foodDigest(needs.atRevision(app.binding, app.needsRevision!).state) === foodDigest(app.needsAfter)
                && foodDigest(needs.atRevision(app.binding, app.needsRevision! - 1).state) === foodDigest(app.needsBefore), 'Frozen boundary physiological receipt binding differs');
        }
    });
    const wealth = readWealth(options, paths);
    check(wealth.pendingEffects.length === 0, 'Native/Business transfer projections are pending; no closed historical wealth boundary');
    check(cohort.every(row => wealth.playerUsernames.includes(row.binding.playerId)), 'Frozen boundary missing a selected canonical player save');
    return { simulationTime: at, clock, cohort, ...wealth };
}
export function collectNativeIntegrationSources(scope: EvaluationScope, options: NativeIntegrationOptions) {
    // Resolve exactly one checkpoint authority using the same rule as physiological application.
    const authority = capture(() => { const source = openPopulationFoodSource(options);
        try { return source.options.checkpointPath; } finally { source.close(); } });
    const checkpoint = <T>(tables: string[], read: (db: Database) => T): NativeObservation<T> => authority.status === 'available'
        ? capture(() => database(options, authority.value, tables, read)) : authority;
    const policies = () => { const policy = loadNeedsPolicyCatalog(join(options.configDirectory, 'needs-policies.json')).policies[0]!;
        return { policy, dynamics: loadNeedsDynamicsPolicyCatalog(join(options.configDirectory, 'needs-dynamics-policies.json'), policy).policies[0]! }; };
    const needs = capture(() => database(options, options.databasePath, ['needs_schema', 'needs_state', 'needs_event'], db => {
        const { policy, dynamics } = policies(), store = new NeedsStore(db, policy, dynamics, { readonly: true });
        const rows = db.query('SELECT state_key,snapshot_json FROM needs_state ORDER BY state_key').all() as { state_key: string; snapshot_json: string }[];
        const histories = rows.map(row => {
            const candidate = JSON.parse(row.snapshot_json) as DurableNeedsState, b = candidate.binding;
            check(b.worldId === options.worldId, 'Needs source belongs to another world');
            const current = store.get(b); check(current, 'Needs source missing current state');
            const history = (db.query('SELECT snapshot_json FROM needs_event WHERE state_key=?1 ORDER BY revision').all(row.state_key) as { snapshot_json: string }[])
                .map(row => JSON.parse(row.snapshot_json) as DurableNeedsState);
            check(history.every(state => digest(state.binding) === digest(b) && state.policyDigest === policy.digest && state.dynamicsDigest === dynamics.digest),
                'Historical needs binding/policy differs');
            for (const state of history) { const { digest: hash, ...body } = state.state;
                check(validateNeedsState(body, policy).digest === hash, 'Historical needs state digest differs'); }
            return { binding: b, current, history };
        });
        return { policy, dynamics, histories };
    }));
    const foodCatalog=capture(()=>loadFoodLoopCatalog(join(options.configDirectory,'food-loops.json')));
    const modes = capture(() => database(options, options.clockPath,
        ['simulation_clock', 'simulation_player_time_history', 'simulation_player_time_state'], db => {
            check((db.query('PRAGMA user_version').get() as { user_version: number }).user_version === SIMULATION_CLOCK_STORE_SCHEMA_VERSION,
                'Unsupported simulation clock schema');
            const clock = db.query('SELECT * FROM simulation_clock WHERE clock_id=?1').get(scope.clockId) as
                { clock_id: string; profile_digest: string; profile_json: string; last_simulation_ms: number; revision: number } | null;
            check(clock && clock.profile_digest === scope.clockProfileDigest, 'Simulation clock/profile mismatch');
            check(simulationClockProfileDigest(JSON.parse(clock.profile_json)) === clock.profile_digest, 'Simulation clock profile digest differs');
            const histories = new Map<string, PlayerTimeHistoryEntry[]>();
            const rows = db.query('SELECT entry_json FROM simulation_player_time_history WHERE clock_id=?1 ORDER BY player_id,revision').all(scope.clockId) as { entry_json: string }[];
            for (const row of rows) {
                const entry = JSON.parse(row.entry_json) as PlayerTimeHistoryEntry, { digest: hash, ...body } = entry;
                const history = histories.get(entry.state.playerId) ?? [], previous = history.at(-1);
                check(hash === playerTimeHistoryDigest(body) && entry.previousDigest === (previous?.digest ?? null)
                    && entry.state.clockId === scope.clockId && entry.profileDigest === scope.clockProfileDigest
                    && (!previous || entry.state.revision === previous.state.revision + 1 && entry.state.updatedAt >= previous.state.updatedAt)
                    && ['online', 'offline'].includes(entry.state.presence) && ['awake', 'sleeping'].includes(entry.state.rest), 'Player-time audit/profile differs');
                check(Number.isSafeInteger(Date.parse(entry.state.updatedAt)) && new Date(entry.state.updatedAt).toISOString() === entry.state.updatedAt,
                    'Invalid player-time boundary');
                history.push(entry); histories.set(entry.state.playerId, history);
            }
            const current = db.query('SELECT * FROM simulation_player_time_state WHERE clock_id=?1 ORDER BY player_id').all(scope.clockId) as any[];
            check(current.length === histories.size && current.every(row => {
                const tip = histories.get(row.player_id)?.at(-1)?.state;
                return tip && tip.revision === row.revision && tip.updatedAt === row.updated_at && tip.updatedWallTime === row.updated_wall_time
                    && tip.presence === row.presence && tip.rest === row.rest
                    && (tip.sleepContext?.access.sourceDigest ?? null) === row.sleep_access_source_digest;
            }), 'Player-time history missing or truncated');
            return { clock, histories: [...histories].map(([playerId, history]) => ({ playerId, history })) };
        }));
    const nutrition = capture(() => database(options, options.databasePath,
        ['native_food_consumption_event', 'native_food_receipt_use', 'needs_event'], () => {
            if (authority.status !== 'available') throw new AbsentSource('Native checkpoint authority unavailable');
            return database(options, authority.value, ['native_food_actions', 'native_food_delivery'], () => {
                const result = readPopulationFoodApplications(options);
                if (result.status !== 'available') throw new AbsentSource('Native physiological applications unavailable'); return result;
            });
        }));
    const lineage = capture(() => {
        if (authority.status !== 'available' || nutrition.status !== 'available') throw new AbsentSource('Native physiological source unavailable');
        return database(options, authority.value, ['native_food_lineage'], () => {
            const result = readPopulationFoodLineage(options);
            if (result.status !== 'available') throw new AbsentSource('Native food origin source unavailable'); return result;
        });
    });
    const production = checkpoint(['native_food_production_schema', 'native_food_production_actions'], db => {
        assertFoodProductionSchema(db);
        return (db.query('SELECT action_id FROM native_food_production_actions ORDER BY action_id').all() as { action_id: string }[])
            .map(row => ({ actionId: row.action_id, receipt: readFoodProductionReceipt(db, row.action_id) }));
    });
    const fares = checkpoint(['native_travel_fare_schema', 'native_travel_fare', 'native_travel_fare_head'], readNativeTravelFares);
    const consumption = checkpoint(['native_food_actions', 'native_food_delivery'], db =>
        (db.query('SELECT action_id,action_json FROM native_food_actions ORDER BY action_id').all() as { action_id: string; action_json: string }[])
            .map(row => ({ action: JSON.parse(row.action_json) as FoodAction, result: readFoodResult(db, row.action_id) })));
    const kitchen = checkpoint(['native_kitchen_schema', 'native_kitchen_operation', 'native_kitchen_audit'], readNativeKitchen);
    const commerce = checkpoint(['native_food_commerce_schema', 'native_food_commerce_operation', 'native_food_commerce_audit'], readNativeCommerce);
    const rent = checkpoint(['native_rent_schema', 'native_rent_operation', 'native_rent_audit'], db =>
        readRentJournal<NativeRentReceipt>(db, 'native_rent').map(row => readNativeRentReceipt(db, row.binding)!));
    const custody = checkpoint(['player_inventory_escrow', 'player_inventory_escrow_audit'], db => {
        const store = new PlayerInventoryEscrowStore({ db, checkpoint: () => { throw new Error('Readonly metrics source'); } }, true);
        return (db.query('SELECT escrow_id FROM player_inventory_escrow ORDER BY escrow_id').all() as { escrow_id: string }[]).map(row => store.get(row.escrow_id)!);
    });
    const sleep = checkpoint(['native_housing_sleep', 'native_housing_sleep_head'], db => {
        let previous: string | null = null;
        const rows = db.query('SELECT * FROM native_housing_sleep ORDER BY sequence').all() as {
            sequence: number; witness_id: string; json: string; previous_hash: string | null; hash: string }[];
        const witnesses = rows.map((row, index) => {
            const { hash, ...body } = row;
            check(row.sequence === index + 1 && row.previous_hash === previous && foodDigest(body) === hash, 'Native sleep witness audit differs');
            previous = hash;
            const witness = JSON.parse(row.json) as { id: string; operationId: string; bindingDigest: string; username: string; lifecycleId: string;
                x: number; z: number; level: number; clock: { clockId: string; profileDigest: string; simulationTime: string }; checkpointDigest: string };
            check(witness.id === row.witness_id, 'Native sleep witness identity differs'); return witness;
        });
        const head = db.query('SELECT * FROM native_housing_sleep_head WHERE id=1').get() as { sequence: number; hash: string | null } | null;
        check(head && head.sequence === rows.length && head.hash === previous, 'Native sleep witness tail missing or truncated');
        return witnesses;
    });
    const journalHeads = checkpoint([], db => Object.fromEntries([
        'native_food_delivery_head', 'native_food_lineage_head', 'native_kitchen_head', 'native_food_commerce_head', 'native_rent_head', 'native_housing_sleep_head',
        'native_travel_fare_head'
    ].map(table => [table, db.query('SELECT 1 FROM sqlite_master WHERE name=?1').get(table) ? db.query(`SELECT * FROM ${table}`).all() : null])));
    const wip = capture(() => database(options, options.businessPath,
        ['business_production_native_schema', 'business_production_native_operation', 'business_production_native_audit'], readNativeKitchenWip));
    const commerceOrders = capture(() => database(options, options.businessPath,
        ['business_food_commerce_schema', 'business_food_commerce_order', 'business_food_commerce_audit'], readFoodCommerce));
    const rentalOrders = capture(() => database(options, options.housingPath,
        ['housing_native_schema', 'housing_native_operation', 'housing_native_audit'], db => readRentJournal<NativeRentOrder>(db, 'housing_native')));
    const work = capture(() => database(options, options.businessPath,
        ['business_work_order', 'business_work_binding', 'business_work_binding_audit'], db => readWorkBindings(db).map(binding => ({ binding,
            order: db.query('SELECT * FROM business_work_order WHERE work_order_id=?1').get(binding.workOrderId) as Record<string, unknown> }))));
    const treasury = capture(() => database(options, options.treasuryPath,
        ['institution_treasury', 'institution_treasury_reservation'], db => ({
            accounts: db.query('SELECT * FROM institution_treasury ORDER BY actor_kind,actor_id').all(),
            reservations: db.query('SELECT * FROM institution_treasury_reservation ORDER BY reservation_id').all() as any[] })));
    const rewards = capture(() => database(options, options.rewardsPath, ['player_action_reward'], db =>
        db.query('SELECT * FROM player_action_reward ORDER BY settlement_id').all() as any[]));
    const tradePath = options.nativeFoodTradePath ?? join(options.workspace, 'server/engine/data/mods/trade-evidence.sqlite');
    const trades = capture(() => database(options, tradePath, ['engine_trade_evidence', 'engine_trade_evidence_audit'], () =>
        readNativeTrades(tradePath, options.clockPath, scope.clockId)));
    const currentAssets = authority.status === 'available' ? capture(() => readWealth(options, { checkpointPath: authority.value,
        businessPath: options.businessPath, treasuryPath: options.treasuryPath, clockPath: options.clockPath, needsPath: options.databasePath })) : authority;
    const openingAssets = capture(() => readWealthBoundary(scope, options, options.openingBoundary, scope.fromSimulationTime));
    const closingAssets = capture(() => readWealthBoundary(scope, options, options.closingBoundary, scope.toSimulationTime));
    // Collection-local reuse only. The facade still recollects independently to reject moving sources.
    const wealthCache=new Map<string,ReturnType<typeof readWealthBoundary>>();
    const physicalCache=new Map<string,ReturnType<typeof readNativeFoodBoundary>>();
    const boundaryInputs=capture(()=>loadFoodBoundaryInputs(options.configDirectory));
    const housingInputs=capture(()=>{check(boundaryInputs.status==='available','Boundary policies unavailable');return loadHousingBoundaryInputs(options,boundaryInputs.value.contract);});
    const frozenWealth=(at:string,paths:NativeFoodBoundaryPaths)=>{
        const key=digest({at,paths});let value=wealthCache.get(key);
        if(!value){value=readWealthBoundary(scope,options,paths,at);wealthCache.set(key,value);}return value;
    };
    const frozenPhysical=(at:string,paths:NativeFoodBoundaryPaths)=>{
        check(boundaryInputs.status==='available','Boundary policies unavailable');
        const key=digest({at,paths});let value=physicalCache.get(key);
        if(!value){value=readNativeFoodBoundary(scope,options,paths,frozenWealth(at,paths),boundaryInputs.value);physicalCache.set(key,value);}return value;
    };
    const foodBoundaries=capture(()=>{
        if(!options.foodBoundaries?.length)throw new AbsentSource('Frozen native food boundaries not configured');
        check(options.foodBoundaries.length<=1000&&new Set(options.foodBoundaries.map(b=>b.at)).size===options.foodBoundaries.length,'Invalid food boundary inventory');
        return{boundaries:options.foodBoundaries.map(b=>({at:b.at,source:capture(()=>{
            try{
                check(new Date(b.at).toISOString()===b.at&&b.at>=scope.fromSimulationTime&&b.at<=scope.toSimulationTime,'Food boundary outside scope');
                return frozenPhysical(b.at,b.paths);
            }catch{throw new Error('Native food boundary validation failed');}
        })}))};
    });
    const housingAccess=capture(()=>{
        if(!options.housingBoundaries?.length)throw new AbsentSource('Frozen housing access points not configured');
        check(options.housingBoundaries.length<=1000&&new Set(options.housingBoundaries.map(p=>p.at)).size===options.housingBoundaries.length,'Invalid housing point inventory');
        check(options.housingBoundaries.every(p=>new Date(p.at).toISOString()===p.at&&p.at>=scope.fromSimulationTime&&p.at<=scope.toSimulationTime),'Housing inventory outside scope');
        return{points:options.housingBoundaries.map(p=>({at:p.at,source:capture(()=>{
            try{check(new Date(p.at).toISOString()===p.at&&p.at>=scope.fromSimulationTime&&p.at<=scope.toSimulationTime,'Housing point outside scope');
                check(housingInputs.status==='available','Housing policies unavailable');return readHousingAccessPoint(scope,options,p.paths,p.at,housingInputs.value);
            }catch{throw new Error('Native housing point validation failed');}
        })}))};
    });
    const toolBoundaries=capture(()=>{
        if(!options.toolBoundaries?.length)throw new AbsentSource('Frozen native tool boundaries not configured');
        check(options.toolBoundaries.length<=1000&&new Set(options.toolBoundaries.map(b=>b.at)).size===options.toolBoundaries.length,'Invalid tool boundary inventory');
        check(options.toolBoundaries.every(b=>new Date(b.at).toISOString()===b.at&&b.at>=scope.fromSimulationTime&&b.at<=scope.toSimulationTime),'Tool boundary outside scope');
        return{boundaries:options.toolBoundaries.map(b=>({at:b.at,source:capture(()=>{
            try{check(boundaryInputs.status==='available','Boundary policies unavailable');return readNativeToolCapacityBoundary(scope,options,b.paths,frozenWealth(b.at,b.paths),
                {contract:boundaryInputs.value.contract,physical:frozenPhysical(b.at,b.paths)});}
            catch{throw Error('Native tool boundary validation failed');}
        })}))};
    });
    const wealthBoundaries=capture(()=>{
        if(!options.foodBoundaries?.length)throw new AbsentSource('Frozen custody inventory not configured');
        check(options.foodBoundaries.length<=1000,'Custody boundary budget exceeded');
        return{boundaries:options.foodBoundaries.map(b=>({at:b.at,source:capture(()=>{
            check(new Date(b.at).toISOString()===b.at&&b.at>=scope.fromSimulationTime&&b.at<=scope.toSimulationTime,'Custody boundary outside scope');
            return frozenWealth(b.at,b.paths);
        })}))};
    });
    return { needs, modes, nutrition, lineage,foodCatalog, production, kitchen, commerce, rent, custody, wip, commerceOrders, rentalOrders, work, treasury, rewards, trades,wealthBoundaries,
        currentAssets, openingAssets, closingAssets,foodBoundaries,housingAccess,toolBoundaries, sleep, journalHeads, consumption, fares };
}
export type NativeIntegrationSources = ReturnType<typeof collectNativeIntegrationSources>;
