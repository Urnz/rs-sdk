import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore, CrimeEvidenceStore, type LegalFindingRequest } from '../index.js';

const roots: string[] = [], at = '2030-01-01T10:00:00.000Z', observedAt = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() { const root = mkdtempSync(join(tmpdir(), 'crime-evidence-')); roots.push(root);
    return { thieving: join(root, 'thieving.sqlite'), cases: join(root, 'cases.sqlite'),
        evidence: join(root, 'evidence.sqlite') }; }
const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence-1',
    procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
    actorAgentId: 'actual-thief', playerUsername: 'Thief1',
    target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
    result: 'succeeded', effect: 'item-transfer',
    transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
    startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event-1',
    sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
function setup() { const path = paths(), thieving = new ThievingProcedureStore(path.thieving);
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    const cases = new CrimeCaseStore(path.cases, thieving);
    const evidence = new CrimeEvidenceStore(path.evidence, cases, thieving);
    return { path, thieving, cases, evidence }; }
function observe(thieving: ThievingProcedureStore, observationId: string,
    source: 'direct-witness' | 'physical-trace', identification: 'none' | 'direct' = 'none') {
    thieving.recordDiscovery(observationId, { evidenceId: `engine-${observationId}`, outcomeReceiptId: 'receipt-1',
        source, observerAgentId: 'guard-1', actorIdentification: identification,
        suspectAgentId: identification === 'direct' ? 'actual-thief' : null,
        facts: ['Observed an incident.'], sourceEvidenceDigest: 'b'.repeat(64), occurredAt: observedAt
    }, () => true, observedAt);
}
const request = (evidenceIds: string[], conclusion: LegalFindingRequest['conclusion'] = 'responsible'):
    LegalFindingRequest => ({ findingId: 'finding-1', caseId: 'case-1', jurisdictionId: 'varrock',
        suspectAgentId: 'actual-thief', conclusion, evidenceIds, policyId: 'local-law-v1',
        policyDigest: 'c'.repeat(64), authorityEvidenceDigest: 'd'.repeat(64), occurredAt: observedAt });

