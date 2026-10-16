import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CrimeHeatAssessment, CrimeHeatPolicy, CrimeHeatProjection, CrimeHeatProjectionInput,
    CrimeHeatAssessmentVerifier, CrimeHeatAssetVerifier, CrimeHeatDiscoveryVerifier, CrimeHeatOutcomeVerifier,
    CrimeHeatTheftVerifier } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/, DIGEST = /^[0-9a-f]{64}$/;
const WEIGHT_KEYS = ['value', 'uniqueness', 'victimImportance', 'witness', 'report', 'publicity', 'locationExposure'];
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function exact(value: object, keys: string[], field: string): void { if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error(`${field} is invalid`); }
function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== 'object'
    || Array.isArray(value)) throw new Error(`${field} is invalid`); return value as Record<string, unknown>; }
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function integer(value: unknown, field: string, max = 2_147_483_647): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error(`${field} is invalid`);
    return Number(value);
}
function time(value: unknown, field: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`); return value; }
function digest(value: unknown, field: string): string { if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${field} is invalid`); return value; }
export function crimeHeatPolicyDigest(value: Omit<CrimeHeatPolicy, 'digest'>): string { return hash(value); }
export function validateCrimeHeatPolicy(value: unknown): CrimeHeatPolicy {
    const input = record(value, 'Crime heat policy'); exact(input, ['schemaVersion', 'policyId', 'version',
        'valueScaleCoins', 'decayPerSimulationHourBasisPoints', 'weights', 'jurisdictions'], 'Crime heat policy');
    if (input.schemaVersion !== 1 || typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version))
        throw new Error('Crime heat policy is invalid');
    const weights = record(input.weights, 'Crime heat weights'); exact(weights, WEIGHT_KEYS, 'Crime heat weights');
    const parsedWeights = Object.fromEntries(WEIGHT_KEYS.map(key => [key,
        integer(weights[key], `weights.${key}`, 10_000)])) as unknown as CrimeHeatPolicy['weights'];
    if (!Array.isArray(input.jurisdictions) || input.jurisdictions.length < 1 || input.jurisdictions.length > 1000)
        throw new Error('Crime heat jurisdictions are invalid');
    const jurisdictions = input.jurisdictions.map((value, index) => { const field = `jurisdictions[${index}]`;
        const entry = record(value, field); exact(entry, ['jurisdictionId', 'localMultiplierBasisPoints',
            'foreignMultiplierBasisPoints'], field); return { jurisdictionId: id(entry.jurisdictionId, `${field}.jurisdictionId`),
            localMultiplierBasisPoints: integer(entry.localMultiplierBasisPoints, `${field}.localMultiplierBasisPoints`, 20_000),
            foreignMultiplierBasisPoints: integer(entry.foreignMultiplierBasisPoints, `${field}.foreignMultiplierBasisPoints`, 20_000) }; });
    if (new Set(jurisdictions.map(value => value.jurisdictionId)).size !== jurisdictions.length)
        throw new Error('Crime heat jurisdiction ids must be unique');
    const valueScaleCoins = integer(input.valueScaleCoins, 'valueScaleCoins');
    if (valueScaleCoins === 0) throw new Error('Crime heat value scale must be positive');
    const definition = { schemaVersion: 1 as const, policyId: id(input.policyId, 'policyId'), version: input.version,
        valueScaleCoins, decayPerSimulationHourBasisPoints: integer(input.decayPerSimulationHourBasisPoints,
            'decayPerSimulationHourBasisPoints', 10_000), weights: parsedWeights, jurisdictions };
    return { ...definition, digest: crimeHeatPolicyDigest(definition) };
}
export function loadCrimeHeatPolicy(path: string): CrimeHeatPolicy {
    return validateCrimeHeatPolicy(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
export function loadDefaultCrimeHeatPolicy(): CrimeHeatPolicy {
    return loadCrimeHeatPolicy(join(import.meta.dir, '..', 'config', 'crime-heat-policy.json'));
}
function assessment(value: CrimeHeatAssessment, receiptId: string, occurredAt: string,
    policy: CrimeHeatPolicy): CrimeHeatAssessment {
    const input = record(value, 'Crime heat assessment'); exact(input, ['assessmentId', 'outcomeReceiptId',
        'crimeJurisdictionId', 'currentJurisdictionId', 'locationId', 'valueCoins', 'uniquenessBasisPoints',
        'victimImportanceBasisPoints', 'publicityBasisPoints', 'locationExposureBasisPoints', 'sourceEvidenceDigest',
        'crimeAtSimulationTime', 'assessedAtSimulationTime', 'assessedAtWallTime'], 'Crime heat assessment');
    const normalized: CrimeHeatAssessment = { assessmentId: id(value.assessmentId, 'assessmentId'),
        outcomeReceiptId: id(value.outcomeReceiptId, 'outcomeReceiptId'),
        crimeJurisdictionId: id(value.crimeJurisdictionId, 'crimeJurisdictionId'),
        currentJurisdictionId: id(value.currentJurisdictionId, 'currentJurisdictionId'),
        locationId: id(value.locationId, 'locationId'), valueCoins: integer(value.valueCoins, 'valueCoins'),
        uniquenessBasisPoints: integer(value.uniquenessBasisPoints, 'uniquenessBasisPoints', 10_000),
        victimImportanceBasisPoints: integer(value.victimImportanceBasisPoints, 'victimImportanceBasisPoints', 10_000),
        publicityBasisPoints: integer(value.publicityBasisPoints, 'publicityBasisPoints', 10_000),
        locationExposureBasisPoints: integer(value.locationExposureBasisPoints, 'locationExposureBasisPoints', 10_000),
        sourceEvidenceDigest: digest(value.sourceEvidenceDigest, 'sourceEvidenceDigest'),
        crimeAtSimulationTime: time(value.crimeAtSimulationTime, 'crimeAtSimulationTime'),
        assessedAtSimulationTime: time(value.assessedAtSimulationTime, 'assessedAtSimulationTime'),
        assessedAtWallTime: time(value.assessedAtWallTime, 'assessedAtWallTime') };
    if (normalized.outcomeReceiptId !== receiptId
        || Date.parse(normalized.assessedAtSimulationTime) < Date.parse(normalized.crimeAtSimulationTime)
        || Date.parse(normalized.assessedAtWallTime) < Date.parse(occurredAt)
        || !policy.jurisdictions.some(entry => entry.jurisdictionId === normalized.crimeJurisdictionId)
        || !policy.jurisdictions.some(entry => entry.jurisdictionId === normalized.currentJurisdictionId))
        throw new Error('Crime heat assessment does not match its outcome or jurisdiction');
    return normalized;
}
export function projectCrimeHeat(policy: CrimeHeatPolicy, input: CrimeHeatProjectionInput,
    verifyOutcome?: CrimeHeatOutcomeVerifier, verifyAssessment?: CrimeHeatAssessmentVerifier,
    verifyDiscovery?: CrimeHeatDiscoveryVerifier, verifyTheft?: CrimeHeatTheftVerifier,
    verifyAsset?: CrimeHeatAssetVerifier): CrimeHeatProjection {
    const { digest: policyDigest, ...definition } = policy;
    if (policyDigest !== crimeHeatPolicyDigest(definition)) throw new Error('Crime heat policy digest mismatch');
    const outcome = input.outcome;
    if (!outcome || outcome.result !== 'succeeded' || outcome.effect === 'none'
        || !DIGEST.test(outcome.receiptDigest) || !ID.test(outcome.receiptId) || !verifyOutcome?.(outcome))
        throw new Error('Crime heat requires a successful persisted outcome');
    const assessed = assessment(input.assessment, outcome.receiptId, outcome.occurredAt, policy);
    if (!verifyAssessment?.(Object.freeze(assessed), outcome)) throw new Error('Crime heat assessment is not trusted');
    const theft = input.theftEvent;
    if (theft !== null && (theft.kind !== 'stolen' || theft.sourceDomain !== 'thieving-procedures'
        || theft.sourceRecordId !== outcome.receiptId || theft.sourceEvidenceDigest !== outcome.receiptDigest
        || theft.occurredAt !== outcome.occurredAt || !outcome.transferredItems.some(item => item.itemId === theft.itemId
            && item.quantity === theft.quantity) || !verifyTheft?.(theft, outcome)))
        throw new Error('Crime heat theft event does not match trusted outcome');
    const asset = input.asset;
    if ((asset === null) !== (theft?.assetId == null) || asset && (asset.assetId !== theft?.assetId
        || asset.itemId !== theft.itemId || asset.quantity !== theft.quantity || asset.theftHistoryCount < 1
        || !verifyAsset?.(asset, theft)))
        throw new Error('Crime heat asset does not match theft event');
    if (!Array.isArray(input.discoveries) || input.discoveries.length > 1000) throw new Error('Crime heat discoveries are invalid');
    const observations = [...input.discoveries].sort((a, b) => a.observationId.localeCompare(b.observationId));
    if (new Set(observations.map(value => value.observationId)).size !== observations.length)
        throw new Error('Crime heat discovery ids are duplicated');
    for (const discovery of observations) {
        if (discovery.outcomeReceiptId !== outcome.receiptId || !DIGEST.test(discovery.observationDigest)
            || Date.parse(discovery.occurredAt) > Date.parse(assessed.assessedAtWallTime)
            || !verifyDiscovery?.(discovery, outcome)) throw new Error('Crime heat discovery is not trusted or not yet observed');
    }
    const witnesses = new Set(observations.filter(value => value.source === 'direct-witness'
        || value.source === 'guard-line-of-sight').map(value => value.observerAgentId).filter((value): value is string => value !== null));
    const reports = observations.filter(value => value.source === 'owner-loss-report').length;
    const factors = { value: Math.min(10_000, Math.floor(assessed.valueCoins * 10_000 / policy.valueScaleCoins)),
        uniqueness: assessed.uniquenessBasisPoints, victimImportance: assessed.victimImportanceBasisPoints,
        witnesses: Math.min(10_000, witnesses.size * 5_000), reports: reports > 0 ? 10_000 : 0,
        publicity: assessed.publicityBasisPoints, locationExposure: assessed.locationExposureBasisPoints,
        jurisdictionMultiplierBasisPoints: 0, elapsedSimulationHours: Math.floor((Date.parse(assessed.assessedAtSimulationTime)
            - Date.parse(assessed.crimeAtSimulationTime)) / 3_600_000) };
    const jurisdiction = policy.jurisdictions.find(value => value.jurisdictionId === assessed.crimeJurisdictionId)!;
    factors.jurisdictionMultiplierBasisPoints = assessed.currentJurisdictionId === assessed.crimeJurisdictionId
        ? jurisdiction.localMultiplierBasisPoints : jurisdiction.foreignMultiplierBasisPoints;
    const weighted = Math.floor((factors.value * policy.weights.value + factors.uniqueness * policy.weights.uniqueness
        + factors.victimImportance * policy.weights.victimImportance + factors.witnesses * policy.weights.witness
        + factors.reports * policy.weights.report + factors.publicity * policy.weights.publicity
        + factors.locationExposure * policy.weights.locationExposure) / 10_000);
    const decayed = Math.max(0, weighted - factors.elapsedSimulationHours * policy.decayPerSimulationHourBasisPoints);
    const traceabilityBasisPoints = Math.min(10_000,
        Math.floor(decayed * factors.jurisdictionMultiplierBasisPoints / 10_000));
    const subject: CrimeHeatProjection['subject'] = asset
        ? { kind: asset.tier, id: asset.assetId }
        : { kind: 'crime', id: outcome.receiptId };
    const base = { subject, outcomeReceiptId: outcome.receiptId, jurisdictionId: assessed.currentJurisdictionId,
        locationId: assessed.locationId, assessedAtSimulationTime: assessed.assessedAtSimulationTime,
        traceabilityBasisPoints, factors, sourceIds: { theftEventId: theft?.eventId ?? null,
            discoveryObservationIds: observations.map(value => value.observationId), assessmentId: assessed.assessmentId },
        policyDigest };
    return { ...base, projectionDigest: hash(base) };
}
