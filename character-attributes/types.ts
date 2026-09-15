export const ATTRIBUTE_PROFILE_SCHEMA_VERSION = 1 as const;

export const ATTRIBUTE_KEYS = [
    'intellect', 'dexterity', 'vigor', 'endurance', 'perception', 'will'
] as const;

export type AttributeKey = typeof ATTRIBUTE_KEYS[number];
export type AttributeValues = Record<AttributeKey, number>;
export type AttributeProfileOrigin = 'genesis-lottery' | 'human-allocation' | 'migration-default';

export interface AttributeScale {
    minimum: number;
    maximum: number;
}

export interface AttributeProfileSource {
    origin: AttributeProfileOrigin;
    policyId: string;
    policyVersion: string;
    seedDigest: string | null;
}

/**
 * Immutable base aptitudes for one persistent player character.
 *
 * RuneScape levels, executable agent skills and facility capabilities deliberately
 * do not belong in this model. Later systems may derive effects from these values,
 * but must not rewrite the base profile to represent learning or equipment.
 */
export interface AttributeProfileDefinition {
    schemaVersion: typeof ATTRIBUTE_PROFILE_SCHEMA_VERSION;
    profileId: string;
    version: string;
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    source: AttributeProfileSource;
    scale: AttributeScale;
    values: AttributeValues;
}

export interface AttributeProfile extends AttributeProfileDefinition {
    totalPoints: number;
    digest: string;
}

export const ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION = 1 as const;

export interface AttributeBudgetWeight {
    points: number;
    weight: number;
}

export interface AttributeBudgetPolicyDefinition {
    schemaVersion: typeof ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION;
    policyId: string;
    version: string;
    characterKind: 'npc';
    scale: AttributeScale;
    distribution: {
        kind: 'bounded-discrete';
        minimumTotalPoints: number;
        maximumTotalPoints: number;
        weights: AttributeBudgetWeight[];
    };
    entropy: {
        algorithm: 'sha256-rejection-v1';
        namespace: string;
    };
}

export interface AttributeBudgetPolicy extends AttributeBudgetPolicyDefinition {
    digest: string;
}

export interface AttributeBudgetPolicyCatalog {
    schemaVersion: typeof ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION;
    policies: AttributeBudgetPolicy[];
}

export interface GenerateAttributeBudgetInput {
    seed: string;
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
}

export interface GeneratedAttributeBudgetDefinition {
    schemaVersion: typeof ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION;
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    policy: { policyId: string; version: string; digest: string };
    source: AttributeProfileSource;
    totalPoints: number;
    entropyDigest: string;
}

export interface GeneratedAttributeBudget extends GeneratedAttributeBudgetDefinition {
    digest: string;
}

export const ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION = 1 as const;

export type AttributeAllocationStrategy = 'generalist' | 'specialist' | 'unoptimized';

export interface AttributeAllocationStrategyWeight {
    strategy: AttributeAllocationStrategy;
    weight: number;
}

export interface AttributeAllocationPolicyDefinition {
    schemaVersion: typeof ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION;
    policyId: string;
    version: string;
    characterKind: 'npc';
    budgetPolicy: { policyId: string; version: string };
    strategies: AttributeAllocationStrategyWeight[];
    specialistFocusCount: number;
    entropy: {
        algorithm: 'sha256-rejection-v1';
        namespace: string;
    };
}

export interface AttributeAllocationPolicy extends AttributeAllocationPolicyDefinition {
    digest: string;
}

export interface AttributeAllocationPolicyCatalog {
    schemaVersion: typeof ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION;
    policies: AttributeAllocationPolicy[];
}

export interface GeneratedAttributeAllocationDefinition {
    schemaVersion: typeof ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION;
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    budget: GeneratedAttributeBudget;
    policy: { policyId: string; version: string; digest: string };
    strategy: AttributeAllocationStrategy;
    values: AttributeValues;
    entropyDigest: string;
}

export interface GeneratedAttributeAllocation extends GeneratedAttributeAllocationDefinition {
    digest: string;
}

export interface GeneratedNpcAttributeProfile {
    budget: GeneratedAttributeBudget;
    allocation: GeneratedAttributeAllocation;
    profile: AttributeProfile;
}

export const HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION = 1 as const;
export type HumanAttributeCreationMode = 'player-choice' | 'genetic-lottery';

