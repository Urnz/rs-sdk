import type { CrimeEvidenceStore } from '../crime-cases/evidence-store.js';
import type { CrimeCaseStore } from '../crime-cases/store.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;

export interface JurisdictionCrimeHistoryRequest {
    actorAgentId: string;
    jurisdictionId: string;
    incidentFrom: string;
    incidentUntil: string;
    recordedAsOf: string;
}
export interface JurisdictionCrimeHistory extends JurisdictionCrimeHistoryRequest {
    /** Complete local responsibility ledger, not complete crime or population history. */
    scope: 'local-jurisdiction-responsible-history';
    incidents: Array<{ receiptId: string; occurredAt: string; caseIds: string[]; findingIds: string[] }>;
    responsibleOutcomes: number;
    additionalResponsibleOutcomes: number;
    firstIncidentAt: string | null;
    lastIncidentAt: string | null;
    unavailable: {
        recidivismRate: 'no-population-or-complete-cross-jurisdiction-follow-up';
        prospectiveRisk: 'recorded-responsibility-is-not-a-risk-probability';
    };
}

function identifier(value: unknown, name: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${name} is invalid`);
    return value;
}
function timestamp(value: unknown, name: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
        throw new Error(`${name} is invalid`);
    return value;
}

/** Internal-only: the caller must authorize access to legal history and hidden outcome identities. */
export function inspectJurisdictionCrimeHistory(
    evidence: Pick<CrimeEvidenceStore, 'verifyAuditChain' | 'getJurisdictionCriminalRecord'>,
    cases: Pick<CrimeCaseStore, 'verifyAuditChain' | 'getState'>,
    thieving: Pick<ThievingProcedureStore, 'verifyAuditChain' | 'getOutcome'>,
    request: JurisdictionCrimeHistoryRequest
): JurisdictionCrimeHistory {
    const actorAgentId = identifier(request.actorAgentId, 'actorAgentId');
    const jurisdictionId = identifier(request.jurisdictionId, 'jurisdictionId');
    const incidentFrom = timestamp(request.incidentFrom, 'incidentFrom');
    const incidentUntil = timestamp(request.incidentUntil, 'incidentUntil');
    const recordedAsOf = timestamp(request.recordedAsOf, 'recordedAsOf');
    if (Date.parse(incidentFrom) >= Date.parse(incidentUntil) || Date.parse(incidentUntil) > Date.parse(recordedAsOf))
        throw new Error('Crime history interval is invalid');
    const assertSources = () => {
        if (!evidence.verifyAuditChain() || !cases.verifyAuditChain() || !thieving.verifyAuditChain())
            throw new Error('Crime history source audit chain is invalid');
    };
    assertSources();
    const record = structuredClone(evidence.getJurisdictionCriminalRecord(actorAgentId, jurisdictionId));
    const sourceSnapshot = JSON.stringify(record);
    if (record.suspectAgentId !== actorAgentId || record.jurisdictionId !== jurisdictionId)
        throw new Error('Crime history source scope does not match');
    const seen = new Set<string>();
    const caseSnapshots = new Map<string, string>();
    const outcomeSnapshots = new Map<string, string>();
    const grouped = new Map<string, { occurredAt: string; caseIds: Set<string>; findingIds: Set<string> }>();
    for (const finding of record.responsibleFindings) {
        identifier(finding.findingId, 'findingId');
        identifier(finding.caseId, 'caseId');
        const findingAt = timestamp(finding.occurredAt, 'finding occurredAt');
        const recordedAt = timestamp(finding.recordedAt, 'finding recordedAt');
        if (finding.suspectAgentId !== actorAgentId || finding.jurisdictionId !== jurisdictionId
            || finding.conclusion !== 'responsible' || seen.has(finding.findingId)
            || Date.parse(recordedAt) < Date.parse(findingAt))
            throw new Error('Crime history finding is invalid');
        seen.add(finding.findingId);
        if (Date.parse(recordedAt) > Date.parse(recordedAsOf)) continue;
        const state = structuredClone(cases.getState(finding.caseId));
        if (!state || state.caseId !== finding.caseId) throw new Error('Crime history case is missing or mismatched');
        const caseSnapshot = JSON.stringify(state);
        if (caseSnapshots.has(finding.caseId) && caseSnapshots.get(finding.caseId) !== caseSnapshot)
            throw new Error('Crime history case changed during inspection');
        caseSnapshots.set(finding.caseId, caseSnapshot);
        const receiptId = identifier(state.outcomeReceiptId, 'outcomeReceiptId');
        const outcome = structuredClone(thieving.getOutcome(receiptId));
        if (!outcome || outcome.receiptId !== receiptId || outcome.actorAgentId !== actorAgentId)
            throw new Error('Crime history outcome is missing or belongs to another actor');
        const outcomeSnapshot = JSON.stringify(outcome);
        if (outcomeSnapshots.has(receiptId) && outcomeSnapshots.get(receiptId) !== outcomeSnapshot)
            throw new Error('Crime history outcome changed during inspection');
        outcomeSnapshots.set(receiptId, outcomeSnapshot);
        const occurredAt = timestamp(outcome.occurredAt, 'outcome occurredAt');
        if (Date.parse(occurredAt) > Date.parse(findingAt)) throw new Error('Crime history finding precedes incident');
        if (Date.parse(occurredAt) < Date.parse(incidentFrom) || Date.parse(occurredAt) >= Date.parse(incidentUntil)) continue;
        const existing = grouped.get(receiptId);
        if (existing && existing.occurredAt !== occurredAt) throw new Error('Crime history outcome changed during inspection');
        const entry = existing ?? { occurredAt, caseIds: new Set<string>(), findingIds: new Set<string>() };
        entry.caseIds.add(finding.caseId);
        entry.findingIds.add(finding.findingId);
        grouped.set(receiptId, entry);
    }
    assertSources();
    if (JSON.stringify(evidence.getJurisdictionCriminalRecord(actorAgentId, jurisdictionId)) !== sourceSnapshot)
        throw new Error('Crime history finding source changed during inspection');
    for (const [caseId, snapshot] of caseSnapshots) {
        if (JSON.stringify(cases.getState(caseId)) !== snapshot)
            throw new Error('Crime history case changed during inspection');
    }
    for (const [receiptId, snapshot] of outcomeSnapshots) {
        if (JSON.stringify(thieving.getOutcome(receiptId)) !== snapshot)
            throw new Error('Crime history outcome changed during inspection');
    }
    assertSources();
    const incidents = [...grouped].map(([receiptId, entry]) => ({ receiptId, occurredAt: entry.occurredAt,
        caseIds: [...entry.caseIds].sort(), findingIds: [...entry.findingIds].sort() }))
        .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.receiptId.localeCompare(b.receiptId));
    return { scope: 'local-jurisdiction-responsible-history', actorAgentId, jurisdictionId,
        incidentFrom, incidentUntil, recordedAsOf, incidents, responsibleOutcomes: incidents.length,
        additionalResponsibleOutcomes: Math.max(0, incidents.length - 1),
        firstIncidentAt: incidents[0]?.occurredAt ?? null, lastIncidentAt: incidents.at(-1)?.occurredAt ?? null,
        unavailable: { recidivismRate: 'no-population-or-complete-cross-jurisdiction-follow-up',
            prospectiveRisk: 'recorded-responsibility-is-not-a-risk-probability' } };
}
