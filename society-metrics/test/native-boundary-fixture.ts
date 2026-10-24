import { afterEach, expect, test } from 'bun:test';
import { OwnedDatabase as Database } from '../../server/engine/src/io/OwnedDatabase.js';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { FoodNeedsPersistence } from '../../food-loop/needs-persistence.js';
import { NativeFoodSource } from '../../food-loop/native-source.js';
import { loadFoodLoopCatalog } from '../../food-loop/catalog.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../../needs/config.js';
import { NativeFoodConsumptionStore, foodDigest, FOOD_POLICY } from '../../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { NativeFoodProductionStore, type FoodProductionAction } from '../../server/engine/src/mods/NativeFoodProductionStore.js';
import { closeFoodDeliveryTick } from '../../server/engine/src/mods/NativeFoodDeliveryStore.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { PlayerInventoryEscrowStore } from '../../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { NativeTravelFareStore } from '../../server/engine/src/mods/NativeTravelFareStore.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { BusinessAssetStore } from '../../business-assets/store.js';
import { ProductionWorkInProgressStore, loadDefaultProductionWorkflowCatalog } from '../../production-workflow/index.js';
import { createSaveData } from '../../sdk/test/utils/save-generator.js';
import { nativeIntegrationOptions } from '../integration-sources.js';
import { reportNativeIntegration, readNativeIntegrationEvidence, integrateNeedsDemand } from '../integration-report.js';

