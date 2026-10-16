import type { PropertyCatalog } from '../server/engine/src/mods/Properties.js';
import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { projectHousingSecurity } from './security.js';
import { recordHousingEntryTrace, type HousingTraceDecision } from './trace-discovery.js';
import type { HousingTraceRollStore } from './trace-roll-store.js';
import type { HousingAttackSurfaceObservation, HousingEffectPolicy, HousingSecurityPolicy,
    HousingTierPolicy, HousingUnitCatalog } from './types.js';

/** Promotes only a persisted engine Property-entry event to a housing trace decision. */
export function recordEngineHousingEntryTrace(eventId: string, source: ThievingEvidenceStore,
    thieving: ThievingProcedureStore, rolls: HousingTraceRollStore, properties: PropertyCatalog,
    policy: HousingSecurityPolicy, hierarchy: HousingTierPolicy, effects: HousingEffectPolicy,
    units: HousingUnitCatalog, recordedAt = new Date().toISOString()): HousingTraceDecision {
    if (!source.verifyChain()) throw new Error('Thieving engine evidence chain is invalid');
    const event = source.get(eventId);
    if (!event || event.procedureKind !== 'property-burglary' || event.effect !== 'entry-completed'
        || event.target.kind !== 'loc' || !event.propertyAccess || event.propertyAccess.actorAuthorized
        || !event.propertyAccess.owner) throw new Error('Engine event is not a denied Property burglary entry');
    const receiptId = `outcome:${event.eventId}`, outcome = thieving.getOutcome(receiptId);
    if (!outcome || outcome.sourceEventId !== event.eventId || outcome.sourceEvidenceDigest !== event.eventDigest
        || outcome.playerUsername !== event.playerUsername)
        throw new Error('Engine Property entry has no matching Thieving outcome');
    const accessSnapshot = event.propertyAccess;
    const property = properties.properties.find(value => value.propertyId === accessSnapshot.propertyId);
    const entry = property?.entryPoints.find(value => value.entryPointId === accessSnapshot.entryPointId);
    if (!property || !entry || entry.x !== event.target.x || entry.z !== event.target.z
        || entry.level !== event.target.level)
        throw new Error('Engine Property entry does not match the Property catalog');
    if (!Number.isSafeInteger(accessSnapshot.lockLevel) || accessSnapshot.lockLevel! < 1
        || accessSnapshot.lockLevel! > 99) throw new Error('Engine Property entry lacks an event-time lock level');
    const matchingUnits = units.units.filter(value => value.enabled && value.propertyId === property.propertyId);
    if (matchingUnits.length !== 1) throw new Error('Engine Property entry needs exactly one enabled housing unit');
    const observationId = `trace:${event.eventId}`;
    const surface: HousingAttackSurfaceObservation = { observationId: `surface:${event.eventId}`,
        kind: 'property-entry', housingUnitId: matchingUnits[0]!.housingUnitId,
        storageSurfaceId: null, storageSlots: 0, propertyLockLevel: accessSnapshot.lockLevel!,
        sourceEvidenceDigest: event.eventDigest };
    const trusted = () => source.verifyChain() && source.get(event.eventId)?.eventDigest === event.eventDigest;
    const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, trusted);
    const issued = rolls.issue(receiptId, observationId, security, recordedAt);
    const roll = { roll: issued.roll, occurredAt: issued.occurredAt,
        sourceEvidenceDigest: issued.sourceEvidenceDigest };
    const access = { sourceEventId: event.eventId, sourceEvidenceDigest: event.eventDigest,
        propertyId: accessSnapshot.propertyId, propertyStateVersion: accessSnapshot.propertyStateVersion,
        actorAuthorized: accessSnapshot.actorAuthorized, owner: accessSnapshot.owner };
    return recordHousingEntryTrace(observationId, receiptId, thieving, policy, hierarchy, effects, units,
        surface, access, roll, trusted, trusted, rolls.verifyRollFor.bind(rolls), recordedAt);
}
