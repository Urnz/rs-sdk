import type { AgentStateStore } from '../agent-state/store.js';
import type { GovernanceStore } from '../server/gateway/admin/governance.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { CrimeCaseStore } from './store.js';
import type { CrimeEvidenceStore } from './evidence-store.js';
import type { FineDecisionStore } from './fine-decision-store.js';
import type { FineProposalStore } from './fine-proposal-store.js';

export type FineCollectionBlocker = 'decision-rejected' | 'jurisdiction-inactive'
    | 'debtor-avatar-unverified';

/** Execution preflight only: the settlement journal still requires a separately recorded audited intent. */
export interface FineCollectionPreflight {
    decisionId: string;
    decisionDigest: string;
    amountGp: number;
    creditorFactionId: string | null;
    treasuryActorId: string | null;
    candidatePayerUsername: string | null;
    blockers: FineCollectionBlocker[];
    canCollect: boolean;
}

/** Re-reads the audited legal chain and identifies current endpoints without authorizing payment. */
export function inspectFineCollection(decisionId: string, sources: {
    decisions: Pick<FineDecisionStore, 'get'>;
    proposals: Pick<FineProposalStore, 'get'>;
    evidence: Pick<CrimeEvidenceStore, 'getFinding'>;
    cases: Pick<CrimeCaseStore, 'getState'>;
    thieving: Pick<ThievingProcedureStore, 'getOutcome'>;
    agents: Pick<AgentStateStore, 'getIdentity' | 'getControlProfile'>;
    governance: Pick<GovernanceStore, 'getJurisdiction' | 'getFaction'>;
}): FineCollectionPreflight | null {
    // FineDecisionStore.get verifies its own chain and the proposal/finding/policy/grant sources.
    const decision = sources.decisions.get(decisionId);
    if (!decision) return null;
    const blockers: FineCollectionBlocker[] = [];
    if (decision.disposition !== 'approved') blockers.push('decision-rejected');
    const jurisdiction = sources.governance.getJurisdiction(decision.jurisdictionId);
    const faction = jurisdiction && sources.governance.getFaction(jurisdiction.factionId);
    if (!faction || faction.status !== 'active') blockers.push('jurisdiction-inactive');

    const proposal = sources.proposals.get(decision.proposalId);
    const finding = proposal && sources.evidence.getFinding(proposal.findingId);
    const caseState = finding && sources.cases.getState(finding.caseId);
    const outcome = caseState && sources.thieving.getOutcome(caseState.outcomeReceiptId);
    const identity = sources.agents.getIdentity(decision.suspectAgentId);
    const profile = sources.agents.getControlProfile(decision.suspectAgentId);
    const originalUsername = outcome?.playerUsername.trim().toLowerCase();
    const candidatePayerUsername = outcome?.actorAgentId === decision.suspectAgentId
        && originalUsername && identity?.playerUsername === originalUsername
        && profile?.role === 'player' && profile.subjectKind === 'player'
        && profile.avatarPlayerUsername === originalUsername
        && profile.subjectId === originalUsername ? originalUsername : null;
    if (!candidatePayerUsername) blockers.push('debtor-avatar-unverified');

    return { decisionId: decision.decisionId, decisionDigest: decision.decisionDigest,
        amountGp: decision.amountGp, creditorFactionId: faction?.factionId ?? null,
        treasuryActorId: faction?.treasuryActorId ?? null, candidatePayerUsername,
        blockers, canCollect: blockers.length === 0 };
}
