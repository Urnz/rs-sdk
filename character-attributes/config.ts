import { readFileSync } from 'node:fs';
import { validateAttributeAllocationPolicy } from './allocation-policy.js';
import { validateAttributeBudgetPolicy } from './budget-policy.js';
import { validateHumanAttributeCreationPolicy } from './human-policy.js';
import { validateSkillPotentialPolicy } from './skill-potential.js';
import { ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION, ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION,
    HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION, type AttributeAllocationPolicyCatalog,
    SKILL_POTENTIAL_POLICY_SCHEMA_VERSION, type AttributeBudgetPolicyCatalog,
    type HumanAttributeCreationPolicyCatalog, type SkillPotentialPolicyCatalog } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateAttributeBudgetPolicyCatalog(value: unknown): AttributeBudgetPolicyCatalog {
    if (!record(value) || value.schemaVersion !== ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION
        || Object.keys(value).sort().join(',') !== 'policies,schemaVersion' || !Array.isArray(value.policies)) {
        throw new Error('Attribute budget policy catalog is invalid');
    }
    const policies = value.policies.map(validateAttributeBudgetPolicy);
    if (policies.length < 1 || policies.length > 100) throw new Error('Attribute budget catalog requires 1-100 policies');
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Attribute budget policy identities must be unique');
    return { schemaVersion: ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION, policies };
}

export function loadAttributeBudgetPolicyCatalog(path: string): AttributeBudgetPolicyCatalog {
    return validateAttributeBudgetPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function validateAttributeAllocationPolicyCatalog(value: unknown): AttributeAllocationPolicyCatalog {
    if (!record(value) || value.schemaVersion !== ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION
        || Object.keys(value).sort().join(',') !== 'policies,schemaVersion' || !Array.isArray(value.policies)) {
        throw new Error('Attribute allocation policy catalog is invalid');
    }
    const policies = value.policies.map(validateAttributeAllocationPolicy);
    if (policies.length < 1 || policies.length > 100) {
        throw new Error('Attribute allocation catalog requires 1-100 policies');
    }
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Attribute allocation policy identities must be unique');
    return { schemaVersion: ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION, policies };
}

export function loadAttributeAllocationPolicyCatalog(path: string): AttributeAllocationPolicyCatalog {
    return validateAttributeAllocationPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function validateHumanAttributeCreationPolicyCatalog(value: unknown): HumanAttributeCreationPolicyCatalog {
    if (!record(value) || value.schemaVersion !== HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION
        || Object.keys(value).sort().join(',') !== 'policies,schemaVersion' || !Array.isArray(value.policies)) {
        throw new Error('Human attribute creation policy catalog is invalid');
    }
    const policies = value.policies.map(validateHumanAttributeCreationPolicy);
    if (policies.length < 1 || policies.length > 100) {
        throw new Error('Human attribute creation catalog requires 1-100 policies');
    }
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Human attribute policy identities must be unique');
    return { schemaVersion: HUMAN_ATTRIBUTE_POLICY_SCHEMA_VERSION, policies };
}

export function loadHumanAttributeCreationPolicyCatalog(path: string): HumanAttributeCreationPolicyCatalog {
    return validateHumanAttributeCreationPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function validateSkillPotentialPolicyCatalog(value: unknown): SkillPotentialPolicyCatalog {
    if (!record(value) || value.schemaVersion !== SKILL_POTENTIAL_POLICY_SCHEMA_VERSION
        || Object.keys(value).sort().join(',') !== 'policies,schemaVersion' || !Array.isArray(value.policies)) {
        throw new Error('Skill potential policy catalog is invalid');
    }
    const policies = value.policies.map(validateSkillPotentialPolicy);
    if (policies.length < 1 || policies.length > 100) {
        throw new Error('Skill potential catalog requires 1-100 policies');
    }
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Skill potential policy identities must be unique');
    return { schemaVersion: SKILL_POTENTIAL_POLICY_SCHEMA_VERSION, policies };
}

export function loadSkillPotentialPolicyCatalog(path: string): SkillPotentialPolicyCatalog {
    return validateSkillPotentialPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
