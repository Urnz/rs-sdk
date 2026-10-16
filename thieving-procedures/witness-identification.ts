import { createHash } from 'node:crypto';
import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { ThievingProcedureStore } from './store.js';
import type { WitnessAttentionDecisionStore } from './witness-decision-store.js';

/** Retrieved by a trusted server port, never supplied as an LLM/HTTP attestation. */
export interface WitnessRecognitionSource {
    recognitionId: string;
    eventId: string;
    observerUsername: string;
    recognizedPlayerUsername: string;
    recognizedAgentId: string;
    attentionDecisionDigest: string;
    sourceEvidenceDigest: string;
    recognitionDigest: string;
    occurredAt: string;
}
export interface WitnessRecognitionPort {
    verifyAuditChain(): boolean;
    get(recognitionId: string): WitnessRecognitionSource | null;
}
/** Until an independent engine recognition journal is wired, production must deny identification. */
export function createCurrentWitnessRecognitionPort(): WitnessRecognitionPort {
    return Object.freeze({ verifyAuditChain: () => true, get: () => null });
}

/** Adds recognition after attention, leaving the original anonymous discovery immutable. */
export function recordWitnessIdentification(recognitionId: string, observerUsername: string, deps: {
    source: ThievingEvidenceStore;
    thieving: ThievingProcedureStore;
    decisions: WitnessAttentionDecisionStore;
    recognition: WitnessRecognitionPort;
}, recordedAt = new Date().toISOString()) {
    if (!/^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(recognitionId)
        || !/^[a-z0-9]{1,12}$/.test(observerUsername)) throw new Error('Invalid recognition request');
    if (!deps.source.verifyChain() || !deps.thieving.verifyAuditChain()
        || !deps.decisions.verifyAuditChain() || !deps.recognition.verifyAuditChain())
        throw new Error('Witness recognition source audit is invalid');
    const retrieved = deps.recognition.get(recognitionId);
    const proof = retrieved ? structuredClone(retrieved) : null;
    if (!proof || proof.recognitionId !== recognitionId || proof.observerUsername !== observerUsername
        || !/^[a-z0-9]{1,12}$/.test(proof.recognizedPlayerUsername)
        || !/^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(proof.recognizedAgentId)
        || !/^[a-f0-9]{64}$/.test(proof.recognitionDigest)) throw new Error('Independent recognition proof required');
    const event = deps.source.get(proof.eventId), outcome = deps.thieving.getOutcome(`outcome:${proof.eventId}`);
    const decision = deps.decisions.get(proof.eventId, observerUsername);
    const anonymousId = `witness:${createHash('sha256').update(JSON.stringify({ eventId: proof.eventId, observer: observerUsername })).digest('hex')}`;
    const anonymous = deps.thieving.getDiscovery(anonymousId);
    if (!event || !outcome || !decision || !anonymous || decision.roll >= decision.attentionBasisPoints
        || outcome.sourceEvidenceDigest !== event.eventDigest || proof.sourceEvidenceDigest !== event.eventDigest
        || decision.decisionDigest !== proof.attentionDecisionDigest || decision.outcomeReceiptDigest !== outcome.receiptDigest
        || decision.outcomeReceiptId !== outcome.receiptId || anonymous.outcomeReceiptId !== outcome.receiptId
        || anonymous.sourceEvidenceDigest !== decision.decisionDigest || anonymous.observerAgentId !== decision.observerAgentId
        || anonymous.source !== 'direct-witness' || anonymous.actorIdentification !== 'none' || anonymous.suspectAgentId !== null
        || proof.recognizedPlayerUsername !== event.playerUsername || proof.recognizedAgentId !== outcome.actorAgentId
        || observerUsername === event.playerUsername)
        throw new Error('Recognition does not match the noticed event and observer');
    const when = Date.parse(proof.occurredAt), recorded = Date.parse(recordedAt);
    if (!Number.isFinite(when) || !Number.isFinite(recorded)
        || new Date(when).toISOString() !== proof.occurredAt || new Date(recorded).toISOString() !== recordedAt
        || when < Date.parse(decision.occurredAt) || recorded < when)
        throw new Error('Recognition timing is invalid');
    const key = createHash('sha256').update(JSON.stringify({ recognitionId, observerUsername })).digest('hex');
    const evidence = { evidenceId: `recognition-evidence:${key}`, outcomeReceiptId: outcome.receiptId,
        source: 'direct-witness' as const, observerAgentId: decision.observerAgentId,
        actorIdentification: 'direct' as const, suspectAgentId: proof.recognizedAgentId,
        facts: ['The previously noticed person was independently recognized.'],
        sourceEvidenceDigest: proof.recognitionDigest, occurredAt: proof.occurredAt };
    return deps.thieving.recordDiscovery(`recognition:${key}`, evidence, () => {
        // Recheck the independent port at the actual write boundary.
        return deps.source.verifyChain() && deps.thieving.verifyAuditChain() && deps.decisions.verifyAuditChain()
            && deps.recognition.verifyAuditChain()
            && JSON.stringify(deps.recognition.get(recognitionId)) === JSON.stringify(proof);
    }, recordedAt);
}
