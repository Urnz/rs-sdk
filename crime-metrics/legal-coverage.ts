import type { CrimeCaseStore } from '../crime-cases/store.js';
import type { CrimeEvidenceStore } from '../crime-cases/evidence-store.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;

export interface CrimeLegalCoverage {
    /** Caller-selected receipts only; not a complete criminal history or a recidivism rate. */
    scope: 'selected-thieving-receipts';
    actorAgentId: string;
    sourceReceiptIds: string[];
    receipts: Array<{ receiptId: string; caseId: string | null;
        actorFindings: Array<{ findingId: string; jurisdictionId: string;
            conclusion: 'responsible' | 'not-proven' }> }>;
    outcomesWithCase: number;
    outcomesWithResponsibleFinding: number;
    outcomesWithNotProvenFinding: number;
    outcomesWithoutActorFinding: number;
    unavailable: { recidivism: 'no-complete-adjudicated-history-or-follow-up-window' };
}

/** Internal-only view. Authorize access to hidden receipts before calling; never infer guilt from a case alone. */
export function inspectCrimeLegalCoverage(
    thieving: Pick<ThievingProcedureStore, 'verifyAuditChain' | 'getOutcome'>,
    cases: Pick<CrimeCaseStore, 'verifyAuditChain' | 'getCaseForOutcome'>,
    evidence: Pick<CrimeEvidenceStore, 'verifyAuditChain' | 'listFindings'>,
    actorAgentId: string, receiptIdsInput: readonly string[]
): CrimeLegalCoverage {
    if (typeof actorAgentId !== 'string' || !ID.test(actorAgentId)) throw new Error('actorAgentId is invalid');
    if (!Array.isArray(receiptIdsInput) || receiptIdsInput.length < 1 || receiptIdsInput.length > 1_000
        || receiptIdsInput.some(value => typeof value !== 'string' || !ID.test(value)))
        throw new Error('Receipt cohort is invalid');
    const receiptIds = [...receiptIdsInput];
    if (new Set(receiptIds).size !== receiptIds.length) throw new Error('Receipt cohort contains duplicates');
    if (!thieving.verifyAuditChain() || !cases.verifyAuditChain() || !evidence.verifyAuditChain())
        throw new Error('Crime legal source audit chain is invalid');

    const receipts = receiptIds.map(receiptId => {
        const outcome = thieving.getOutcome(receiptId);
        if (!outcome) throw new Error(`Thieving receipt ${receiptId} does not exist`);
        if (outcome.actorAgentId !== actorAgentId) throw new Error('Receipt cohort contains another actor');
        const caseId = cases.getCaseForOutcome(receiptId);
        const findings = caseId === null ? [] : evidence.listFindings(caseId);
        if (findings.some(finding => finding.caseId !== caseId))
            throw new Error('Legal finding does not match its case');
        return { receiptId, caseId, actorFindings: findings.filter(finding => finding.suspectAgentId === actorAgentId)
            .map(finding => ({ findingId: finding.findingId, jurisdictionId: finding.jurisdictionId,
                conclusion: finding.conclusion })) };
    });
    return { scope: 'selected-thieving-receipts', actorAgentId, sourceReceiptIds: receiptIds, receipts,
        outcomesWithCase: receipts.filter(receipt => receipt.caseId !== null).length,
        outcomesWithResponsibleFinding: receipts.filter(receipt => receipt.actorFindings.some(finding =>
            finding.conclusion === 'responsible')).length,
        outcomesWithNotProvenFinding: receipts.filter(receipt => receipt.actorFindings.some(finding =>
            finding.conclusion === 'not-proven')).length,
        outcomesWithoutActorFinding: receipts.filter(receipt => receipt.actorFindings.length === 0).length,
        unavailable: { recidivism: 'no-complete-adjudicated-history-or-follow-up-window' } };
}