describe('separate crime evidence and jurisdiction finding ledger', () => {
    test('requires a recorded direct identification and a trusted jurisdiction verifier for responsibility', () => {
        const { thieving, cases, evidence } = setup();
        try { observe(thieving, 'observation-1', 'direct-witness', 'direct');
            cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
            cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
            const proof = evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
            expect(proof).toMatchObject({ kind: 'direct-identification', suspectAgentId: 'actual-thief' });
            expect(() => evidence.recordFinding(request(['proof-1']), undefined, observedAt)).toThrow('not trusted');
            const finding = evidence.recordFinding(request(['proof-1']), () => true, observedAt);
            expect(finding).toMatchObject({ conclusion: 'responsible', evidenceIds: ['proof-1'] });
            expect(evidence.recordFinding(request(['proof-1']), () => true, observedAt)).toEqual(finding);
            expect(cases.getState('case-1')?.legalFinding).toBeNull();
            expect(evidence.verifyAuditChain()).toBeTrue();
        } finally { evidence.close(); cases.close(); thieving.close(); }
    });
    test('possession alone never proves the holder committed the theft', () => {
        const { thieving, cases, evidence } = setup();
        try { observe(thieving, 'observation-1', 'physical-trace');
            cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
            const trace = evidence.recordCaseEvidence('trace-1', 'case-discovery-1', observedAt);
            expect(trace).toMatchObject({ kind: 'physical-trace', suspectAgentId: null });
            const possession = { observationId: 'inspection-1', caseId: 'case-1', assetId: 'stolen-pickaxe',
                holderAgentId: 'actual-thief', sourceEvidenceDigest: 'e'.repeat(64), occurredAt: observedAt };
            expect(() => evidence.recordPossession('possession-1', possession, undefined, observedAt)).toThrow('not trusted');
            const held = evidence.recordPossession('possession-1', possession, () => true, observedAt);
            expect(held).toMatchObject({ kind: 'possession', suspectAgentId: 'actual-thief' });
            expect(() => evidence.recordFinding(request(['possession-1', 'trace-1']), () => true, observedAt))
                .toThrow('Possession or suspicion alone');
            const notProven = evidence.recordFinding(request(['possession-1', 'trace-1'], 'not-proven'),
                () => true, observedAt);
            expect(notProven.conclusion).toBe('not-proven');
        } finally { evidence.close(); cases.close(); thieving.close(); }
    });
    test('rejects foreign evidence, unsupported source and changed finding replay', () => {
        const { thieving, cases, evidence } = setup();
        try { observe(thieving, 'observation-1', 'direct-witness', 'direct');
            cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
            expect(() => evidence.recordCaseEvidence('proof-1', 'case-discovery-1', observedAt))
                .toThrow('not admissible');
            cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
            evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
            expect(() => evidence.recordFinding(request(['missing']), () => true, observedAt))
                .toThrow('foreign or absent');
            evidence.recordFinding(request(['proof-1']), () => true, observedAt);
            expect(() => evidence.recordFinding({ ...request(['proof-1']), conclusion: 'not-proven' },
                () => true, observedAt)).toThrow('reused');
        } finally { evidence.close(); cases.close(); thieving.close(); }
    });
    test('survives restart and detects a deleted audit row', () => {
        const { path, thieving, cases, evidence } = setup();
        observe(thieving, 'observation-1', 'direct-witness', 'direct');
        cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
        cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
        evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
        evidence.recordFinding(request(['proof-1']), () => true, observedAt);
        evidence.close();
        const reopened = new CrimeEvidenceStore(path.evidence, cases, thieving);
        expect(reopened.verifyAuditChain()).toBeTrue();
        expect(reopened.listFindings('case-1')).toHaveLength(1);
        reopened.close();
        const raw = new Database(path.evidence);
        raw.run("DELETE FROM crime_evidence_audit WHERE entry_kind='finding'"); raw.close();
        const damaged = new CrimeEvidenceStore(path.evidence, cases, thieving);
        try { expect(damaged.verifyAuditChain()).toBeFalse(); } finally { damaged.close(); cases.close(); thieving.close(); }
    });
    test('projects only responsible findings for the exact suspect and jurisdiction', () => {
        const { path, thieving, cases, evidence } = setup();
        let active = evidence;
        try {
            observe(thieving, 'observation-1', 'direct-witness', 'direct');
            cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
            cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
            evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
            const responsible = evidence.recordFinding(request(['proof-1']), () => true, observedAt);
            evidence.recordFinding({ ...request([], 'not-proven'), findingId: 'finding-2',
                jurisdictionId: 'lumbridge' }, () => true, observedAt);
            evidence.recordFinding({ ...request([], 'not-proven'), findingId: 'finding-3',
                suspectAgentId: 'bystander' }, () => true, observedAt);
            expect(evidence.getJurisdictionCriminalRecord('actual-thief', 'varrock')).toEqual({
                suspectAgentId: 'actual-thief', jurisdictionId: 'varrock', responsibleFindings: [responsible]
            });
            expect(evidence.getJurisdictionCriminalRecord('actual-thief', 'lumbridge').responsibleFindings)
                .toEqual([]);
            expect(evidence.getJurisdictionCriminalRecord('bystander', 'varrock').responsibleFindings)
                .toEqual([]);
            active.close();
            active = new CrimeEvidenceStore(path.evidence, cases, thieving);
            expect(active.getJurisdictionCriminalRecord('actual-thief', 'varrock')
                .responsibleFindings).toEqual([responsible]);
        } finally { active.close(); cases.close(); thieving.close(); }
    });
    test('refuses a criminal-record view when finding history has been tampered with', () => {
        const { path, thieving, cases, evidence } = setup();
        try {
            observe(thieving, 'observation-1', 'direct-witness', 'direct');
            cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
            cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
            evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
            evidence.recordFinding(request(['proof-1']), () => true, observedAt);
            const raw = new Database(path.evidence);
            try { raw.run("UPDATE crime_legal_finding SET jurisdiction_id='lumbridge' WHERE finding_id='finding-1'");
            } finally { raw.close(); }
            expect(() => evidence.getJurisdictionCriminalRecord('actual-thief', 'varrock'))
                .toThrow('audit chain');
            expect(() => evidence.getFinding('finding-1')).toThrow('audit chain');
            expect(() => evidence.listFindings('case-1')).toThrow('audit chain');
            expect(() => evidence.getEvidence('proof-1')).toThrow('audit chain');
            expect(() => evidence.listEvidence('case-1')).toThrow('audit chain');
        } finally { evidence.close(); cases.close(); thieving.close(); }
    });
});
