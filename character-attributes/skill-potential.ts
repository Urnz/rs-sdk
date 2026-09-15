import { createHash } from 'node:crypto';
import { validateAttributeProfile } from './profile.js';
import { ATTRIBUTE_KEYS, SKILL_POTENTIAL_POLICY_SCHEMA_VERSION, type AttributeProfile,
    type SkillPotentialPolicy, type SkillPotentialPolicyDefinition, type SkillPotentialProfile,
    type SkillPotentialProfileDefinition, type SkillPotentialWeightDefinition,
    type SkillTalentComponent } from './types.js';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const WEIGHT_TOTAL_BPS = 10_000;

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function version(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} must use semantic versioning`);
    return value;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function skillPotentialPolicyDigest(value: SkillPotentialPolicyDefinition): string {
    return digest(value);
}

export function skillPotentialProfileDigest(value: SkillPotentialProfileDefinition): string {
    return digest(value);
}

function validateSkillWeights(value: unknown, index: number): SkillPotentialWeightDefinition {
    const field = `skillWeights[${index}]`, input = record(value, field);
    exact(input, ['skillId', 'weights'], field);
    const rawWeights = record(input.weights, `${field}.weights`);
    exact(rawWeights, ATTRIBUTE_KEYS, `${field}.weights`);
    const weights = Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key,
        integer(rawWeights[key], `${field}.weights.${key}`, 0, WEIGHT_TOTAL_BPS)])) as
        SkillPotentialWeightDefinition['weights'];
    const total = ATTRIBUTE_KEYS.reduce((sum, key) => sum + weights[key], 0);
    if (total !== WEIGHT_TOTAL_BPS) throw new Error(`${field}.weights must total 10000 basis points`);
    return { skillId: identifier(input.skillId, `${field}.skillId`), weights };
}

export function validateSkillPotentialPolicy(value: unknown): SkillPotentialPolicy {
    const input = record(value, 'Skill potential policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'skillWeights', 'learning', 'potential'],
        'Skill potential policy');
    if (input.schemaVersion !== SKILL_POTENTIAL_POLICY_SCHEMA_VERSION) {
        throw new Error(`Unsupported skill potential policy schema version: ${String(input.schemaVersion)}`);
    }
    if (!Array.isArray(input.skillWeights) || input.skillWeights.length < 1 || input.skillWeights.length > 100) {
        throw new Error('skillWeights requires 1-100 entries');
    }
    const skillWeights = input.skillWeights.map(validateSkillWeights);
    if (new Set(skillWeights.map(item => item.skillId)).size !== skillWeights.length) {
        throw new Error('skillWeights skill identities must be unique');
    }
    const learning = record(input.learning, 'learning');
    exact(learning, ['baseMultiplierBps', 'attributeInfluenceBps', 'talentInfluenceBps',
        'minimumMultiplierBps', 'maximumMultiplierBps'], 'learning');
    const minimumMultiplierBps = integer(learning.minimumMultiplierBps, 'learning.minimumMultiplierBps', 1, 100_000);
    const maximumMultiplierBps = integer(learning.maximumMultiplierBps, 'learning.maximumMultiplierBps',
        minimumMultiplierBps, 100_000);
    const baseMultiplierBps = integer(learning.baseMultiplierBps, 'learning.baseMultiplierBps',
        minimumMultiplierBps, maximumMultiplierBps);
    const potential = record(input.potential, 'potential');
    exact(potential, ['minimumLevel', 'maximumLevel', 'talentMaximumLevelAdjustment'], 'potential');
    const minimumLevel = integer(potential.minimumLevel, 'potential.minimumLevel', 1, 99);
    const maximumLevel = integer(potential.maximumLevel, 'potential.maximumLevel', minimumLevel, 99);
    const definition: SkillPotentialPolicyDefinition = {
        schemaVersion: SKILL_POTENTIAL_POLICY_SCHEMA_VERSION,
        policyId: identifier(input.policyId, 'policyId'), version: version(input.version, 'version'), skillWeights,
        learning: { baseMultiplierBps,
            attributeInfluenceBps: integer(learning.attributeInfluenceBps, 'learning.attributeInfluenceBps', 0, 100_000),
            talentInfluenceBps: integer(learning.talentInfluenceBps, 'learning.talentInfluenceBps', 0, 100_000),
            minimumMultiplierBps, maximumMultiplierBps },
        potential: { minimumLevel, maximumLevel,
            talentMaximumLevelAdjustment: integer(potential.talentMaximumLevelAdjustment,
                'potential.talentMaximumLevelAdjustment', 0, 98) }
    };
    return { ...definition, digest: skillPotentialPolicyDigest(definition) };
}

function resolvePolicy(value: SkillPotentialPolicyDefinition | SkillPotentialPolicy): SkillPotentialPolicy {
    const input = record(value, 'Skill potential policy');
    if (!Object.hasOwn(input, 'digest')) return validateSkillPotentialPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'skillWeights', 'learning', 'potential', 'digest'],
        'Validated skill potential policy');
    const { digest: supplied, ...definition } = input;
    const policy = validateSkillPotentialPolicy(definition);
    if (supplied !== policy.digest) throw new Error('Validated skill potential policy digest does not match');
    return policy;
}

function talentMap(values: readonly SkillTalentComponent[], configuredSkills: Set<string>): Map<string, number> {
    if (values.length > configuredSkills.size) throw new Error('Talent entries exceed configured skills');
    const result = new Map<string, number>();
    for (const [index, value] of values.entries()) {
        const input = record(value, `talents[${index}]`);
        exact(input, ['skillId', 'talentBps'], `talents[${index}]`);
        const skillId = identifier(input.skillId, `talents[${index}].skillId`);
        if (!configuredSkills.has(skillId)) throw new Error(`Talent skill is not configured: ${skillId}`);
        if (result.has(skillId)) throw new Error(`Talent skill is duplicated: ${skillId}`);
        result.set(skillId, integer(input.talentBps, `talents[${index}].talentBps`, -10_000, 10_000));
    }
    return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function resolveAttributeProfile(value: AttributeProfile): AttributeProfile {
    const input = record(value, 'Attribute profile');
    exact(input, ['schemaVersion', 'profileId', 'version', 'characterAgentId', 'lifecycleCreatedAtSimulationTime',
        'source', 'scale', 'values', 'totalPoints', 'digest'], 'Validated attribute profile');
    const { totalPoints: suppliedTotal, digest: suppliedDigest, ...definition } = input;
    const profile = validateAttributeProfile(definition);
    if (suppliedTotal !== profile.totalPoints || suppliedDigest !== profile.digest) {
        throw new Error('Validated attribute profile evidence does not match');
    }
    return profile;
}

export function createSkillPotentialProfile(attributeProfile: AttributeProfile,
    policyValue: SkillPotentialPolicyDefinition | SkillPotentialPolicy,
    talents: readonly SkillTalentComponent[] = []): SkillPotentialProfile {
    const policy = resolvePolicy(policyValue);
    const sourceProfile = resolveAttributeProfile(attributeProfile);
    if (!DIGEST.test(sourceProfile.digest)) throw new Error('Attribute profile digest is invalid');
    const range = sourceProfile.scale.maximum - sourceProfile.scale.minimum;
    if (!Number.isSafeInteger(range) || range < 1) throw new Error('Attribute profile scale is invalid');
    const configuredSkills = new Set(policy.skillWeights.map(item => item.skillId));
    const talentBySkill = talentMap(talents, configuredSkills);
    const skills = policy.skillWeights.map(item => {
        const weighted = ATTRIBUTE_KEYS.reduce((sum, key) => sum
            + (sourceProfile.values[key] - sourceProfile.scale.minimum) * item.weights[key], 0);
        const weightedAttributeScoreBps = Math.round(weighted / range);
        const talentBps = talentBySkill.get(item.skillId) ?? null;
        const talent = talentBps ?? 0;
        const attributeLearning = Math.round((weightedAttributeScoreBps - 5_000)
            * policy.learning.attributeInfluenceBps / 10_000);
        const talentLearning = Math.round(talent * policy.learning.talentInfluenceBps / 10_000);
        const learningMultiplierBps = clamp(policy.learning.baseMultiplierBps + attributeLearning + talentLearning,
            policy.learning.minimumMultiplierBps, policy.learning.maximumMultiplierBps);
        const basePotential = policy.potential.minimumLevel + Math.round(weightedAttributeScoreBps
            * (policy.potential.maximumLevel - policy.potential.minimumLevel) / 10_000);
        const talentPotential = Math.round(talent * policy.potential.talentMaximumLevelAdjustment / 10_000);
        const personalPotentialLevel = clamp(basePotential + talentPotential,
            policy.potential.minimumLevel, policy.potential.maximumLevel);
        return { skillId: item.skillId, weightedAttributeScoreBps, talentBps,
            learningMultiplierBps, personalPotentialLevel };
    });
    const definition: SkillPotentialProfileDefinition = {
        schemaVersion: SKILL_POTENTIAL_POLICY_SCHEMA_VERSION,
        profileId: `potential:${sourceProfile.characterAgentId}:${digest({ attribute: sourceProfile.digest,
            policy: policy.digest, skills }).slice(0, 16)}`,
        version: policy.version, characterAgentId: sourceProfile.characterAgentId,
        sourceAttributeProfile: { profileId: sourceProfile.profileId, version: sourceProfile.version,
            digest: sourceProfile.digest },
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest }, skills
    };
    return { ...definition, digest: skillPotentialProfileDigest(definition) };
}
