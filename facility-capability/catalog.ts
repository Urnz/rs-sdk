import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
    FacilityAccessKind,
    FacilityCapabilityCatalog,
    FacilityCapabilityDefinition,
    FacilityDefinition
} from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const ACCESS_KINDS: FacilityAccessKind[] = ['employment', 'lease', 'contract', 'explicit'];
function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error(`${field} fields are invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function facilityCapabilityCatalogDigest(value: Omit<FacilityCapabilityCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateFacilityCapabilityCatalog(value: unknown, knownPropertyIds: ReadonlySet<string>,
    knownBusinessIds: ReadonlySet<string> = new Set()): FacilityCapabilityCatalog {
    const input = record(value, 'Facility capability catalog');
    exact(input, ['schemaVersion', 'facilities'], 'Facility capability catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.facilities) || input.facilities.length < 1
        || input.facilities.length > 10_000) throw new Error('Facility capability catalog is invalid');
    const facilities: FacilityDefinition[] = input.facilities.map((entry, index) => {
        const field = `facilities[${index}]`, facility = record(entry, field);
        exact(facility, ['facilityId', 'label', 'propertyId', 'businessId', 'capabilities', 'allowedAccessKinds'], field);
        const propertyId = id(facility.propertyId, `${field}.propertyId`);
        if (!knownPropertyIds.has(propertyId)) throw new Error(`${field}.propertyId references an unknown Property`);
        const businessId = facility.businessId === null ? null : id(facility.businessId, `${field}.businessId`);
        if (businessId && !knownBusinessIds.has(businessId)) throw new Error(`${field}.businessId references an unknown Business`);
        if (typeof facility.label !== 'string' || !facility.label.trim() || facility.label.length > 120) {
            throw new Error(`${field}.label is invalid`);
        }
        if (!Array.isArray(facility.capabilities) || facility.capabilities.length < 1 || facility.capabilities.length > 100) {
            throw new Error(`${field}.capabilities is invalid`);
        }
        const capabilities: FacilityCapabilityDefinition[] = facility.capabilities.map((capabilityEntry, capabilityIndex) => {
            const name = `${field}.capabilities[${capabilityIndex}]`, capability = record(capabilityEntry, name);
            exact(capability, ['capabilityId', 'capacityUnits'], name);
            if (!Number.isSafeInteger(capability.capacityUnits) || Number(capability.capacityUnits) < 1
                || Number(capability.capacityUnits) > 1_000_000) throw new Error(`${name}.capacityUnits is invalid`);
            return { capabilityId: id(capability.capabilityId, `${name}.capabilityId`), capacityUnits: Number(capability.capacityUnits) };
        });
        if (new Set(capabilities.map(capability => capability.capabilityId)).size !== capabilities.length) {
            throw new Error(`${field}.capabilities must be unique`);
        }
        if (!Array.isArray(facility.allowedAccessKinds) || facility.allowedAccessKinds.length < 1
            || facility.allowedAccessKinds.some(kind => !ACCESS_KINDS.includes(kind as FacilityAccessKind))) {
            throw new Error(`${field}.allowedAccessKinds is invalid`);
        }
        const allowedAccessKinds = facility.allowedAccessKinds as FacilityAccessKind[];
        if (new Set(allowedAccessKinds).size !== allowedAccessKinds.length) throw new Error(`${field}.allowedAccessKinds must be unique`);
        return { facilityId: id(facility.facilityId, `${field}.facilityId`), label: facility.label.trim(), propertyId,
            businessId, capabilities, allowedAccessKinds };
    });
    if (new Set(facilities.map(facility => facility.facilityId)).size !== facilities.length) {
        throw new Error('Facility ids must be unique');
    }
    const definition = { schemaVersion: 1 as const, facilities };
    return { ...definition, digest: facilityCapabilityCatalogDigest(definition) };
}
export function loadDefaultFacilityCapabilityCatalog(): FacilityCapabilityCatalog {
    const root = join(import.meta.dir, '..', 'config');
    const properties = JSON.parse(readFileSync(join(root, 'properties.json'), 'utf8')) as { properties: Array<{ propertyId: string }> };
    return validateFacilityCapabilityCatalog(JSON.parse(readFileSync(join(root, 'facility-capabilities.json'), 'utf8')) as unknown,
        new Set(properties.properties.map(property => property.propertyId)));
}
