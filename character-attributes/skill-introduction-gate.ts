import { createHash } from 'node:crypto';
import { SKILL_INTRODUCTION_GATE_SCHEMA_VERSION, type NewPersonalSkillProposal,
    type SkillIntroductionGateDecision, type SkillIntroductionGateDecisionDefinition,
    type SkillIntroductionGatePolicy, type SkillIntroductionGatePolicyDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const DIGEST = /^[0-9a-f]{64}$/;

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

function identifier(value: string, field: string): string {
    if (!ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function unique(values: readonly string[], field: string): void {
    if (new Set(values).size !== values.length) throw new Error(`${field} identities must be unique`);
}

export function skillIntroductionGatePolicyDigest(value: SkillIntroductionGatePolicyDefinition): string {
    return digest(value);
}

export function validateSkillIntroductionGatePolicy(value: SkillIntroductionGatePolicyDefinition):
    SkillIntroductionGatePolicy {
    if (value.schemaVersion !== SKILL_INTRODUCTION_GATE_SCHEMA_VERSION || !VERSION.test(value.version)
        || !Number.isSafeInteger(value.minimumIndependentEvidencePerGap)
        || value.minimumIndependentEvidencePerGap < 1 || value.minimumIndependentEvidencePerGap > 10
        || typeof value.requireExperimentEvidence !== 'boolean') {
        throw new Error('Skill introduction gate policy is invalid');
    }
    const definition: SkillIntroductionGatePolicyDefinition = {
        schemaVersion: SKILL_INTRODUCTION_GATE_SCHEMA_VERSION,
        policyId: identifier(value.policyId, 'policyId'), version: value.version,
        minimumIndependentEvidencePerGap: value.minimumIndependentEvidencePerGap,
        requireExperimentEvidence: value.requireExperimentEvidence
    };
    return { ...definition, digest: skillIntroductionGatePolicyDigest(definition) };
}

function resolvePolicy(value: SkillIntroductionGatePolicyDefinition | SkillIntroductionGatePolicy):
    SkillIntroductionGatePolicy {
    if (!('digest' in value)) return validateSkillIntroductionGatePolicy(value);
    const { digest: supplied, ...definition } = value;
    const policy = validateSkillIntroductionGatePolicy(definition);
    if (supplied !== policy.digest) throw new Error('Skill introduction gate policy digest does not match');
    return policy;
}

function validateProposal(value: NewPersonalSkillProposal): NewPersonalSkillProposal {
    if (value.schemaVersion !== SKILL_INTRODUCTION_GATE_SCHEMA_VERSION || !VERSION.test(value.version)
        || !Array.isArray(value.requirements) || value.requirements.length < 1 || value.requirements.length > 100
        || !value.alternatives || !Array.isArray(value.alternatives.personalSkills)
        || !Array.isArray(value.alternatives.verifiedProcedures)
        || !Array.isArray(value.alternatives.providedCapabilities) || !Array.isArray(value.gapEvidence)) {
        throw new Error('New personal skill proposal is invalid');
    }
    const requirementIds = value.requirements.map((item, index) => {
        identifier(item.requirementId, `requirements[${index}].requirementId`);
        if (!item.description.trim() || item.description.length > 500) throw new Error('Requirement description is invalid');
        return item.requirementId;
    });
    unique(requirementIds, 'Requirement');
    const known = new Set(requirementIds);
    const covers = (ids: string[], field: string) => {
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new Error(`${field} is invalid`);
        unique(ids, field);
        for (const id of ids) if (!known.has(id)) throw new Error(`${field} references an unknown requirement`);
    };
    for (const [index, item] of value.alternatives.personalSkills.entries()) {
        identifier(item.skillId, `personalSkills[${index}].skillId`);
        if (!Number.isSafeInteger(item.minimumLevel) || item.minimumLevel < 1 || item.minimumLevel > 99) {
            throw new Error(`personalSkills[${index}].minimumLevel is invalid`);
        }
        covers(item.covers, `personalSkills[${index}].covers`);
    }
    for (const [index, item] of value.alternatives.verifiedProcedures.entries()) {
        identifier(item.skill.id, `verifiedProcedures[${index}].skill.id`);
        if (!VERSION.test(item.skill.version) || !DIGEST.test(item.skill.checksum)) {
            throw new Error(`verifiedProcedures[${index}].skill evidence is invalid`);
        }
        covers(item.covers, `verifiedProcedures[${index}].covers`);
    }
    for (const [index, item] of value.alternatives.providedCapabilities.entries()) {
        identifier(item.capabilityId, `providedCapabilities[${index}].capabilityId`);
        if (item.providerKind !== 'facility' && item.providerKind !== 'organization') {
            throw new Error(`providedCapabilities[${index}].providerKind is invalid`);
        }
        covers(item.covers, `providedCapabilities[${index}].covers`);
    }
    if (value.gapEvidence.length > 1_000) throw new Error('gapEvidence exceeds 1000 entries');
    unique(value.gapEvidence.map(item => item.evidenceId), 'Gap evidence');
    for (const [index, item] of value.gapEvidence.entries()) {
        identifier(item.evidenceId, `gapEvidence[${index}].evidenceId`);
        if (!known.has(item.requirementId) || !DIGEST.test(item.sourceDigest)
            || (item.source !== 'experiment' && item.source !== 'domain-analysis')
            || !item.finding.trim() || item.finding.length > 500) throw new Error(`gapEvidence[${index}] is invalid`);
    }
    identifier(value.proposalId, 'proposalId');
    identifier(value.proposedSkillId, 'proposedSkillId');
    return structuredClone(value);
}

export function evaluateSkillIntroductionGate(proposalValue: NewPersonalSkillProposal,
    policyValue: SkillIntroductionGatePolicyDefinition | SkillIntroductionGatePolicy): SkillIntroductionGateDecision {
    const proposal = validateProposal(proposalValue), policy = resolvePolicy(policyValue);
    const covered = new Set<string>();
    for (const item of proposal.alternatives.personalSkills) item.covers.forEach(id => covered.add(id));
    for (const item of proposal.alternatives.verifiedProcedures) item.covers.forEach(id => covered.add(id));
    for (const item of proposal.alternatives.providedCapabilities) item.covers.forEach(id => covered.add(id));
    const requirementIds = proposal.requirements.map(item => item.requirementId);
    const coveredRequirementIds = requirementIds.filter(id => covered.has(id));
    const uncoveredRequirementIds = requirementIds.filter(id => !covered.has(id));
    const reasons: string[] = [];
    let outcome: SkillIntroductionGateDecision['outcome'];
    if (uncoveredRequirementIds.length === 0) {
        outcome = 'use-existing-composition';
        reasons.push('Every requirement is covered by existing personal skills, verified procedures or provided capabilities.');
    } else {
        for (const requirementId of uncoveredRequirementIds) {
            const evidence = proposal.gapEvidence.filter(item => item.requirementId === requirementId);
            const independent = new Set(evidence.map(item => item.sourceDigest)).size;
            if (independent < policy.minimumIndependentEvidencePerGap) reasons.push(
                `${requirementId} lacks ${policy.minimumIndependentEvidencePerGap} independent evidence records.`);
            if (policy.requireExperimentEvidence && !evidence.some(item => item.source === 'experiment')) {
                reasons.push(`${requirementId} lacks experiment evidence.`);
            }
        }
        outcome = reasons.length === 0 ? 'candidate-justified' : 'evidence-required';
        if (outcome === 'candidate-justified') reasons.push('Every uncovered requirement has sufficient independent evidence.');
    }
    const definition: SkillIntroductionGateDecisionDefinition = {
        schemaVersion: SKILL_INTRODUCTION_GATE_SCHEMA_VERSION,
        proposal: { proposalId: proposal.proposalId, proposedSkillId: proposal.proposedSkillId,
            version: proposal.version, digest: digest(proposal) },
        policy: { policyId: policy.policyId, version: policy.version, digest: policy.digest },
        coveredRequirementIds, uncoveredRequirementIds, outcome,
        mayIntroducePersonalSkill: outcome === 'candidate-justified', reasons
    };
    return { ...definition, digest: digest(definition) };
}
