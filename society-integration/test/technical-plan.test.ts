import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { loadIntegrationFixture } from '../fixture.js';
import { buildTechnicalPlan, technicalPlanAdmission, validateTechnicalPlan } from '../technical-plan.js';
const root = resolve(import.meta.dir, '../..');
test('technical protocol fixes the same three game days and mechanics while explicitly retaining unscaled physics and separate economic outcome', () => {
    const profiles = ['live', 'accelerated-test'].map(mode => loadIntegrationFixture(join(root, `config/fixtures/society-lobster-four-${mode}-native-sites-trial-v1.json`)));
    const plans = profiles.map(buildTechnicalPlan);
    expect(plans.map(p => p.maximumWallMinutes)).toEqual([181, 16]);
    expect(plans[0]!.requiredMechanisms).toEqual(plans[1]!.requiredMechanisms);
    for (const [i, plan] of plans.entries()) {
        const fixture = profiles[i]!;
        expect(technicalPlanAdmission(plan, fixture).liveAcceptance).toBeFalse();
        expect(technicalPlanAdmission(plan, fixture).nominalPortions).toBe(12);
        expect(technicalPlanAdmission(plan, fixture).originalD1Amended).toBeFalse();
        for (const patch of [{ providerCalls: 1 }, { physicsClockScale: 12 }, { requiredMechanisms: [] }, { maximumWallMinutes: 90 }])
            expect(() => validateTechnicalPlan({ ...plan, ...patch }, fixture)).toThrow();
    }
    expect(() => validateTechnicalPlan(plans[0], profiles[1]!)).toThrow();
});
