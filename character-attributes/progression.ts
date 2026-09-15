import { createHash } from 'node:crypto';
import { resolveSkillCap } from './skill-cap-policy.js';
import { POTENTIAL_ENABLED_SKILLS, SKILL_CAP_POLICY_SCHEMA_VERSION, type SkillCapPolicy,
    type SkillCapPolicyDefinition, type SkillPotentialProfile, type SkillProgressionAward,
    type SkillProgressionAwardDefinition } from './types.js';

const SKILL_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const enabledSkills = new Set<string>(POTENTIAL_ENABLED_SKILLS);

function digest(value: unknown): string {
    function canonical(entry: unknown): unknown {
        if (Array.isArray(entry)) return entry.map(canonical);
        if (!entry || typeof entry !== 'object') return entry;
        return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonical(child)]));
    }
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function result(definition: SkillProgressionAwardDefinition): SkillProgressionAward {
    return { ...definition, digest: digest(definition) };
}

/**
 * Bounded XP adapter for the first Phase 17 vertical slice.
 * Skills outside the explicit allowlist remain byte-for-byte vanilla and do not
 * require an attribute profile or cap policy.
 */
export function applySkillPotentialProgression(baseXpValue: number, skillIdValue: string, currentLevel: number,
    profile: SkillPotentialProfile | null,
    policy: SkillCapPolicyDefinition | SkillCapPolicy | null): SkillProgressionAward {
    if (!Number.isSafeInteger(baseXpValue) || baseXpValue < 0 || baseXpValue > 2_000_000_000) {
        throw new Error('baseXp must be an integer between 0 and 2000000000');
    }
    const skillId = skillIdValue.trim().toLowerCase();
    if (!SKILL_ID.test(skillId)) throw new Error('skillId is invalid');
    if (!enabledSkills.has(skillId)) return result({
        schemaVersion: SKILL_CAP_POLICY_SCHEMA_VERSION, skillId, baseXp: baseXpValue,
        grantedXp: baseXpValue, applied: false, reason: 'vanilla-skill', capDecision: null
    });
    if (!profile || !policy) throw new Error(`Potential-enabled skill requires profile and cap policy: ${skillId}`);
    const capDecision = resolveSkillCap(profile, skillId, currentLevel, policy);
    if (!capDecision.canGainPersonalLevel) return result({
        schemaVersion: SKILL_CAP_POLICY_SCHEMA_VERSION, skillId, baseXp: baseXpValue,
        grantedXp: 0, applied: true, reason: 'personal-cap-reached', capDecision
    });
    const grantedXp = baseXpValue === 0 ? 0
        : Math.max(1, Math.round(baseXpValue * capDecision.learningMultiplierBps / 10_000));
    return result({ schemaVersion: SKILL_CAP_POLICY_SCHEMA_VERSION, skillId, baseXp: baseXpValue,
        grantedXp, applied: true, reason: 'potential-adjusted', capDecision });
}
