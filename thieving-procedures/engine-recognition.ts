import type { AgentStateStore } from '../agent-state/store.js';
import type { ThievingEvidenceStore } from '../server/engine/src/mods/ThievingEvidenceStore.js';
import type { EngineWitnessInspectionStore } from '../server/engine/src/mods/WitnessInspectionStore.js';
import { resolveBoundAvatarAgent } from './event-processor.js';
import type { ThievingProcedureStore } from './store.js';
import type { WitnessAttentionDecisionStore } from './witness-decision-store.js';
import { recordWitnessIdentification, type WitnessRecognitionPort, type WitnessRecognitionSource } from './witness-identification.js';
import { WitnessRecognitionStore } from './witness-recognition-store.js';

export interface EngineWitnessRecognitionDependencies {
    engineRecognition: EngineWitnessInspectionStore;
    recognition: WitnessRecognitionStore;
    source: ThievingEvidenceStore;
    thieving: ThievingProcedureStore;
    decisions: WitnessAttentionDecisionStore;
    agents: AgentStateStore;
}

/** Engine samples the explicitly selected visible person; hidden theft identity only checks consistency. */
function matchesEngine(proof: WitnessRecognitionSource, deps: EngineWitnessRecognitionDependencies): boolean {
    const receipt = deps.engineRecognition.get(proof.recognitionId);
    const decision = deps.decisions.get(proof.eventId, proof.observerUsername);
    const event = deps.source.get(proof.eventId);
    const outcome = deps.thieving.getOutcome(`outcome:${proof.eventId}`);
    const continuity = event?.sightSnapshot?.continuity;
    return !!receipt && !!decision && !!event && !!outcome
        && receipt.recognitionId === proof.recognitionId && receipt.eventId === proof.eventId
        && receipt.observerUsername === proof.observerUsername
        && receipt.recognizedPlayerUsername === proof.recognizedPlayerUsername
        && receipt.sourceEvidenceDigest === proof.sourceEvidenceDigest
        && receipt.occurredAt === proof.occurredAt
        && decision.decisionDigest === proof.attentionDecisionDigest
        && decision.roll < decision.attentionBasisPoints
        && Date.parse(receipt.occurredAt) >= Date.parse(decision.occurredAt)
        && event.eventDigest === proof.sourceEvidenceDigest
        && !!continuity && continuity.actorSessionToken === receipt.actorSessionToken
        && continuity.visualDigest === receipt.visualDigest
        && continuity.observers.some(observer => observer.username === proof.observerUsername)
        && receipt.engineTick >= event.endedAtEngineTick
        && outcome.sourceEvidenceDigest === event.eventDigest
        && outcome.actorAgentId === proof.recognizedAgentId
        && event.playerUsername === receipt.recognizedPlayerUsername
        && resolveBoundAvatarAgent(deps.agents, receipt.recognizedPlayerUsername) === proof.recognizedAgentId
        && (decision.observerAgentId === null
            || resolveBoundAvatarAgent(deps.agents, proof.observerUsername) === decision.observerAgentId);
}

/** Revalidates upstream source coverage, not just the derived recognition hash. */
export function makeVerifiedEngineRecognitionPort(deps: EngineWitnessRecognitionDependencies): WitnessRecognitionPort {
    const verifyAuditChain = () => {
        try {
            return deps.engineRecognition.verifyChain() && deps.source.verifyChain()
                && deps.thieving.verifyAuditChain() && deps.decisions.verifyAuditChain()
                && deps.recognition.verifyAuditChain()
                && deps.recognition.list().every(proof => matchesEngine(proof, deps));
        } catch { return false; }
    };
    return { verifyAuditChain, get: id => {
        if (!verifyAuditChain()) throw new Error('Independent engine recognition source is invalid');
        const proof = deps.recognition.get(id);
        return proof && matchesEngine(proof, deps) ? proof : null;
    } };
}

export function recordEngineWitnessRecognition(recognitionId: string, observerUsername: string,
    deps: EngineWitnessRecognitionDependencies, recordedAt = new Date().toISOString()) {
    if (!deps.engineRecognition.verifyChain() || !deps.source.verifyChain()
        || !deps.thieving.verifyAuditChain() || !deps.decisions.verifyAuditChain()
        || !deps.recognition.verifyAuditChain()) throw new Error('Engine recognition source audit is invalid');
    const receipt = deps.engineRecognition.get(recognitionId);
    if (!receipt || receipt.observerUsername !== observerUsername) throw new Error('Exact engine recognition receipt required');
    const recognizedAgentId = resolveBoundAvatarAgent(deps.agents, receipt.recognizedPlayerUsername);
    const decision = deps.decisions.get(receipt.eventId, observerUsername);
    if (!recognizedAgentId || !decision || decision.roll >= decision.attentionBasisPoints)
        throw new Error('Recognition requires a bound visible subject and noticed observer');
    const proof = deps.recognition.record({ recognitionId, eventId: receipt.eventId, observerUsername,
        recognizedPlayerUsername: receipt.recognizedPlayerUsername, recognizedAgentId,
        sourceEvidenceDigest: receipt.sourceEvidenceDigest, attentionDecisionDigest: decision.decisionDigest,
        occurredAt: receipt.occurredAt }, candidate =>
        deps.engineRecognition.verifyChain() && deps.source.verifyChain() && deps.thieving.verifyAuditChain()
        && deps.decisions.verifyAuditChain() && matchesEngine(candidate, deps) ? candidate.recognitionDigest : null);
    return recordWitnessIdentification(proof.recognitionId, observerUsername,
        { ...deps, recognition: makeVerifiedEngineRecognitionPort(deps) }, recordedAt);
}
