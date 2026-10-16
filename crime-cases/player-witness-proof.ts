import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { WitnessAttentionDecisionStore } from '../thieving-procedures/witness-decision-store.js';
import type { CrimeCaseStore } from './store.js';
import type { ThievingDiscoveryObservation } from '../thieving-procedures/types.js';

export type VerifyPlayerRecognition = (observation: Readonly<ThievingDiscoveryObservation>, username: string) => string | null;

const USERNAME = /^[a-z0-9]{1,12}$/;

/** Read-only proof of a noticed, player-only witness; never an agent identity or legal finding. */
export interface PlayerOnlyWitnessProof {
    caseId: string;
    sourceCaseEventId: string;
    observerUsername: string;
    observationId: string;
    witnessDecisionDigest: string;
}

export function verifyPlayerOnlyWitness(caseId: string, sourceCaseEventId: string,
    authenticatedUsername: string, sources: {
        cases: Pick<CrimeCaseStore, 'verifyAuditChain' | 'getEvent'>;
        thieving: Pick<ThievingProcedureStore, 'verifyAuditChain' | 'getDiscovery' | 'getOutcome'>;
        witnessDecisions: Pick<WitnessAttentionDecisionStore, 'verifyAuditChain' | 'get'>;
        verifyRecognition?: VerifyPlayerRecognition;
    }): PlayerOnlyWitnessProof | null {
    const username = authenticatedUsername.trim().toLowerCase();
    if (!USERNAME.test(username)) throw new Error('Authenticated witness username is invalid');
    if (!sources.thieving.verifyAuditChain() || !sources.cases.verifyAuditChain()
        || !sources.witnessDecisions.verifyAuditChain())
        throw new Error('Player witness source audit chain is invalid');
    const discovery = sources.cases.getEvent(sourceCaseEventId);
    if (!discovery || discovery.kind !== 'discovery-recorded' || discovery.caseId !== caseId
        || discovery.observerAgentId !== null) return null;
    const observation = sources.thieving.getDiscovery(discovery.observationId);
    if (!observation || observation.observationDigest !== discovery.observationDigest
        || observation.source !== 'direct-witness' || observation.observerAgentId !== null
        || observation.outcomeReceiptId !== discovery.outcomeReceiptId) return null;
    const outcome = sources.thieving.getOutcome(observation.outcomeReceiptId);
    if (!outcome) return null;
    const decision = sources.witnessDecisions.get(outcome.sourceEventId, username);
    const recognitionDigest = observation.observationId.startsWith('recognition:')
        ? sources.verifyRecognition?.(observation, username) : null;
    if (observation.observationId.startsWith('recognition:') && !recognitionDigest) return null;
    if (!decision || decision.observerUsername !== username || decision.observerAgentId !== null
        || decision.roll >= decision.attentionBasisPoints
        || decision.outcomeReceiptId !== outcome.receiptId
        || decision.outcomeReceiptDigest !== outcome.receiptDigest
        || (recognitionDigest ? decision.decisionDigest !== recognitionDigest
            : decision.decisionDigest !== observation.sourceEvidenceDigest || decision.occurredAt !== observation.occurredAt)) return null;
    return { caseId, sourceCaseEventId, observerUsername: username,
        observationId: observation.observationId, witnessDecisionDigest: decision.decisionDigest };
}
