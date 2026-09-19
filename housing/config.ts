import { readFileSync } from 'node:fs';
import { validateHousingEffectPolicy } from './effects.js';
import { validateHousingTierPolicy } from './hierarchy.js';
import { validateHousingUnitCatalog } from './units.js';
import { HOUSING_EFFECT_SCHEMA_VERSION, HOUSING_SCHEMA_VERSION, type HousingEffectPolicyCatalog,
    type HousingTierPolicy, type HousingTierPolicyCatalog, type HousingUnitCatalog } from './types.js';

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

export function validateHousingEffectPolicyCatalog(value: unknown,
    hierarchy: HousingTierPolicy): HousingEffectPolicyCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Housing effect policy catalog is invalid');
    }
    const input = value as Record<string, unknown>;
    if (input.schemaVersion !== HOUSING_EFFECT_SCHEMA_VERSION || !Array.isArray(input.policies)
        || Object.keys(input).sort().join(',') !== 'policies,schemaVersion') {
        throw new Error('Housing effect policy catalog is invalid');
    }
    const policies = input.policies.map(policy => validateHousingEffectPolicy(policy, hierarchy));
    if (policies.length < 1 || policies.length > 100) {
        throw new Error('Housing effect policy catalog requires 1-100 policies');
    }
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Housing effect policy identities must be unique');
    return { schemaVersion: HOUSING_EFFECT_SCHEMA_VERSION, policies };
}

export function loadHousingEffectPolicyCatalog(path: string,
    hierarchy: HousingTierPolicy): HousingEffectPolicyCatalog {
    return validateHousingEffectPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown, hierarchy);
}

export function loadHousingUnitCatalog(path: string, hierarchy: HousingTierPolicy,
    knownPropertyIds: ReadonlySet<string>): HousingUnitCatalog {
    return validateHousingUnitCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown,
        hierarchy, knownPropertyIds);
}
