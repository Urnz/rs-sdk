import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileSurvivalProfile, evaluateSurvivalDeficit, GAME_DAY_MS, loadSurvivalProfile, survivalRulesV1, validateSurvivalRules } from '../survival.js';
import { stageSurvivalConfiguration } from '../survival-config.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { selectLivelihoodAction, type LivelihoodSnapshot } from '../../server/gateway/admin/livelihood-policy.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const rules = survivalRulesV1(), start = '2001-01-01T00:00:00.000Z';
const at = (days: number) => new Date(Date.parse(start) + days * GAME_DAY_MS).toISOString();
const meal = (days: number) => ({ actionId: randomUUID(), atSimulationTime: at(days), sourceDigest: 'a'.repeat(64) });
function fresh() {
    const root = mkdtempSync(join(tmpdir(), 'day-survival-')); roots.push(root); mkdirSync(join(root, 'config'));
    writeFileSync(join(root, '.integration-stage.json'), JSON.stringify({ fixtureDigest: 'a'.repeat(64) }));
    writeFileSync(join(root, 'config/survival-rules.json'), JSON.stringify(rules)); return root;
}
test('live and accelerated profiles share all physiology and portions; only the world clock changes', () => {
    const live = compileSurvivalProfile(rules, 'live', 'same-seed'), fast = compileSurvivalProfile(rules, 'accelerated-test', 'same-seed');
    for (const key of ['rules', 'policy', 'dynamics', 'food'] as const) expect(live[key]).toEqual(fast[key]);
    expect(live.clock.profile.rate.simulationMilliseconds).toBe(24);
    expect(fast.clock.profile.rate.simulationMilliseconds).toBe(288);
    expect(live.food.chains[0]!.hungerRelief).toBe(2400);
    expect(live.dynamics.rules[0]).toMatchObject({ onlineAwakePerHour: 100, offlineAwakePerHour: 100,
        onlineSleepingPerHour: 100, offlineSleepingPerHour: 100 });
});
for (const [mode, millisecondsPerDay] of [['live', 3600000], ['accelerated-test', 300000]] as const) {
    test(`${mode}: persisted world clock reaches hungry at one day and death at seven, including reopen`, () => {
        const root = fresh(), p = stageSurvivalConfiguration(root, mode, 'same-seed');
        expect(loadSurvivalProfile(root)).toEqual(p);
        const path = join(root, 'clock.sqlite'); let clock = new SimulationClockStore(path);
        clock.create({ clockId: p.clock.clockId, profile: p.clock.profile, simulationTime: start, wallTime: start });
        const one = clock.observe('world', new Date(Date.parse(start) + millisecondsPerDay).toISOString());
        expect(one.simulationTime).toBe(at(1)); expect(evaluateSurvivalDeficit(rules, start, one.simulationTime, []).hungry).toBeTrue();
        clock.close(); clock = new SimulationClockStore(path);
        try { const seven = clock.observe('world', new Date(Date.parse(start) + millisecondsPerDay * 7).toISOString());
            expect(evaluateSurvivalDeficit(rules, start, seven.simulationTime, []).deathAt).toBe(at(7)); }
        finally { clock.close(); }
    });
}
test('hunger and fatal boundaries are exact; no poll interval or floating point drift', () => {
    expect(evaluateSurvivalDeficit(rules, start, at(1 - 1 / GAME_DAY_MS), []).hungry).toBeFalse();
    expect(evaluateSurvivalDeficit(rules, start, at(7 - 1 / GAME_DAY_MS), []).deathAt).toBeNull();
    expect(evaluateSurvivalDeficit(rules, start, at(9), []).deathAt).toBe(at(7));
});
test('one portion restores one day, clamps at zero, and cannot bank early meals', () => {
    expect(evaluateSurvivalDeficit(rules, start, at(1), [meal(1)]).deficitSimulationMilliseconds).toBe(0);
    expect(evaluateSurvivalDeficit(rules, start, at(7), [meal(0)]).deathAt).toBe(at(7));
    expect(evaluateSurvivalDeficit(rules, start, at(7), [meal(6)]).deathAt).toBeNull();
    expect(evaluateSurvivalDeficit(rules, start, at(8), [meal(6)]).deathAt).toBe(at(8));
});
test('late meals never resurrect and invalid history after a fatal boundary is still rejected', () => {
    expect(evaluateSurvivalDeficit(rules, start, at(9), [meal(7), meal(8)]).deathAt).toBe(at(7));
    const a = meal(7); expect(() => evaluateSurvivalDeficit(rules, start, at(9), [a, a])).toThrow('source/order');
    expect(() => evaluateSurvivalDeficit(rules, start, at(9), [meal(8), meal(7)])).toThrow('source/order');
    expect(() => evaluateSurvivalDeficit(rules, start, at(9), [meal(10)])).toThrow('source/order');
});
test('world clock pause prevents hunger growth without a separate test-only physiology', () => {
    const root = fresh(), p = stageSurvivalConfiguration(root, 'accelerated-test', 'pause-seed');
    const clock = new SimulationClockStore(join(root, 'clock.sqlite'));
    try {
        const c = clock.create({ clockId: 'world', profile: p.clock.profile, simulationTime: start, wallTime: start });
        clock.pause('world', c.revision, start);
        expect(clock.observe('world', at(10)).simulationTime).toBe(start);
    } finally { clock.close(); }
});
test('autonomous policy seeks food at one day, wakes from sleep, and waits for real food authority', () => {
    const snapshot: LivelihoodSnapshot = { lifecycle: 'day-test', alive: true, role: 'player', clockRunning: true,
        physicalAllowed: true, hungerThreshold: 2400, needs: { hunger: 2400, fatigue: 0, sleeping: false },
        food: { kind: 'commerce', operationId: 'bounded-food-buy' } };
    expect(selectLivelihoodAction(snapshot)).toEqual({ action: snapshot.food!, reason: 'hunger-relief' });
    expect(selectLivelihoodAction({ ...snapshot, food: undefined }).reason).toBe('food-input-or-authority-required');
    expect(selectLivelihoodAction({ ...snapshot, physicalAllowed: false, needs: { hunger: 2400, fatigue: 9000, sleeping: true },
        wake: { kind: 'housing', operation: 'wake', operationId: 'paid-rest' } }).reason).toBe('wake-for-self-care');
    expect(selectLivelihoodAction({ ...snapshot, needs: { hunger: 2399, fatigue: 0, sleeping: false } }).reason).not.toBe('hunger-relief');
});
test('profile is opt-in and rejects changed rules, clock or meal catalog instead of falling back', () => {
    const root = fresh(); expect(loadSurvivalProfile(root)).toBeNull();
    stageSurvivalConfiguration(root, 'live', 'bound-seed');
    expect(() => stageSurvivalConfiguration(root, 'accelerated-test', 'bound-seed')).toThrow('fresh');
    const path = join(root, 'config/food-loops.json'), food = JSON.parse(readFileSync(path, 'utf8'));
    food.chains[0].hungerRelief = 1; writeFileSync(path, JSON.stringify(food));
    expect(() => loadSurvivalProfile(root)).toThrow('portion policy');
    expect(() => validateSurvivalRules({ ...rules, fatalDeficitGameDays: 8 })).toThrow('Unsupported');
    expect(() => validateSurvivalRules({ ...rules, scheduledFeeding: true })).toThrow();
});
