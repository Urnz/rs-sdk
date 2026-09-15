import { readFileSync } from 'node:fs';
import { validateAttributeAllocationPolicy } from './allocation-policy.js';
import { validateAttributeBudgetPolicy } from './budget-policy.js';
import { ATTRIBUTE_ALLOCATION_POLICY_SCHEMA_VERSION, ATTRIBUTE_BUDGET_POLICY_SCHEMA_VERSION,
    type AttributeAllocationPolicyCatalog, type AttributeBudgetPolicyCatalog } from './types.js';

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
