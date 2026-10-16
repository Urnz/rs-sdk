import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { FurnishingPlacementStore } from './furnishing-store.js';
import { furnishingCatalogDigest } from './furnishings.js';
import { housingSecurityPolicyDigest, projectHousingSecurity } from './security.js';
import { housingUnitCatalogDigest } from './units.js';
import type { FurnishingCatalog, HousingEffectPolicy, HousingSecurityPolicy, HousingSecurityProjection,
    HousingTierPolicy, HousingUnitCatalog, PlacedHousingStorage } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
export interface StorageSurfaceBinding {
    placementSlotId: string;
    housingUnitId: string;
    storageSurfaceId: string;
}
export interface StorageSurfaceBindingCatalog {
    schemaVersion: 1;
    bindings: StorageSurfaceBinding[];
    digest: string;
}
export interface PlacedStorageSecurity {
    placementId: string;
    placementRevision: number;
    storageSlots: number;
    bindingDigest: string;
    security: HousingSecurityProjection;
}

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} is invalid`);
    return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
        throw new Error(`${field} fields are invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

export function validateStorageSurfaceBindings(value: unknown, furnishings: FurnishingCatalog,
    units: HousingUnitCatalog, policy: HousingSecurityPolicy): StorageSurfaceBindingCatalog {
    const { digest: furnishingDigest, ...furnishingDefinition } = furnishings;
    const { digest: unitDigest, ...unitDefinition } = units;
    const { digest: policyDigest, ...policyDefinition } = policy;
    if (furnishingCatalogDigest(furnishingDefinition) !== furnishingDigest
        || housingUnitCatalogDigest(unitDefinition) !== unitDigest
        || housingSecurityPolicyDigest(policyDefinition) !== policyDigest)
        throw new Error('Storage binding source catalog digest mismatch');
    const input = record(value, 'Storage bindings');
    exact(input, ['schemaVersion', 'bindings'], 'Storage bindings');
    if (input.schemaVersion !== 1 || !Array.isArray(input.bindings) || input.bindings.length > 10_000)
        throw new Error('Storage bindings are invalid');
    const bindings = input.bindings.map((value, index) => {
        const entry = record(value, `Storage binding ${index}`);
        exact(entry, ['placementSlotId', 'housingUnitId', 'storageSurfaceId'], `Storage binding ${index}`);
        const binding = { placementSlotId: id(entry.placementSlotId, 'placementSlotId'),
            housingUnitId: id(entry.housingUnitId, 'housingUnitId'),
            storageSurfaceId: id(entry.storageSurfaceId, 'storageSurfaceId') };
        const slot = furnishings.placementSlots.find(value => value.placementSlotId === binding.placementSlotId);
        const unit = units.units.find(value => value.housingUnitId === binding.housingUnitId && value.enabled);
        const tier = policy.tiers.find(value => value.tierId === unit?.tierId);
        if (!slot || !unit || slot.propertyId !== unit.propertyId
            || !furnishings.furnishings.some(value => value.capabilities.privateStorageSlots > 0
                && slot.allowedKinds.includes(value.kind))
            || !tier?.allowedStorageSurfaceIds.includes(binding.storageSurfaceId)
            || !policy.storageSurfaces.some(value => value.surfaceId === binding.storageSurfaceId))
            throw new Error(`Storage binding ${index} does not match an active storage surface`);
        return binding;
    }).sort((left, right) => left.placementSlotId.localeCompare(right.placementSlotId));
    if (new Set(bindings.map(value => value.placementSlotId)).size !== bindings.length)
        throw new Error('Storage placement slot has duplicate bindings');
    const definition = { schemaVersion: 1 as const, bindings };
    return { ...definition, digest: hash(definition) };
}
export function loadStorageSurfaceBindings(path: string, furnishings: FurnishingCatalog,
    units: HousingUnitCatalog, policy: HousingSecurityPolicy): StorageSurfaceBindingCatalog {
    return validateStorageSurfaceBindings(JSON.parse(readFileSync(path, 'utf8')) as unknown,
        furnishings, units, policy);
}

function storageDigest(placement: PlacedHousingStorage, bindingDigest: string): string {
    return hash({ placement, bindingDigest });
}

/** Read-only exact placement projection; it does not prove an engine opening or item transfer. */
export function projectPlacedStorageSecurity(placementId: string, store: FurnishingPlacementStore,
    bindings: StorageSurfaceBindingCatalog, furnishings: FurnishingCatalog,
    policy: HousingSecurityPolicy, hierarchy: HousingTierPolicy, effects: HousingEffectPolicy,
    units: HousingUnitCatalog): PlacedStorageSecurity {
    const { digest, ...definition } = bindings;
    if (validateStorageSurfaceBindings(definition, furnishings, units, policy).digest !== digest)
        throw new Error('Storage binding catalog digest mismatch');
    const placement = store.getStoragePlacement(placementId);
    if (!placement) throw new Error('No active audited storage placement');
    const binding = bindings.bindings.find(value => value.placementSlotId === placement.placementSlotId);
    const unit = units.units.find(value => value.housingUnitId === binding?.housingUnitId);
    if (!binding || !unit || unit.propertyId !== placement.propertyId)
        throw new Error('Storage placement has no matching Housing unit binding');
    const sourceEvidenceDigest = storageDigest(placement, digest);
    const observation = { observationId: `storage-surface:${sourceEvidenceDigest.slice(0, 40)}`,
        kind: 'storage' as const, housingUnitId: unit.housingUnitId,
        storageSurfaceId: binding.storageSurfaceId, storageSlots: placement.storageSlots,
        propertyLockLevel: null, sourceEvidenceDigest };
    const trusted = () => { const current = store.getStoragePlacement(placementId);
        return current !== null && storageDigest(current, digest) === sourceEvidenceDigest; };
    const security = projectHousingSecurity(policy, hierarchy, effects, units, observation, trusted);
    return { placementId: placement.placementId, placementRevision: placement.revision,
        storageSlots: placement.storageSlots, bindingDigest: digest, security };
}
