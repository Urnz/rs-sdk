import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { assessEngineHousingStorageSource } from './engine-storage-source.js';
import { projectHousingSecurity } from './security.js';
import { recordHousingStorageTrace, type HousingTraceDecision } from './trace-discovery.js';
import type { HousingTraceRollStore } from './trace-roll-store.js';
import type { HousingEffectPolicy, HousingSecurityPolicy, HousingTierPolicy,
    HousingUnitCatalog } from './types.js';

/** Promotes one exact placed-storage engine transfer to one persisted trace decision. */
export function recordEngineHousingStorageTrace(eventId: string, source: ThievingEvidenceStore,
    thieving: ThievingProcedureStore, rolls: HousingTraceRollStore, policy: HousingSecurityPolicy,
    hierarchy: HousingTierPolicy, effects: HousingEffectPolicy, units: HousingUnitCatalog,
    recordedAt = new Date().toISOString()): HousingTraceDecision {
    const assessed = assessEngineHousingStorageSource(eventId, source);
    if (!assessed.eligible) throw new Error(`Engine event is not an eligible Housing storage theft: ${assessed.reason}`);
    const receiptId = `outcome:${eventId}`, outcome = thieving.getOutcome(receiptId);
    if (!outcome || outcome.sourceEventId !== eventId || outcome.sourceEvidenceDigest !== assessed.sourceEvidenceDigest)
        throw new Error('Engine storage theft has no matching Thieving outcome');
    const snapshot = assessed.storageAccess;
    const surface = { observationId: `surface:${eventId}`, kind: 'storage' as const,
        housingUnitId: snapshot.housingUnitId, storageSurfaceId: snapshot.storageSurfaceId,
        storageSlots: snapshot.storageSlots, propertyLockLevel: null,
        sourceEvidenceDigest: assessed.sourceEvidenceDigest };
    const trusted = () => source.verifyChain()
        && source.get(eventId)?.eventDigest === assessed.sourceEvidenceDigest;
    const security = projectHousingSecurity(policy, hierarchy, effects, units, surface, trusted);
    if (security.propertyId !== snapshot.propertyId || security.lockLevel !== snapshot.lockLevel
        || security.traceBasisPoints !== snapshot.traceBasisPoints)
        throw new Error('Engine storage snapshot no longer matches Housing security policy');
    const observationId = `storage-trace:${eventId}`;
    const issued = rolls.issue(receiptId, observationId, security, recordedAt);
    return recordHousingStorageTrace(observationId, receiptId, thieving, policy, hierarchy, effects, units,
        surface, { roll: issued.roll, occurredAt: issued.occurredAt,
            sourceEvidenceDigest: issued.sourceEvidenceDigest }, trusted, rolls.verifyRollFor.bind(rolls), recordedAt);
}
