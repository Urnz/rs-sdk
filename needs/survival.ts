import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { healthDigest as digest, healthObject as object } from '../population-health/policy.js';
import { validateNeedsPolicy } from './profile.js';
import { validateNeedsDynamicsPolicy } from './dynamics.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from './config.js';
import { validateFoodLoopCatalog, loadFoodLoopCatalog } from '../food-loop/catalog.js';
import { loadSimulationClockRuntimeConfig } from '../simulation-clock/config.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';

export const GAME_DAY_MS = 86400000;
export type SurvivalMode = 'live' | 'accelerated-test';
export interface SurvivalRules {
    schemaVersion: 1; policyId: 'day-survival'; version: '1.0.0'; gameDaySimulationMilliseconds: number;
    hungerUnitsPerGameDay: number; hungryAfterGameDays: number; fatalDeficitGameDays: number; normalMealGameDays: number;
}
export function survivalRulesV1(): SurvivalRules {
    return { schemaVersion: 1, policyId: 'day-survival', version: '1.0.0', gameDaySimulationMilliseconds: GAME_DAY_MS,
        hungerUnitsPerGameDay: 2400, hungryAfterGameDays: 1, fatalDeficitGameDays: 7, normalMealGameDays: 1 };
}
export function validateSurvivalRules(raw: unknown): SurvivalRules {
    const r = object(raw, ['schemaVersion', 'policyId', 'version', 'gameDaySimulationMilliseconds', 'hungerUnitsPerGameDay',
        'hungryAfterGameDays', 'fatalDeficitGameDays', 'normalMealGameDays'], 'Survival rules');
    if (r.schemaVersion !== 1 || r.policyId !== 'day-survival' || r.version !== '1.0.0' || r.gameDaySimulationMilliseconds !== GAME_DAY_MS
        || r.hungerUnitsPerGameDay !== 2400 || r.hungryAfterGameDays !== 1 || r.fatalDeficitGameDays !== 7 || r.normalMealGameDays !== 1)
        throw new Error('Unsupported one/seven-day survival rules');
    return structuredClone(r) as unknown as SurvivalRules;
}
export function compileSurvivalProfile(raw: unknown, mode: SurvivalMode, seed: string) {
    const rules = validateSurvivalRules(raw);
    if (!['live', 'accelerated-test'].includes(mode) || typeof seed !== 'string' || !seed.trim() || seed.length > 128)
        throw new Error('Invalid survival world mode/seed');
    const hungerThreshold = rules.hungerUnitsPerGameDay * rules.hungryAfterGameDays, deathThreshold = rules.hungerUnitsPerGameDay * rules.fatalDeficitGameDays;
    const policy = validateNeedsPolicy({ schemaVersion: 1, policyId: 'day-survival-needs', version: '1.0.0', needs: [
        { needId: 'hunger', label: 'Hunger', minimumValue: 0, maximumValue: deathThreshold, initialValue: 0, criticalThreshold: hungerThreshold },
        { needId: 'fatigue', label: 'Fatigue', minimumValue: 0, maximumValue: 10000, initialValue: 0, criticalThreshold: 8000 }
    ] });
    const dynamics = validateNeedsDynamicsPolicy({ schemaVersion: 1, policyId: 'day-survival-dynamics', version: '1.0.0',
        needsPolicy: { policyId: policy.policyId, version: policy.version }, rules: [
            { needId: 'hunger', onlineAwakePerHour: 100, offlineAwakePerHour: 100, onlineSleepingPerHour: 100, offlineSleepingPerHour: 100 },
            { needId: 'fatigue', onlineAwakePerHour: 400, offlineAwakePerHour: 250, onlineSleepingPerHour: -1000, offlineSleepingPerHour: -1000 }
        ] }, policy);
    const food = validateFoodLoopCatalog({ schemaVersion: 1, chains: [{ foodChainId: 'lobster',
        rawItem: { itemId: 377, name: 'Raw lobster', sourceSkill: 'Fishing' },
        cookedItem: { itemId: 379, name: 'Lobster' }, processingSkill: 'Cooking', hungerRelief: rules.hungerUnitsPerGameDay * rules.normalMealGameDays }] });
    const clock = { schemaVersion: 1 as const, clockId: 'world', initialSimulationTime: '2001-01-01T00:00:00.000Z',
        profile: { schemaVersion: 1 as const, profileId: `day-survival-${mode}`, version: '1.0.0', seed,
            rate: { simulationMilliseconds: mode === 'live' ? 24 : 288, wallMilliseconds: 1 } } };
    const selection = { schemaVersion: 1, mode, rules, rulesDigest: digest(rules), clockProfileDigest: simulationClockProfileDigest(clock.profile),
        needsPolicyDigest: policy.digest, dynamicsDigest: dynamics.digest, foodCatalogDigest: food.digest };
    return { rules, rulesDigest: digest(rules), mode, hungerThreshold, deathThreshold, policy, dynamics, food, clock,
        selection: { ...selection, digest: digest(selection) } };
}
/** Opt-in, immutable world binding. Absence preserves a legacy world's rules;
 * a present but invalid selection always fails closed instead of falling back. */
