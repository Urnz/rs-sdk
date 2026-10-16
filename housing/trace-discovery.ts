import { createHash } from 'node:crypto';

import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { ThievingDiscoveryObservation, ThievingOutcomeReceipt } from '../thieving-procedures/types.js';
import { projectHousingSecurity } from './security.js';
import type { HousingAttackSurfaceObservation, HousingAttackSurfaceVerifier, HousingEffectPolicy,
    HousingSecurityPolicy, HousingTierPolicy, HousingUnitCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/;
export interface HousingPropertyAccessEvidence {
    sourceEventId: string;
    sourceEvidenceDigest: string;
    propertyId: string;
    propertyStateVersion: number;
    actorAuthorized: boolean;
    owner: { kind: 'player' | 'business' | 'faction'; id: string } | null;
}
export interface HousingTraceRollEvidence {
    roll: number;
    sourceEvidenceDigest: string;
    occurredAt: string;
}
export interface HousingTraceDecision {
    discovered: boolean;
    traceBasisPoints: number;
    observation: ThievingDiscoveryObservation | null;
    decisionDigest: string;
}
export type HousingAccessVerifier = (access: Readonly<HousingPropertyAccessEvidence>,
    outcome: Readonly<ThievingOutcomeReceipt>) => boolean;
export type HousingTraceRollVerifier = (roll: Readonly<HousingTraceRollEvidence>,
    outcome: Readonly<ThievingOutcomeReceipt>, observationId: string, securityProjectionDigest: string) => boolean;

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function stableId(prefix: string, source: string): string { const direct = `${prefix}:${source}`;
    return direct.length <= 128 ? direct : `${prefix}:${hash(source)}`; }
function id(value: unknown, field: string): string { if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${field} is invalid`); return value; }
function digest(value: unknown, field: string): string { if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${field} is invalid`); return value; }
function time(value: unknown, field: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new Error(`${field} is invalid`); return value; }
function exact(value: unknown, keys: string[], field: string): void { if (!value || typeof value !== 'object'
    || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error(`${field} fields are invalid`); }

/** A verified detection may publish a scene trace, never the hidden offender. */
export function recordHousingEntryTrace(observationIdInput: string, outcomeReceiptIdInput: string,
    thieving: ThievingProcedureStore, policy: HousingSecurityPolicy, hierarchy: HousingTierPolicy,
    effects: HousingEffectPolicy, units: HousingUnitCatalog, surface: HousingAttackSurfaceObservation,
    accessInput: HousingPropertyAccessEvidence, rollInput: HousingTraceRollEvidence,
    verifySurface?: HousingAttackSurfaceVerifier, verifyAccess?: HousingAccessVerifier,
    verifyRoll?: HousingTraceRollVerifier, recordedAtInput = new Date().toISOString()): HousingTraceDecision {
    const observationId = id(observationIdInput, 'observationId');
    const outcomeReceiptId = id(outcomeReceiptIdInput, 'outcomeReceiptId');
    const recordedAt = time(recordedAtInput, 'recordedAt');
    if (!thieving.verifyAuditChain()) throw new Error('Thieving audit chain is invalid');
    const outcome = thieving.getOutcome(outcomeReceiptId);
    if (!outcome || outcome.result !== 'succeeded' || outcome.procedureKind !== 'property-burglary'
        || outcome.effect !== 'entry-completed' || outcome.target.kind !== 'loc')
        throw new Error('Housing trace requires a successful Property burglary entry');
    const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, verifySurface);
    if (security.kind !== 'property-entry' || !security.propertyId || security.housingUnitId === null
        || security.sourceEvidenceDigest !== outcome.sourceEvidenceDigest)
        throw new Error('Housing security projection does not bind to the burglary source');
    exact(accessInput, ['sourceEventId', 'sourceEvidenceDigest', 'propertyId', 'propertyStateVersion',
        'actorAuthorized', 'owner'], 'Property access evidence');
    const owner = accessInput.owner;
    if (owner !== null) exact(owner, ['kind', 'id'], 'Property owner');
    const access: HousingPropertyAccessEvidence = { sourceEventId: id(accessInput.sourceEventId, 'sourceEventId'),
        sourceEvidenceDigest: digest(accessInput.sourceEvidenceDigest, 'sourceEvidenceDigest'),
        propertyId: id(accessInput.propertyId, 'propertyId'),
        propertyStateVersion: accessInput.propertyStateVersion,
        actorAuthorized: accessInput.actorAuthorized,
        owner: owner === null ? null : { kind: owner.kind, id: id(owner.id, 'owner.id') } };
    if (!Number.isSafeInteger(access.propertyStateVersion) || access.propertyStateVersion < 1
        || typeof access.actorAuthorized !== 'boolean' || access.actorAuthorized || !access.owner
        || !['player', 'business', 'faction'].includes(access.owner.kind)
        || access.sourceEventId !== outcome.sourceEventId
        || access.sourceEvidenceDigest !== outcome.sourceEvidenceDigest
        || access.propertyId !== security.propertyId || !verifyAccess?.(Object.freeze(access), outcome))
        throw new Error('Housing trace requires exact denied Property access evidence');
    exact(rollInput, ['roll', 'sourceEvidenceDigest', 'occurredAt'], 'Trace roll evidence');
    const roll: HousingTraceRollEvidence = { roll: rollInput.roll,
        sourceEvidenceDigest: digest(rollInput.sourceEvidenceDigest, 'roll.sourceEvidenceDigest'),
        occurredAt: time(rollInput.occurredAt, 'roll.occurredAt') };
    if (!Number.isSafeInteger(roll.roll) || roll.roll < 0 || roll.roll > 9_999
        || Date.parse(roll.occurredAt) < Date.parse(outcome.occurredAt)
        || Date.parse(recordedAt) < Date.parse(roll.occurredAt)
        || !verifyRoll?.(Object.freeze(roll), outcome, observationId, security.projectionDigest))
        throw new Error('Housing trace roll is not trusted');
    const discovered = roll.roll < security.traceBasisPoints;
    const base = { observationId, outcomeReceiptId, securityProjectionDigest: security.projectionDigest,
        accessSourceDigest: access.sourceEvidenceDigest, rollSourceDigest: roll.sourceEvidenceDigest,
        roll: roll.roll, traceBasisPoints: security.traceBasisPoints, discovered };
    const decisionDigest = hash(base);
    if (!discovered) return { discovered, traceBasisPoints: security.traceBasisPoints,
        observation: null, decisionDigest };
    const evidence = { evidenceId: stableId('housing-trace', observationId), outcomeReceiptId,
        source: 'physical-trace' as const,
        observerAgentId: null, actorIdentification: 'none' as const, suspectAgentId: null,
        facts: [`A physical trace was detected at Property ${security.propertyId}.`],
        sourceEvidenceDigest: decisionDigest, occurredAt: roll.occurredAt };
    const observation = thieving.recordDiscovery(observationId, evidence,
        candidate => candidate.sourceEvidenceDigest === decisionDigest && thieving.verifyAuditChain(), recordedAt);
    return { discovered, traceBasisPoints: security.traceBasisPoints, observation, decisionDigest };
}

