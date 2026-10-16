import type { AgentStateStore } from '../agent-state/store.js';
import type { CrimeCaseStore } from './store.js';
import type { CrimeReport, CrimeReportRequest, CrimeReportVerifier, CrimeReportStore } from './report-store.js';

export type WitnessReportAction = Omit<CrimeReportRequest, 'reporterAgentId'>;

/**
 * Internal boundary only. The caller must resolve the avatar from an authenticated
 * game session, not from a request body, chat message or LLM tool argument.
 */
export function fileWitnessReportForAvatar(action: WitnessReportAction,
    authenticatedAvatar: () => string | null, agents: AgentStateStore, cases: CrimeCaseStore,
    reports: CrimeReportStore, verifyAction: CrimeReportVerifier,
    recordedAt = new Date().toISOString()): CrimeReport {
    const username = authenticatedAvatar()?.toLowerCase();
    if (!username) throw new Error('Authenticated avatar is required to report a crime');
    if (!cases.verifyAuditChain()) throw new Error('Crime case audit chain is invalid');
    const discovery = cases.getEvent(action.sourceCaseEventId);
    if (!discovery || discovery.kind !== 'discovery-recorded' || discovery.caseId !== action.caseId)
        throw new Error('Report requires a recorded case discovery');
    const matching = agents.listIdentities().filter(identity => identity.playerUsername === username);
    if (matching.length !== 1) throw new Error('Avatar has no unique player agent identity');
    const identity = matching[0]!;
    const profile = agents.getControlProfile(identity.agentId);
    if (!profile || profile.role !== 'player' || profile.subjectKind !== 'player'
        || profile.subjectId !== username || profile.avatarPlayerUsername !== username)
        throw new Error('Avatar is not bound to a player agent');
    if (discovery.observerAgentId !== identity.agentId)
        throw new Error('Only the recorded witness may report this discovery');
    return reports.record({ ...action, reporterAgentId: identity.agentId }, verifyAction, recordedAt);
}
