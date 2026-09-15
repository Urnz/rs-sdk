import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSkillPotentialProfile, loadSkillPotentialPolicyCatalog, validateAttributeProfile,
    validateSkillPotentialPolicy } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'skill-potential-policies.json');

function attributes(value: number) {
    return validateAttributeProfile({ schemaVersion: 1, profileId: `attribute:ada:${value}`,
        version: '1.0.0', characterAgentId: 'ada', lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
        source: { origin: 'human-allocation', policyId: 'test', policyVersion: '1.0.0', seedDigest: null },
        scale: { minimum: 0, maximum: 10 },
        values: { intellect: value, dexterity: value, vigor: value, endurance: value,
            perception: value, will: value } });
}

function rawPolicy(): Record<string, unknown> {
    const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
    const { digest: _digest, ...definition } = policy;
    return JSON.parse(JSON.stringify(definition)) as Record<string, unknown>;
}

describe('skill potential profile', () => {
    test('loads exact skill-specific weights and derives a stable neutral profile', () => {
        const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
        expect(policy.skillWeights.map(item => item.skillId)).toEqual(['fishing', 'cooking', 'mining', 'smithing']);
        const first = createSkillPotentialProfile(attributes(5), policy);
        const second = createSkillPotentialProfile(attributes(5), policy);
        expect(first).toEqual(second);
        expect(first.skills).toHaveLength(4);
        expect(first.skills[0]).toEqual({ skillId: 'fishing', weightedAttributeScoreBps: 5000,
            talentBps: null, learningMultiplierBps: 10000, personalPotentialLevel: 70 });
        expect(first.sourceAttributeProfile.digest).toBe(attributes(5).digest);
    });

    test('uses bounded talent without mutating the source attribute profile', () => {
        const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
        const source = attributes(5), before = JSON.stringify(source);
        const profile = createSkillPotentialProfile(source, policy, [{ skillId: 'fishing', talentBps: 10000 }]);
        expect(profile.skills[0]).toMatchObject({ talentBps: 10000,
            learningMultiplierBps: 12000, personalPotentialLevel: 80 });
        expect(profile.skills[1]!.talentBps).toBeNull();
        expect(JSON.stringify(source)).toBe(before);
    });

    test('clamps low and high aptitude outcomes to policy limits', () => {
        const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
        expect(createSkillPotentialProfile(attributes(0), policy).skills[0]).toMatchObject({
            weightedAttributeScoreBps: 0, learningMultiplierBps: 7500, personalPotentialLevel: 40 });
        expect(createSkillPotentialProfile(attributes(10), policy).skills[0]).toMatchObject({
            weightedAttributeScoreBps: 10000, learningMultiplierBps: 12500, personalPotentialLevel: 99 });
    });

    test('rejects invalid weights, duplicate skills and invalid talent bindings', () => {
        const invalid = rawPolicy();
        const entries = invalid.skillWeights as Array<Record<string, unknown>>;
        (entries[0]!.weights as Record<string, number>).will = 999;
        expect(() => validateSkillPotentialPolicy(invalid)).toThrow('must total 10000');
        const duplicate = rawPolicy();
        const duplicated = duplicate.skillWeights as unknown[];
        duplicated.push(JSON.parse(JSON.stringify(duplicated[0])) as unknown);
        expect(() => validateSkillPotentialPolicy(duplicate)).toThrow('identities must be unique');
        const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
        expect(() => createSkillPotentialProfile(attributes(5), policy, [
            { skillId: 'fishing', talentBps: 1 }, { skillId: 'fishing', talentBps: 2 }
        ])).toThrow('duplicated');
        expect(() => createSkillPotentialProfile(attributes(5), policy,
            [{ skillId: 'woodcutting', talentBps: 1 }])).toThrow('not configured');
    });

    test('rejects changed validated policy evidence', () => {
        const policy = loadSkillPotentialPolicyCatalog(configPath).policies[0]!;
        expect(() => createSkillPotentialProfile(attributes(5), { ...policy, digest: '0'.repeat(64) }))
            .toThrow('digest does not match');
        expect(() => createSkillPotentialProfile({ ...attributes(5), digest: '0'.repeat(64) }, policy))
            .toThrow('attribute profile evidence does not match');
    });
});
