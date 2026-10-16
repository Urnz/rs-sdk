import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingProcedureStore } from './store.js';

export interface WitnessAttentionPolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    bands: Array<{ maxDistance: number; attentionBasisPoints: number }>;
}
export interface WitnessAttentionPolicy extends WitnessAttentionPolicyDefinition { digest: string }
export interface WitnessOpportunity {
    eventId: string;
    outcomeReceiptId: string;
    observerUsername: string;
    distance: number;
    attentionBasisPoints: number;
    policyDigest: string;
    sourceEvidenceDigest: string;
    opportunityDigest: string;
}

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, VERSION = /^\d+\.\d+\.\d+$/;
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== 'object'
    || Array.isArray(value)) throw new Error(`${field} is invalid`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[], field: string): void {
    if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error(`${field} fields are invalid`);
}
function integer(value: unknown, min: number, max: number, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
        throw new Error(`${field} is invalid`);
    return Number(value);
}
function point(value: unknown, field: string): { x: number; z: number; level: number } {
    const input = record(value, field);
    exact(input, ['x', 'z', 'level'], field);
    return { x: integer(input.x, 0, 16_383, `${field}.x`), z: integer(input.z, 0, 16_383, `${field}.z`),
        level: integer(input.level, 0, 3, `${field}.level`) };
}