export interface HumanAttributeCreationPolicyDefinition {
    schemaVersion: typeof HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION;
    policyId: string;
    version: string;
    characterKind: 'human-player';
    mode: HumanAttributeCreationMode;
    scale: AttributeScale;
    manualAllocation: { totalPoints: number } | null;
    lottery: {
        budgetPolicy: { policyId: string; version: string };
        allocationPolicy: { policyId: string; version: string };
    } | null;
}

export interface HumanAttributeCreationPolicy extends HumanAttributeCreationPolicyDefinition {
    digest: string;
}

export interface HumanAttributeCreationPolicyCatalog {
    schemaVersion: typeof HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION;
    policies: HumanAttributeCreationPolicy[];
}

export type CreateHumanAttributeProfileInput = {
    mode: 'player-choice';
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    values: AttributeValues;
} | {
    mode: 'genetic-lottery';
    characterAgentId: string;
    lifecycleCreatedAtSimulationTime: string;
    seed: string;
};

export interface HumanAttributeCreationResultDefinition {
    schemaVersion: typeof HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION;
    policy: { policyId: string; version: string; digest: string };
    mode: HumanAttributeCreationMode;
    profile: AttributeProfile;
    lotteryEvidence: GeneratedAttributeAllocation | null;
}

export interface HumanAttributeCreationResult extends HumanAttributeCreationResultDefinition {
    digest: string;
}

export const COMPETENCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** A personal RuneScape competence. It is never an executable agent procedure. */
export interface PersonalRuneScapeSkill {
    kind: 'personal-rs-skill';
    characterAgentId: string;
    skillId: string;
    level: number;
}

/** One exact verified procedure learned by the character's agent. */
export interface LearnedVerifiedAgentSkill {
    kind: 'verified-agent-skill';
    characterAgentId: string;
    skill: { id: string; version: string; checksum: string };
    learnedAtSimulationTime: string;
    status: 'verified';
    executable: true;
}

/** Effective access supplied by infrastructure or an organization, not owned aptitude. */
export interface ProvidedCapability {
    kind: 'provided-capability';
    characterAgentId: string;
    capabilityId: string;
    provider: { kind: 'facility' | 'organization'; providerId: string };
    grantId: string;
}

export interface CompetenceSnapshotDefinition {
    schemaVersion: typeof COMPETENCE_SNAPSHOT_SCHEMA_VERSION;
    snapshotId: string;
    characterAgentId: string;
    observedAtSimulationTime: string;
    personalSkills: PersonalRuneScapeSkill[];
    learnedProcedures: LearnedVerifiedAgentSkill[];
    providedCapabilities: ProvidedCapability[];
}

export interface CompetenceSnapshot extends CompetenceSnapshotDefinition {
    digest: string;
}

export type CompetenceRequirement =
    | { kind: 'personal-rs-skill'; skillId: string; minimumLevel: number }
    | { kind: 'verified-agent-skill'; skill: { id: string; version: string; checksum: string } }
    | { kind: 'provided-capability'; capabilityId: string;
        provider: { kind: 'facility' | 'organization'; providerId: string } | null };

export const SKILL_POTENTIAL_POLICY_SCHEMA_VERSION = 1 as const;

export interface SkillPotentialWeightDefinition {
    skillId: string;
    weights: Record<AttributeKey, number>;
}

export interface SkillPotentialPolicyDefinition {
    schemaVersion: typeof SKILL_POTENTIAL_POLICY_SCHEMA_VERSION;
    policyId: string;
    version: string;
    skillWeights: SkillPotentialWeightDefinition[];
    learning: {
        baseMultiplierBps: number;
        attributeInfluenceBps: number;
        talentInfluenceBps: number;
        minimumMultiplierBps: number;
        maximumMultiplierBps: number;
    };
    potential: {
        minimumLevel: number;
        maximumLevel: number;
        talentMaximumLevelAdjustment: number;
    };
}

export interface SkillPotentialPolicy extends SkillPotentialPolicyDefinition {
    digest: string;
}

export interface SkillPotentialPolicyCatalog {
    schemaVersion: typeof SKILL_POTENTIAL_POLICY_SCHEMA_VERSION;
    policies: SkillPotentialPolicy[];
}

export interface SkillTalentComponent {
    skillId: string;
    talentBps: number;
}

export interface SkillPotentialEntry {
    skillId: string;
    weightedAttributeScoreBps: number;
    talentBps: number | null;
    learningMultiplierBps: number;
    personalPotentialLevel: number;
}

