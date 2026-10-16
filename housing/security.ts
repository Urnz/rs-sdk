import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { resolveHousingEffects } from './effects.js';
import { resolveHousingTier } from './hierarchy.js';
import { validateHousingUnitCatalog } from './units.js';
import type { HousingAttackSurfaceObservation, HousingAttackSurfaceVerifier, HousingEffectPolicy,
    HousingSecurityPolicy, HousingSecurityPolicyDefinition, HousingSecurityProjection, HousingSecurityTier,
    HousingStorageSecuritySurface, HousingTierPolicy, HousingUnitCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/;
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== 'object'
    || Array.isArray(value)) throw new Error(`${field} is invalid`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${field} fields are invalid`);
}
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function integer(value: unknown, field: string, max: number): number { if (!Number.isSafeInteger(value)
    || Number(value) < 0 || Number(value) > max) throw new Error(`${field} is invalid`); return Number(value); }
function reference(value: unknown, field: string): { policyId: string; version: string; digest: string } {
    const input = record(value, field); exact(input, ['policyId', 'version', 'digest'], field);
    if (typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version)
        || typeof input.digest !== 'string' || !DIGEST.test(input.digest)) throw new Error(`${field} is invalid`);
    return { policyId: id(input.policyId, `${field}.policyId`), version: input.version, digest: input.digest };
}
export function housingSecurityPolicyDigest(value: HousingSecurityPolicyDefinition): string { return hash(value); }
export function validateHousingSecurityPolicy(value: unknown, hierarchy: HousingTierPolicy,
    effects: HousingEffectPolicy): HousingSecurityPolicy {
    const input = record(value, 'Housing security policy'); exact(input, ['schemaVersion', 'policyId', 'version',
        'hierarchyPolicy', 'effectPolicy', 'tiers', 'storageSurfaces'], 'Housing security policy');
    if (input.schemaVersion !== 1 || typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version)
        || !Array.isArray(input.tiers) || !Array.isArray(input.storageSurfaces))
        throw new Error('Housing security policy is invalid');
    const hierarchyRef = reference(input.hierarchyPolicy, 'hierarchyPolicy');
    const effectRef = reference(input.effectPolicy, 'effectPolicy');
    if (hierarchyRef.policyId !== hierarchy.policyId || hierarchyRef.version !== hierarchy.version
        || hierarchyRef.digest !== hierarchy.digest || effectRef.policyId !== effects.policyId
        || effectRef.version !== effects.version || effectRef.digest !== effects.digest)
        throw new Error('Housing security policy source digest does not match');
    const storageSurfaces: HousingStorageSecuritySurface[] = input.storageSurfaces.map((value, index) => {
        const field = `storageSurfaces[${index}]`, entry = record(value, field);
        exact(entry, ['surfaceId', 'lockLevel', 'traceBasisPoints'], field);
        return { surfaceId: id(entry.surfaceId, `${field}.surfaceId`),
            lockLevel: integer(entry.lockLevel, `${field}.lockLevel`, 99),
            traceBasisPoints: integer(entry.traceBasisPoints, `${field}.traceBasisPoints`, 10_000) };
    });
    if (storageSurfaces.length < 1 || storageSurfaces.length > 100
        || new Set(storageSurfaces.map(entry => entry.surfaceId)).size !== storageSurfaces.length)
        throw new Error('Housing storage surface ids are invalid');
    const surfaceIds = new Set(storageSurfaces.map(entry => entry.surfaceId));
    const tiers: HousingSecurityTier[] = input.tiers.map((value, index) => {
        const field = `tiers[${index}]`, entry = record(value, field);
        exact(entry, ['tierId', 'sleepingExposureBasisPoints', 'entryLockLevel', 'entryTraceBasisPoints',
            'allowedStorageSurfaceIds'], field);
        const tierId = id(entry.tierId, `${field}.tierId`);
        resolveHousingTier(hierarchy, tierId);
        if (!Array.isArray(entry.allowedStorageSurfaceIds)) throw new Error(`${field}.allowedStorageSurfaceIds is invalid`);
        const allowedStorageSurfaceIds = entry.allowedStorageSurfaceIds.map(value => id(value, `${field}.surfaceId`));
        if (new Set(allowedStorageSurfaceIds).size !== allowedStorageSurfaceIds.length
            || allowedStorageSurfaceIds.some(value => !surfaceIds.has(value)))
            throw new Error(`${field}.allowedStorageSurfaceIds are invalid`);
        if (allowedStorageSurfaceIds.length > 0 && resolveHousingEffects(effects, hierarchy, tierId).privateStorageSlots < 1)
            throw new Error(`${field} allows storage without housing storage capacity`);
        return { tierId, sleepingExposureBasisPoints: integer(entry.sleepingExposureBasisPoints,
            `${field}.sleepingExposureBasisPoints`, 10_000),
            entryLockLevel: integer(entry.entryLockLevel, `${field}.entryLockLevel`, 99),
            entryTraceBasisPoints: integer(entry.entryTraceBasisPoints, `${field}.entryTraceBasisPoints`, 10_000),
            allowedStorageSurfaceIds };
    }).sort((a, b) => resolveHousingTier(hierarchy, a.tierId).rank - resolveHousingTier(hierarchy, b.tierId).rank);
    if (tiers.length !== hierarchy.tiers.length || new Set(tiers.map(entry => entry.tierId)).size !== tiers.length
        || tiers.some((entry, index) => entry.tierId !== hierarchy.tiers[index]?.tierId))
        throw new Error('Housing security tiers must match the hierarchy');
    for (let index = 1; index < tiers.length; index++) {
        const prior = tiers[index - 1]!, current = tiers[index]!;
        if (current.sleepingExposureBasisPoints > prior.sleepingExposureBasisPoints
            || current.entryLockLevel < prior.entryLockLevel
            || current.entryTraceBasisPoints < prior.entryTraceBasisPoints)
            throw new Error('Higher housing security tiers cannot weaken protection');
    }
    const definition: HousingSecurityPolicyDefinition = { schemaVersion: 1,
        policyId: id(input.policyId, 'policyId'), version: input.version,
        hierarchyPolicy: hierarchyRef, effectPolicy: effectRef, tiers, storageSurfaces };
    return { ...definition, digest: housingSecurityPolicyDigest(definition) };
}
export function loadHousingSecurityPolicy(path: string, hierarchy: HousingTierPolicy,
    effects: HousingEffectPolicy): HousingSecurityPolicy {
    return validateHousingSecurityPolicy(JSON.parse(readFileSync(path, 'utf8')) as unknown, hierarchy, effects);
}
export function projectHousingSecurity(policy: HousingSecurityPolicy, hierarchy: HousingTierPolicy,
    effects: HousingEffectPolicy, units: HousingUnitCatalog, input: HousingAttackSurfaceObservation,
    verify?: HousingAttackSurfaceVerifier): HousingSecurityProjection {
    const { digest, ...definition } = policy;
    const validated = validateHousingSecurityPolicy(definition, hierarchy, effects);
    if (digest !== validated.digest) throw new Error('Housing security policy digest mismatch');
    const { digest: unitDigest, ...unitDefinition } = units;
    const validatedUnits = validateHousingUnitCatalog(unitDefinition, hierarchy);
    if (unitDigest !== validatedUnits.digest) throw new Error('Housing unit catalog digest mismatch');
    const observation = record(input, 'Housing attack surface');
    exact(observation, ['observationId', 'kind', 'housingUnitId', 'storageSurfaceId', 'storageSlots', 'propertyLockLevel',
        'sourceEvidenceDigest'], 'Housing attack surface');
    if (!['sleeping-person', 'property-entry', 'storage'].includes(input.kind)
        || typeof input.sourceEvidenceDigest !== 'string' || !DIGEST.test(input.sourceEvidenceDigest))
        throw new Error('Housing attack surface is invalid');
    const normalized: HousingAttackSurfaceObservation = { observationId: id(input.observationId, 'observationId'),
        kind: input.kind, housingUnitId: input.housingUnitId === null ? null : id(input.housingUnitId, 'housingUnitId'),
        storageSurfaceId: input.storageSurfaceId === null ? null : id(input.storageSurfaceId, 'storageSurfaceId'),
        storageSlots: integer(input.storageSlots, 'storageSlots', 100_000),
        propertyLockLevel: input.propertyLockLevel === null ? null
            : integer(input.propertyLockLevel, 'propertyLockLevel', 99),
        sourceEvidenceDigest: input.sourceEvidenceDigest };
    if (!verify?.(Object.freeze(normalized))) throw new Error('Housing attack surface is not trusted');
    const unit = normalized.housingUnitId === null ? null
        : validatedUnits.units.find(value => value.housingUnitId === normalized.housingUnitId);
    if (normalized.housingUnitId !== null && (!unit || !unit.enabled))
        throw new Error('Housing attack surface references an unavailable unit');
    const tierId = unit?.tierId ?? 'street';
    if (unit === null && (normalized.kind !== 'sleeping-person' || normalized.storageSlots !== 0))
        throw new Error('Street exposure cannot claim a Property or storage surface');
    const profile = validated.tiers.find(value => value.tierId === tierId)!;
    const effect = resolveHousingEffects(effects, hierarchy, tierId);
    let lockLevel = 0, exposureBasisPoints = 0, traceBasisPoints = 0;
    if (normalized.kind === 'sleeping-person') {
        if (normalized.storageSurfaceId !== null || normalized.storageSlots !== 0
            || normalized.propertyLockLevel !== null)
            throw new Error('Sleeping-person surface cannot claim storage');
        exposureBasisPoints = Math.min(profile.sleepingExposureBasisPoints,
            10_000 - effect.theftProtectionBasisPoints);
    } else if (normalized.kind === 'property-entry') {
        if (normalized.storageSurfaceId !== null || normalized.storageSlots !== 0)
            throw new Error('Property entry surface cannot claim storage');
        if (normalized.propertyLockLevel === null || normalized.propertyLockLevel < 1
            || normalized.propertyLockLevel < profile.entryLockLevel)
            throw new Error('Property door lock is below the housing security policy minimum');
        lockLevel = normalized.propertyLockLevel;
        traceBasisPoints = profile.entryTraceBasisPoints;
        exposureBasisPoints = 10_000 - effect.theftProtectionBasisPoints;
    } else {
        const storage = validated.storageSurfaces.find(value => value.surfaceId === normalized.storageSurfaceId);
        if (!storage || normalized.propertyLockLevel !== null
            || !profile.allowedStorageSurfaceIds.includes(storage.surfaceId)
            || normalized.storageSlots < 1 || normalized.storageSlots > effect.privateStorageSlots)
            throw new Error('Storage security surface is not available at this tier');
        lockLevel = storage.lockLevel;
        traceBasisPoints = storage.traceBasisPoints;
        exposureBasisPoints = 10_000 - effect.theftProtectionBasisPoints;
    }
    const base = { kind: normalized.kind, housingUnitId: normalized.housingUnitId,
        propertyId: unit?.propertyId ?? null, tierId, storageSurfaceId: normalized.storageSurfaceId,
        lockLevel, exposureBasisPoints, traceBasisPoints,
        theftProtectionBasisPoints: effect.theftProtectionBasisPoints,
        observationId: normalized.observationId, sourceEvidenceDigest: normalized.sourceEvidenceDigest,
        policyDigest: digest, unitCatalogDigest: unitDigest };
    return { ...base, projectionDigest: hash(base) };
}
