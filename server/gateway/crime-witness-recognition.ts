import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { AgentStateStore } from '../../agent-state/store.js';
import { CrimeCaseStore } from '../../crime-cases/store.js';
import { CrimeEvidenceStore } from '../../crime-cases/evidence-store.js';
import { promoteCrimeObservation } from '../../crime-cases/observation-ingest.js';
import { ThievingEvidenceStore } from '../engine/src/mods/ThievingEvidenceStore.js';
import { EngineWitnessInspectionStore } from '../engine/src/mods/WitnessInspectionStore.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { WitnessRecognitionStore } from '../../thieving-procedures/witness-recognition-store.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import { loadWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { makeVerifiedEngineRecognitionPort, recordEngineWitnessRecognition } from '../../thieving-procedures/engine-recognition.js';
import type { ThievingDiscoveryObservation } from '../../thieving-procedures/types.js';
import type { CrimeReportIntakePaths } from './crime-report-intake.js';

export function openWitnessRecognitionSources(paths: CrimeReportIntakePaths, allowCreate = false) {
    if (!paths.engineEvidence || !paths.engineRecognition || !paths.recognition || !paths.witnessDecisions || !paths.witnessPolicy
        || ![paths.agents, paths.thieving, paths.engineEvidence, paths.witnessDecisions, paths.witnessPolicy,
            ...(allowCreate ? [] : [paths.engineRecognition, paths.recognition])].every(existsSync))
        throw new Error('Witness recognition source verification is unavailable');
    const closers: Array<() => void> = [];
    const keep = <T extends { close(): void }>(store: T): T => { closers.unshift(() => store.close()); return store; };
    try {
        const agents = keep(new AgentStateStore(paths.agents));
        const source = keep(new ThievingEvidenceStore(paths.engineEvidence));
        const thieving = keep(new ThievingProcedureStore(paths.thieving));
        const decisions = keep(new WitnessAttentionDecisionStore(paths.witnessDecisions, source, thieving,
            loadWitnessAttentionPolicy(paths.witnessPolicy)));
        const engineRecognition = keep(new EngineWitnessInspectionStore(paths.engineRecognition));
        const recognition = keep(new WitnessRecognitionStore(paths.recognition));
        const deps = { agents, source, thieving, decisions, engineRecognition, recognition };
        const port = makeVerifiedEngineRecognitionPort(deps);
        const verifyRecognition = (observation: Readonly<ThievingDiscoveryObservation>, username: string): string | null => {
            if (!port.verifyAuditChain()) throw new Error('Independent engine recognition source is invalid');
            const candidate = recognition.getByDigest(observation.sourceEvidenceDigest);
            const proof = candidate && port.get(candidate.recognitionId);
            const decision = proof && decisions.get(proof.eventId, username);
            const key = proof && createHash('sha256').update(JSON.stringify({ recognitionId: proof.recognitionId,
                observerUsername: username })).digest('hex');
            if (!proof || !decision || proof.observerUsername !== username
                || observation.observationId !== `recognition:${key}`
                || observation.evidenceId !== `recognition-evidence:${key}`
                || observation.source !== 'direct-witness' || observation.actorIdentification !== 'direct'
                || observation.suspectAgentId !== proof.recognizedAgentId
                || observation.observerAgentId !== decision.observerAgentId
                || observation.outcomeReceiptId !== decision.outcomeReceiptId
                || observation.occurredAt !== proof.occurredAt) return null;
            return proof.attentionDecisionDigest;
        };
        return { ...deps, verifyRecognition, close: () => closers.forEach(close => close()) };
    } catch (error) { closers.forEach(close => close()); throw error; }
}

/** Authenticated observer chooses an opaque visible player slot, never a purported identity. */
export async function recognizeAuthenticatedWitness(input: unknown, authenticatedUsername: string,
    currentGameAvatar: string | null, paths: CrimeReportIntakePaths) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'commandId,eventId,targetPlayerSlot')
        throw new Error('Witness recognition fields are invalid');
    const request = input as { commandId: string; eventId: string; targetPlayerSlot: number };
    if (typeof request.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.commandId)
        || typeof request.eventId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,127}$/i.test(request.eventId)
        || !Number.isSafeInteger(request.targetPlayerSlot) || request.targetPlayerSlot < 0 || request.targetPlayerSlot > 2047)
        throw new Error('Witness recognition request is invalid');
    const username = authenticatedUsername.trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(username) || currentGameAvatar?.trim().toLowerCase() !== username)
        throw new Error('Authenticated avatar has no matching live game session');
    if (!paths.caseEvidence || !existsSync(paths.cases)) throw new Error('Witness recognition case sources unavailable');
    const sources = openWitnessRecognitionSources(paths, true);
    let cases: CrimeCaseStore | null = null, evidence: CrimeEvidenceStore | null = null;
    try {
        const decision = sources.decisions.get(request.eventId, username);
        if (!sources.decisions.verifyAuditChain() || !decision || decision.roll >= decision.attentionBasisPoints)
            throw new Error('Witness recognition requires a noticed event');
        const token = process.env.ENGINE_ADMIN_TOKEN?.trim();
        if (!token) throw new Error('Engine witness inspection channel is unavailable');
        const response = await fetch(`${(process.env.ENGINE_ADMIN_URL || 'http://localhost:8888').replace(/\/$/, '')}/api/internal/admin/witness-inspection`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
            body: JSON.stringify({ ...request, observerUsername: username }), signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Engine witness inspection rejected');
        // Only the separately audited engine journal is authority, not response JSON.
        const observation = recordEngineWitnessRecognition(request.commandId, username, sources);
        cases = new CrimeCaseStore(paths.cases, sources.thieving);
        evidence = new CrimeEvidenceStore(paths.caseEvidence, cases, sources.thieving);
        const promoted = promoteCrimeObservation(observation.observationId, sources.thieving, cases, evidence);
        return { recognitionId: request.commandId, observationId: observation.observationId,
            caseId: promoted.caseId, sourceCaseEventId: promoted.discovery.eventId };
    } finally { evidence?.close(); cases?.close(); sources.close(); }
}
