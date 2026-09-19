import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { applyHousingFatigueRecoveryRate, housingStorageCapability, loadHousingEffectPolicyCatalog,
    loadHousingTierPolicyCatalog, resolveHousingEffects, resolveHousingTheftOutcome,
    validateHousingEffectPolicy } from '../index.js';

const hierarchyPath = join(import.meta.dir, '..', '..', 'config', 'housing-tier-policies.json');
const effectsPath = join(import.meta.dir, '..', '..', 'config', 'housing-effect-policies.json');

function setup() {
    const hierarchy = loadHousingTierPolicyCatalog(hierarchyPath).policies[0]!;
    const policy = loadHousingEffectPolicyCatalog(effectsPath, hierarchy).policies[0]!;
    return { hierarchy, policy };
}

describe('housing effects', () => {
    test('binds every effect to the exact hierarchy with stable evidence', () => {
        const { hierarchy, policy } = setup();
        expect(policy.hierarchyPolicy).toEqual({ policyId: hierarchy.policyId,
            version: hierarchy.version, digest: hierarchy.digest });
        expect(policy.effects.map(effect => effect.tierId)).toEqual(hierarchy.tiers.map(tier => tier.tierId));
        expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('higher housing deterministically improves fatigue recovery', () => {
        const { hierarchy, policy } = setup();
        const street = resolveHousingEffects(policy, hierarchy, 'street');
        const fortified = resolveHousingEffects(policy, hierarchy, 'fortified-property');
        expect(applyHousingFatigueRecoveryRate(-1000, street)).toBe(-250);
        expect(applyHousingFatigueRecoveryRate(-1000, fortified)).toBe(-1500);
        expect(() => applyHousingFatigueRecoveryRate(1, fortified)).toThrow('between -1000000 and 0');
    });

    test('exposes bounded private storage only where capacity exists', () => {
        const { hierarchy, policy } = setup();
        expect(housingStorageCapability(resolveHousingEffects(policy, hierarchy, 'street')))
            .toEqual({ privateStorageAllowed: false, privateStorageSlots: 0 });
        expect(housingStorageCapability(resolveHousingEffects(policy, hierarchy, 'shared-dormitory')))
            .toEqual({ privateStorageAllowed: true, privateStorageSlots: 8 });
    });

    test('resolves theft protection from an explicit replayable roll', () => {
        const { hierarchy, policy } = setup();
        const fortified = resolveHousingEffects(policy, hierarchy, 'fortified-property');
        expect(resolveHousingTheftOutcome(fortified, 9499)).toEqual({ prevented: true,
            protectionBasisPoints: 9500, residualRiskBasisPoints: 500 });
        expect(resolveHousingTheftOutcome(fortified, 9500).prevented).toBeFalse();
        expect(() => resolveHousingTheftOutcome(fortified, 10_000)).toThrow('between 0 and 9999');
    });

    test('rejects missing, decreasing, foreign and tampered policies', () => {
        const { hierarchy, policy } = setup();
        const raw = { schemaVersion: 1, policyId: policy.policyId, version: policy.version,
            hierarchyPolicy: { policyId: hierarchy.policyId, version: hierarchy.version },
            effects: policy.effects };
        expect(() => validateHousingEffectPolicy({ ...raw, effects: raw.effects.slice(1) }, hierarchy))
            .toThrow('every hierarchy tier exactly once');
        expect(() => validateHousingEffectPolicy({ ...raw, effects: raw.effects.map((effect, index) =>
            index === 3 ? { ...effect, privateStorageSlots: 1 } : effect) }, hierarchy))
            .toThrow('must not decrease');
        expect(() => validateHousingEffectPolicy({ ...raw,
            hierarchyPolicy: { policyId: 'foreign', version: hierarchy.version } }, hierarchy))
            .toThrow('different hierarchy');
        expect(() => resolveHousingEffects({ ...policy, digest: '0'.repeat(64) }, hierarchy, 'street'))
            .toThrow('effect policy digest does not match');
    });
});
