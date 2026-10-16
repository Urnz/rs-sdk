import { createHash } from 'node:crypto';

import type { GovernanceStore } from '../server/gateway/admin/governance.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { CrimeEvidenceStore } from './evidence-store.js';
import type { LegalFindingRequest } from './evidence-types.js';
import { createJurisdictionFindingVerifier } from './jurisdiction-policy.js';
import type { JurisdictionCrimePolicy, JurisdictionCrimePolicySource } from './jurisdiction-policy.js';
import type { CrimeCaseStore } from './store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i, DIGEST = /^[0-9a-f]{64}$/;

/** Immutable sentencing limit, separate from the evidence rule for finding responsibility. */
export interface JurisdictionFinePolicy {
    schemaVersion: 1;
    policyId: string;
    jurisdictionId: string;
    version: number;
    createdAt: string;
    effectiveFrom: string;
    maxFineGp: number;
}

/** A proposal only. Passing its gate does not create a debt or transfer money. */
export interface FineProposal {
    proposalId: string;
    findingId: string;
    findingDigest: string;
    suspectAgentId: string;
    jurisdictionId: string;
    policyId: string;
    policyDigest: string;
    amountGp: number;
    authorityEvidenceDigest: string;
    occurredAt: string;
}

export interface FineProposalSources {
    evidence: Pick<CrimeEvidenceStore, 'getFinding' | 'getEvidence' | 'verifyAuditChain'>;
    cases: Pick<CrimeCaseStore, 'getState' | 'verifyAuditChain'>;
    thieving: Pick<ThievingProcedureStore, 'getOutcome'>;
    governance: Pick<GovernanceStore, 'resolveAt' | 'isFactionActiveAt'>;
    crimePolicies: readonly JurisdictionCrimePolicy[] | JurisdictionCrimePolicySource;
    /** Rechecks the original finding's independent adjudication, not the fine authority. */
    verifyFindingAuthority: (request: Readonly<LegalFindingRequest>) => string | null;
    /** Independent adjudicator attestation, never a client or LLM assertion. */
    verifyAuthority: (proposal: Readonly<FineProposal>) => string | null;
}

export interface JurisdictionFinePolicySource {
    /** Must attest historic creation and activation through a persistent audit trail. */
    listEffectiveAt(jurisdictionId: string, occurredAt: string): JurisdictionFinePolicy[];
}

function isPolicySource(value: readonly JurisdictionFinePolicy[] | JurisdictionFinePolicySource):
    value is JurisdictionFinePolicySource { return 'listEffectiveAt' in value; }

function iso(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}
function normalized(policy: JurisdictionFinePolicy): JurisdictionFinePolicy {
    if (!policy || Object.keys(policy).sort().join(',') !== [
        'schemaVersion', 'policyId', 'jurisdictionId', 'version', 'createdAt', 'effectiveFrom', 'maxFineGp'
    ].sort().join(',') || policy.schemaVersion !== 1
        || typeof policy.policyId !== 'string' || !ID.test(policy.policyId)
        || typeof policy.jurisdictionId !== 'string' || !ID.test(policy.jurisdictionId)
        || !Number.isSafeInteger(policy.version) || policy.version < 1
        || !iso(policy.createdAt) || !iso(policy.effectiveFrom) || policy.createdAt > policy.effectiveFrom
        || !Number.isSafeInteger(policy.maxFineGp)
        || policy.maxFineGp < 1 || policy.maxFineGp > 1_000_000_000)
        throw new Error('Fine policy schema or limit is invalid');
    return { schemaVersion: 1, policyId: policy.policyId, jurisdictionId: policy.jurisdictionId,
        version: policy.version, createdAt: policy.createdAt, effectiveFrom: policy.effectiveFrom,
        maxFineGp: policy.maxFineGp };
}

export function digestJurisdictionFinePolicy(policy: JurisdictionFinePolicy): string {
    return createHash('sha256').update(JSON.stringify(normalized(policy))).digest('hex');
}

