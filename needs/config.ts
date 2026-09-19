import { readFileSync } from 'node:fs';
import { validateNeedsPolicy } from './profile.js';
import { NEEDS_SCHEMA_VERSION, type NeedsPolicyCatalog } from './types.js';

export function validateNeedsPolicyCatalog(value: unknown): NeedsPolicyCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Needs policy catalog is invalid');
    const input = value as Record<string, unknown>;
    if (input.schemaVersion !== NEEDS_SCHEMA_VERSION || !Array.isArray(input.policies)
        || Object.keys(input).sort().join(',') !== 'policies,schemaVersion') {
        throw new Error('Needs policy catalog is invalid');
    }
    const policies = input.policies.map(validateNeedsPolicy);
    if (policies.length < 1 || policies.length > 100) throw new Error('Needs policy catalog requires 1-100 policies');
    const identities = new Set(policies.map(policy => `${policy.policyId}@${policy.version}`));
    if (identities.size !== policies.length) throw new Error('Needs policy identities must be unique');
    return { schemaVersion: NEEDS_SCHEMA_VERSION, policies };
}

export function loadNeedsPolicyCatalog(path: string): NeedsPolicyCatalog {
    return validateNeedsPolicyCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