/** Records a one-shot physical trace for an audited placed-storage theft, without naming its actor. */
export function recordHousingStorageTrace(observationIdInput: string, outcomeReceiptIdInput: string,
    thieving: ThievingProcedureStore, policy: HousingSecurityPolicy, hierarchy: HousingTierPolicy,
    effects: HousingEffectPolicy, units: HousingUnitCatalog, surface: HousingAttackSurfaceObservation,
    rollInput: HousingTraceRollEvidence, verifySurface?: HousingAttackSurfaceVerifier,
    verifyRoll?: HousingTraceRollVerifier, recordedAtInput = new Date().toISOString()): HousingTraceDecision {
    const observationId = id(observationIdInput, 'observationId');
    const outcomeReceiptId = id(outcomeReceiptIdInput, 'outcomeReceiptId');
    const recordedAt = time(recordedAtInput, 'recordedAt');
    if (!thieving.verifyAuditChain()) throw new Error('Thieving audit chain is invalid');
    const outcome = thieving.getOutcome(outcomeReceiptId);
    if (!outcome || outcome.result !== 'succeeded' || outcome.procedureKind !== 'container-theft'
        || outcome.effect !== 'item-transfer' || outcome.target.kind !== 'loc')
        throw new Error('Housing storage trace requires a successful container theft');
    const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, verifySurface);
    if (security.kind !== 'storage' || !security.propertyId || !security.housingUnitId
        || !security.storageSurfaceId || security.sourceEvidenceDigest !== outcome.sourceEvidenceDigest)
        throw new Error('Housing storage security projection does not bind to the theft source');
    exact(rollInput, ['roll', 'sourceEvidenceDigest', 'occurredAt'], 'Trace roll evidence');
    const roll: HousingTraceRollEvidence = { roll: rollInput.roll,
        sourceEvidenceDigest: digest(rollInput.sourceEvidenceDigest, 'roll.sourceEvidenceDigest'),
        occurredAt: time(rollInput.occurredAt, 'roll.occurredAt') };
    if (!Number.isSafeInteger(roll.roll) || roll.roll < 0 || roll.roll > 9_999
        || Date.parse(roll.occurredAt) < Date.parse(outcome.occurredAt)
        || Date.parse(recordedAt) < Date.parse(roll.occurredAt)
        || !verifyRoll?.(Object.freeze(roll), outcome, observationId, security.projectionDigest))
        throw new Error('Housing storage trace roll is not trusted');
    const discovered = roll.roll < security.traceBasisPoints;
    const base = { observationId, outcomeReceiptId, securityProjectionDigest: security.projectionDigest,
        rollSourceDigest: roll.sourceEvidenceDigest, roll: roll.roll,
        traceBasisPoints: security.traceBasisPoints, discovered };
    const decisionDigest = hash(base);
    if (!discovered) return { discovered, traceBasisPoints: security.traceBasisPoints,
        observation: null, decisionDigest };
    const evidence = { evidenceId: stableId('housing-storage-trace', observationId), outcomeReceiptId,
        source: 'physical-trace' as const, observerAgentId: null,
        actorIdentification: 'none' as const, suspectAgentId: null,
        facts: [`A physical trace was detected at protected storage ${security.storageSurfaceId}.`],
        sourceEvidenceDigest: decisionDigest, occurredAt: roll.occurredAt };
    const observation = thieving.recordDiscovery(observationId, evidence,
        candidate => candidate.sourceEvidenceDigest === decisionDigest && thieving.verifyAuditChain(), recordedAt);
    return { discovered, traceBasisPoints: security.traceBasisPoints, observation, decisionDigest };
}
