import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { applySkillPotentialProgression, createSkillPotentialProfile, loadSkillCapPolicyCatalog,
    loadSkillPotentialPolicyCatalog, POTENTIAL_ENABLED_SKILLS, validateAttributeProfile } from '../index.js';

const config = (name: string) => join(import.meta.dir, '..', '..', 'config', name);

function potential(attributeValue: number) {
    const attributes = validateAttributeProfile({ schemaVersion: 1,
        profileId: `attribute:agent-${attributeValue}:profile`, version: '1.0.0',
        characterAgentId: `agent-${attributeValue}`, lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
        source: { origin: 'human-allocation', policyId: 'test', policyVersion: '1.0.0', seedDigest: null },
        scale: { minimum: 0, maximum: 10 }, values: { intellect: attributeValue, dexterity: attributeValue,
            vigor: attributeValue, endurance: attributeValue, perception: attributeValue, will: attributeValue } });
    const policy = loadSkillPotentialPolicyCatalog(config('skill-potential-policies.json')).policies[0]!;
    return createSkillPotentialProfile(attributes, policy);
}

function hardCapPolicy() {
    return loadSkillCapPolicyCatalog(config('skill-cap-policies.json')).policies
        .find(policy => policy.kind === 'attribute-hard-cap')!;
}

describe('potential-enabled skill progression vertical slice', () => {
    test('gives different learning paths to equally experienced characters with different aptitudes', () => {
        const lower = applySkillPotentialProgression(80, 'FISHING', 20, potential(0), hardCapPolicy());
        const higher = applySkillPotentialProgression(80, 'fishing', 20, potential(10), hardCapPolicy());
        expect(lower).toMatchObject({ skillId: 'fishing', grantedXp: 60, applied: true,
            reason: 'potential-adjusted', capDecision: { personalHardCapLevel: 40 } });
        expect(higher).toMatchObject({ skillId: 'fishing', grantedXp: 100, applied: true,
            reason: 'potential-adjusted', capDecision: { personalHardCapLevel: 99 } });
    });

    test('applies the adapter to exactly the four configured vertical skills', () => {
        expect(POTENTIAL_ENABLED_SKILLS).toEqual(['fishing', 'cooking', 'mining', 'smithing']);
        const profile = potential(5), policy = hardCapPolicy();
        for (const skillId of POTENTIAL_ENABLED_SKILLS) {
            expect(applySkillPotentialProgression(50, skillId, 1, profile, policy).applied).toBeTrue();
        }
    });

    test('leaves every non-target skill byte-for-byte vanilla without profile data', () => {
        for (const skillId of ['woodcutting', 'attack', 'thieving']) {
            expect(applySkillPotentialProgression(83, skillId, 99, null, null)).toMatchObject({
                skillId, baseXp: 83, grantedXp: 83, applied: false,
                reason: 'vanilla-skill', capDecision: null
            });
        }
    });

    test('withholds personal XP at a hard cap and retains exact decision evidence', () => {
        const first = applySkillPotentialProgression(80, 'mining', 40, potential(0), hardCapPolicy());
        const second = applySkillPotentialProgression(80, 'mining', 40, potential(0), hardCapPolicy());
        expect(first).toEqual(second);
        expect(first).toMatchObject({ grantedXp: 0, applied: true, reason: 'personal-cap-reached',
            capDecision: { personalHardCapLevel: 40, canGainPersonalLevel: false } });
        expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('fails closed for targeted skills without exact profile and policy evidence', () => {
        expect(() => applySkillPotentialProgression(10, 'cooking', 1, null, hardCapPolicy()))
            .toThrow('requires profile and cap policy');
        expect(() => applySkillPotentialProgression(10, 'smithing', 1, potential(5), null))
            .toThrow('requires profile and cap policy');
        expect(() => applySkillPotentialProgression(-1, 'fishing', 1, potential(5), hardCapPolicy()))
            .toThrow('baseXp');
    });
});
