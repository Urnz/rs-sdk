import { createHash } from 'node:crypto';

import type { GovernanceStore } from '../server/gateway/admin/governance.js';
import type { ThievingProcedureStore } from '../thieving-procedures/store.js';
import type { CrimeEvidenceKind, LegalFindingRequest, LegalFindingVerifier } from './evidence-types.js';
import type { CrimeCaseStore } from './store.js';

const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const KINDS: ReadonlySet<string> = new Set(['direct-identification', 'physical-trace', 'possession']);
const DIGEST = /^[0-9a-f]{64}$/;

/** Immutable policy version. Changes require a new version and effective timestamp. */
export interface JurisdictionCrimePolicy {
    schemaVersion: 1;
    policyId: string;
    jurisdictionId: string;
    version: number;
    effectiveFrom: string;
    responsibleEvidenceKinds: CrimeEvidenceKind[];
}

function normalized(policy: JurisdictionCrimePolicy): JurisdictionCrimePolicy {
    if (!policy || Object.keys(policy).sort().join(',') !== [
        'schemaVersion', 'policyId', 'jurisdictionId', 'version', 'effectiveFrom',
        'responsibleEvidenceKinds'
    ].sort().join(',') || policy.schemaVersion !== 1) throw new Error('Crime policy schema is invalid');
    if (!ID.test(policy.policyId) || !ID.test(policy.jurisdictionId)
        || !Number.isSafeInteger(policy.version) || policy.version < 1
        || Number.isNaN(Date.parse(policy.effectiveFrom))
        || new Date(policy.effectiveFrom).toISOString() !== policy.effectiveFrom)
        throw new Error('Crime policy identity or effective time is invalid');
    const kinds = policy.responsibleEvidenceKinds;
    if (!Array.isArray(kinds) || !kinds.length || kinds.length > KINDS.size
        || new Set(kinds).size !== kinds.length || kinds.some(kind => !KINDS.has(kind))
        || !kinds.includes('direct-identification')) throw new Error('Crime policy evidence rule is invalid');
    return { schemaVersion: 1, policyId: policy.policyId, jurisdictionId: policy.jurisdictionId,
        version: policy.version, effectiveFrom: policy.effectiveFrom,
        responsibleEvidenceKinds: [...kinds].sort() };
}

export function digestJurisdictionCrimePolicy(policy: JurisdictionCrimePolicy): string {
    return createHash('sha256').update(JSON.stringify(normalized(policy))).digest('hex');
}

export interface JurisdictionFindingSources {
    governance: Pick<GovernanceStore, 'resolveAt' | 'isFactionActiveAt'>;
    cases: Pick<CrimeCaseStore, 'getState' | 'verifyAuditChain'>;
    thieving: Pick<ThievingProcedureStore, 'getOutcome'>;
    /** Independent trusted adjudication/authority evidence; never an LLM or client assertion. */
    verifyAuthority: (request: Readonly<LegalFindingRequest>) => string | null;
}

export interface JurisdictionCrimePolicySource {
    listEffectiveAt(jurisdictionId: string, occurredAt: string): JurisdictionCrimePolicy[];
}

function isPolicySource(value: readonly JurisdictionCrimePolicy[] | JurisdictionCrimePolicySource):
    value is JurisdictionCrimePolicySource { return 'listEffectiveAt' in value; }

/** Fail-closed adapter for the evidence ledger's separate human/institutional finding gate. */
export function createJurisdictionFindingVerifier(policies: readonly JurisdictionCrimePolicy[]
    | JurisdictionCrimePolicySource,
    sources: JurisdictionFindingSources): LegalFindingVerifier {
    const policySource = isPolicySource(policies) ? policies : null;
    const catalog = policySource ? [] : (policies as readonly JurisdictionCrimePolicy[]).map(normalized);
    const ids = new Set<string>(), versions = new Set<string>();
    for (const policy of catalog) {
        const key = `${policy.jurisdictionId}:${policy.version}`;
        if (ids.has(policy.policyId) || versions.has(key)) throw new Error('Duplicate crime policy identity or version');
        ids.add(policy.policyId); versions.add(key);
    }
    return (request, evidence) => {
        if (!sources.cases.verifyAuditChain()) return false;
        const state = sources.cases.getState(request.caseId);
        const outcome = state && sources.thieving.getOutcome(state.outcomeReceiptId);
        if (!outcome || outcome.result !== 'succeeded'
            || Date.parse(request.occurredAt) < Date.parse(outcome.occurredAt)) return false;
        const jurisdictions = sources.governance.resolveAt(outcome.target.x, outcome.target.z,
            outcome.target.level).filter(scope => Date.parse(scope.createdAt) <= Date.parse(outcome.occurredAt)
                && Date.parse(scope.territory.createdAt) <= Date.parse(outcome.occurredAt)
                && Date.parse(scope.faction.createdAt) <= Date.parse(outcome.occurredAt)
                && sources.governance.isFactionActiveAt(scope.factionId, outcome.occurredAt));
        const active = [...jurisdictions].reverse().flatMap(scope => (policySource
            ? policySource.listEffectiveAt(scope.jurisdictionId, outcome.occurredAt).map(normalized)
            : catalog.filter(policy => policy.jurisdictionId === scope.jurisdictionId
                && Date.parse(policy.effectiveFrom) <= Date.parse(outcome.occurredAt)))
            .sort((left, right) => right.version - left.version)).at(0);
        if (!active || active.policyId !== request.policyId
            || active.jurisdictionId !== request.jurisdictionId
            || digestJurisdictionCrimePolicy(active) !== request.policyDigest) return false;
        const scope = jurisdictions.find(value => value.jurisdictionId === active.jurisdictionId)!;
        if (!sources.governance.isFactionActiveAt(scope.factionId, request.occurredAt)) return false;
        if (request.conclusion === 'responsible' && active.responsibleEvidenceKinds.some(kind =>
            !evidence.some(entry => entry.kind === kind
                && (kind === 'physical-trace' || entry.suspectAgentId === request.suspectAgentId))))
            return false;
        const authorityDigest = sources.verifyAuthority(request);
        return typeof authorityDigest === 'string' && DIGEST.test(authorityDigest)
            && authorityDigest === request.authorityEvidenceDigest;
    };
}