/** Fail-closed, read-only preflight. Collection needs a separate atomic audited command. */
export function createFineProposalVerifier(policies: readonly JurisdictionFinePolicy[]
    | JurisdictionFinePolicySource,
    sources: FineProposalSources): (proposal: Readonly<FineProposal>) => boolean {
    const policySource = isPolicySource(policies) ? policies : null;
    const catalog = policySource ? [] : (policies as readonly JurisdictionFinePolicy[]).map(normalized);
    const ids = new Set<string>(), versions = new Set<string>();
    for (const policy of catalog) {
        const familyVersion = `${policy.jurisdictionId}:${policy.version}`;
        if (ids.has(policy.policyId) || versions.has(familyVersion))
            throw new Error('Duplicate fine policy identity or version');
        ids.add(policy.policyId); versions.add(familyVersion);
    }
    for (const jurisdictionId of new Set(catalog.map(policy => policy.jurisdictionId))) {
        const family = catalog.filter(policy => policy.jurisdictionId === jurisdictionId)
            .sort((left, right) => left.version - right.version);
        if (family.some((policy, index) => policy.version !== index + 1
            || (index > 0 && policy.effectiveFrom <= family[index - 1]!.effectiveFrom)))
            throw new Error('Fine policy versions must be complete and chronologically ordered');
    }
    const verifyFinding = createJurisdictionFindingVerifier(sources.crimePolicies, {
        governance: sources.governance, cases: sources.cases, thieving: sources.thieving,
        verifyAuthority: sources.verifyFindingAuthority
    });
    return proposal => {
        if (!proposal || Object.keys(proposal).sort().join(',') !== [
            'proposalId', 'findingId', 'findingDigest', 'suspectAgentId', 'jurisdictionId',
            'policyId', 'policyDigest', 'amountGp', 'authorityEvidenceDigest', 'occurredAt'
        ].sort().join(',') || typeof proposal.proposalId !== 'string' || !ID.test(proposal.proposalId)
            || typeof proposal.findingId !== 'string' || !ID.test(proposal.findingId)
            || typeof proposal.suspectAgentId !== 'string' || !ID.test(proposal.suspectAgentId)
            || typeof proposal.jurisdictionId !== 'string' || !ID.test(proposal.jurisdictionId)
            || typeof proposal.policyId !== 'string' || !ID.test(proposal.policyId)
            || typeof proposal.findingDigest !== 'string' || !DIGEST.test(proposal.findingDigest)
            || typeof proposal.policyDigest !== 'string' || !DIGEST.test(proposal.policyDigest)
            || typeof proposal.authorityEvidenceDigest !== 'string'
            || !DIGEST.test(proposal.authorityEvidenceDigest)
            || !Number.isSafeInteger(proposal.amountGp) || proposal.amountGp < 1
            || !iso(proposal.occurredAt)) return false;
        if (!sources.evidence.verifyAuditChain() || !sources.cases.verifyAuditChain()) return false;
        const finding = sources.evidence.getFinding(proposal.findingId);
        if (!finding || finding.findingDigest !== proposal.findingDigest || finding.conclusion !== 'responsible'
            || finding.suspectAgentId !== proposal.suspectAgentId
            || finding.jurisdictionId !== proposal.jurisdictionId
            || Date.parse(proposal.occurredAt) < Date.parse(finding.recordedAt)) return false;
        const findingRequest: LegalFindingRequest = { findingId: finding.findingId,
            caseId: finding.caseId, jurisdictionId: finding.jurisdictionId,
            suspectAgentId: finding.suspectAgentId, conclusion: finding.conclusion,
            evidenceIds: [...finding.evidenceIds], policyId: finding.policyId,
            policyDigest: finding.policyDigest,
            authorityEvidenceDigest: finding.authorityEvidenceDigest,
            occurredAt: finding.occurredAt };
        const cited = finding.evidenceIds.map(value => sources.evidence.getEvidence(value));
        if (cited.some(value => !value || value.caseId !== finding.caseId
            || value.occurredAt > finding.occurredAt)
            || !verifyFinding(findingRequest, cited as NonNullable<typeof cited[number]>[])) return false;
        const state = sources.cases.getState(finding.caseId);
        const outcome = state && sources.thieving.getOutcome(state.outcomeReceiptId);
        if (!outcome || outcome.result !== 'succeeded') return false;
        const incidentAt = outcome.occurredAt;
        const candidates = policySource
            ? policySource.listEffectiveAt(finding.jurisdictionId, incidentAt).map(normalized)
            : catalog.filter(policy => policy.jurisdictionId === finding.jurisdictionId
            && Date.parse(policy.createdAt) <= Date.parse(incidentAt)
            && Date.parse(policy.effectiveFrom) <= Date.parse(incidentAt));
        if (policySource && candidates.length > 1) return false;
        if (candidates.some(policy => policy.jurisdictionId !== finding.jurisdictionId
            || policy.createdAt > incidentAt || policy.effectiveFrom > incidentAt)) return false;
        const active = candidates.sort((left, right) => right.version - left.version)[0];
        if (!active || active.policyId !== proposal.policyId
            || digestJurisdictionFinePolicy(active) !== proposal.policyDigest
            || proposal.amountGp > active.maxFineGp) return false;
        const scope = sources.governance.resolveAt(outcome.target.x, outcome.target.z, outcome.target.level)
            .find(value => value.jurisdictionId === finding.jurisdictionId
                && Date.parse(value.createdAt) <= Date.parse(incidentAt)
                && Date.parse(value.territory.createdAt) <= Date.parse(incidentAt)
                && Date.parse(value.faction.createdAt) <= Date.parse(incidentAt));
        if (!scope || !sources.governance.isFactionActiveAt(scope.factionId, incidentAt)
            || !sources.governance.isFactionActiveAt(scope.factionId, proposal.occurredAt)) return false;
        const attested = sources.verifyAuthority(Object.freeze({ ...proposal }));
        return typeof attested === 'string' && DIGEST.test(attested)
            && attested === proposal.authorityEvidenceDigest;
    };
}
