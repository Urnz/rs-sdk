import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../needs/config.js';
import { LIVELIHOOD_POLICY, LIVELIHOOD_THRESHOLDS } from '../server/gateway/admin/livelihood-policy.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { preflightIntegrationDefinition } from './bootstrap.js';
import { check, integrationWorldId, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';
import { compileSurvivalProfile, loadSurvivalProfile } from '../needs/survival.js';

export interface D1Plan {
    schemaVersion: 1; planId: string; fixtureDigest: string; durationMinutes: number; restartAfterMinutes: number;
    recoveryDeadlineMinutes: number; snapshotIntervalSeconds: number; providerCalls: number;
    minimumConsumesPerAvatar: number; minimumInternalConsumesPerAvatar: number; minimumSatisfiedDemandBasisPoints: number;
    minimumBuyerSellerRelations: number; minimumActorDependencies: number;
    plannedInputShortage: { startsAfterMinutes: number; endsAfterMinutes: number };
    bedWindows: { agentId: string; startsAfterMinutes: number; endsAfterMinutes: number }[];
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
    check(!!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === keys.sort().join(','), 'D1 plan fields differ');
}
export function validateD1Plan(raw: unknown, fixture: IntegrationFixture): D1Plan {
    validateIntegrationFixture(fixture);
    exact(raw, ['schemaVersion', 'planId', 'fixtureDigest', 'durationMinutes', 'restartAfterMinutes', 'recoveryDeadlineMinutes',
        'snapshotIntervalSeconds', 'providerCalls', 'minimumConsumesPerAvatar', 'minimumInternalConsumesPerAvatar',
        'minimumSatisfiedDemandBasisPoints', 'minimumBuyerSellerRelations', 'minimumActorDependencies', 'plannedInputShortage', 'bedWindows']);
    const p = raw as unknown as D1Plan;
    check(p.schemaVersion === 1 && typeof p.planId === 'string' && /^[a-z0-9][a-z0-9.-]{1,95}$/.test(p.planId)
        && p.fixtureDigest === fixture.digest, 'D1 fixture/plan binding differs');
    check(Number.isSafeInteger(p.durationMinutes) && p.durationMinutes >= 60 && p.durationMinutes <= fixture.protocol.maximumWallMinutes,
        'D1 requires 60–90 wall minutes within the fixture limit');
    check(Number.isSafeInteger(p.restartAfterMinutes) && p.restartAfterMinutes >= Math.floor(p.durationMinutes / 3)
        && p.restartAfterMinutes <= Math.ceil(p.durationMinutes * 2 / 3)
        && p.restartAfterMinutes + 5 < p.durationMinutes && p.recoveryDeadlineMinutes === 5, 'D1 restart/recovery window differs');
    check(Number.isSafeInteger(p.snapshotIntervalSeconds) && p.snapshotIntervalSeconds >= 15 && p.snapshotIntervalSeconds <= 60
        && p.providerCalls === 0, 'D1 requires bounded observation and zero provider calls');
    check(p.minimumConsumesPerAvatar === 2 && p.minimumInternalConsumesPerAvatar >= 1 && p.minimumInternalConsumesPerAvatar <= 2
        && Number.isSafeInteger(p.minimumInternalConsumesPerAvatar) && p.minimumSatisfiedDemandBasisPoints === 9500
        && p.minimumBuyerSellerRelations === 3 && p.minimumActorDependencies === 2, 'D1 acceptance thresholds cannot be weakened');
    exact(p.plannedInputShortage, ['startsAfterMinutes', 'endsAfterMinutes']);
    const interval = (s: number, e: number) => Number.isSafeInteger(s) && Number.isSafeInteger(e) && s >= 0 && e > s && e <= p.durationMinutes;
    check(interval(p.plannedInputShortage.startsAfterMinutes, p.plannedInputShortage.endsAfterMinutes)
        && p.plannedInputShortage.endsAfterMinutes < p.restartAfterMinutes, 'Invalid D1 shortage interval');
    check(Array.isArray(p.bedWindows) && p.bedWindows.length <= 12, 'D1 bed schedule exceeds limit');
    for (const w of p.bedWindows) {
        exact(w, ['agentId', 'startsAfterMinutes', 'endsAfterMinutes']);
        check(fixture.avatars.some(a => a.agentId === w.agentId) && w.agentId !== fixture.housing.landlordAgentId
            && interval(w.startsAfterMinutes, w.endsAfterMinutes), 'Invalid D1 tenant/window');
    }
    for (const w of p.bedWindows) {
        const active = p.bedWindows.filter(other => other.startsAfterMinutes <= w.startsAfterMinutes && other.endsAfterMinutes > w.startsAfterMinutes);
        check(active.length <= fixture.housing.maximumConcurrentTenants && new Set(active.map(x => x.agentId)).size === active.length,
            'D1 bed capacity or tenant overlap differs');
    }
    return structuredClone(p);
}

/** A necessary-condition proof, not a simulated run. Even continuous online,
 * awake time is an upper bound here; sleeping/offline time cannot improve it. */
export function inspectMealReachability(initialHunger: number, maximumAccrualPerHour: number, hungerThreshold: number, wallMinutes: number,
    rate = { simulationMilliseconds: 1, wallMilliseconds: 1 }) {
    for (const n of [initialHunger, maximumAccrualPerHour, hungerThreshold, wallMinutes])
        check(Number.isSafeInteger(n) && n >= 0 && n <= 2147483647, 'Invalid D1 hunger bound');
    check(hungerThreshold > 0 && wallMinutes > 0, 'Invalid D1 hunger threshold/window');
    check([rate.simulationMilliseconds, rate.wallMilliseconds].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647), 'Invalid D1 clock rate');
    const unitDivisor = 60 * rate.wallMilliseconds;
    const maximumHungerNumerator = BigInt(initialHunger) * BigInt(unitDivisor) + BigInt(maximumAccrualPerHour) * BigInt(wallMinutes) * BigInt(rate.simulationMilliseconds);
    return { initialHunger, maximumAccrualPerHour, hungerThreshold, wallMinutes, unitDivisor,
        maximumHungerNumerator: String(maximumHungerNumerator),
        earliestFirstMealMinutes: initialHunger >= hungerThreshold ? 0 : maximumAccrualPerHour === 0 ? null
            : Math.ceil((hungerThreshold - initialHunger) * unitDivisor / (maximumAccrualPerHour * rate.simulationMilliseconds)),
        firstMealReachable: maximumHungerNumerator >= BigInt(hungerThreshold) * BigInt(unitDivisor) };
}

