import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSkillPotentialProfile, loadSkillCapPolicyCatalog, loadSkillPotentialPolicyCatalog,
    resolveSkillCap, validateAttributeProfile, validateSkillCapPolicy } from '../index.js';

const config = (name: string) => join(import.meta.dir, '..', '..', 'config', name);

function potential() {
    const attributes = validateAttributeProfile({ schemaVersion: 1, profileId: 'attribute:ada:neutral',
        version: '1.0.0', characterAgentId: 'ada', lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
        source: { origin: 'human-allocation', policyId: 'test', policyVersion: '1.0.0', seedDigest: null },
        scale: { minimum: 0, maximum: 10 },
        values: { intellect: 5, dexterity: 5, vigor: 5, endurance: 5, perception: 5, will: 5 } });
    const policy = loadSkillPotentialPolicyCatalog(config('skill-potential-policies.json')).policies[0]!;
    return createSkillPotentialProfile(attributes, policy);
}

function policies() {
    const catalog = loadSkillCapPolicyCatalog(config('skill-cap-policies.json'));
    return Object.fromEntries(catalog.policies.map(policy => [policy.kind, policy])) as
        Record<string, (typeof catalog.policies)[number]>;
}

describe('personal skill cap policies', () => {
    test('loads all four policy kinds with immutable evidence', () => {
        const catalog = loadSkillCapPolicyCatalog(config('skill-cap-policies.json'));
        expect(catalog.policies.map(policy => policy.kind)).toEqual([
            'classic-99', 'attribute-hard-cap', 'attribute-soft-cap', 'facility-centered-cap'
        ]);
        expect(catalog.policies.every(policy => /^[0-9a-f]{64}$/.test(policy.digest))).toBeTrue();
    });

    test('keeps the classic personal ceiling at level 99', () => {
        const decision = resolveSkillCap(potential(), 'fishing', 70, policies()['classic-99']!);
        expect(decision).toMatchObject({ personalHardCapLevel: 99, personalSoftCapLevel: null,
            learningMultiplierBps: 10000, canGainPersonalLevel: true, providedCapabilityRequired: null });
        expect(resolveSkillCap(potential(), 'fishing', 99, policies()['classic-99']!).canGainPersonalLevel)
            .toBeFalse();
    });

    test('stops an attribute hard-cap exactly at personal potential', () => {
        const below = resolveSkillCap(potential(), 'fishing', 69, policies()['attribute-hard-cap']!);
        expect(below).toMatchObject({ personalHardCapLevel: 70, canGainPersonalLevel: true,
            learningMultiplierBps: 10000 });
        const at = resolveSkillCap(potential(), 'fishing', 70, policies()['attribute-hard-cap']!);
        expect(at).toMatchObject({ personalHardCapLevel: 70, canGainPersonalLevel: false,
            learningMultiplierBps: 0 });
    });

    test('slows learning above an attribute soft-cap while retaining level 99', () => {
        const below = resolveSkillCap(potential(), 'fishing', 69, policies()['attribute-soft-cap']!);
        expect(below).toMatchObject({ personalHardCapLevel: 99, personalSoftCapLevel: 70,
            learningMultiplierBps: 10000, canGainPersonalLevel: true });
        const above = resolveSkillCap(potential(), 'fishing', 70, policies()['attribute-soft-cap']!);
        expect(above).toMatchObject({ personalHardCapLevel: 99, personalSoftCapLevel: 70,
            learningMultiplierBps: 2500, canGainPersonalLevel: true });
    });

    test('keeps a facility capability separate from the lower personal cap', () => {
        const below = resolveSkillCap(potential(), 'smithing', 59, policies()['facility-centered-cap']!);
        expect(below).toMatchObject({ personalHardCapLevel: 60, canGainPersonalLevel: true,
            providedCapabilityRequired: 'advanced-production-facility' });
        const at = resolveSkillCap(potential(), 'smithing', 60, policies()['facility-centered-cap']!);
        expect(at).toMatchObject({ personalHardCapLevel: 60, canGainPersonalLevel: false,
            learningMultiplierBps: 0, providedCapabilityRequired: 'advanced-production-facility' });
    });

    test('fails closed for inconsistent policies, unknown skills and changed evidence', () => {
        expect(() => validateSkillCapPolicy({ schemaVersion: 1, policyId: 'bad', version: '1.0.0',
            kind: 'classic-99', maximumLevel: 98, softCapLearningMultiplierBps: null,
            facilityCapabilityId: null })).toThrow('must be level 99');
        expect(() => resolveSkillCap(potential(), 'woodcutting', 1, policies()['classic-99']!))
            .toThrow('not configured');
        expect(() => resolveSkillCap({ ...potential(), digest: '0'.repeat(64) }, 'fishing', 1,
            policies()['classic-99']!)).toThrow('digest does not match');
        expect(() => resolveSkillCap(potential(), 'fishing', 1,
            { ...policies()['classic-99']!, digest: '0'.repeat(64) })).toThrow('digest does not match');
    });
});
