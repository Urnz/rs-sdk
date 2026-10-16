import { readFileSync } from 'node:fs';

import type { PropertyView } from '../server/engine/src/mods/PropertyRuntime.js';
import type { EngineThievingTarget } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { FurnishingPlacementStore } from './furnishing-store.js';
import { projectPlacedStorageSecurity, type StorageSurfaceBindingCatalog } from './placed-storage-security.js';
import type { FurnishingCatalog, HousingEffectPolicy, HousingSecurityPolicy,
    HousingTierPolicy, HousingUnitCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

export interface EngineHousingStorageLocation {
    locTypeId: number;
    x: number;
    z: number;
    level: number;
    placementId: string;
}

export interface EngineHousingStorageLocationCatalog {
    schemaVersion: 1;
    locations: EngineHousingStorageLocation[];
}

/** Event-time proof that an actual engine container operation used an audited Housing placement. */
export interface EngineHousingStorageAccessSnapshot {
    placementId: string;
    placementRevision: number;
    placementSlotId: string;
    placementEvidenceDigest: string;
    bindingDigest: string;
    housingUnitId: string;
    propertyId: string;
    storageSurfaceId: string;
    storageSlots: number;
    lockLevel: number;
    traceBasisPoints: number;
    propertyStateVersion: number;
    actorAuthorized: boolean;
    owner: { kind: 'player' | 'business' | 'faction'; id: string } | null;
}

function integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
        throw new Error(`${field} is invalid`);
    return Number(value);
}

export function validateEngineHousingStorageLocations(value: unknown): EngineHousingStorageLocationCatalog {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Engine Housing storage locations are invalid');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'locations,schemaVersion'
        || input.schemaVersion !== 1 || !Array.isArray(input.locations) || input.locations.length > 10_000)
        throw new Error('Engine Housing storage locations are invalid');
    const locations = input.locations.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Engine Housing storage location ${index} is invalid`);
        const entry = value as Record<string, unknown>;
        if (Object.keys(entry).sort().join(',') !== 'level,locTypeId,placementId,x,z'
            || typeof entry.placementId !== 'string' || !ID.test(entry.placementId))
            throw new Error(`Engine Housing storage location ${index} is invalid`);
        return { locTypeId: integer(entry.locTypeId, 'locTypeId', 0, 65_535),
            x: integer(entry.x, 'x', 0, 16_383), z: integer(entry.z, 'z', 0, 16_383),
            level: integer(entry.level, 'level', 0, 3), placementId: entry.placementId.toLowerCase() };
    });
    const targets = locations.map(value => `${value.locTypeId}:${value.x}:${value.z}:${value.level}`);
    if (new Set(targets).size !== targets.length || new Set(locations.map(value => value.placementId)).size !== locations.length)
        throw new Error('Engine Housing storage locations must be unique');
    return { schemaVersion: 1, locations };
}

export function loadEngineHousingStorageLocations(path: string): EngineHousingStorageLocationCatalog {
    return validateEngineHousingStorageLocations(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export interface EngineHousingStorageRuntimeDependencies {
    placements: FurnishingPlacementStore;
    locations: EngineHousingStorageLocationCatalog;
    bindings: StorageSurfaceBindingCatalog;
    furnishings: FurnishingCatalog;
    policy: HousingSecurityPolicy;
    hierarchy: HousingTierPolicy;
    effects: HousingEffectPolicy;
    units: HousingUnitCatalog;
    property: (propertyId: string) => PropertyView | null;
    canEnter: (property: PropertyView, username: string, isAdmin: boolean) => boolean;
}

/** Resolves only an exact configured loc and rechecks the active placement audit before returning. */
export function resolveEngineHousingStorageAccess(target: EngineThievingTarget, username: string, isAdmin: boolean,
    deps: EngineHousingStorageRuntimeDependencies): EngineHousingStorageAccessSnapshot | undefined {
    if (target.kind !== 'loc') return undefined;
    const location = deps.locations.locations.find(value => value.locTypeId === target.typeId
        && value.x === target.x && value.z === target.z && value.level === target.level);
    if (!location) return undefined;
    const placed = deps.placements.getStoragePlacement(location.placementId);
    if (!placed) throw new Error('Configured Housing storage has no active audited placement');
    const projected = projectPlacedStorageSecurity(location.placementId, deps.placements, deps.bindings,
        deps.furnishings, deps.policy, deps.hierarchy, deps.effects, deps.units);
    if (!projected.security.propertyId || !projected.security.housingUnitId
        || !projected.security.storageSurfaceId) throw new Error('Housing storage projection is incomplete');
    const property = deps.property(projected.security.propertyId);
    if (!property || property.state.version < 1) throw new Error('Housing storage Property state is unavailable');
    return { placementId: placed.placementId, placementRevision: placed.revision,
        placementSlotId: placed.placementSlotId, placementEvidenceDigest: projected.security.sourceEvidenceDigest,
        bindingDigest: projected.bindingDigest, housingUnitId: projected.security.housingUnitId,
        propertyId: projected.security.propertyId, storageSurfaceId: projected.security.storageSurfaceId!,
        storageSlots: projected.storageSlots, lockLevel: projected.security.lockLevel,
        traceBasisPoints: projected.security.traceBasisPoints, propertyStateVersion: property.state.version,
        actorAuthorized: deps.canEnter(property, username.toLowerCase(), isAdmin), owner: property.state.owner };
}