export interface SkillPotentialProfileDefinition {
    schemaVersion: typeof SKILL_POTENTIAL_POLICY_SCHEMA_VERSION;
    profileId: string;
    version: string;
    characterAgentId: string;
    sourceAttributeProfile: { profileId: string; version: string; digest: string };
    policy: { policyId: string; version: string; digest: string };
    skills: SkillPotentialEntry[];
}

export interface SkillPotentialProfile extends SkillPotentialProfileDefinition {
    digest: string;
}

export const SKILL_CAP_POLICY_SCHEMA_VERSION = 1 as const;
export type SkillCapPolicyKind = 'classic-99' | 'attribute-hard-cap' | 'attribute-soft-cap'
    | 'facility-centered-cap';

export interface SkillCapPolicyDefinition {
    schemaVersion: typeof SKILL_CAP_POLICY_SCHEMA_VERSION;
    policyId: string;
    version: string;
    kind: SkillCapPolicyKind;
    maximumLevel: number;
    softCapLearningMultiplierBps: number | null;
    facilityCapabilityId: string | null;
}

export interface SkillCapPolicy extends SkillCapPolicyDefinition {
    digest: string;
}

export interface SkillCapPolicyCatalog {
    schemaVersion: typeof SKILL_CAP_POLICY_SCHEMA_VERSION;
    policies: SkillCapPolicy[];
}

export interface SkillCapDecisionDefinition {
    schemaVersion: typeof SKILL_CAP_POLICY_SCHEMA_VERSION;
    skillId: string;
    currentLevel: number;
    sourcePotentialProfile: { profileId: string; version: string; digest: string };
    policy: { policyId: string; version: string; digest: string; kind: SkillCapPolicyKind };
    personalHardCapLevel: number;
    personalSoftCapLevel: number | null;
    learningMultiplierBps: number;
    canGainPersonalLevel: boolean;
    providedCapabilityRequired: string | null;
}

export interface SkillCapDecision extends SkillCapDecisionDefinition {
    digest: string;
}

export const POTENTIAL_ENABLED_SKILLS = ['fishing', 'cooking', 'mining', 'smithing'] as const;
export type PotentialEnabledSkill = typeof POTENTIAL_ENABLED_SKILLS[number];

export interface SkillProgressionAwardDefinition {
    schemaVersion: typeof SKILL_CAP_POLICY_SCHEMA_VERSION;
    skillId: string;
    baseXp: number;
    grantedXp: number;
    applied: boolean;
    reason: 'vanilla-skill' | 'potential-adjusted' | 'personal-cap-reached';
    capDecision: SkillCapDecision | null;
}

export interface SkillProgressionAward extends SkillProgressionAwardDefinition {
    digest: string;
}

export const SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION = 1 as const;
export type SkillPotentialExperimentArm = 'control-vanilla' | 'treatment-potential';

export interface SkillPotentialExperimentEvent {
    eventId: string;
    skillId: PotentialEnabledSkill;
    baseXp: number;
    currentLevel: number;
}

export interface SkillPotentialExperimentDefinition {
    schemaVersion: typeof SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION;
    experimentId: string;
    version: string;
    treatmentPolicy: { policyId: string; version: string; digest: string };
    events: SkillPotentialExperimentEvent[];
}

export interface SkillPotentialTelemetrySummary {
    participantId: string;
    arm: SkillPotentialExperimentArm;
    awards: number;
    baseXp: number;
    grantedXp: number;
    adjustedXp: number;
    blockedAwards: number;
    softCappedAwards: number;
}

export interface SkillPotentialTelemetryEvent {
    participantId: string;
    arm: SkillPotentialExperimentArm;
    event: SkillPotentialExperimentEvent;
    award: SkillProgressionAward | null;
    grantedXp: number;
}

export interface SkillPotentialExperimentReportDefinition {
    schemaVersion: typeof SKILL_POTENTIAL_EXPERIMENT_SCHEMA_VERSION;
    experiment: { experimentId: string; version: string; digest: string };
    treatmentPolicy: { policyId: string; version: string; digest: string };
    workloadFingerprint: string;
    participants: Array<{ participantId: string; potentialProfileDigest: string }>;
    telemetry: SkillPotentialTelemetryEvent[];
    summaries: SkillPotentialTelemetrySummary[];
}

export interface SkillPotentialExperimentReport extends SkillPotentialExperimentReportDefinition {
    digest: string;
}
