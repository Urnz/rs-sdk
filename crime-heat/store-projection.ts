import type { ItemProvenanceStore } from '../item-provenance/store.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import { projectCrimeHeat } from './policy.js';
import type { CrimeHeatAssessment, CrimeHeatAssessmentVerifier, CrimeHeatPolicy,
    CrimeHeatProjection } from './types.js';

export interface CrimeHeatSources {
    thieving: ThievingProcedureStore;
    provenance: ItemProvenanceStore | null;
}

/** Read only. Source ledgers are verified before their facts enter the projection. */
export function projectCrimeHeatFromStores(policy: CrimeHeatPolicy, sources: CrimeHeatSources,
    outcomeReceiptId: string, assetId: string | null, assessment: CrimeHeatAssessment,
    verifyAssessment?: CrimeHeatAssessmentVerifier): CrimeHeatProjection {
    if (!sources.thieving.verifyAuditChain()) throw new Error('Thieving audit chain is invalid');
    const outcome = sources.thieving.getOutcome(outcomeReceiptId);
    if (!outcome) throw new Error('Crime heat outcome does not exist');
    const discoveries = sources.thieving.listDiscoveries(outcomeReceiptId)
        .filter(value => Date.parse(value.occurredAt) <= Date.parse(assessment.assessedAtWallTime));
    let asset = null;
    let theftEvent = null;
    if (assetId !== null) {
        if (!sources.provenance || !sources.provenance.verifyAuditChain())
            throw new Error('Item provenance audit chain is unavailable or invalid');
        asset = sources.provenance.getAsset(assetId);
        if (!asset) throw new Error('Crime heat asset does not exist');
        theftEvent = sources.provenance.listEvents(assetId).find(value => value.kind === 'stolen'
            && value.sourceRecordId === outcomeReceiptId) ?? null;
        if (!theftEvent) throw new Error('Crime heat asset has no matching theft event');
    }
    return projectCrimeHeat(policy, { outcome, theftEvent, asset, discoveries, assessment },
        candidate => candidate.receiptId === outcome.receiptId && candidate.receiptDigest === outcome.receiptDigest,
        verifyAssessment,
        candidate => discoveries.some(value => value.observationId === candidate.observationId
            && value.observationDigest === candidate.observationDigest),
        candidate => theftEvent !== null && candidate.eventId === theftEvent.eventId
            && candidate.eventDigest === theftEvent.eventDigest,
        candidate => asset !== null && candidate.assetId === asset.assetId && candidate.revision === asset.revision);
}
