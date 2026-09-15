import { createHash } from 'node:crypto';
import { skillPotentialProfileDigest } from './skill-potential.js';
import { SKILL_CAP_POLICY_SCHEMA_VERSION, type SkillCapDecision, type SkillCapDecisionDefinition,
    type SkillCapPolicy, type SkillCapPolicyDefinition, type SkillCapPolicyKind,
    type SkillPotentialProfile } from './types.js';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KINDS = new Set<SkillCapPolicyKind>([
    'classic-99', 'attribute-hard-cap', 'attribute-soft-cap', 'facility-centered-cap'
]);

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

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function version(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} must use semantic versioning`);
    return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
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

export function skillCapPolicyDigest(value: SkillCapPolicyDefinition): string {
    return digest(value);
}

export function skillCapDecisionDigest(value: SkillCapDecisionDefinition): string {
    return digest(value);
}

export function validateSkillCapPolicy(value: unknown): SkillCapPolicy {
    const input = record(value, 'Skill cap policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'kind', 'maximumLevel',
        'softCapLearningMultiplierBps', 'facilityCapabilityId'], 'Skill cap policy');
    if (input.schemaVersion !== SKILL_CAP_POLICY_SCHEMA_VERSION || !KINDS.has(input.kind as SkillCapPolicyKind)) {
        throw new Error('Skill cap policy identity is invalid');
    }
    const kind = input.kind as SkillCapPolicyKind;
    const maximumLevel = integer(input.maximumLevel, 'maximumLevel', 1, 99);
    const softCapLearningMultiplierBps = input.softCapLearningMultiplierBps === null ? null
        : integer(input.softCapLearningMultiplierBps, 'softCapLearningMultiplierBps', 1, 9_999);
    const facilityCapabilityId = input.facilityCapabilityId === null ? null
        : identifier(input.facilityCapabilityId, 'facilityCapabilityId');
    if (kind === 'classic-99' && maximumLevel !== 99) throw new Error('Classic cap must be level 99');
    if ((kind === 'classic-99' || kind === 'attribute-hard-cap')
        && (softCapLearningMultiplierBps !== null || facilityCapabilityId !== null)) {
        throw new Error(`${kind} has incompatible configuration`);
    }
    if (kind === 'attribute-soft-cap'
        && (softCapLearningMultiplierBps === null || facilityCapabilityId !== null || maximumLevel !== 99)) {
        throw new Error('attribute-soft-cap has incompatible configuration');
    }
    if (kind === 'facility-centered-cap'
        && (facilityCapabilityId === null || softCapLearningMultiplierBps !== null || maximumLevel >= 99)) {
        throw new Error('facility-centered-cap has incompatible configuration');
    }
    const definition: SkillCapPolicyDefinition = {
        schemaVersion: SKILL_CAP_POLICY_SCHEMA_VERSION, policyId: identifier(input.policyId, 'policyId'),
        version: version(input.version, 'version'), kind, maximumLevel,
        softCapLearningMultiplierBps, facilityCapabilityId
    };
    return { ...definition, digest: skillCapPolicyDigest(definition) };
}

function resolvePolicy(value: SkillCapPolicyDefinition | SkillCapPolicy): SkillCapPolicy {
    const input = record(value, 'Skill cap policy');
    if (!Object.hasOwn(input, 'digest')) return validateSkillCapPolicy(input);
    exact(input, ['schemaVersion', 'policyId', 'version', 'kind', 'maximumLevel',
        'softCapLearningMultiplierBps', 'facilityCapabilityId', 'digest'], 'Validated skill cap policy');
    const { digest: supplied, ...definition } = input;
    const policy = validateSkillCapPolicy(definition);
    if (supplied !== policy.digest) throw new Error('Validated skill cap policy digest does not match');
    return policy;
}

function verifyPotentialProfile(value: SkillPotentialProfile): void {
    const input = record(value, 'Skill potential profile');
    exact(input, ['schemaVersion', 'profileId', 'version', 'characterAgentId', 'sourceAttributeProfile',
        'policy', 'skills', 'digest'], 'Skill potential profile');
    if (!DIGEST.test(value.digest)) throw new Error('Skill potential profile digest is invalid');
    const { digest: supplied, ...definition } = value;
    if (supplied !== skillPotentialProfileDigest(definition)) {
        throw new Error('Skill potential profile digest does not match its content');
    }
}

export function resolveSkillCap(profile: SkillPotentialProfile, skillIdValue: string, currentLevelValue: number,
    policyValue: SkillCapPolicyDefinition | SkillCapPolicy): SkillCapDecision {
    verifyPotentialProfile(profile);
    const policy = resolvePolicy(policyValue);
    const skillId = identifier(skillIdValue, 'skillId');
    const currentLevel = integer(currentLevelValue, 'currentLevel', 1, 99);
    const potential = profile.skills.find(item => item.skillId === skillId);
    if (!potential) throw new Error(`Skill potential is not configured: ${skillId}`);
    let personalHardCapLevel: number, personalSoftCapLevel: number | null = null;
    let learningMultiplierBps = potential.learningMultiplierBps;
    if (policy.kind === 'classic-99') personalHardCapLevel = 99;
    else if (policy.kind === 'attribute-hard-cap') personalHardCapLevel = potential.personalPotentialLevel;
    else if (policy.kind === 'attribute-soft-cap') {
        personalHardCapLevel = 99;
        personalSoftCapLevel = potential.personalPotentialLevel;
        if (currentLevel >= personalSoftCapLevel) learningMultiplierBps = Math.max(1,
            Math.round(learningMultiplierBps * policy.softCapLearningMultiplierBps! / 10_000));
    } else personalHardCapLevel = Math.min(policy.maximumLevel, potential.personalPotentialLevel);
    personalHardCapLevel = Math.min(personalHardCapLevel, policy.maximumLevel);
    const canGainPersonalLevel = currentLevel < personalHardCapLevel;
    if (!canGainPersonalLevel) learningMultiplierBps = 0;
    const definition: SkillCapDecisionDefinition = {
        schemaVersion: SKILL_CAP_POLICY_SCHEMA_VERSION, skillId, currentLevel,
        sourcePotentialProfile: { profileId: profile.profileId, version: profile.version, digest: profile.digest },
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest, kind: policy.kind },
        personalHardCapLevel, personalSoftCapLevel, learningMultiplierBps, canGainPersonalLevel,
        providedCapabilityRequired: policy.facilityCapabilityId
    };
    return { ...definition, digest: skillCapDecisionDigest(definition) };
}