export const roots: string[] = [], closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
export const start = '2030-01-01T00:00:00.000Z', at = (hours: number) => new Date(Date.parse(start) + hours * 3600000).toISOString();
export function fixture(initialize = true, zeroRates = false) {
    const root = mkdtempSync(join(tmpdir(), 'si-a12-')); roots.push(root);
    cpSync(join(import.meta.dir, '../../config'), join(root, 'config'), { recursive: true });
    if (zeroRates) { const path = join(root, 'config/needs-dynamics-policies.json'), value = JSON.parse(readFileSync(path, 'utf8'));
        for (const rule of value.policies[0].rules) for (const key of Object.keys(rule).filter(key => key.endsWith('PerHour'))) rule[key] = 0;
        writeFileSync(path, JSON.stringify(value)); }
    const options = { ...nativeIntegrationOptions(root), worldId: 'integration-world', nativeFoodCheckpointPath: join(root, 'checkpoints.sqlite') };
    mkdirSync(dirname(options.databasePath), { recursive: true });
    const db = new Database(options.nativeFoodCheckpointPath, { create: true, strict: true }); closers.push(() => db.close(true));
    const native = new NativeFoodConsumptionStore({ db }), production = new NativeFoodProductionStore(db);
    new NativeTravelFareStore(db);
    const clock = new SimulationClockStore(options.clockPath); closers.push(() => clock.close());
    const created = clock.create({ clockId: 'world', profile: { schemaVersion: 1, profileId: 'integration', version: '1.0.0', seed: 'fixture',
        rate: { simulationMilliseconds: 1, wallMilliseconds: 1 } }, wallTime: start, simulationTime: start });
    const policy = loadNeedsPolicyCatalog(join(root, 'config/needs-policies.json')).policies[0]!;
    const dynamics = loadNeedsDynamicsPolicyCatalog(join(root, 'config/needs-dynamics-policies.json'), policy).policies[0]!;
    const persistence = new FoodNeedsPersistence(options.databasePath, policy, dynamics, loadFoodLoopCatalog(join(root, 'config/food-loops.json')));
    closers.push(() => persistence.close());
    const scope = { fromSimulationTime: start, toSimulationTime: at(1), clockId: 'world', clockProfileDigest: created.profileDigest,
        actorAgentIds: ['ada', 'bea', 'cora', 'dora'] };
    const bindings = scope.actorAgentIds.map(actorId => ({ worldId: options.worldId, actorId, playerId: actorId, lifecycleId: `life-${actorId}`,
        clockId: 'world', clockProfileDigest: created.profileDigest, worldProfileDigest: 'a'.repeat(64), lifecyclePolicyDigest: 'b'.repeat(64) }));
    const observation = (hours: number) => clock.observe('world', at(hours), Math.round(hours * 6000));
    if (initialize) for (const binding of bindings) persistence.needs.initialize({ binding, clock: observation(0), history: [], playerTime: null,
        admission: { kind: 'genesis', evidenceId: 'fixture', evidenceDigest: 'c'.repeat(64) } });
    const trades = new TradeEvidenceStore(join(root, 'server/engine/data/mods/trade-evidence.sqlite')); trades.close();
    const advance = (hours = 1) => {
        const clock = observation(hours); closeFoodDeliveryTick(db, clock);
        for (const binding of bindings) { const current = persistence.needs.get(binding); if (current) persistence.needs.advance({ binding, clock,
            history: [], playerTime: null, expectedRevision: current.revision }); }
    };
    const produce = (kind: 'gather' | 'cook', hours: number) => {
        const binding = bindings[0]!, action: FoodProductionAction = production.admit({ actionId: randomUUID(), worldId: binding.worldId,
            actorId: binding.actorId, username: binding.playerId, lifecycleId: binding.lifecycleId, clockId: binding.clockId,
            clockProfileDigest: binding.clockProfileDigest, kind, runId: 'food-run', batchId: 'batch', policyDigest: 'a'.repeat(64), catalogDigest: 'b'.repeat(64),
            source: { kind: kind === 'gather' ? 'npc' : 'loc', sourceId: 'finite-source', typeId: 1, x: 3200, z: 3200, level: 0 },
            recipeId: 'food.cook-lobster', recipeVersion: '1.0.0' });
        db.transaction(() => production.finish({ schemaVersion: 1, action, requestDigest: foodDigest(action), outcome: kind === 'gather' ? 'raw-gained' : 'cooked',
            inputs: kind === 'gather' ? [] : [{ itemId: 377, quantity: 1 }], outputs: [{ itemId: kind === 'gather' ? 377 : 379, quantity: 1 }],
            before: { raw: kind === 'gather' ? 0 : 1, cooked: 0, burnt: 0 }, after: { raw: kind === 'gather' ? 1 : 0, cooked: kind === 'cook' ? 1 : 0, burnt: 0 },
            quota: kind === 'gather' ? production.takeQuota(action, 1) : null, clock: observation(hours), checkpointId: `food-production:${action.actionId}`, checkpointDigest: 'd'.repeat(64) })).immediate();
        return action;
    };
    const consume = (hours = 1, noUse = false) => {
        const b = bindings[0]!, action = native.admit({ actionId: randomUUID(), worldId: b.worldId, actorId: b.actorId, username: b.playerId,
            lifecycleId: b.lifecycleId, clockId: b.clockId, clockProfileDigest: b.clockProfileDigest, itemId: 379, quantity: 1, slot: 0, policyDigest: foodDigest(FOOD_POLICY) });
        const clock = observation(hours);
        db.transaction(() => native.finish({ action, outcome: noUse ? 'no-use' : 'consumed', receipt: noUse ? null : { ...action, schemaVersion: 1, cause: 'content:consume_effect_stat',
            before: 1, after: 0, hpBefore: 20, hpAfter: 20, clock, checkpointId: `food:${action.actionId}`, checkpointDigest: 'd'.repeat(64), requestDigest: foodDigest(action) } }, clock)).immediate();
        closeFoodDeliveryTick(db, clock);
        const source = new NativeFoodSource({ workspace: root, worldId: options.worldId, checkpointPath: options.nativeFoodCheckpointPath });
        try { persistence.nativeFood.apply(source, 1, { binding: b, clock, history: [], playerTime: null, expectedRevision: persistence.needs.get(b)!.revision }); }
        finally { source.close(); } return action;
    };
    const read = () => reportNativeIntegration(scope, options);
    const assets = () => {
        db.run('CREATE TABLE accounts(owner TEXT PRIMARY KEY,save BLOB NOT NULL)');
        for (const actor of scope.actorAgentIds) db.run('INSERT INTO accounts VALUES(?1,?2)', [actor, createSaveData({ coins: 100, bank: [{ id: 379, count: 2 }] })]);
        new PlayerInventoryEscrowStore({ db, checkpoint: () => {} });
        const manager = new BusinessManagerStore(options.businessPath); manager.close();
        const businessAssets = new BusinessAssetStore(options.businessPath); businessAssets.close();
        const wip = new ProductionWorkInProgressStore(options.businessPath, loadDefaultProductionWorkflowCatalog(), undefined, false); wip.close();
        const treasury = new InstitutionTreasuryStore(options.treasuryPath, false); treasury.close();
    };
    const freeze = (name: string) => {
        const directory = join(root, '.local/boundaries', name); mkdirSync(directory, { recursive: true });
        const paths = { checkpointPath: join(directory, 'checkpoint.sqlite'), businessPath: join(directory, 'business.sqlite'), treasuryPath: join(directory, 'treasury.sqlite'),
            clockPath: join(directory, 'clock.sqlite'), needsPath: join(directory, 'needs.sqlite') };
        for (const [path, source] of [[paths.checkpointPath, options.nativeFoodCheckpointPath], [paths.businessPath, options.businessPath],
            [paths.treasuryPath, options.treasuryPath], [paths.clockPath, options.clockPath], [paths.needsPath, options.databasePath]]) {
            const connection = new Database(source!); connection.run('PRAGMA wal_checkpoint(TRUNCATE)'); connection.close(true); copyFileSync(source!, path!);
        }
        return paths;
    };
    return { root, options, scope, db, native, clock, policy, dynamics, bindings, persistence, observation, advance, produce, consume, read, assets, freeze };
}
