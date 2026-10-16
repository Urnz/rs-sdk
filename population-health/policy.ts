import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { HealthPolicy, HealthPolicyDefinition } from './types.js';

export function healthDigest(value: unknown): string {
    const canonical = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(canonical)
        : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : entry;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function healthObject(value: unknown, fields: string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error(`${label} fields are invalid`);
    return value as Record<string, unknown>;
}
export function healthKey(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)) throw new Error('Health identifier is invalid');
    return value;
}
export function healthInteger(value: unknown, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Health integer is outside bounds');
    return value;
}
export function healthTime(value: string): number {
    const result = Date.parse(value);
    if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new Error('Health time must be canonical UTC ISO');
    return result;
}
function reference(raw: unknown, key: 'policyId' | 'id', digestKey: 'digest' | 'checksum') {
    const value = healthObject(raw, [key, 'version', digestKey], 'Health policy reference');
    healthKey(value[key]);
    if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)
        || typeof value[digestKey] !== 'string' || !/^[a-f0-9]{64}$/.test(value[digestKey])) throw new Error('Health reference is invalid');
    return value;
}
export function validateHealthPolicy(raw: unknown): HealthPolicy {
    const value = healthObject(raw, ['schemaVersion', 'policyId', 'version', 'agePolicy', 'recoveryBurdenPerSimulationHour',
        'treatmentRequiredBurden', 'untreatedRecoveryFloor', 'criticalBurden', 'maximumOpenInjuries', 'treatments'], 'Health policy');
    if (value.schemaVersion !== 1 || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) throw new Error('Health policy version is invalid');
    const agePolicy = reference(value.agePolicy, 'policyId', 'digest') as unknown as HealthPolicyDefinition['agePolicy'];
    const required = healthInteger(value.treatmentRequiredBurden, 1, 10000);
    const floor = healthInteger(value.untreatedRecoveryFloor, 1, required);
    if (!Array.isArray(value.treatments) || value.treatments.length > 32) throw new Error('Health treatments are invalid');
    const treatments = value.treatments.map(rawTreatment => {
        const treatment = healthObject(rawTreatment, ['treatmentId', 'skill', 'capabilityId', 'minimumHerbloreLevel', 'reliefBurden'], 'Health treatment');
        return { treatmentId: healthKey(treatment.treatmentId), capabilityId: healthKey(treatment.capabilityId),
            skill: reference(treatment.skill, 'id', 'checksum') as unknown as HealthPolicyDefinition['treatments'][number]['skill'],
            minimumHerbloreLevel: healthInteger(treatment.minimumHerbloreLevel, 1, 99),
            reliefBurden: healthInteger(treatment.reliefBurden, 1, 10000) };
    });
    if (new Set(treatments.map(item => item.treatmentId)).size !== treatments.length) throw new Error('Health treatment ids must be unique');
    const definition: HealthPolicyDefinition = { schemaVersion: 1, policyId: healthKey(value.policyId), version: value.version,
        agePolicy: { ...agePolicy }, recoveryBurdenPerSimulationHour: healthInteger(value.recoveryBurdenPerSimulationHour, 1, 10000),
        treatmentRequiredBurden: required, untreatedRecoveryFloor: floor, criticalBurden: healthInteger(value.criticalBurden, 1, 10000),
        maximumOpenInjuries: healthInteger(value.maximumOpenInjuries, 1, 256), treatments };
    return { ...definition, digest: healthDigest(definition) };
}
export function loadHealthPolicy(path: string): HealthPolicy { return validateHealthPolicy(JSON.parse(readFileSync(path, 'utf8'))); }
