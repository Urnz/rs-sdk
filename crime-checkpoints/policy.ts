import { createHash } from 'node:crypto';

import type { CheckpointDetectionEvidence, CheckpointDetectionVerifier, CheckpointExposure,
    CheckpointInspectionEvidence, CheckpointInspectionPolicy, CheckpointInspectionRule,
    CheckpointInspectionVerifier } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
}
function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} is invalid`);
    return value as Record<string, unknown>;
}
function exact(value: object, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${field} is invalid`);
}
function id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function digest(value: unknown, field: string): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${field} is invalid`);
    return value;
}
function time(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${field} is invalid`);
    return value;
}
export function checkpointInspectionPolicyDigest(value: Omit<CheckpointInspectionPolicy, 'digest'>): string {
    return hash(value);
}
export function validateCheckpointInspectionPolicy(value: unknown): CheckpointInspectionPolicy {
    const input = record(value, 'Checkpoint inspection policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'effectiveFrom', 'expiresAt', 'rules'],
        'Checkpoint inspection policy');
    if (input.schemaVersion !== 1 || typeof input.version !== 'string' || !VERSION.test(input.version)
        || !Array.isArray(input.rules) || input.rules.length > 1000)
        throw new Error('Checkpoint inspection policy is invalid');
    const rules: CheckpointInspectionRule[] = input.rules.map((value, index) => {
        const field = `rules[${index}]`, entry = record(value, field);
        exact(entry, ['jurisdictionId', 'locationId', 'checkpointId', 'permission', 'authorityId'], field);
        if (entry.permission !== 'allow' && entry.permission !== 'deny') throw new Error(`${field} is invalid`);
        return { jurisdictionId: id(entry.jurisdictionId, `${field}.jurisdictionId`),
            locationId: id(entry.locationId, `${field}.locationId`),
            checkpointId: id(entry.checkpointId, `${field}.checkpointId`),
            permission: entry.permission, authorityId: id(entry.authorityId, `${field}.authorityId`) };
    });
    const keys = rules.map(rule => `${rule.jurisdictionId}\0${rule.locationId}\0${rule.checkpointId}`);
    if (new Set(keys).size !== keys.length) throw new Error('Checkpoint inspection rules must be unique');
    const effectiveFrom = time(input.effectiveFrom, 'effectiveFrom');
    const expiresAt = input.expiresAt === null ? null : time(input.expiresAt, 'expiresAt');
    if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(effectiveFrom))
        throw new Error('Checkpoint inspection policy interval is invalid');
    const definition = { schemaVersion: 1 as const, policyId: id(input.policyId, 'policyId'),
        version: input.version, effectiveFrom, expiresAt, rules };
    return { ...definition, digest: checkpointInspectionPolicyDigest(definition) };
}
function assertPolicy(policy: CheckpointInspectionPolicy): void {
    const { digest: suppliedDigest, ...definition } = policy;
    if (!DIGEST.test(suppliedDigest) || suppliedDigest !== checkpointInspectionPolicyDigest(definition))
        throw new Error('Checkpoint inspection policy digest mismatch');
    validateCheckpointInspectionPolicy(definition);
}
function validateInspection(value: CheckpointInspectionEvidence): void {
    const input = record(value, 'Checkpoint inspection evidence');
    exact(input, ['inspectionId', 'jurisdictionId', 'locationId', 'checkpointId', 'authorityId',
        'inspectorAgentId', 'subjectAgentId', 'occurredAt', 'sourceEvidenceDigest'], 'Checkpoint inspection evidence');
    for (const key of ['inspectionId', 'jurisdictionId', 'locationId', 'checkpointId', 'authorityId',
        'inspectorAgentId', 'subjectAgentId'] as const) id(value[key], key);
    time(value.occurredAt, 'inspection.occurredAt');
    digest(value.sourceEvidenceDigest, 'inspection.sourceEvidenceDigest');
}
function validateDetection(value: CheckpointDetectionEvidence): void {
    const input = record(value, 'Checkpoint detection evidence');
    exact(input, ['detectionId', 'inspectionId', 'subjectAgentId', 'assetId', 'result', 'occurredAt',
        'sourceEvidenceDigest'], 'Checkpoint detection evidence');
    for (const key of ['detectionId', 'inspectionId', 'subjectAgentId', 'assetId'] as const) id(value[key], key);
    if (value.result !== 'recognized-stolen' && value.result !== 'not-recognized')
        throw new Error('Checkpoint detection result is invalid');
    time(value.occurredAt, 'detection.occurredAt');
    digest(value.sourceEvidenceDigest, 'detection.sourceEvidenceDigest');
}

/** Fail closed: only a permitted, trusted inspection plus matching trusted positive detection exposes an asset. */
export function projectCheckpointExposure(policy: CheckpointInspectionPolicy,
    inspection: CheckpointInspectionEvidence | null, detection: CheckpointDetectionEvidence | null,
    verifyInspection?: CheckpointInspectionVerifier,
    verifyDetection?: CheckpointDetectionVerifier): CheckpointExposure {
    assertPolicy(policy);
    const hidden: CheckpointExposure = { exposed: false, assetId: null, inspectionId: null,
        detectionId: null, policyDigest: policy.digest };
    if (!inspection || !detection || !verifyInspection || !verifyDetection) return hidden;
    validateInspection(inspection);
    validateDetection(detection);
    const rule = policy.rules.find(rule => rule.jurisdictionId === inspection.jurisdictionId
        && rule.locationId === inspection.locationId && rule.checkpointId === inspection.checkpointId);
    if (!rule || rule.permission !== 'allow' || rule.authorityId !== inspection.authorityId
        || Date.parse(inspection.occurredAt) < Date.parse(policy.effectiveFrom)
        || policy.expiresAt !== null && Date.parse(inspection.occurredAt) >= Date.parse(policy.expiresAt)) return hidden;
    if (detection.inspectionId !== inspection.inspectionId || detection.subjectAgentId !== inspection.subjectAgentId
        || Date.parse(detection.occurredAt) < Date.parse(inspection.occurredAt)
        || detection.result !== 'recognized-stolen') return hidden;
    if (!verifyInspection(Object.freeze({ ...inspection }))
        || !verifyDetection(Object.freeze({ ...detection }), Object.freeze({ ...inspection }))) return hidden;
    return { exposed: true, assetId: detection.assetId, inspectionId: inspection.inspectionId,
        detectionId: detection.detectionId, policyDigest: policy.digest };
}
