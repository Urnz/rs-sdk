import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { EngineHousingStorageAccessSnapshot } from './engine-storage-runtime.js';

export type HousingStorageSourceAssessment =
    | { eligible: false; reason: 'not-container-theft' }
    | { eligible: false; reason: 'missing-engine-storage-placement-link';
        sourceEventId: string; sourceEvidenceDigest: string }
    | { eligible: false; reason: 'authorized-storage-access';
        sourceEventId: string; sourceEvidenceDigest: string }
    | { eligible: true; sourceEventId: string; sourceEvidenceDigest: string;
        storageAccess: EngineHousingStorageAccessSnapshot };

/**
 * A vanilla chest/stall transfer proves an item delta, not access to an audited Housing placement.
 * Only the event-time snapshot captured by the engine before the transfer may cross this boundary.
 */
export function assessEngineHousingStorageSource(eventId: string,
    source: ThievingEvidenceStore): HousingStorageSourceAssessment {
    if (!source.verifyChain()) throw new Error('Thieving engine evidence chain is invalid');
    const event = source.get(eventId);
    if (!event) throw new Error('Thieving engine event was not found');
    if (event.procedureKind !== 'container-theft' || event.effect !== 'item-transfer'
        || event.target.kind !== 'loc') return { eligible: false, reason: 'not-container-theft' };
    if (!event.storageAccess) return { eligible: false, reason: 'missing-engine-storage-placement-link',
        sourceEventId: event.eventId, sourceEvidenceDigest: event.eventDigest };
    if (event.storageAccess.actorAuthorized) return { eligible: false, reason: 'authorized-storage-access',
        sourceEventId: event.eventId, sourceEvidenceDigest: event.eventDigest };
    return { eligible: true, sourceEventId: event.eventId, sourceEvidenceDigest: event.eventDigest,
        storageAccess: event.storageAccess };
}