export async function inspectD1Feasibility(root: string, fixture: IntegrationFixture, rawPlan: unknown) {
    const plan = validateD1Plan(rawPlan, fixture), definition = await preflightIntegrationDefinition(root, fixture);
    const survival = fixture.survival ? loadSurvivalProfile(root) ?? compileSurvivalProfile(
        JSON.parse(readFileSync(join(root, 'config/survival-rules.json'), 'utf8')), fixture.survival.mode, fixture.clock.profile.seed) : null;
    const policy = survival?.policy ?? loadNeedsPolicyCatalog(join(root, 'config/needs-policies.json')).policies[0]!;
    const dynamics = survival?.dynamics ?? loadNeedsDynamicsPolicyCatalog(join(root, 'config/needs-dynamics-policies.json'), policy).policies[0]!;
    const hunger = policy.needs.find(n => n.needId === 'hunger')!, rule = dynamics.rules.find(r => r.needId === 'hunger')!;
    check(policy.digest === definition.references.needsPolicyDigest && dynamics.digest === definition.references.dynamicsDigest,
        'Needs policy changed during D1 inspection');
    const maxRate = Math.max(0, rule.onlineAwakePerHour, rule.offlineAwakePerHour, rule.onlineSleepingPerHour, rule.offlineSleepingPerHour);
    const mealBound = inspectMealReachability(hunger.initialValue, maxRate, survival?.hungerThreshold ?? LIVELIHOOD_THRESHOLDS.hunger, plan.durationMinutes, fixture.clock.profile.rate);
    const survivalBound = survival ? {
        mode: survival.mode, rulesDigest: survival.rulesDigest,
        normalMealRelief: survival.food.chains[0]!.hungerRelief,
        earliestSecondMealMinutes: mealBound.earliestFirstMealMinutes! * 2,
        nominalMealsPerAvatar: Math.floor(plan.durationMinutes / mealBound.earliestFirstMealMinutes!),
        maximumAvailablePortions: fixture.protocol.nativeHarvest + fixture.avatars.reduce((n, a) => n + a.cookedReserve, 0)
    } : null;
    const mealsBlocked = !mealBound.firstMealReachable || !!survivalBound && (survivalBound.earliestSecondMealMinutes > plan.durationMinutes
        || survivalBound.nominalMealsPerAvatar * fixture.avatars.length * 0.95 > survivalBound.maximumAvailablePortions);
    const gates: { id: string; status: 'passed' | 'blocked' | 'unverified'; detail: string }[] = [
        { id: 'definition', status: 'passed', detail: 'Pinned fixture, native resource, price, housing and policy references validated.' },
        { id: 'publication', status: definition.executableSkillsReady ? 'passed' : 'blocked', detail: definition.errors.join('; ') || 'Every exact procedure is verified.' },
        { id: 'meal-reachability', status: mealsBlocked ? 'blocked' : 'unverified',
            detail: survivalBound ? `Day-survival ${survivalBound.mode}: second nominal meal at ${survivalBound.earliestSecondMealMinutes} minutes; ${survivalBound.nominalMealsPerAvatar * fixture.avatars.length} nominal portions versus at most ${survivalBound.maximumAvailablePortions} finite portions (before cooking losses). Native demand remains unverified.`
                : mealBound.firstMealReachable ? 'One reachable threshold is insufficient proof of two meals or 95% satisfied demand.'
                : `No first routine meal within ${plan.durationMinutes} minutes; earliest upper-bound arrival is ${mealBound.earliestFirstMealMinutes ?? 'never'} minutes.` },
        { id: 'native-travel', status: 'unverified', detail: 'Current delivery meets in Lumbridge; Karamja/ferry/Falador travel, fees, timing and return need native acceptance.' },
        { id: 'runtime-and-baseline', status: 'unverified', detail: 'A sealed isolated baseline, exact accounts/controllers, native grants and source readers must be bound before D1.' },
        { id: 'restart-and-shortage', status: 'unverified', detail: 'The actual runtime must preserve an in-flight intent over stack restart and enforce the planned shortage without value injection.' },
        { id: 'archive-and-restore', status: 'unverified', detail: 'Progressed-result capture/verify/restore has native roundtrip tests; the actual stopped D1 result and reread report remain required. Baseline capture still rejects a progressed world.' }
    ];
    const sourcePaths = ['config/fixtures/society-lobster-four-v1.json', 'config/needs-policies.json', 'config/needs-dynamics-policies.json',
        'server/gateway/admin/livelihood-policy.ts', 'society-integration/live-preflight.ts', 'scripts/society-integration-live.ts',
        ...fixture.skills.map(s => `agent-skills/catalog/${s.id}@${s.version}.skill.json`)];
    if (fixture.survival) sourcePaths.push('config/survival-rules.json', 'needs/survival.ts', 'config/food-loops.json',
        `config/fixtures/society-lobster-four-${fixture.survival.mode}-day-v1.json`);
    const sources = sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }));
    const body = { protocol: 'society-integration-d1-preflight-v1', plan, planDigest: digest(plan), fixtureDigest: fixture.digest,
        worldId: integrationWorldId(fixture), status: 'blocked', liveStartAuthorized: false, liveRunStarted: false, liveVerdict: 'not-run',
        gates, unresolvedGateCount: gates.filter(g => g.status !== 'passed').length, verifiedSkills: definition.verifiedSkills,
        references: definition.references, mealBound, survivalBound, routine: LIVELIHOOD_POLICY, sources,
        opening: { actors: fixture.avatars, treasuryGp: fixture.kitchen.treasuryGp,
            totalGp: fixture.kitchen.treasuryGp + fixture.avatars.reduce((n, a) => n + a.coinsGp, 0),
            rawStock: fixture.kitchen.rawOpening, cookedStock: fixture.kitchen.cookedOpening,
            harvestQuota: fixture.protocol.nativeHarvest, concurrentBeds: fixture.housing.maximumConcurrentTenants },
        scope: 'readonly-feasibility-and-unverified-live-gates' };
    return { ...body, digest: digest(body) };
}
