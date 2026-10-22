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
import { handleAdminRequest } from '../../server/gateway/admin/routes.js';
import type { BotSupervisor } from '../../server/gateway/admin/supervisor.js';

const roots: string[] = [], closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const start = '2030-01-01T00:00:00.000Z', at = (hours: number) => new Date(Date.parse(start) + hours * 3600000).toISOString();
function fixture(initialize = true, zeroRates = false) {
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
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceHashes = (root: string) => readdirSync(root, { recursive: true }).map(String).filter(name => name.endsWith('.sqlite')).sort()
    .map(name => [name, hash(join(root, name))]);

test('four exact needs boundaries produce a complete measured denominator without wall-time estimates or invented relief', () => {
    const f = fixture(); f.advance(); const before = sourceHashes(f.root), report = f.read();
    expect(report.completePopulationCoverage).toBeTrue();
    expect(report.needs.internalHungerRelief).toMatchObject({ status: 'verified', numerator: '0', denominator: '2880000000', basisPoints: '0' });
    expect(report.needs.actors).toHaveLength(4); expect(report.needs.actors.every(row => row.demand![0]!.accrued === '720000000')).toBeTrue();
    expect(report.balances.status).toBe('inconclusive'); expect(report.societyMinimumVerdict).toBe('inconclusive');
    expect(f.read()).toEqual(report); expect(sourceHashes(f.root)).toEqual(before);
    for (const id of report.needs.internalHungerRelief.evidenceIds) expect(report.evidence.some(row => row.id === id)).toBeTrue();
});

test('real native production and physiological readers count one final use and preserve exact internal relief terms', () => {
    const f = fixture(); f.produce('gather', 0.25); f.produce('cook', 0.5); const action = f.consume(); f.advance();
    const report = f.read(); expect(report.food.finalUses).toHaveLength(1);
    expect(report.food.finalUses[0]).toMatchObject({ actionId: action.actionId, units: 1, hungerRelief: 200, internalSupply: 'verified' });
    expect(report.food.production).toHaveLength(2);
    expect(report.needs.internalHungerRelief).toMatchObject({ status: 'verified', numerator: '720000000', denominator: '2880000000', basisPoints: '2500' });
    expect(report.balances.operationEquations).toHaveLength(7);
    expect(report.balances.operationEquations.every(row => row.residual === '0')).toBeTrue();
    expect(report.evidence.filter(row => row.channel === 'nutrition')).toHaveLength(1);
});

test('unknown inventory origin and a missing actor boundary stay inconclusive', () => {
    const f = fixture(); f.consume(); f.advance(); expect(f.read().needs.internalHungerRelief.status).toBe('inconclusive');
    const db = new Database(f.options.databasePath); db.run('DELETE FROM needs_state WHERE actor_id=?1', ['dora']); db.close(true);
    const report = f.read(); expect(report.completePopulationCoverage).toBeFalse(); expect(report.needs.internalHungerRelief.basisPoints).toBeNull();
});

test('a complete zero-demand cohort has no successful self-sufficiency ratio', () => {
    const f = fixture(true, true); f.advance(); const report = f.read();
    expect(report.completePopulationCoverage).toBeTrue();
    expect(report.needs.internalHungerRelief).toMatchObject({ status: 'inconclusive', numerator: '0', denominator: '0', basisPoints: null });
});

test('native no-use remains an application diagnostic and cannot become final use or hunger relief', () => {
    const f = fixture(); f.consume(1, true); f.advance(); const report = f.read();
    expect(report.food.finalUses).toEqual([]); expect(report.food.applications[0]).toMatchObject({ units: 0, hungerRelief: 0 });
    expect(report.needs.internalHungerRelief).toMatchObject({ status: 'verified', numerator: '0', basisPoints: '0' });
});

test('stale physiological mode cursor and a truncated PlayerTime journal fail denominator coverage', () => {
    const f = fixture(); f.clock.recordPlayerPresence('world', 'ada', 'online', at(0.5)); f.advance();
    const stale = f.read(); expect(stale.needs.actors.find(row => row.actorAgentId === 'ada')!.reasons).toContain('Closing needs mode cursor is stale');
    expect(stale.needs.internalHungerRelief.status).toBe('inconclusive');
    const db = new Database(f.options.clockPath); db.run('DELETE FROM simulation_player_time_history'); db.close(true);
    expect(f.read().sources.modes.status).toBe('invalid');
});

test('native row limits are checked before reading oversized histories; no truncation is certified', () => {
    const f = fixture(); f.advance();
    f.db.run(`WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<100001)
        INSERT INTO native_food_actions SELECT CAST(n AS TEXT),'{}','invalid',NULL,NULL FROM ids`);
    const report = f.read(); expect(report.sources.consumption).toMatchObject({ status: 'invalid', reason: expect.stringContaining('row limit') });
    expect(report.needs.internalHungerRelief.status).toBe('inconclusive');
});

test('events at the opening boundary are excluded and the closing boundary is included', () => {
    const f = fixture(); f.produce('gather', 0); f.produce('cook', 0.5); f.consume(1); f.advance();
    expect(f.read().food.production.map(row => row.kind)).toEqual(['cook']);
    expect(f.read().food.finalUses).toHaveLength(1);
});

test('source truncation, policy/schema mismatch and a second world never become successful zero observations', () => {
    const f = fixture(); f.produce('gather', 0.25); f.produce('cook', 0.5); f.consume(); f.advance();
    f.db.run('DELETE FROM native_food_lineage WHERE sequence=1');
    expect(f.read().sources.lineage.status).toBe('invalid'); expect(f.read().needs.internalHungerRelief.status).toBe('inconclusive');
    const other = reportNativeIntegration(f.scope, { ...f.options, worldId: 'another-world' });
    expect(other.sources.needs.status).toBe('invalid'); expect(other.completePopulationCoverage).toBeFalse();
    const db = new Database(f.options.databasePath); db.run('UPDATE needs_schema SET version=99'); db.close(true);
    expect(f.read().sources.needs.status).toBe('invalid');
});

test('snapshot-bound drilldown detects later native changes and does not accept a saved report as authority', () => {
    const f = fixture(); f.advance(); const report = f.read(), id = report.needs.internalHungerRelief.evidenceIds[0]!;
    expect(readNativeIntegrationEvidence(f.scope, f.options, report.digest, id).evidence.id).toBe(id);
    f.advance(2);
    expect(() => readNativeIntegrationEvidence(f.scope, f.options, report.digest, id)).toThrow('snapshot changed');
    expect(() => readNativeIntegrationEvidence(f.scope, f.options, report.digest, 'uploaded-report')).toThrow('Invalid');
});

test('frozen native opening/closing wealth includes bank and GP once and exposes an unclosed item/GP equation', () => {
    const f = fixture(); f.assets(); f.advance(0); f.clock.pause('world', f.clock.get('world')!.revision, start);
    const openingBoundary = f.freeze('opening'); f.clock.resume('world', f.clock.get('world')!.revision, start); f.advance(); f.clock.pause('world', f.clock.get('world')!.revision, at(1));
    const closingBoundary = f.freeze('closing');
    const report = reportNativeIntegration(f.scope, { ...f.options, openingBoundary, closingBoundary });
    expect(report.sources.openingAssets.status).toBe('available'); expect(report.sources.closingAssets.status).toBe('available');
    expect(report.balances.boundaryEquations.find(row => row.itemId === 995)).toMatchObject({ opening: '400', closing: '400', residual: '0' });
    expect(report.balances.boundaryEquations.find(row => row.itemId === 379)).toMatchObject({ opening: '8', closing: '8', residual: '0' });
    expect(report.balances.status).toBe('observed-equations-close'); expect(report.balances.completeEconomicCoverage).toBeFalse();
    const changed = new Database(closingBoundary.checkpointPath); changed.run('UPDATE accounts SET save=?1 WHERE owner=?2', [createSaveData({ coins: 120 }), 'ada']); changed.close(true);
    const mismatch = reportNativeIntegration(f.scope, { ...f.options, openingBoundary, closingBoundary });
    expect(mismatch.balances.status).toBe('mismatch');
    expect(mismatch.balances.boundaryEquations.find(row => row.itemId === 995)!.residual).toBe('-20');
});

test('misaligned boundary clock is unavailable to historical wealth even if current native balances exist', () => {
    const f = fixture(); f.assets(); f.advance(); const closingBoundary = f.freeze('running');
    const report = reportNativeIntegration(f.scope, { ...f.options, closingBoundary });
    expect(report.sources.closingAssets.status).toBe('invalid'); expect(report.balances.closing).toBeNull();
    expect(report.sources.currentAssets).toMatchObject({ status: 'available' }); expect(report.balances.currentAssets).not.toBeNull();
});

test('canonical fares close the GP sink equation once; missing or damaged fare history cannot certify it', () => {
    const f = fixture(); f.assets(); f.advance(0); f.clock.pause('world', f.clock.get('world')!.revision, start);
    const openingBoundary = f.freeze('fare-opening');
    f.clock.resume('world', f.clock.get('world')!.revision, start); f.advance();
    const save = createSaveData({ coins: 70, bank: [{ id: 379, count: 2 }] });
    f.db.transaction(() => {
        f.db.run('UPDATE accounts SET save=?1 WHERE owner=?2', [save, 'ada']);
        new NativeTravelFareStore(f.db).append({ id: randomUUID(), worldId: f.options.worldId, actorId: 'ada', username: 'ada',
            lifecycleId: f.bindings[0]!.lifecycleId, route: 'karamja-to-port-sarim',
            source: { script: '[label,customs_pay]', npc: 'customs_officer', x: 2954, z: 3147, level: 0 },
            amountGp: 30, beforeGp: 100, afterGp: 70, clock: f.observation(1), checkpointDigest: foodDigest([...save]) });
    }).immediate();
    f.clock.pause('world', f.clock.get('world')!.revision, at(1));
    const closingBoundary = f.freeze('fare-closing'), options = { ...f.options, openingBoundary, closingBoundary };
    const report = reportNativeIntegration(f.scope, options);
    expect(report.fares).toHaveLength(1);
    expect(report.balances.boundaryEquations.find(row => row.itemId === 995))
        .toMatchObject({ opening: '400', outflow: '30', closing: '370', residual: '0', status: 'closed-observed-equation' });
    expect(reportNativeIntegration(f.scope, options).digest).toBe(report.digest);
    f.db.run('DELETE FROM native_travel_fare');
    const damaged = reportNativeIntegration(f.scope, options);
    expect(damaged.sources.fares.status).toBe('invalid'); expect(damaged.balances.status).toBe('inconclusive');
    for (const table of ['native_travel_fare', 'native_travel_fare_head', 'native_travel_fare_schema']) f.db.run(`DROP TABLE ${table}`);
    expect(reportNativeIntegration(f.scope, options).sources.fares.status).toBe('unavailable');
});

test('exact rate integration preserves saturation demand and splits sleep expiry without wall exposure', () => {
    const f = fixture(); f.advance(); const opening = f.persistence.needs.atRevision(f.bindings[0]!, 1), closing = f.persistence.needs.get(f.bindings[0]!)!;
    opening.state.values[0]!.value = 10000;
    const demand = integrateNeedsDemand(opening, closing, [], f.dynamics.rules, start, at(1));
    expect(demand[0]).toMatchObject({ opening: '36000000000', accrued: '720000000' });
    opening.rest = closing.rest = 'sleeping'; opening.sleepUntil = at(0.5);
    expect(integrateNeedsDemand(opening, closing, [], f.dynamics.rules, start, at(1))[0]!.accrued).toBe('540000000');
});

test('absent databases are never initialized by report collection and four actors are required before reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'si-a12-absent-')); roots.push(root);
    const f = fixture(), options = nativeIntegrationOptions(root), before = readdirSync(root);
    const report = reportNativeIntegration(f.scope, options);
    expect(Object.values(report.sources).every(source => source.status !== 'available')).toBeTrue(); expect(readdirSync(root)).toEqual(before);
    expect(() => reportNativeIntegration({ ...f.scope, actorAgentIds: ['ada'] }, options)).toThrow('exactly four');
});

