import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import InvType from '../cache/config/InvType.js';
import ObjType from '../cache/config/ObjType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import VarBitType from '../cache/config/VarBitType.js';
import ParamType from '../cache/config/ParamType.js';
import EnumType from '../cache/config/EnumType.js';
import StructType from '../cache/config/StructType.js';
import SeqType from '../cache/config/SeqType.js';
import DbRowType from '../cache/config/DbRowType.js';
import DbTableType from '../cache/config/DbTableType.js';
import DbTableIndex from '../cache/config/DbTableIndex.js';
import Player from '../engine/entity/Player.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import { executeNativeFoodAction } from './NativeFoodConsumption.js';
import { FOOD_ITEM, FOOD_POLICY, NativeFoodConsumptionStore, foodDigest, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { closeFoodDeliveryTick } from './NativeFoodDeliveryStore.js';
import { NativeFoodSource } from '../../../../food-loop/native-source.js';
import { FoodNeedsPersistence } from '../../../../food-loop/needs-persistence.js';
import { SimulationClockStore } from '../../../../simulation-clock/store.js';
import { AgentStateStore } from '../../../../agent-state/store.js';
import { stageSurvivalConfiguration } from '../../../../needs/survival-config.js';
import { GAME_DAY_MS, type SurvivalMode } from '../../../../needs/survival.js';
import { populationNeedsBinding } from '../../../../needs/population-binding.js';
import { loadPopulationAgePolicy } from '../../../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy } from '../../../../population-lifecycle/mortality.js';
import { readPopulationStarvation } from '../../../../population-lifecycle/starvation.js';
import { PlayerHealthEvidenceStore } from './PlayerHealthEvidenceStore.js';
import { admitPopulationStarvation } from './PopulationDeathRuntime.js';
import { reconcilePopulationDeaths } from '../../../gateway/admin/population-death-runtime.js';
import { selectLivelihoodAction } from '../../../gateway/admin/livelihood-policy.js';

const config = resolve(import.meta.dir, '../../../../config'), pack = resolve(import.meta.dir, '../../data/pack');
const age = loadPopulationAgePolicy(join(config, 'population-age-policy.json'));
const mortality = loadPopulationMortalityPolicy(join(config, 'population-mortality-policy.json'));
const roots: string[] = [], closers: Array<() => void> = [];
const start = '2001-01-01T00:00:00.000Z', wall = '2026-10-20T00:00:00.000Z';
beforeAll(() => {
    for (const type of [InvType, ObjType, VarPlayerType, VarBitType, ParamType, EnumType, StructType, SeqType, DbRowType, DbTableType]) type.load(pack);
    DbTableIndex.init(); ScriptProvider.load(pack);
});
afterEach(() => { for (const close of closers.splice(0).reverse()) close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(mode: SurvivalMode = 'accelerated-test') {
    const root = mkdtempSync(join(tmpdir(), 'native-day-survival-')); roots.push(root);
    mkdirSync(join(root, 'config')); writeFileSync(join(root, '.integration-stage.json'), JSON.stringify({ fixtureDigest: 'a'.repeat(64) }));
    copyFileSync(join(config, 'survival-rules.json'), join(root, 'config/survival-rules.json'));
    const p = stageSurvivalConfiguration(root, mode, 'native-survival-parity');
    const clock = new SimulationClockStore(join(root, 'clock.sqlite')); closers.push(() => clock.close());
    const created = clock.create({ clockId: 'world', profile: p.clock.profile, simulationTime: start, wallTime: wall });
    const agents = new AgentStateStore(join(root, 'agents.sqlite'), { store: clock, clockId: 'world' }); closers.push(() => agents.close());
    agents.createIdentity({ agentId: 'foodtest', playerUsername: 'foodtest', displayName: 'Food test', background: 'Native survival', personalityTraits: ['steady'] }, wall);
    agents.bindPopulationMember({ agentId: 'foodtest', playerUsername: 'foodtest', worldProfile: { profileId: 'mature-society', version: '1.0.0', digest: 'a'.repeat(64) },
        lifecyclePolicy: { ...age.lifecyclePolicy, kind: 'finite' }, simulationClock: { clockId: 'world', profileDigest: created.profileDigest },
        joinedAtSimulationTime: start, sourceResultId: 'genesis-' + 'b'.repeat(24), sourceResultDigest: 'c'.repeat(64) }, wall);
    const member = agents.getPopulationMember('foodtest')!, binding = populationNeedsBinding('survival-world', member);
    const path = join(root, 'checkpoints.sqlite'), options = { workspace: root, worldId: binding.worldId, checkpointPath: path };
    const market = new MarketStore(path); closers.push(() => market.db.close(true)); new NativeFoodConsumptionStore(market);
    const persistence = new FoodNeedsPersistence(join(root, '.local/simulation/food-needs.sqlite'), p.policy, p.dynamics, p.food);
    closers.push(() => persistence.close());
    persistence.needs.initialize({ binding, clock: clock.observe('world', wall, 1), history: [], playerTime: null,
        admission: { kind: 'genesis', evidenceId: 'survival-genesis', evidenceDigest: 'd'.repeat(64) } });
    const player = new Player('foodtest', 1n, 1n); player.x = 3222; player.z = 3218;
    player.levels.fill(1); player.baseLevels.fill(1); player.levels[PlayerStat.HITPOINTS] = 20; player.baseLevels[PlayerStat.HITPOINTS] = 20;
    const inv = player.getInventory(InvType.INV)!; inv.add(FOOD_ITEM, 6); market.checkpoint(player.username, player.save(false), true);
    const source = new NativeFoodSource(options); closers.push(() => source.close());
    const healthPath = join(root, 'health.sqlite'); let health = new PlayerHealthEvidenceStore(healthPath); closers.push(() => health.close());
    const observe = (days: number) => clock.observe('world', new Date(Date.parse(wall) + days * GAME_DAY_MS / p.clock.profile.rate.simulationMilliseconds).toISOString(),
        100 + Math.floor(days * 100));
    const admit = (days: number) => admitPopulationStarvation(member, observe(days), health, age, mortality, options);
    const eat = (days: number, noUse = false) => {
        const observed = observe(days); World.currentTick = observed.engineTick!;
        const context: NativeFoodContext = { action: { actionId: randomUUID(), worldId: binding.worldId, actorId: binding.actorId,
            username: binding.playerId, lifecycleId: binding.lifecycleId, itemId: FOOD_ITEM, quantity: 1,
            slot: inv.items.findIndex(item => item?.id === FOOD_ITEM), policyDigest: foodDigest(FOOD_POLICY),
            clockId: binding.clockId, clockProfileDigest: binding.clockProfileDigest }, clock: observed };
        player.setVar(VarPlayerType.getId('eat_delay'), noUse ? World.currentTick + 5 : 0);
        return executeNativeFoodAction(market, player, context, save => market.checkpoint(player.username, save, true), () => {
            admitPopulationStarvation(member, observed, health, age, mortality, options);
            if (health.deathFor(player.username)) throw new Error('Starved population avatar cannot act');
            return context;
        });
    };
    const apply = (days: number, sequence = 1) => {
        closeFoodDeliveryTick(market.db, observe(days));
        return persistence.nativeFood.apply(source, sequence, { binding, clock: observe(days), history: [], playerTime: null,
            expectedRevision: persistence.needs.get(binding)!.revision });
    };
    return { root, p, clock, agents, member, binding, market, persistence, inv, source, healthPath, options, observe, eat, apply, admit,
        proof: (days: number) => readPopulationStarvation(options, member, observe(days))!, get health() { return health; },
        reopenHealth() { health.close(); health = new PlayerHealthEvidenceStore(healthPath); } };
}
test('native one-day hunger triggers the existing autonomous food skill and one real portion restores one day', () => {
    const f = fixture(), observed = f.observe(1);
    const state = f.persistence.needs.advance({ binding: f.binding, clock: observed, history: [], playerTime: null, expectedRevision: 1 });
    expect(state.state.values.find(v => v.needId === 'hunger')!.value).toBe(2400);
    const action = { kind: 'skill' as const, skill: { id: 'procedure.food.consume-lobster', version: '0.1.0' },
        binding: { sourceKind: 'approved-policy' as const, sourceId: 'native-day-test', parameters: {} } };
    expect(selectLivelihoodAction({ lifecycle: f.binding.lifecycleId, alive: true, role: 'player', clockRunning: true, physicalAllowed: true,
        hungerThreshold: f.p.hungerThreshold, needs: { hunger: 2400, fatigue: 9600, sleeping: false }, food: action })).toEqual({ action, reason: 'hunger-relief' });
    expect(f.eat(1).outcome).toBe('consumed');
    expect(f.apply(1)).toMatchObject({ hungerBefore: 2400, hungerRelief: 2400, hungerAfter: 0 });
    expect(f.proof(1).deficitSimulationMilliseconds).toBe(0); expect(f.inv.getItemCount(FOOD_ITEM)).toBe(5);
});
test('unprojected native commits count before gateway recovery; a portion defers death by exactly one day', () => {
    const f = fixture(); f.eat(6);
    expect(f.persistence.needs.get(f.binding)!.revision).toBe(1);
    expect(f.proof(7).deathAt).toBeNull(); expect(f.admit(7)).toBeFalse();
    expect(f.admit(8)).toBeTrue(); expect(f.health.listDeaths()[0]!.atSimulationTime).toBe('2001-01-09T00:00:00.000Z');
});
test('seven days without food closes offline finite members permanently and projects death on gateway recovery', () => {
    const f = fixture(); expect(f.admit(6.99)).toBeFalse(); expect(f.admit(7)).toBeTrue(); f.reopenHealth();
    expect(f.admit(8)).toBeFalse(); expect(f.health.listDeaths()).toHaveLength(1);
    expect(f.health.listDeaths()[0]!.cause.kind).toBe('starvation');
    expect(reconcilePopulationDeaths(f.agents, f.healthPath, age, mortality)).toBe(1);
    expect(reconcilePopulationDeaths(f.agents, f.healthPath, age, mortality)).toBe(0);
    expect(() => f.agents.assertCharacterCanAct('foodtest')).toThrow('closed');
});
test('a native food attempt at the seventh-day deadline cannot resurrect or remove an item', () => {
    const f = fixture(); expect(() => f.eat(7)).toThrow('Starved');
    expect(f.inv.getItemCount(FOOD_ITEM)).toBe(6); expect(f.health.listDeaths()).toHaveLength(1);
});
test('early food gives no stored credit and no-use does not prevent starvation', () => {
    const early = fixture(); early.eat(0); expect(early.apply(0).hungerRelief).toBe(0); expect(early.admit(7)).toBeTrue();
    const unused = fixture(); expect(unused.eat(1, true).outcome).toBe('no-use'); expect(unused.apply(1).hungerRelief).toBe(0);
    expect(unused.admit(7)).toBeTrue(); expect(unused.inv.getItemCount(FOOD_ITEM)).toBe(6);
});
test('native journal tampering or truncation fails closed instead of inventing a survival outcome', () => {
    const tamper = fixture(); tamper.eat(1); tamper.apply(1);
    tamper.market.db.run('UPDATE native_food_actions SET result_digest=?1', ['f'.repeat(64)]);
    expect(() => tamper.proof(7)).toThrow(); expect(tamper.health.listDeaths()).toHaveLength(0);
    const truncate = fixture(); truncate.eat(1); truncate.apply(1); truncate.market.db.run('DELETE FROM native_food_delivery');
    expect(() => truncate.proof(7)).toThrow('truncated'); expect(truncate.health.listDeaths()).toHaveLength(0);
});
test('live and accelerated native content produce equal physiology and the same seven-day deadline', () => {
    const results = (['live', 'accelerated-test'] as const).map(mode => {
        const f = fixture(mode); f.eat(1); const applied = f.apply(1);
        expect(f.admit(7)).toBeFalse(); expect(f.admit(8)).toBeTrue();
        return { relief: applied.hungerRelief, deathAt: f.health.listDeaths()[0]!.atSimulationTime };
    }); expect(results[0]).toEqual(results[1]);
});
