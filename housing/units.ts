import { createHash } from 'node:crypto';
import { resolveHousingTier } from './hierarchy.js';
import type { HousingTierPolicy, HousingUnitCatalog, HousingUnitDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function rec(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = keys.sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value.toLowerCase();
}
function int(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
        throw new Error(`${field} must be an integer between ${min} and ${max}`);
    }
    return Number(value);
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function housingUnitCatalogDigest(value: Omit<HousingUnitCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateHousingUnitCatalog(value: unknown, hierarchy: HousingTierPolicy,
    knownPropertyIds?: ReadonlySet<string>): HousingUnitCatalog {
    const input = rec(value, 'Housing unit catalog');
    exact(input, ['schemaVersion', 'units'], 'Housing unit catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.units) || input.units.length > 1_000) {
        throw new Error('Housing unit catalog is invalid');
    }
    const units: HousingUnitDefinition[] = input.units.map((entry, index) => {
        const field = `units[${index}]`, unit = rec(entry, field);
        exact(unit, ['housingUnitId', 'propertyId', 'tierId', 'enabled', 'capacity', 'rentGpPerPeriod',
            'rentPeriodSimulationMinutes', 'bedSlots'], field);
        if (typeof unit.enabled !== 'boolean') throw new Error(`${field}.enabled must be boolean`);
        if (!Array.isArray(unit.bedSlots)) throw new Error(`${field}.bedSlots must be an array`);
        const bedSlots = unit.bedSlots.map((bed, bedIndex) => {
            const item = rec(bed, `${field}.bedSlots[${bedIndex}]`);
            exact(item, ['bedSlotId', 'label'], `${field}.bedSlots[${bedIndex}]`);
            if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80) {
                throw new Error(`${field}.bedSlots[${bedIndex}].label is invalid`);
            }
            return { bedSlotId: id(item.bedSlotId, `${field}.bedSlots[${bedIndex}].bedSlotId`),
                label: item.label.trim() };
        });
        const capacity = int(unit.capacity, `${field}.capacity`, 1, 1_000);
        if (bedSlots.length !== capacity || new Set(bedSlots.map(bed => bed.bedSlotId)).size !== bedSlots.length) {
            throw new Error(`${field} capacity must equal its unique bed slots`);
        }
        const tierId = resolveHousingTier(hierarchy, id(unit.tierId, `${field}.tierId`)).tierId;
        const propertyId = id(unit.propertyId, `${field}.propertyId`);
        if (knownPropertyIds && !knownPropertyIds.has(propertyId)) {
            throw new Error(`${field}.propertyId references an unknown Property`);
        }
        return { housingUnitId: id(unit.housingUnitId, `${field}.housingUnitId`),
            propertyId, tierId, enabled: unit.enabled, capacity,
            rentGpPerPeriod: int(unit.rentGpPerPeriod, `${field}.rentGpPerPeriod`, 0, 2_147_483_647),
            rentPeriodSimulationMinutes: int(unit.rentPeriodSimulationMinutes,
                `${field}.rentPeriodSimulationMinutes`, 1, 525_600), bedSlots };
    });
    if (new Set(units.map(unit => unit.housingUnitId)).size !== units.length) {
        throw new Error('Housing unit identities must be unique');
    }
    const definition = { schemaVersion: 1 as const, units };
    return { ...definition, digest: housingUnitCatalogDigest(definition) };
}
