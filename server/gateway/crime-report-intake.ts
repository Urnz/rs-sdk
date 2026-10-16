import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import { AgentStateStore } from '../../agent-state/store.js';
import { CrimeCaseStore, CrimeReportStore, PlayerWitnessReportStore, fileWitnessReportForAvatar,
    type CrimeReport, type PlayerWitnessReport } from '../../crime-cases/index.js';
import { ThievingEvidenceStore } from '../engine/src/mods/ThievingEvidenceStore.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { loadWitnessAttentionPolicy } from '../../thieving-procedures/witness-attention.js';
import { WitnessAttentionDecisionStore } from '../../thieving-procedures/witness-decision-store.js';
import { openWitnessRecognitionSources } from './crime-witness-recognition.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const USERNAME = /^[a-z0-9]{1,12}$/i;

export interface CrimeReportIntakePaths {
    agents: string;
    thieving: string;
    cases: string;
    reports: string;
    playerReports?: string;
    engineEvidence?: string;
    witnessDecisions?: string;
    witnessPolicy?: string;
    recognition?: string;
    engineRecognition?: string;
    caseEvidence?: string;
}

/** A reused or stale bot state is not evidence of a current in-game avatar. */
export function hasMatchingLiveWitnessAvatar(input: {
    loginServerEnabled: boolean;
    authenticatedUsername: string;
    avatarName: string | null;
    connected: boolean;
    receivedStateThisConnection: boolean;
    inGame: boolean;
    lastStateReceivedAt: number;
    nowMs: number;
}): boolean {
    const username = input.authenticatedUsername.trim().toLowerCase();
    const age = input.nowMs - input.lastStateReceivedAt;
    return input.loginServerEnabled && USERNAME.test(username) && input.connected
        && input.receivedStateThisConnection && input.inGame
        && input.avatarName?.trim().toLowerCase() === username
        && Number.isFinite(age) && age >= 0 && age <= 15_000;
}