test('native integration GET and evidence are authenticated, source paths/posted observations cannot change trusted options', async () => {
    const f = fixture(); f.advance(); const context = { gatewayBots: () => new Map(), supervisor: {} as BotSupervisor, nativeIntegrationOptions: f.options };
    const params = new URLSearchParams({ from: start, to: at(1), clockId: 'world', clockProfileDigest: f.scope.clockProfileDigest,
        checkpointPath: 'C:/untrusted.sqlite', observations: '{"success":true}' });
    for (const actor of f.scope.actorAgentIds) params.append('actor', actor);
    const url = new URL(`http://localhost:7780/api/admin/society/integration?${params}`), headers = { 'X-Admin-Request': 'rs-sdk-admin' };
    expect((await handleAdminRequest(new Request(url), url, context))!.status).toBe(401);
    const response = (await handleAdminRequest(new Request(url, { headers }), url, context))!; expect(response.status).toBe(200);
    const report = await response.json(); expect(report.digest).toBe(f.read().digest);
    const detail = new URL(`http://localhost:7780/api/admin/society/integration/evidence/${report.evidence[0].id}?${params}&snapshot=${report.digest}`);
    expect((await handleAdminRequest(new Request(detail, { headers }), detail, context))!.status).toBe(200);
    expect((await handleAdminRequest(new Request(url, { method: 'POST', headers }), url, context))!.status).not.toBe(200);
});
