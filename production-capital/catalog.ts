import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDefaultFacilityCapabilityCatalog } from '../facility-capability/index.js';
import { loadItemLifecycleCatalog, loadItemRepairPolicyCatalog } from '../item-lifecycle/index.js';
import type { ProductionCapitalCatalog, ProductionCapitalDefinition } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
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
function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}
export function productionCapitalCatalogDigest(value: Omit<ProductionCapitalCatalog, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateProductionCapitalCatalog(value: unknown, lifecycleTypeIds: ReadonlySet<string>,
    maintenancePolicyIds: ReadonlySet<string>, installationCapabilityIds: ReadonlySet<string>): ProductionCapitalCatalog {
    const input = record(value, 'Production capital catalog');
    exact(input, ['schemaVersion', 'assets'], 'Production capital catalog');
    if (input.schemaVersion !== 1 || !Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 1_000) {
        throw new Error('Production capital catalog is invalid');
    }
    const assets: ProductionCapitalDefinition[] = input.assets.map((entry, index) => {
        const field = `assets[${index}]`, asset = record(entry, field);
        exact(asset, ['capitalAssetTypeId', 'lifecycleTypeId', 'installationCapabilityId', 'providedCapabilities',
            'effects', 'wearUsesPerBatch', 'maintenancePolicyId'], field);
        const lifecycleTypeId = id(asset.lifecycleTypeId, `${field}.lifecycleTypeId`);
        const installationCapabilityId = id(asset.installationCapabilityId, `${field}.installationCapabilityId`);
        const maintenancePolicyId = id(asset.maintenancePolicyId, `${field}.maintenancePolicyId`);
        if (!lifecycleTypeIds.has(lifecycleTypeId) || !maintenancePolicyIds.has(maintenancePolicyId)
            || !installationCapabilityIds.has(installationCapabilityId)) throw new Error(`${field} has an unknown lifecycle, maintenance or facility binding`);
        if (!Array.isArray(asset.providedCapabilities) || asset.providedCapabilities.length < 1
            || asset.providedCapabilities.length > 100) throw new Error(`${field}.providedCapabilities is invalid`);
        const providedCapabilities = asset.providedCapabilities.map((value, capabilityIndex) =>
            id(value, `${field}.providedCapabilities[${capabilityIndex}]`));
        if (new Set(providedCapabilities).size !== providedCapabilities.length) throw new Error(`${field}.providedCapabilities must be unique`);
        const effects = record(asset.effects, `${field}.effects`);
        exact(effects, ['throughputMultiplierBasisPoints', 'qualityBonusBasisPoints', 'failureReductionBasisPoints',
            'capacityBonusUnits'], `${field}.effects`);
        return { capitalAssetTypeId: id(asset.capitalAssetTypeId, `${field}.capitalAssetTypeId`), lifecycleTypeId,
            installationCapabilityId, providedCapabilities,
            effects: { throughputMultiplierBasisPoints: integer(effects.throughputMultiplierBasisPoints,
                `${field}.effects.throughputMultiplierBasisPoints`, 10_000, 50_000),
            qualityBonusBasisPoints: integer(effects.qualityBonusBasisPoints, `${field}.effects.qualityBonusBasisPoints`, 0, 10_000),
            failureReductionBasisPoints: integer(effects.failureReductionBasisPoints,
                `${field}.effects.failureReductionBasisPoints`, 0, 10_000),
            capacityBonusUnits: integer(effects.capacityBonusUnits, `${field}.effects.capacityBonusUnits`, 0, 1_000_000) },
            wearUsesPerBatch: integer(asset.wearUsesPerBatch, `${field}.wearUsesPerBatch`, 1, 1_000_000), maintenancePolicyId };
    });
    if (new Set(assets.map(asset => asset.capitalAssetTypeId)).size !== assets.length
        || new Set(assets.map(asset => asset.lifecycleTypeId)).size !== assets.length) {
        throw new Error('Production capital identities and lifecycle bindings must be unique');
    }
    const definition = { schemaVersion: 1 as const, assets };
    return { ...definition, digest: productionCapitalCatalogDigest(definition) };
}
export function loadDefaultProductionCapitalCatalog(): ProductionCapitalCatalog {
    const root = join(import.meta.dir, '..', 'config'), lifecycle = loadItemLifecycleCatalog(join(root, 'item-lifecycle.json'));
    const repairs = loadItemRepairPolicyCatalog(join(root, 'item-repair-policies.json'), lifecycle);
    const facilities = loadDefaultFacilityCapabilityCatalog();
    return validateProductionCapitalCatalog(JSON.parse(readFileSync(join(root, 'production-capital.json'), 'utf8')) as unknown,
        new Set(lifecycle.items.map(item => item.lifecycleTypeId)), new Set(repairs.policies.map(policy => policy.policyId)),
        new Set(facilities.facilities.flatMap(facility => facility.capabilities.map(capability => capability.capabilityId))));
}
