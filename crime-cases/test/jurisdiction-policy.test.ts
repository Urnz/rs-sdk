import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/store.js';
import { GovernanceStore } from '../../server/gateway/admin/governance.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore, CrimeEvidenceStore, FineAdjudicatorGrantStore, FineDecisionStore,
    FineProposalStore, JurisdictionCrimePolicyStore, JurisdictionFinePolicyStore,
    createFineProposalVerifier, createJurisdictionFindingVerifier, inspectFineCollection,
    digestJurisdictionCrimePolicy, digestJurisdictionFinePolicy, type FineProposal,
    type FineDecisionRequest, type JurisdictionCrimePolicy, type JurisdictionFinePolicy,
    type LegalFindingRequest } from '../index.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z', observedAt = '2030-01-01T10:01:00.000Z';
const authorityDigest = 'a'.repeat(64);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'crime-jurisdiction-')); roots.push(root);
    const governance = new GovernanceStore(join(root, 'governance.sqlite'));
    governance.createFaction({ factionId: 'realm', kind: 'kingdom', name: 'Realm' }, '2029-01-01T00:00:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'realm-law', factionId: 'realm', kind: 'realm',
        name: 'Realm law' }, '2029-01-01T00:00:00.000Z');
    governance.assignTerritory({ territoryId: 'realm-map', jurisdictionId: 'realm-law',
        level: 0, minX: 3200, maxX: 3250, minZ: 3200, maxZ: 3250 }, '2029-01-01T00:00:00.000Z');
    governance.createFaction({ factionId: 'city', kind: 'city', name: 'City' }, '2029-01-01T00:00:00.000Z');
    governance.createJurisdiction({ jurisdictionId: 'city-law', factionId: 'city',
        parentJurisdictionId: 'realm-law', kind: 'city', name: 'City law' }, '2029-01-01T00:00:00.000Z');
    governance.assignTerritory({ territoryId: 'city-map', jurisdictionId: 'city-law',
        level: 0, minX: 3220, maxX: 3230, minZ: 3210, maxZ: 3220 }, '2029-01-01T00:00:00.000Z');
    const thieving = new ThievingProcedureStore(join(root, 'thieving.sqlite'));
    const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence',
        procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
        actorAgentId: 'thief', playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer',
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
        startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event',
        sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at };
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    const cases = new CrimeCaseStore(join(root, 'cases.sqlite'), thieving);
    const evidence = new CrimeEvidenceStore(join(root, 'evidence.sqlite'), cases, thieving);
    for (const [name, source, identification] of [
        ['witness', 'direct-witness', 'direct'], ['trace', 'physical-trace', 'none']
    ] as const) {
        thieving.recordDiscovery(`observation-${name}`, { evidenceId: `engine-${name}`,
            outcomeReceiptId: 'receipt-1', source, observerAgentId: 'guard', actorIdentification: identification,
            suspectAgentId: identification === 'direct' ? 'thief' : null, facts: ['Observed incident.'],
            sourceEvidenceDigest: 'c'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
        cases.recordDiscovery('case-1', `discovery-${name}`, `observation-${name}`, observedAt);
    }
    cases.recordIdentification('case-1', 'identification-1', 'observation-witness', observedAt);
    evidence.recordCaseEvidence('proof-1', 'identification-1', observedAt);
    evidence.recordCaseEvidence('trace-1', 'discovery-trace', observedAt);
    return { root, governance, thieving, cases, evidence };
}

const realm: JurisdictionCrimePolicy = { schemaVersion: 1, policyId: 'realm-v1', jurisdictionId: 'realm-law',
    version: 1, effectiveFrom: '2029-01-01T00:00:00.000Z',
    responsibleEvidenceKinds: ['direct-identification'] };
const city: JurisdictionCrimePolicy = { schemaVersion: 1, policyId: 'city-v1', jurisdictionId: 'city-law',
    version: 1, effectiveFrom: '2029-01-01T00:00:00.000Z',
    responsibleEvidenceKinds: ['direct-identification', 'physical-trace'] };
function request(policy = city, evidenceIds = ['proof-1', 'trace-1']): LegalFindingRequest {
    return { findingId: 'finding-1', caseId: 'case-1', jurisdictionId: policy.jurisdictionId,
        suspectAgentId: 'thief', conclusion: 'responsible', evidenceIds, policyId: policy.policyId,
        policyDigest: digestJurisdictionCrimePolicy(policy), authorityEvidenceDigest: authorityDigest,
        occurredAt: observedAt };
}

describe('jurisdiction crime finding policy', () => {
    test('uses the incident location, deepest effective policy and independent authority attestation', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            const verifier = createJurisdictionFindingVerifier([realm, city], { governance, thieving, cases,
                verifyAuthority: () => authorityDigest });
            expect(() => evidence.recordFinding(request(realm), verifier, observedAt)).toThrow('not trusted');
            expect(() => evidence.recordFinding(request(city, ['proof-1']), verifier, observedAt))
                .toThrow('not trusted');
            expect(() => evidence.recordFinding({ ...request(), policyDigest: 'd'.repeat(64) }, verifier, observedAt))
                .toThrow('not trusted');
            const accepted = evidence.recordFinding(request(), verifier, observedAt);
            expect(accepted.policyId).toBe('city-v1');
            expect(evidence.verifyAuditChain()).toBeTrue();
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('refuses missing authority, future policy and duplicate policy version', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            const noAuthority = createJurisdictionFindingVerifier([realm, city], { governance, thieving, cases,
                verifyAuthority: () => null });
            expect(() => evidence.recordFinding(request(), noAuthority, observedAt)).toThrow('not trusted');
            const future = { ...city, policyId: 'city-v2', version: 2,
                effectiveFrom: '2030-01-02T00:00:00.000Z' };
            const verifier = createJurisdictionFindingVerifier([realm, city, future], { governance, thieving,
                cases, verifyAuthority: () => authorityDigest });
            expect(() => evidence.recordFinding(request(future), verifier, observedAt)).toThrow('not trusted');
            expect(() => createJurisdictionFindingVerifier([city, { ...city, policyId: 'duplicate' }], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest
            })).toThrow('Duplicate crime policy');
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('a policy requiring possession accepts only the named suspect as the holder', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            evidence.recordPossession('other-holder', { observationId: 'inspection-1', caseId: 'case-1',
                assetId: 'asset-1', holderAgentId: 'another-agent', sourceEvidenceDigest: 'e'.repeat(64),
                occurredAt: observedAt }, () => true, observedAt);
            const custodyPolicy: JurisdictionCrimePolicy = { ...city, responsibleEvidenceKinds:
                ['direct-identification', 'possession'] };
            const verifier = createJurisdictionFindingVerifier([realm, custodyPolicy], { governance, thieving,
                cases, verifyAuthority: () => authorityDigest });
            expect(() => evidence.recordFinding(request(custodyPolicy, ['proof-1', 'other-holder']),
                verifier, observedAt)).toThrow('not trusted');
            evidence.recordPossession('suspect-holder', { observationId: 'inspection-2', caseId: 'case-1',
                assetId: 'asset-1', holderAgentId: 'thief', sourceEvidenceDigest: 'f'.repeat(64),
                occurredAt: observedAt }, () => true, observedAt);
            expect(evidence.recordFinding(request(custodyPolicy, ['proof-1', 'suspect-holder']),
                verifier, observedAt).conclusion).toBe('responsible');
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('does not grant a disabled local faction retroactive authority over an incident', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            governance.setFactionStatus('city', 1, 'disabled', 'city-judge', 'City court closed',
                '2030-01-01T09:30:00.000Z');
            governance.setFactionStatus('city', 2, 'active', 'city-judge', 'City court reopened',
                '2030-01-01T10:00:30.000Z');
            const verifier = createJurisdictionFindingVerifier([realm, city], { governance, thieving, cases,
                verifyAuthority: () => authorityDigest });
            expect(() => evidence.recordFinding(request(city), verifier, observedAt)).toThrow('not trusted');
            expect(evidence.recordFinding(request(realm, ['proof-1']), verifier, observedAt).policyId)
                .toBe('realm-v1');
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });
});

const finePolicy: JurisdictionFinePolicy = { schemaVersion: 1, policyId: 'city-fine-v1',
    jurisdictionId: 'city-law', version: 1, createdAt: '2028-12-01T00:00:00.000Z',
    effectiveFrom: '2029-01-01T00:00:00.000Z', maxFineGp: 20 };
const fineAt = '2030-01-01T10:02:00.000Z';
const findingRecheck = { crimePolicies: [realm, city],
    verifyFindingAuthority: () => authorityDigest };
function createCrimePolicyCatalog(root: string): JurisdictionCrimePolicyStore {
    const policies = new JurisdictionCrimePolicyStore(join(root, 'governance.sqlite'));
    const draft = policies.create({ policyId: 'city-v1', jurisdictionId: 'city-law',
        version: 1, responsibleEvidenceKinds: ['direct-identification', 'physical-trace'],
        createdByAgentId: 'city-clerk' }, '2029-01-01T00:00:00.000Z');
    policies.activate(draft.policyId, draft.revision, 'city-judge',
        '2029-01-01T00:00:00.000Z');
    return policies;
}
function fineProposal(findingDigest: string, policy = finePolicy): FineProposal {
    return { proposalId: 'fine-proposal-1', findingId: 'finding-1', findingDigest,
        suspectAgentId: 'thief', jurisdictionId: 'city-law', policyId: policy.policyId,
        policyDigest: digestJurisdictionFinePolicy(policy), amountGp: 10,
        authorityEvidenceDigest: authorityDigest, occurredAt: fineAt };
}

describe('read-only jurisdiction fine proposal gate', () => {
    test('rechecks a historical crime policy from the durable audited catalog', () => {
        const { root, governance, thieving, cases, evidence } = setup();
        const governancePath = join(root, 'governance.sqlite');
        const crimePolicies = new JurisdictionCrimePolicyStore(governancePath);
        const finePolicies = new JurisdictionFinePolicyStore(governancePath);
        try {
            const crimeDraft = crimePolicies.create({ policyId: 'city-v1', jurisdictionId: 'city-law',
                version: 1, responsibleEvidenceKinds: ['direct-identification', 'physical-trace'],
                createdByAgentId: 'city-clerk' }, '2029-01-01T00:00:00.000Z');
            crimePolicies.activate(crimeDraft.policyId, crimeDraft.revision, 'city-judge',
                '2029-02-01T00:00:00.000Z');
            const fineDraft = finePolicies.create({ policyId: 'city-fine-v1',
                jurisdictionId: 'city-law', version: 1, maxFineGp: 20,
                createdByAgentId: 'city-clerk' }, '2029-01-01T00:00:00.000Z');
            finePolicies.activate(fineDraft.policyId, fineDraft.revision, 'city-judge',
                '2029-02-01T00:00:00.000Z');
            const activeCrime = crimePolicies.listEffectiveAt('city-law', at)[0]!;
            const finding = evidence.recordFinding(request(activeCrime),
                createJurisdictionFindingVerifier(crimePolicies, { governance, thieving, cases,
                    verifyAuthority: () => authorityDigest }), observedAt);
            const gate = createFineProposalVerifier(finePolicies, { governance, thieving, cases,
                evidence, crimePolicies, verifyFindingAuthority: () => authorityDigest,
                verifyAuthority: () => authorityDigest });
            const proposal = { ...fineProposal(finding.findingDigest),
                policyDigest: finePolicies.get('city-fine-v1')!.policyDigest! };
            expect(gate(proposal)).toBeTrue();
            const db = new Database(governancePath);
            db.run(`UPDATE governance_crime_policy SET evidence_kinds_json='["direct-identification"]'
                WHERE policy_id='city-v1'`);
            db.close();
            expect(crimePolicies.verifyAuditChain()).toBeFalse();
            expect(() => gate(proposal)).toThrow('audit chain');
        } finally { finePolicies.close(); crimePolicies.close(); evidence.close(); cases.close();
            thieving.close(); governance.close(); }
    });

    test('rejects an audit-valid finding recorded without the actual crime policy or its evidence rule', () => {
        const forged = setup();
        try {
            const finding = forged.evidence.recordFinding({ ...request(), policyId: 'fabricated-policy' },
                () => true, observedAt);
            expect(forged.evidence.verifyAuditChain()).toBeTrue();
            const gate = createFineProposalVerifier([finePolicy], { governance: forged.governance,
                thieving: forged.thieving, cases: forged.cases, evidence: forged.evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            expect(gate(fineProposal(finding.findingDigest))).toBeFalse();
        } finally { forged.evidence.close(); forged.cases.close(); forged.thieving.close();
            forged.governance.close(); }

        const incomplete = setup();
        try {
            const finding = incomplete.evidence.recordFinding(request(city, ['proof-1']),
                () => true, observedAt);
            expect(incomplete.evidence.verifyAuditChain()).toBeTrue();
            const gate = createFineProposalVerifier([finePolicy], { governance: incomplete.governance,
                thieving: incomplete.thieving, cases: incomplete.cases, evidence: incomplete.evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            expect(gate(fineProposal(finding.findingDigest))).toBeFalse();
        } finally { incomplete.evidence.close(); incomplete.cases.close(); incomplete.thieving.close();
            incomplete.governance.close(); }

        const unattested = setup();
        try {
            const finding = unattested.evidence.recordFinding({ ...request(),
                authorityEvidenceDigest: 'f'.repeat(64) }, () => true, observedAt);
            const gate = createFineProposalVerifier([finePolicy], { governance: unattested.governance,
                thieving: unattested.thieving, cases: unattested.cases, evidence: unattested.evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            expect(gate(fineProposal(finding.findingDigest))).toBeFalse();
        } finally { unattested.evidence.close(); unattested.cases.close(); unattested.thieving.close();
            unattested.governance.close(); }
    });

    test('uses an audited persistent policy catalog instead of accepting a later cap for an older incident', () => {
        const { root, governance, thieving, cases, evidence } = setup();
        const policies = new JurisdictionFinePolicyStore(join(root, 'governance.sqlite'));
        try {
            const first = policies.create({ policyId: 'city-fine-v1', jurisdictionId: 'city-law',
                version: 1, maxFineGp: 20, createdByAgentId: 'city-clerk' },
            '2029-01-01T00:00:00.000Z');
            const firstActive = policies.activate(first.policyId, first.revision, 'city-judge',
                '2029-02-01T00:00:00.000Z');
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
            const later = policies.create({ policyId: 'city-fine-v2', jurisdictionId: 'city-law',
                version: 2, maxFineGp: 100, createdByAgentId: 'city-clerk' }, observedAt);
            policies.activate(later.policyId, later.revision, 'city-judge', fineAt);
            const gate = createFineProposalVerifier(policies, { governance, thieving, cases, evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            const proposal: FineProposal = { ...fineProposal(finding.findingDigest),
                policyDigest: firstActive.policyDigest! };
            expect(gate(proposal)).toBeTrue();
            expect(gate({ ...proposal, amountGp: 21 })).toBeFalse();
            expect(gate({ ...proposal, policyId: later.policyId,
                policyDigest: policies.get(later.policyId)!.policyDigest!, amountGp: 50 })).toBeFalse();
            expect(policies.verifyAuditChain()).toBeTrue();
        } finally { policies.close(); evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('requires a matching responsible finding, incident-time policy and separate authority', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
            const later: JurisdictionFinePolicy = { ...finePolicy, policyId: 'city-fine-v2', version: 2,
                effectiveFrom: '2031-01-01T00:00:00.000Z', maxFineGp: 100 };
            const gate = createFineProposalVerifier([finePolicy, later], {
                governance, thieving, cases, evidence, ...findingRecheck,
                verifyAuthority: () => authorityDigest });
            const proposal = fineProposal(finding.findingDigest);
            expect(digestJurisdictionFinePolicy({ maxFineGp: finePolicy.maxFineGp,
                effectiveFrom: finePolicy.effectiveFrom, createdAt: finePolicy.createdAt,
                version: finePolicy.version, jurisdictionId: finePolicy.jurisdictionId,
                policyId: finePolicy.policyId, schemaVersion: 1 }))
                .toBe(digestJurisdictionFinePolicy(finePolicy));
            expect(gate(proposal)).toBeTrue();
            expect(gate({ ...proposal, amountGp: 21 })).toBeFalse();
            expect(gate({ ...proposal, amountGp: 0 })).toBeFalse();
            expect(gate({ ...proposal, proposalId: 123 as unknown as string })).toBeFalse();
            expect(gate({ ...proposal, findingDigest: 'f'.repeat(64) })).toBeFalse();
            expect(gate({ ...proposal, suspectAgentId: 'bystander' })).toBeFalse();
            expect(gate({ ...proposal, policyDigest: 'f'.repeat(64) })).toBeFalse();
            expect(gate(fineProposal(finding.findingDigest, later))).toBeFalse();
            expect(gate({ ...proposal, occurredAt: at })).toBeFalse();
            expect(createFineProposalVerifier([finePolicy], { governance, thieving, cases, evidence,
                ...findingRecheck, verifyAuthority: () => null })(proposal)).toBeFalse();
            expect(evidence.getFinding('finding-1')).toEqual(finding);
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('rejects not-proven decisions and retroactive policy versions', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding({ ...request(), conclusion: 'not-proven' },
                findingVerifier, observedAt);
            const gate = createFineProposalVerifier([finePolicy], { governance, thieving, cases, evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            expect(gate(fineProposal(finding.findingDigest))).toBeFalse();
            expect(() => createFineProposalVerifier([finePolicy, { ...finePolicy,
                policyId: 'city-fine-v2', version: 2, createdAt: '2027-12-01T00:00:00.000Z',
                effectiveFrom: '2028-01-01T00:00:00.000Z' }], {
                governance, thieving, cases, evidence, ...findingRecheck,
                verifyAuthority: () => authorityDigest
            })).toThrow('chronologically ordered');
            expect(() => createFineProposalVerifier([{ ...finePolicy, maxFineGp: 0 }], {
                governance, thieving, cases, evidence, ...findingRecheck,
                verifyAuthority: () => authorityDigest
            })).toThrow('schema or limit');
            expect(() => createFineProposalVerifier([{ ...finePolicy,
                createdAt: '2029-01-02T00:00:00.000Z' }], {
                governance, thieving, cases, evidence, ...findingRecheck,
                verifyAuthority: () => authorityDigest
            })).toThrow('schema or limit');
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });

    test('stops a valid fine proposal when the issuing faction loses authority', () => {
        const { governance, thieving, cases, evidence } = setup();
        try {
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
            const gate = createFineProposalVerifier([finePolicy], { governance, thieving, cases, evidence,
                ...findingRecheck, verifyAuthority: () => authorityDigest });
            const proposal = fineProposal(finding.findingDigest);
            expect(gate(proposal)).toBeTrue();
            governance.setFactionStatus('city', 1, 'disabled', 'city-judge', 'Court closed',
                '2030-01-01T10:01:30.000Z');
            expect(gate(proposal)).toBeFalse();
        } finally { evidence.close(); cases.close(); thieving.close(); governance.close(); }
    });
});

describe('audited fine proposal ledger', () => {
    test('records one policy-bound proposal per finding, replays exactly and survives reopening', () => {
        const { root, governance, thieving, cases, evidence } = setup();
        const policies = new JurisdictionFinePolicyStore(join(root, 'governance.sqlite'));
        const crimePolicies = createCrimePolicyCatalog(root);
        const source = { governance, thieving, cases, evidence,
            verifyFindingAuthority: () => authorityDigest,
            verifyAuthority: () => authorityDigest };
        const path = join(root, 'fine-proposals.sqlite');
        try {
            const draft = policies.create({ policyId: 'city-fine-v1', jurisdictionId: 'city-law',
                version: 1, maxFineGp: 20, createdByAgentId: 'city-clerk' },
            '2029-01-01T00:00:00.000Z');
            policies.activate(draft.policyId, draft.revision, 'city-judge',
                '2029-02-01T00:00:00.000Z');
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
            const input: FineProposal = { ...fineProposal(finding.findingDigest),
                policyDigest: policies.get('city-fine-v1')!.policyDigest! };
            expect(() => new FineProposalStore(path, policies,
                [city] as unknown as JurisdictionCrimePolicyStore, source))
                .toThrow('durable audited policy catalogs');
            const ledger = new FineProposalStore(path, policies, crimePolicies, source);
            expect(() => ledger.record({ ...input, amountGp: 21 }, fineAt)).toThrow('not trusted');
            expect(() => ledger.record({ ...input, policyDigest: 'f'.repeat(64) }, fineAt))
                .toThrow('not trusted');
            const stored = ledger.record(input, fineAt);
            expect(stored).toMatchObject({ proposalId: input.proposalId, amountGp: 10,
                findingDigest: finding.findingDigest });
            expect(ledger.record(input, fineAt)).toEqual(stored);
            expect(() => ledger.record({ ...input, proposalId: 'another-proposal' }, fineAt))
                .toThrow();
            expect(ledger.listForFinding('finding-1')).toEqual([stored]);
            expect(ledger.verifyAuditChain()).toBeTrue();
            ledger.close();
            const reopened = new FineProposalStore(path, policies, crimePolicies, source);
            expect(reopened.get(input.proposalId)).toEqual(stored);
            reopened.close();
            const newerSchema = new Database(path);
            newerSchema.run('PRAGMA user_version = 2');
            newerSchema.close();
            expect(() => new FineProposalStore(path, policies, crimePolicies, source))
                .toThrow('newer than supported');
        } finally { crimePolicies.close(); policies.close(); evidence.close(); cases.close();
            thieving.close(); governance.close(); }
    });

    test('fails closed if a recorded amount or audit entry changes', () => {
        const { root, governance, thieving, cases, evidence } = setup();
        const policies = new JurisdictionFinePolicyStore(join(root, 'governance.sqlite'));
        const crimePolicies = createCrimePolicyCatalog(root);
        const path = join(root, 'fine-proposals.sqlite');
        try {
            const draft = policies.create({ policyId: 'city-fine-v1', jurisdictionId: 'city-law',
                version: 1, maxFineGp: 20, createdByAgentId: 'city-clerk' },
            '2029-01-01T00:00:00.000Z');
            policies.activate(draft.policyId, draft.revision, 'city-judge',
                '2029-02-01T00:00:00.000Z');
            const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
                governance, thieving, cases, verifyAuthority: () => authorityDigest });
            const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
            const ledger = new FineProposalStore(path, policies, crimePolicies,
                { governance, thieving, cases, evidence,
                    verifyFindingAuthority: () => authorityDigest,
                    verifyAuthority: () => authorityDigest });
            ledger.record({ ...fineProposal(finding.findingDigest),
                policyDigest: policies.get('city-fine-v1')!.policyDigest! }, fineAt);
            const db = new Database(path);
            db.run("UPDATE fine_proposal SET amount_gp=19 WHERE proposal_id='fine-proposal-1'");
            db.close();
            expect(ledger.verifyAuditChain()).toBeFalse();
            expect(() => ledger.get('fine-proposal-1')).toThrow('audit chain');
            ledger.close();
        } finally { crimePolicies.close(); policies.close(); evidence.close(); cases.close();
            thieving.close(); governance.close(); }
    });
});

const decisionAt = '2030-01-01T10:03:00.000Z';
const decisionDigest = 'd'.repeat(64);
function setupFineReview() {
    const base = setup(), { root, governance, thieving, cases, evidence } = base;
    const policies = new JurisdictionFinePolicyStore(join(root, 'governance.sqlite'));
    const crimePolicies = createCrimePolicyCatalog(root);
    const draft = policies.create({ policyId: 'city-fine-v1', jurisdictionId: 'city-law',
        version: 1, maxFineGp: 20, createdByAgentId: 'city-clerk' },
    '2029-01-01T00:00:00.000Z');
    policies.activate(draft.policyId, draft.revision, 'city-judge',
        '2029-02-01T00:00:00.000Z');
    const findingVerifier = createJurisdictionFindingVerifier([realm, city], {
        governance, thieving, cases, verifyAuthority: () => authorityDigest });
    const finding = evidence.recordFinding(request(), findingVerifier, observedAt);
    const proposals = new FineProposalStore(join(root, 'fine-proposals.sqlite'), policies,
        crimePolicies, { governance, thieving, cases, evidence,
            verifyFindingAuthority: () => authorityDigest,
            verifyAuthority: () => authorityDigest });
    const proposal = proposals.record({ ...fineProposal(finding.findingDigest),
        policyDigest: policies.get('city-fine-v1')!.policyDigest! }, fineAt);
    const agents = new AgentStateStore(join(root, 'agents.sqlite'));
    for (const agentId of ['court-admin', 'city-judge']) {
        agents.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
            background: 'Local court test.', personalityTraits: ['careful'] },
        '2029-01-01T00:00:00.000Z');
    }
    const grants = new FineAdjudicatorGrantStore(join(root, 'fine-grants.sqlite'),
        governance, agents, () => 'e'.repeat(64));
    const appointment = grants.issue({ grantId: 'city-judge-grant',
        jurisdictionId: 'city-law', adjudicatorAgentId: 'city-judge',
        issuedByAgentId: 'court-admin', authorityEvidenceDigest: 'e'.repeat(64),
        occurredAt: '2030-01-01T10:02:30.000Z' });
    return { ...base, policies, crimePolicies, proposals, proposal, agents, grants, appointment };
}
function closeFineReview(value: ReturnType<typeof setupFineReview>): void {
    value.grants.close(); value.agents.close(); value.proposals.close(); value.policies.close();
    value.crimePolicies.close();
    value.evidence.close(); value.cases.close();
    value.thieving.close(); value.governance.close();
}
function fineDecision(proposalDigest: string,
    disposition: FineDecisionRequest['disposition'] = 'approved'): FineDecisionRequest {
    return { decisionId: 'fine-decision-1', proposalId: 'fine-proposal-1', proposalDigest,
        jurisdictionId: 'city-law', suspectAgentId: 'thief', disposition,
        adjudicatorAgentId: 'city-judge', decisionEvidenceDigest: decisionDigest,
        occurredAt: decisionAt };
}

describe('audited fine decision ledger', () => {
    test('collection preflight identifies only the original exact avatar for the settlement authority', () => {
        const value = setupFineReview();
        try {
            const decisions = new FineDecisionStore(join(value.root, 'fine-decisions.sqlite'),
                value.proposals, value.governance, value.grants, () => decisionDigest);
            const sources = { decisions, proposals: value.proposals, evidence: value.evidence,
                cases: value.cases, thieving: value.thieving, agents: value.agents,
                governance: value.governance };
            try {
                expect(inspectFineCollection('absent-decision', sources)).toBeNull();
                decisions.record(fineDecision(value.proposal.proposalDigest), decisionAt);
                expect(inspectFineCollection('fine-decision-1', sources)).toMatchObject({
                    amountGp: 10, creditorFactionId: 'city', candidatePayerUsername: null,
                    blockers: ['debtor-avatar-unverified'],
                    canCollect: false });
                value.agents.createIdentity({ agentId: 'thief', playerUsername: 'Thief1',
                    displayName: 'Thief', background: 'Local test avatar.',
                    personalityTraits: ['cautious'] }, '2029-01-01T00:00:00.000Z');
                expect(inspectFineCollection('fine-decision-1', sources)).toMatchObject({
                    candidatePayerUsername: 'thief1',
                    blockers: [], canCollect: true });
                value.governance.setFactionStatus('city', 1, 'disabled', 'court-admin',
                    'Court is closed', '2030-01-01T10:05:00.000Z');
                expect(inspectFineCollection('fine-decision-1', sources)?.blockers)
                    .toEqual(['jurisdiction-inactive']);
            } finally { decisions.close(); }
        } finally { closeFineReview(value); }
    });

    test('rejected decision is not a collection candidate even for a matching player', () => {
        const value = setupFineReview();
        try {
            value.agents.createIdentity({ agentId: 'thief', playerUsername: 'Thief1',
                displayName: 'Thief', background: 'Local test avatar.',
                personalityTraits: ['cautious'] }, '2029-01-01T00:00:00.000Z');
            const decisions = new FineDecisionStore(join(value.root, 'fine-decisions.sqlite'),
                value.proposals, value.governance, value.grants, () => decisionDigest);
            try {
                decisions.record(fineDecision(value.proposal.proposalDigest, 'rejected'), decisionAt);
                expect(inspectFineCollection('fine-decision-1', { decisions, proposals: value.proposals,
                    evidence: value.evidence, cases: value.cases, thieving: value.thieving,
                    agents: value.agents, governance: value.governance })).toMatchObject({
                    amountGp: 0, candidatePayerUsername: 'thief1',
                    blockers: ['decision-rejected'],
                    canCollect: false });
            } finally { decisions.close(); }
        } finally { closeFineReview(value); }
    });

    test('uses a jurisdiction grant and explicit action while preserving a pre-revocation decision', () => {
        const value = setupFineReview();
        try {
            const decisions = new FineDecisionStore(join(value.root, 'fine-decisions.sqlite'),
                value.proposals, value.governance, value.grants, () => decisionDigest);
            const input = fineDecision(value.proposal.proposalDigest);
            expect(() => decisions.record({ ...input, adjudicatorAgentId: 'outsider' }, decisionAt))
                .toThrow('not trusted');
            const accepted = decisions.record(input, decisionAt);
            value.grants.revoke({ grantId: value.appointment.grantId, revokedByAgentId: 'court-admin',
                authorityEvidenceDigest: 'e'.repeat(64),
                occurredAt: '2030-01-01T10:04:00.000Z' }, value.appointment.revision);
            expect(decisions.get(accepted.decisionId)).toEqual(accepted);
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge', decisionAt)).toBeTrue();
            expect(value.grants.isAuthorizedAt('city-law', 'city-judge',
                '2030-01-01T10:04:00.000Z')).toBeFalse();
            const db = new Database(join(value.root, 'fine-grants.sqlite'));
            db.run("UPDATE fine_adjudicator_grant SET adjudicator_agent_id='outsider' WHERE grant_id='city-judge-grant'");
            db.close();
            expect(() => decisions.get(accepted.decisionId)).toThrow('audit chain');
            decisions.close();
        } finally { closeFineReview(value); }
    });

    test('approves or rejects only with independent adjudicator evidence, without a payment', () => {
        const value = setupFineReview();
        const path = join(value.root, 'fine-decisions.sqlite');
        try {
            expect(() => new FineDecisionStore(path, value.proposals, value.governance,
                {} as FineAdjudicatorGrantStore, () => decisionDigest))
                .toThrow('audited adjudicator grant catalog');
            const decisions = new FineDecisionStore(path, value.proposals, value.governance, value.grants,
                (input, source) => input.adjudicatorAgentId === 'city-judge'
                    && source.proposalDigest === value.proposal.proposalDigest ? decisionDigest : null);
            const input = fineDecision(value.proposal.proposalDigest);
            expect(() => decisions.record({ ...input, adjudicatorAgentId: 'untrusted-agent' }, decisionAt))
                .toThrow('not trusted');
            expect(() => decisions.record({ ...input, proposalDigest: 'f'.repeat(64) }, decisionAt))
                .toThrow('not trusted');
            expect(() => decisions.record({ ...input,
                decisionId: 123 as unknown as string }, decisionAt)).toThrow('schema or time');
            const accepted = decisions.record(input, decisionAt);
            expect(accepted).toMatchObject({ disposition: 'approved', amountGp: 10,
                proposalDigest: value.proposal.proposalDigest });
            expect(decisions.record(input, decisionAt)).toEqual(accepted);
            expect(() => decisions.record({ ...input, decisionId: 'another-decision',
                disposition: 'rejected' }, decisionAt)).toThrow();
            expect(decisions.getForProposal(input.proposalId)).toEqual(accepted);
            decisions.close();
            const reopened = new FineDecisionStore(path, value.proposals, value.governance,
                value.grants,
                () => decisionDigest);
            expect(reopened.get(input.decisionId)).toEqual(accepted);
            reopened.close();
        } finally { closeFineReview(value); }
    });

    test('rejection carries zero assessed amount and disabled jurisdiction cannot decide', () => {
        const value = setupFineReview();
        try {
            const decisions = new FineDecisionStore(join(value.root, 'fine-decisions.sqlite'),
                value.proposals, value.governance, value.grants, () => decisionDigest);
            const rejected = decisions.record(fineDecision(value.proposal.proposalDigest, 'rejected'),
                decisionAt);
            expect(rejected.amountGp).toBe(0);
            decisions.close();
        } finally { closeFineReview(value); }

        const disabled = setupFineReview();
        try {
            disabled.governance.setFactionStatus('city', 1, 'disabled', 'city-judge',
                'Court closed', decisionAt);
            const decisions = new FineDecisionStore(join(disabled.root, 'fine-decisions.sqlite'),
                disabled.proposals, disabled.governance, disabled.grants, () => decisionDigest);
            expect(() => decisions.record(fineDecision(disabled.proposal.proposalDigest), decisionAt))
                .toThrow('not trusted');
            decisions.close();
        } finally { closeFineReview(disabled); }
    });

    test('detects tampered decision amount and rejects newer schema', () => {
        const value = setupFineReview();
        const path = join(value.root, 'fine-decisions.sqlite');
        try {
            const decisions = new FineDecisionStore(path, value.proposals, value.governance,
                value.grants,
                () => decisionDigest);
            decisions.record(fineDecision(value.proposal.proposalDigest), decisionAt);
            const db = new Database(path);
            db.run("UPDATE fine_decision SET amount_gp=19 WHERE decision_id='fine-decision-1'");
            db.close();
            expect(decisions.verifyAuditChain()).toBeFalse();
            expect(() => decisions.get('fine-decision-1')).toThrow('audit chain');
            decisions.close();
            const newer = new Database(path);
            newer.run('PRAGMA user_version = 2');
            newer.close();
            expect(() => new FineDecisionStore(path, value.proposals, value.governance,
                value.grants, () => decisionDigest)).toThrow('newer than supported');
        } finally { closeFineReview(value); }
    });
});