export function validateWitnessAttentionPolicy(value: unknown): WitnessAttentionPolicy {
    const input = record(value, 'Witness attention policy');
    exact(input, ['schemaVersion', 'policyId', 'version', 'bands'], 'Witness attention policy');
    if (input.schemaVersion !== 1 || typeof input.policyId !== 'string' || !ID.test(input.policyId)
        || typeof input.version !== 'string' || !VERSION.test(input.version)
        || !Array.isArray(input.bands) || input.bands.length < 1 || input.bands.length > 15)
        throw new Error('Witness attention policy is invalid');
    const bands = input.bands.map((value, index) => { const entry = record(value, `bands[${index}]`);
        exact(entry, ['maxDistance', 'attentionBasisPoints'], `bands[${index}]`);
        return { maxDistance: integer(entry.maxDistance, 1, 15, `bands[${index}].maxDistance`),
            attentionBasisPoints: integer(entry.attentionBasisPoints, 0, 10_000,
                `bands[${index}].attentionBasisPoints`) }; });
    if (bands.at(-1)!.maxDistance !== 15 || bands.some((band, index) => index > 0
        && (band.maxDistance <= bands[index - 1]!.maxDistance
            || band.attentionBasisPoints > bands[index - 1]!.attentionBasisPoints)))
        throw new Error('Witness attention bands must cover 15 tiles without increasing at distance');
    const definition: WitnessAttentionPolicyDefinition = { schemaVersion: 1,
        policyId: input.policyId, version: input.version, bands };
    return { ...definition, digest: hash(definition) };
}
export function loadWitnessAttentionPolicy(path: string): WitnessAttentionPolicy {
    return validateWitnessAttentionPolicy(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Compatibility entry point: retains the strict Property-only contract. */
export function projectPropertyWitnessOpportunities(eventId: string, source: ThievingEvidenceStore,
    thieving: ThievingProcedureStore, policy: WitnessAttentionPolicy): WitnessOpportunity[] {
    const event = source.get(eventId);
    if (event?.procedureKind !== 'property-burglary')
        throw new Error('Witness opportunities require an audited denied Property burglary');
    return projectThievingWitnessOpportunities(eventId, source, thieving, policy);
}

/** Read-only opportunity projection. A sight candidate is not yet an actual witness. */
export function projectThievingWitnessOpportunities(eventId: string, source: ThievingEvidenceStore,
    thieving: ThievingProcedureStore, policy: WitnessAttentionPolicy): WitnessOpportunity[] {
    const { digest, ...definition } = policy;
    if (validateWitnessAttentionPolicy(definition).digest !== digest) throw new Error('Witness attention policy digest mismatch');
    if (!source.verifyChain() || !thieving.verifyAuditChain()) throw new Error('Witness source audit is invalid');
    const event = source.get(eventId), outcome = thieving.getOutcome(`outcome:${eventId}`);
    const deniedEntry = event?.procedureKind === 'property-burglary' && event.effect === 'entry-completed'
        && event.target.kind === 'loc' && event.propertyAccess?.actorAuthorized === false
        && !!event.propertyAccess.owner;
    const theft = event?.effect === 'item-transfer' && event.transferredItems.length > 0
        && ((event.procedureKind === 'pickpocket' && event.target.kind === 'npc')
            || (event.procedureKind === 'container-theft' && event.target.kind === 'loc'))
        && event.propertyAccess?.actorAuthorized !== true;
    if (!event || !outcome || (!deniedEntry && !theft) || outcome.result !== 'succeeded'
        || outcome.procedureKind !== event.procedureKind || outcome.sourceEventId !== event.eventId
        || outcome.sourceEvidenceDigest !== event.eventDigest)
        throw new Error('Witness opportunities require an audited theft or denied Property burglary');
    if (!event.sightSnapshot) throw new Error('Engine event has no sight snapshot');
    const snapshot = record(event.sightSnapshot, 'Sight snapshot');
    exact(snapshot, ['actor', 'radius', 'candidates', ...(snapshot.continuity === undefined ? [] : ['continuity'])], 'Sight snapshot');
    if (snapshot.continuity !== undefined) {
        const continuity = record(snapshot.continuity, 'Sight continuity');
        exact(continuity, ['actorSessionToken', 'visualDigest', 'observers'], 'Sight continuity');
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof continuity.actorSessionToken !== 'string' || !uuid.test(continuity.actorSessionToken)
            || typeof continuity.visualDigest !== 'string' || !/^[a-f0-9]{64}$/.test(continuity.visualDigest)
            || !Array.isArray(continuity.observers) || continuity.observers.length > 2047)
            throw new Error('Sight continuity is invalid');
        const seenContinuity = new Set<string>();
        for (const value of continuity.observers) {
            const observer = record(value, 'Sight continuity observer');
            exact(observer, ['username', 'sessionToken'], 'Sight continuity observer');
            if (typeof observer.username !== 'string' || !/^[a-z0-9]{1,12}$/.test(observer.username)
                || seenContinuity.has(observer.username) || typeof observer.sessionToken !== 'string'
                || !uuid.test(observer.sessionToken)) throw new Error('Sight continuity observer is invalid');
            seenContinuity.add(observer.username);
        }
    }
    const actor = point(snapshot.actor, 'Sight actor');
    const radius = integer(snapshot.radius, 1, 15, 'Sight radius');
    if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length > 2047)
        throw new Error('Sight candidates are invalid');
    const seen = new Set<string>();
    return snapshot.candidates.map((value, index) => {
        const candidate = record(value, `Sight candidate ${index}`);
        exact(candidate, ['username', 'x', 'z', 'level'], `Sight candidate ${index}`);
        const observer = point({ x: candidate.x, z: candidate.z, level: candidate.level }, 'Sight candidate position');
        const username = candidate.username;
        if (typeof username !== 'string' || !username || username.length > 12
            || username !== username.toLowerCase() || username === event.playerUsername || seen.has(username)
            || observer.level !== actor.level) throw new Error('Sight candidate identity is invalid');
        seen.add(username);
        const distance = Math.max(Math.abs(observer.x - actor.x), Math.abs(observer.z - actor.z));
        if (distance > radius) throw new Error('Sight candidate is outside the captured radius');
        const band = policy.bands.find(value => distance <= value.maxDistance)!;
        const base = { eventId: event.eventId, outcomeReceiptId: outcome.receiptId,
            observerUsername: username, distance, attentionBasisPoints: band.attentionBasisPoints,
            policyDigest: digest, sourceEvidenceDigest: event.eventDigest };
        return { ...base, opportunityDigest: hash(base) };
    }).sort((left, right) => left.observerUsername.localeCompare(right.observerUsername));
}
