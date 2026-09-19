import { createHash } from 'node:crypto';
import type { FurnishingCatalog, FurnishingCapabilities, FurnishingDefinition,
    FurnishingKind, FurnishingPlacementSlotDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const KINDS: readonly FurnishingKind[] = ['bed', 'chest', 'table', 'other'];
function record(value: unknown, field: string): Record<string, unknown> {
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
function integer(value: unknown, field: string, max: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
        throw new Error(`${field} must be an integer between 0 and ${max}`);
    }
    return Number(value);
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function furnishingCatalogDigest(value: Omit<FurnishingCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function capabilities(value: unknown, field: string): FurnishingCapabilities {
    const input = record(value, field);
    exact(input, ['sleepPlaces', 'privateStorageSlots', 'workSurfaces'], field);
    return { sleepPlaces: integer(input.sleepPlaces, `${field}.sleepPlaces`, 16),
        privateStorageSlots: integer(input.privateStorageSlots, `${field}.privateStorageSlots`, 10_000),
        workSurfaces: integer(input.workSurfaces, `${field}.workSurfaces`, 16) };
}
export function validateFurnishingCatalog(value: unknown,
    knownPropertyIds: ReadonlySet<string>): FurnishingCatalog {
    const input = record(value, 'Furnishing catalog');
    exact(input, ['schemaVersion', 'furnishings', 'placementSlots'], 'Furnishing catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.furnishings) || !Array.isArray(input.placementSlots)
        || input.furnishings.length < 1 || input.furnishings.length > 1_000
        || input.placementSlots.length > 10_000) throw new Error('Furnishing catalog is invalid');
    const furnishings: FurnishingDefinition[] = input.furnishings.map((value, index) => {
        const field = `furnishings[${index}]`, item = record(value, field);
        exact(item, ['furnishingTypeId', 'kind', 'label', 'capabilities'], field);
        if (!KINDS.includes(item.kind as FurnishingKind)) throw new Error(`${field}.kind is invalid`);
        if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80) {
            throw new Error(`${field}.label is invalid`);
        }
        const result = { furnishingTypeId: id(item.furnishingTypeId, `${field}.furnishingTypeId`),
            kind: item.kind as FurnishingKind, label: item.label.trim(),
            capabilities: capabilities(item.capabilities, `${field}.capabilities`) };
        if (Object.values(result.capabilities).every(count => count === 0)) {
            throw new Error(`${field} must grant at least one capability`);
        }
        return result;
    });
    const placementSlots: FurnishingPlacementSlotDefinition[] = input.placementSlots.map((value, index) => {
        const field = `placementSlots[${index}]`, item = record(value, field);
        exact(item, ['placementSlotId', 'propertyId', 'roomId', 'allowedKinds'], field);
        const propertyId = id(item.propertyId, `${field}.propertyId`);
        if (!knownPropertyIds.has(propertyId)) throw new Error(`${field}.propertyId references an unknown Property`);
        if (!Array.isArray(item.allowedKinds) || item.allowedKinds.length < 1
            || item.allowedKinds.some(kind => !KINDS.includes(kind as FurnishingKind))) {
            throw new Error(`${field}.allowedKinds is invalid`);
        }
        const allowedKinds = item.allowedKinds as FurnishingKind[];
        if (new Set(allowedKinds).size !== allowedKinds.length) throw new Error(`${field}.allowedKinds has duplicates`);
        return { placementSlotId: id(item.placementSlotId, `${field}.placementSlotId`), propertyId,
            roomId: id(item.roomId, `${field}.roomId`), allowedKinds };
    });
    if (new Set(furnishings.map(item => item.furnishingTypeId)).size !== furnishings.length
        || new Set(placementSlots.map(item => item.placementSlotId)).size !== placementSlots.length) {
        throw new Error('Furnishing and placement slot identities must be unique');
    }
    const definition = { schemaVersion: 1 as const, furnishings, placementSlots };
    return { ...definition, digest: furnishingCatalogDigest(definition) };
}
