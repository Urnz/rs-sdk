import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { check, validateIntegrationFixture, type IntegrationFixture } from './fixture.js';

export const TECHNICAL_PROTOCOL = 'society-integration-technical-v2';
export const TECHNICAL_MECHANISMS = ['native-gather', 'business-procurement', 'native-cook', 'business-sale', 'native-consume',
    'once-only-needs-relief', 'cook-wage', 'delivery-wage', 'native-rent', 'physical-bed-sleep', 'logout-return',
    'input-shortage', 'funds-shortage', 'bed-capacity', 'in-flight-restart', 'result-restore'] as const;
export interface TechnicalPlan {
    protocol: typeof TECHNICAL_PROTOCOL; fixtureDigest: string; targetGameDays: 3; maximumWallMinutes: number;
    observationIntervalSeconds: 15; restartAfterGameDays: 1.5; recoveryDeadlineSeconds: 300;
    providerCalls: 0; importsAfterBootstrap: 0; manualUnplannedGoals: 0;
    physicsClockScale: 1; needsClockRate: IntegrationFixture['clock']['profile']['rate'];
    interpretation: 'technical-mechanics-with-measured-livelihood-outcome';
    accelerationScope: 'world-clock-only-no-dynamic-parity-claim';
    requiredMechanisms: (typeof TECHNICAL_MECHANISMS)[number][];
    digest: string;
}
export function buildTechnicalPlan(fixture: IntegrationFixture): TechnicalPlan {
    validateIntegrationFixture(fixture);
    check(fixture.nativeSiteProfile && fixture.survival, 'Technical run requires the corrected native sites and day-survival fixture');
    const rate = fixture.clock.profile.rate;
    const minutes = Math.ceil(3 * 86400000 * rate.wallMilliseconds / rate.simulationMilliseconds / 60000) + 1;
    const body = { protocol: TECHNICAL_PROTOCOL, fixtureDigest: fixture.digest, targetGameDays: 3 as const, maximumWallMinutes: minutes,
        observationIntervalSeconds: 15 as const, restartAfterGameDays: 1.5 as const, recoveryDeadlineSeconds: 300 as const,
        providerCalls: 0 as const, importsAfterBootstrap: 0 as const, manualUnplannedGoals: 0 as const,
        physicsClockScale: 1 as const, needsClockRate: structuredClone(rate),
        interpretation: 'technical-mechanics-with-measured-livelihood-outcome' as const,
        accelerationScope: 'world-clock-only-no-dynamic-parity-claim' as const, requiredMechanisms: [...TECHNICAL_MECHANISMS] } satisfies Omit<TechnicalPlan, 'digest'>;
    return { ...body, digest: digest(body) };
}
export function validateTechnicalPlan(input: unknown, fixture: IntegrationFixture): TechnicalPlan {
    const expected = buildTechnicalPlan(fixture);
    check(digest(input) === digest(expected), 'Technical plan differs from its exact predeclared protocol');
    return expected;
}
/** Economic success is a measured result. Missing native mechanics remain missing,
 * and neither a static plan nor a regression harness can establish their execution. */
export function technicalPlanAdmission(plan: TechnicalPlan, fixture: IntegrationFixture) {
    validateTechnicalPlan(plan, fixture);
    return { protocol: plan.protocol, digest: plan.digest, runnableWithinFixtureBudget: plan.maximumWallMinutes <= fixture.protocol.maximumWallMinutes,
        nominalPortions: 3 * fixture.avatars.length,
        maximumFinitePortionsBeforeCookingLosses: fixture.protocol.nativeHarvest + fixture.avatars.reduce((n, a) => n + a.cookedReserve, 0),
        status: 'requires-native-publication-travel-runtime-evidence', liveAcceptance: false,
        livelihoodThresholdsAreTechnicalVerdict: false, originalD1Amended: false };
}
