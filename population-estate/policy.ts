import { readFileSync } from 'node:fs';
import { healthDigest, healthInteger, healthObject } from '../population-health/policy.js';
import { ESTATE_DOMAINS, type EstateDomain } from './schema.js';
export interface EstatePolicy {
    schemaVersion: 1; policyId: string; version: string; mode: 'custody'; maximumRowsPerSource: number;
    requiredDomains: EstateDomain[]; digest: string;
}
export function validateEstatePolicy(raw: unknown): EstatePolicy {
    const item = healthObject(raw, ['schemaVersion','policyId','version','mode','maximumRowsPerSource','requiredDomains'], 'Estate policy');
    if (item.schemaVersion !== 1 || typeof item.policyId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(item.policyId)
        || typeof item.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(item.version) || item.mode !== 'custody'
        || !Array.isArray(item.requiredDomains) || JSON.stringify(item.requiredDomains) !== JSON.stringify(ESTATE_DOMAINS))
        throw new Error('Estate policy must bind every custody domain');
    const definition = { schemaVersion: 1 as const, policyId: item.policyId, version: item.version, mode: 'custody' as const,
        maximumRowsPerSource: healthInteger(item.maximumRowsPerSource, 1, 100000), requiredDomains: [...ESTATE_DOMAINS] };
    return { ...definition, digest: healthDigest(definition) };
}
export function loadEstatePolicy(path: string): EstatePolicy { return validateEstatePolicy(JSON.parse(readFileSync(path, 'utf8'))); }
