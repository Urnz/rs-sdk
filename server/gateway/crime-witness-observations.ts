import { existsSync } from 'node:fs';

import { CrimeCaseStore } from '../../crime-cases/store.js';
import { ThievingEvidenceStore } from '../engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { loadWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import type { ThievingProcedureKind } from '../../thieving-procedures/types.js';
import type { CrimeReportIntakePaths } from './crime-report-intake.js';

const USERNAME = /^[a-z0-9]{1,12}$/;

export interface WitnessObservationNotice {
    eventId: string;
    observationId: string;
    caseId: string;
    sourceCaseEventId: string;
    procedureKind: ThievingProcedureKind;
    occurredAt: string;
    facts: string[];
    observerKind: 'agent' | 'player-only';
}

/** Returns only the authenticated avatar's durable noticed observations; actor identity remains undisclosed. */
export function listAuthenticatedWitnessObservations(authenticatedUsername: string,
    currentGameAvatar: string | null, paths: CrimeReportIntakePaths): WitnessObservationNotice[] {
    const username = authenticatedUsername.trim().toLowerCase();
    if (!USERNAME.test(username) || currentGameAvatar?.trim().toLowerCase() !== username)
        throw new Error('Authenticated avatar has no matching live game session');
    if (!paths.engineEvidence || !paths.witnessDecisions || !paths.witnessPolicy
        || ![paths.engineEvidence, paths.witnessDecisions, paths.witnessPolicy,
            paths.thieving, paths.cases].every(existsSync))
        throw new Error('Witness observation sources are unavailable');
    const source = new ThievingEvidenceStore(paths.engineEvidence);
    const thieving = new ThievingProcedureStore(paths.thieving);
    const decisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, source, thieving,
        loadWitnessAttentionPolicy(paths.witnessPolicy));
    const cases = new CrimeCaseStore(paths.cases, thieving);
    try {
        if (!source.verifyChain() || !thieving.verifyAuditChain() || !decisions.verifyAuditChain()
            || !cases.verifyAuditChain()) throw new Error('Witness observation source audit is invalid');
        const notices: WitnessObservationNotice[] = [];
        for (const item of decisions.listNoticedForObserver(username)) {
            const outcome = thieving.getOutcome(item.outcomeReceiptId);
            const event = source.get(item.eventId);
            const observation = outcome && thieving.listDiscoveries(outcome.receiptId)
                .find(value => value.source === 'direct-witness'
                    && value.sourceEvidenceDigest === item.decisionDigest);
            const caseEvent = observation && cases.findEventByObservation('discovery-recorded', observation.observationId);
            if (!outcome || !event || !observation || !caseEvent
                || event.eventDigest !== outcome.sourceEvidenceDigest
                || event.procedureKind !== outcome.procedureKind
                || item.outcomeReceiptDigest !== outcome.receiptDigest
                || observation.outcomeReceiptId !== outcome.receiptId
                || observation.observerAgentId !== item.observerAgentId
                || observation.actorIdentification !== 'none' || observation.suspectAgentId !== null
                || caseEvent.observationDigest !== observation.observationDigest)
                throw new Error('Witness observation projection is inconsistent');
            notices.push({ eventId: event.eventId, observationId: observation.observationId,
                caseId: caseEvent.caseId, sourceCaseEventId: caseEvent.eventId,
                procedureKind: event.procedureKind, occurredAt: observation.occurredAt,
                facts: [...observation.facts], observerKind: item.observerAgentId ? 'agent' : 'player-only' });
        }
        return notices;
    } finally { cases.close(); decisions.close(); thieving.close(); source.close(); }
}