export function loadSurvivalProfile(root: string) {
    const path = join(root, 'config/survival-profile.json'); if (!existsSync(path)) return null;
    const selected = JSON.parse(readFileSync(path, 'utf8')), { digest: supplied, ...body } = selected;
    object(body, ['schemaVersion', 'mode', 'rules', 'rulesDigest', 'clockProfileDigest', 'needsPolicyDigest', 'dynamicsDigest', 'foodCatalogDigest'], 'Survival selection');
    if (supplied !== digest(body)) throw new Error('Survival selection digest differs');
    const clock = loadSimulationClockRuntimeConfig(join(root, 'config/simulation-clock.json'));
    const compiled = compileSurvivalProfile(body.rules, body.mode, clock.profile.seed);
    if (digest(compiled.selection) !== digest(selected) || digest(compiled.clock) !== digest(clock)) throw new Error('Survival clock/mode binding differs');
    const policy = loadNeedsPolicyCatalog(join(root, 'config/needs-policies.json')).policies[0]!;
    const dynamics = loadNeedsDynamicsPolicyCatalog(join(root, 'config/needs-dynamics-policies.json'), policy).policies[0]!;
    const food = loadFoodLoopCatalog(join(root, 'config/food-loops.json'));
    if (policy.digest !== compiled.policy.digest || dynamics.digest !== compiled.dynamics.digest || food.digest !== compiled.food.digest)
        throw new Error('Survival physiology/portion policy differs');
    return compiled;
}

export interface SurvivalMeal { actionId: string; atSimulationTime: string; sourceDigest: string }
/** Exact deficit replay from admitted genesis and canonical, already-verified
 * native consumptions. No wall rate, gateway poll, or caller hunger enters it. */
export function evaluateSurvivalDeficit(rules: SurvivalRules, admittedAt: string, observedAt: string, meals: readonly SurvivalMeal[]) {
    validateSurvivalRules(rules);
    const time = (s: string) => { const n = Date.parse(s); if (!Number.isSafeInteger(n) || new Date(n).toISOString() !== s) throw new Error('Invalid survival time'); return n; };
    const start = time(admittedAt), end = time(observedAt); if (end < start || meals.length > 100000) throw new Error('Survival time/history exceeds bounds');
    const day = BigInt(rules.gameDaySimulationMilliseconds), fatal = day * BigInt(rules.fatalDeficitGameDays), meal = day * BigInt(rules.normalMealGameDays);
    let deficit = 0n, previous = start, deathAt: string | null = null;
    const seen = new Set<string>();
    for (const item of meals) {
        const at = time(item.atSimulationTime);
        if (!/^[a-f0-9-]{36}$/.test(item.actionId) || !/^[a-f0-9]{64}$/.test(item.sourceDigest) || seen.has(item.actionId) || at < previous || at > end)
            throw new Error('Survival meal source/order differs');
        seen.add(item.actionId);
        previous = at;
    }
    previous = start;
    for (const item of meals) {
        const at = time(item.atSimulationTime);
        const accrued = BigInt(at - previous);
        if (deficit + accrued >= fatal) { deathAt = new Date(previous + Number(fatal - deficit)).toISOString(); break; }
        deficit = deficit + accrued > meal ? deficit + accrued - meal : 0n; previous = at;
    }
    if (!deathAt && deficit + BigInt(end - previous) >= fatal) deathAt = new Date(previous + Number(fatal - deficit)).toISOString();
    const finalDeficit = deathAt ? fatal : deficit + BigInt(end - previous);
    return { policyDigest: digest(rules), admittedAt, observedAt, hungry: finalDeficit >= day, deathAt,
        deficitSimulationMilliseconds: Number(finalDeficit), hungerNumerator: String(finalDeficit * BigInt(rules.hungerUnitsPerGameDay)),
        hungerDivisor: rules.gameDaySimulationMilliseconds, mealsDigest: digest(meals) };
}
