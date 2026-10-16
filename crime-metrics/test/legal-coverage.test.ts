import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CrimeCaseStore, CrimeEvidenceStore } from '../../crime-cases/index.js';
import { ThievingProcedureStore, type ThievingOutcomeEvidence } from '../../thieving-procedures/index.js';
import { inspectCrimeLegalCoverage } from '../index.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z', observedAt = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'crime-legal-coverage-')); roots.push(root);
    const paths = { thieving: join(root, 'thieving.sqlite'), cases: join(root, 'cases.sqlite'),
        evidence: join(root, 'evidence.sqlite') };
    const thieving = new ThievingProcedureStore(paths.thieving);
    const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence-1',
        procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
        actorAgentId: 'thief-1', playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer',
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
        startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event-1',
        sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    thieving.recordOutcome('receipt-2', { ...outcome, evidenceId: 'engine-evidence-2',
        sourceEventId: 'engine-event-2', startedAtEngineTick: 200, endedAtEngineTick: 202 }, () => true, at);
    const cases = new CrimeCaseStore(paths.cases, thieving);
    const evidence = new CrimeEvidenceStore(paths.evidence, cases, thieving);
    return { paths, thieving, cases, evidence, close: () => { evidence.close(); cases.close(); thieving.close(); } };
}

function recordCase(source: ReturnType<typeof fixture>): void {
    source.thieving.recordDiscovery('observation-1', { evidenceId: 'observation-evidence-1',
        outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'guard-1',
        actorIdentification: 'direct', suspectAgentId: 'thief-1', facts: ['Observed an incident.'],
        sourceEvidenceDigest: 'b'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
    source.cases.recordDiscovery('case-1', 'case-discovery-1', 'observation-1', observedAt);
    source.cases.recordIdentification('case-1', 'case-identification-1', 'observation-1', observedAt);
    source.evidence.recordCaseEvidence('proof-1', 'case-identification-1', observedAt);
}

describe('audited legal coverage for an explicit crime cohort', () => {
    test('keeps a discovered case separate from responsibility and filters findings to the actual actor', () => {
        const source = fixture();
        try {
            recordCase(source);
            const before = inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', ['receipt-1', 'receipt-2']);
            expect(before).toMatchObject({ outcomesWithCase: 1, outcomesWithResponsibleFinding: 0,
                outcomesWithNotProvenFinding: 0, outcomesWithoutActorFinding: 2 });
            source.evidence.recordFinding({ findingId: 'finding-bystander', caseId: 'case-1',
                jurisdictionId: 'varrock', suspectAgentId: 'bystander', conclusion: 'not-proven',
                evidenceIds: [], policyId: 'local-law-v1', policyDigest: 'c'.repeat(64),
                authorityEvidenceDigest: 'd'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
            source.evidence.recordFinding({ findingId: 'finding-thief', caseId: 'case-1',
                jurisdictionId: 'varrock', suspectAgentId: 'thief-1', conclusion: 'responsible',
                evidenceIds: ['proof-1'], policyId: 'local-law-v1', policyDigest: 'c'.repeat(64),
                authorityEvidenceDigest: 'd'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
            const result = inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', ['receipt-1', 'receipt-2']);
            expect(result.receipts).toEqual([
                { receiptId: 'receipt-1', caseId: 'case-1', actorFindings: [
                    { findingId: 'finding-thief', jurisdictionId: 'varrock', conclusion: 'responsible' }] },
                { receiptId: 'receipt-2', caseId: null, actorFindings: [] }
            ]);
            expect(result.outcomesWithResponsibleFinding).toBe(1);
            expect(result.outcomesWithoutActorFinding).toBe(1);
            expect(result.unavailable.recidivism).toBe('no-complete-adjudicated-history-or-follow-up-window');
        } finally { source.close(); }
    });

    test('rejects invalid cohorts and a damaged finding audit chain', () => {
        const source = fixture();
        try {
            expect(() => inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', [])).toThrow('cohort is invalid');
            expect(() => inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', ['receipt-1', 'receipt-1'])).toThrow('duplicates');
            expect(() => inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', ['missing'])).toThrow('does not exist');
            expect(() => inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'someone-else', ['receipt-1'])).toThrow('another actor');
            recordCase(source);
            source.evidence.recordFinding({ findingId: 'finding-thief', caseId: 'case-1',
                jurisdictionId: 'varrock', suspectAgentId: 'thief-1', conclusion: 'responsible',
                evidenceIds: ['proof-1'], policyId: 'local-law-v1', policyDigest: 'c'.repeat(64),
                authorityEvidenceDigest: 'd'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
            const raw = new Database(source.paths.evidence);
            try { raw.run("UPDATE crime_legal_finding SET jurisdiction_id='elsewhere' WHERE finding_id='finding-thief'"); }
            finally { raw.close(); }
            expect(() => inspectCrimeLegalCoverage(source.thieving, source.cases, source.evidence,
                'thief-1', ['receipt-1'])).toThrow('source audit chain is invalid');
        } finally { source.close(); }
    });
});
