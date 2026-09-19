import { readFileSync } from 'node:fs';
import { validateHousingTierPolicy } from './hierarchy.js';
import { HOUSING_SCHEMA_VERSION, type HousingTierPolicyCatalog } from './types.js';

export function validateHousingTierPolicyCatalog(value: unknown): HousingTierPolicyCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Housing tier policy catalog is invalid');
    }
    const input = value as Record<string, unknown>;
    if (input.schemaVersion !== HOUSING_SCHEMA_VERSION || !Array.isArray(input.policies)
        || Object.keys(input).sort().join(',') !== 'policies,schemaVersion') {
        throw new Error('Housing tier policy catalog is invalid');
    }
    const policies = input.policies.map(validateHousingTierPolicy);
    if (policies.length < 1 || policies.length > 100) {
        throw new Error('Housing tier policy catalog requires 1-100 policies');
    }
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Housing tier policy identities must be unique');
    return { schemaVersion: HOUSING_SCHEMA_VERSION, policies };
}

export function loadHousingTierPolicyCatalog(path: string): HousingTierPolicyCatalog {
    return validateHousingTierPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
