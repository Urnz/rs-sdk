import type { UnderworldClaimVerifier } from './underworld-claims.js';

/**
 * Evidence contract for a future engine-backed observer/counterparty encounter.
 * This is deliberately not an UnderworldClaimVerifier: constructing one of these
 * values in application code does not attest it. A future adapter must read the
 * committed engine event by ID, validate its integrity and both participant
 * identities, and bind the observer to the event before returning a claim.
 */
export interface EngineCounterpartyObservationSource {
    eventId: string;
    revision: number;
    observerAgentId: string;
    counterpartyAgentId: string;
    committedAt: string;
    sourceDigest: string;
}

/**
 * Production default until an independently verified engine observation exists.
 * Fencing candidate snapshots, settlement summaries, contract text and skill-run
 * telemetry do not establish that this observer learned an underworld partner.
 * Existing test-only verifier callbacks must never be used as a fallback.
 */
export function createCurrentUnderworldClaimVerifier(): UnderworldClaimVerifier {
    return Object.freeze({
        verifyClaim: () => null,
        verifyRevocation: () => null
    });
}