/** Called only after a real login-server authentication; no client-supplied identity or attestation. */
export function fileAuthenticatedWitnessReport(input: unknown, authenticatedUsername: string,
    currentGameAvatar: string | null, paths: CrimeReportIntakePaths,
    occurredAt = new Date().toISOString()): CrimeReport | PlayerWitnessReport {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).sort().join(',') !== 'caseId,sourceCaseEventId')
        throw new Error('Witness report fields are invalid');
    const request = input as { caseId: unknown; sourceCaseEventId: unknown };
    if (typeof request.caseId !== 'string' || !ID.test(request.caseId)
        || typeof request.sourceCaseEventId !== 'string' || !ID.test(request.sourceCaseEventId))
        throw new Error('Witness report source is invalid');
    const username = authenticatedUsername.trim().toLowerCase();
    if (!USERNAME.test(username) || currentGameAvatar?.trim().toLowerCase() !== username)
        throw new Error('Authenticated avatar has no matching live game session');
    if (!existsSync(paths.thieving) || !existsSync(paths.cases))
        throw new Error('Witness report source ledgers are unavailable');

    const reportId = `report-${createHash('sha256').update(JSON.stringify({ username,
        caseId: request.caseId, sourceCaseEventId: request.sourceCaseEventId })).digest('hex').slice(0, 32)}`;
    const thieving = new ThievingProcedureStore(paths.thieving);
    let cases: CrimeCaseStore | null = null;
    let reports: CrimeReportStore | null = null;
    let agents: AgentStateStore | null = null;
    let recognitionSources: ReturnType<typeof openWitnessRecognitionSources> | null = null;
    try {
        cases = new CrimeCaseStore(paths.cases, thieving);
        // The raw event is used to choose a ledger, so authenticate it before branching.
        if (!thieving.verifyAuditChain() || !cases.verifyAuditChain())
            throw new Error('Witness report source audit chain is invalid');
        const source = cases.getEvent(request.sourceCaseEventId);
        // Recognition requires the independent engine receipt even for exact replay.
        if (source?.observationId.startsWith('recognition:')) {
            recognitionSources = openWitnessRecognitionSources(paths);
            const observation = thieving.getDiscovery(source.observationId);
            if (!observation || !recognitionSources.verifyRecognition(observation, username)
                || source.caseId !== request.caseId || observation.observationDigest !== source.observationDigest)
                throw new Error('Witness recognition is not bound to this observer');
        }
        if (source?.kind === 'discovery-recorded' && source.caseId === request.caseId
            && source.observerAgentId === null) {
            if (!paths.playerReports || !paths.engineEvidence || !paths.witnessDecisions || !paths.witnessPolicy
                || ![paths.engineEvidence, paths.witnessDecisions, paths.witnessPolicy].every(existsSync))
                throw new Error('Player witness report sources are unavailable');
            const engine = new ThievingEvidenceStore(paths.engineEvidence);
            let decisions: WitnessAttentionDecisionStore | null = null;
            let playerReports: PlayerWitnessReportStore | null = null;
            try {
                decisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, engine, thieving,
                    loadWitnessAttentionPolicy(paths.witnessPolicy));
                playerReports = new PlayerWitnessReportStore(paths.playerReports,
                    { cases, thieving, witnessDecisions: decisions,
                        verifyRecognition: recognitionSources?.verifyRecognition });
                const existing = playerReports.get(reportId);
                const actionAt = existing?.occurredAt ?? occurredAt;
                const action = { reportId, caseId: request.caseId, sourceCaseEventId: request.sourceCaseEventId,
                    occurredAt: actionAt };
                const attestationFor = (value: typeof action) => createHash('sha256')
                    .update(JSON.stringify({ kind: 'authenticated-player-witness-report-v1', username,
                        reportId: value.reportId, caseId: value.caseId,
                        sourceCaseEventId: value.sourceCaseEventId, occurredAt: value.occurredAt }))
                    .digest('hex');
                return playerReports.record({ ...action, actionAttestationDigest: attestationFor(action) },
                    () => username, value => attestationFor(value), existing?.recordedAt ?? occurredAt);
            } finally { playerReports?.close(); decisions?.close(); engine.close(); }
        }
        // Engine-generated witness observations require the same source proof for agents
        // as for player-only witnesses. An intact downstream journal is not enough.
        if (source?.kind === 'discovery-recorded' && source.observationId.startsWith('witness:')) {
            if (!paths.engineEvidence || !paths.witnessDecisions || !paths.witnessPolicy
                || ![paths.engineEvidence, paths.witnessDecisions, paths.witnessPolicy].every(existsSync))
                throw new Error('Agent witness engine sources are unavailable');
            const engine = new ThievingEvidenceStore(paths.engineEvidence);
            let decisions: WitnessAttentionDecisionStore | null = null;
            try {
                decisions = new WitnessAttentionDecisionStore(paths.witnessDecisions, engine, thieving,
                    loadWitnessAttentionPolicy(paths.witnessPolicy));
                if (!decisions.verifyAuditChain()) throw new Error('Agent witness source audit chain is invalid');
                const observation = thieving.getDiscovery(source.observationId);
                const outcome = observation && thieving.getOutcome(observation.outcomeReceiptId);
                const decision = outcome && decisions.get(outcome.sourceEventId, username);
                const observationId = outcome && `witness:${createHash('sha256')
                    .update(JSON.stringify({ eventId: outcome.sourceEventId, observer: username })).digest('hex')}`;
                if (!observation || !outcome || !decision || source.caseId !== request.caseId
                    || observation.observationId !== observationId || observation.source !== 'direct-witness'
                    || observation.observationDigest !== source.observationDigest
                    || observation.outcomeReceiptId !== source.outcomeReceiptId
                    || decision.observerUsername !== username || decision.observerAgentId !== source.observerAgentId
                    || observation.observerAgentId !== source.observerAgentId
                    || decision.roll >= decision.attentionBasisPoints
                    || decision.outcomeReceiptId !== outcome.receiptId
                    || decision.outcomeReceiptDigest !== outcome.receiptDigest
                    || decision.decisionDigest !== observation.sourceEvidenceDigest
                    || decision.occurredAt !== observation.occurredAt)
                    throw new Error('Agent witness is not bound to the recorded engine observation');
            } finally { decisions?.close(); engine.close(); }
        }
        if (!existsSync(paths.agents)) throw new Error('Witness agent ledger is unavailable');
        agents = new AgentStateStore(paths.agents);
        reports = new CrimeReportStore(paths.reports, cases);
        const existing = reports.get(reportId);
        const actionAt = existing?.occurredAt ?? occurredAt;
        const attestationFor = (value: { reportId: string; caseId: string;
            sourceCaseEventId: string; occurredAt: string }) => createHash('sha256')
            .update(JSON.stringify({ kind: 'authenticated-witness-report-v1', username,
                reportId: value.reportId, caseId: value.caseId,
                sourceCaseEventId: value.sourceCaseEventId, occurredAt: value.occurredAt }))
            .digest('hex');
        const attestation = attestationFor({ reportId, caseId: request.caseId,
            sourceCaseEventId: request.sourceCaseEventId, occurredAt: actionAt });
        return fileWitnessReportForAvatar({ reportId, caseId: request.caseId,
            sourceCaseEventId: request.sourceCaseEventId, reporterAttestationDigest: attestation,
            occurredAt: actionAt }, () => username, agents, cases, reports,
        (value, source) => source.eventId === value.sourceCaseEventId
            ? attestationFor(value) : null, existing?.recordedAt ?? occurredAt);
    } finally { reports?.close(); agents?.close(); cases?.close(); thieving.close(); recognitionSources?.close(); }
}
