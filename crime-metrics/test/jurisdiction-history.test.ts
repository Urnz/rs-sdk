import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CrimeCaseStore, CrimeEvidenceStore } from '../../crime-cases/index.js';
import type { CrimeCaseState } from '../../crime-cases/types.js';
import type { JurisdictionCriminalRecord, LegalFinding } from '../../crime-cases/evidence-types.js';
import { ThievingProcedureStore, type ThievingOutcomeEvidence,
    type ThievingOutcomeReceipt } from '../../thieving-procedures/index.js';
import { inspectJurisdictionCrimeHistory } from '../jurisdiction-history.js';

const roots: string[] = [];
const time = (minute: number) => `2030-01-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
const request = { actorAgentId: 'thief-1', jurisdictionId: 'varrock',
    incidentFrom: time(10), incidentUntil: time(30), recordedAsOf: time(40) };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function outcome(id: string, at: string, actorAgentId = 'thief-1'): ThievingOutcomeEvidence {
    return { evidenceId: `engine-evidence-${id}`, procedureId: 'procedure.thieving.pickpocket',
        procedureVersion: '0.1.0', procedureKind: 'pickpocket', actorAgentId, playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
        thievingXpDelta: 8, startedAtEngineTick: 100, endedAtEngineTick: 102,
        sourceEventId: `engine-event-${id}`, sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
}

function open(paths: { thieving: string; cases: string; evidence: string }) {
    const thieving = new ThievingProcedureStore(paths.thieving);
    const cases = new CrimeCaseStore(paths.cases, thieving);
    const evidence = new CrimeEvidenceStore(paths.evidence, cases, thieving);
    return { paths, thieving, cases, evidence, close: () => { evidence.close(); cases.close(); thieving.close(); } };
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'crime-jurisdiction-history-')); roots.push(root);
    return open({ thieving: join(root, 'thieving.sqlite'), cases: join(root, 'cases.sqlite'),
        evidence: join(root, 'evidence.sqlite') });
}

function incident(source: ReturnType<typeof fixture>, id: string, at: string, actor = 'thief-1') {
    source.thieving.recordOutcome(`receipt-${id}`, outcome(id, at, actor), () => true, at);
    source.thieving.recordDiscovery(`observation-${id}`, { evidenceId: `observation-evidence-${id}`,
        outcomeReceiptId: `receipt-${id}`, source: 'direct-witness', observerAgentId: 'guard-1',
        actorIdentification: 'direct', suspectAgentId: actor, facts: ['Observed the incident.'],
        sourceEvidenceDigest: 'b'.repeat(64), occurredAt: at }, () => true, at);
    source.cases.recordDiscovery(`case-${id}`, `discovery-${id}`, `observation-${id}`, at);
    source.cases.recordIdentification(`case-${id}`, `identification-${id}`, `observation-${id}`, at);
    source.evidence.recordCaseEvidence(`proof-${id}`, `identification-${id}`, at);
}

function finding(source: ReturnType<typeof fixture>, id: string, incidentId: string,
    occurredAt = time(35), recordedAt = time(35), jurisdictionId = 'varrock',
    suspectAgentId = 'thief-1', conclusion: 'responsible' | 'not-proven' = 'responsible') {
    return source.evidence.recordFinding({ findingId: `finding-${id}`, caseId: `case-${incidentId}`,
        jurisdictionId, suspectAgentId, conclusion,
        evidenceIds: conclusion === 'responsible' ? [`proof-${incidentId}`] : [],
        policyId: 'local-law-v1', policyDigest: 'c'.repeat(64), authorityEvidenceDigest: 'd'.repeat(64),
        occurredAt }, () => true, recordedAt);
}

function inspect(source: ReturnType<typeof fixture>) {
    return inspectJurisdictionCrimeHistory(source.evidence, source.cases, source.thieving, request);
}

describe('complete audited local jurisdiction responsibility history', () => {
    test('uses the half-open incident window and inclusive recording cutoff, not adjudication time', () => {
        const source = fixture();
        try {
            incident(source, 'before', time(9)); finding(source, 'before', 'before');
            incident(source, 'start', time(10)); finding(source, 'start', 'start', time(35), time(40));
            incident(source, 'inside', time(29)); finding(source, 'inside', 'inside');
            incident(source, 'end', time(30)); finding(source, 'end', 'end');
            incident(source, 'late', time(20)); finding(source, 'late', 'late', time(35), time(41));
            expect(inspect(source)).toEqual({ ...request, scope: 'local-jurisdiction-responsible-history',
                incidents: [
                    { receiptId: 'receipt-start', occurredAt: time(10), caseIds: ['case-start'], findingIds: ['finding-start'] },
                    { receiptId: 'receipt-inside', occurredAt: time(29), caseIds: ['case-inside'], findingIds: ['finding-inside'] }
                ], responsibleOutcomes: 2, additionalResponsibleOutcomes: 1,
                firstIncidentAt: time(10), lastIncidentAt: time(29), unavailable: {
                    recidivismRate: 'no-population-or-complete-cross-jurisdiction-follow-up',
                    prospectiveRisk: 'recorded-responsibility-is-not-a-risk-probability' } });
        } finally { source.close(); }
    });

    test('sorts simultaneous incidents deterministically by receipt identifier', () => {
        const source = fixture();
        try {
            incident(source, 'zeta', time(20)); finding(source, 'zeta', 'zeta');
            incident(source, 'alpha', time(20)); finding(source, 'second', 'alpha');
            expect(inspect(source).incidents).toEqual([
                { receiptId: 'receipt-alpha', occurredAt: time(20), caseIds: ['case-alpha'], findingIds: ['finding-second'] },
                { receiptId: 'receipt-zeta', occurredAt: time(20), caseIds: ['case-zeta'], findingIds: ['finding-zeta'] }
            ]);
            expect(inspect(source).responsibleOutcomes).toBe(2);
            expect(inspect(source).additionalResponsibleOutcomes).toBe(1);
        } finally { source.close(); }
    });

    test('excludes other jurisdictions, actors, not-proven cases and unadjudicated outcomes', () => {
        const source = fixture();
        try {
            incident(source, 'elsewhere', time(20)); finding(source, 'elsewhere', 'elsewhere', time(35), time(35), 'lumbridge');
            incident(source, 'other', time(20), 'thief-2');
            finding(source, 'other', 'other', time(35), time(35), 'varrock', 'thief-2');
            incident(source, 'not-proven', time(20));
            finding(source, 'not-proven', 'not-proven', time(35), time(35), 'varrock', 'thief-1', 'not-proven');
            incident(source, 'pending', time(20));
            expect(inspect(source)).toMatchObject({ incidents: [], responsibleOutcomes: 0,
                additionalResponsibleOutcomes: 0, firstIncidentAt: null, lastIncidentAt: null });
        } finally { source.close(); }
    });

    test('survives store restart with exactly the same history', () => {
        const source = fixture();
        incident(source, 'one', time(20)); finding(source, 'one', 'one');
        const expected = inspect(source), paths = source.paths;
        source.close();
        const restarted = open(paths);
        try { expect(inspect(restarted)).toEqual(expected); }
        finally { restarted.close(); }
    });

    test('rejects persisted finding tampering rather than returning a partial history', () => {
        const source = fixture();
        try {
            incident(source, 'one', time(20)); finding(source, 'one', 'one');
            const raw = new Database(source.paths.evidence);
            try { raw.run("UPDATE crime_legal_finding SET jurisdiction_id='elsewhere' WHERE finding_id='finding-one'"); }
            finally { raw.close(); }
            expect(() => inspect(source)).toThrow();
        } finally { source.close(); }
    });
});

function doubles() {
    const legalFinding: LegalFinding = { findingId: 'finding-one', caseId: 'case-one', jurisdictionId: 'varrock',
        suspectAgentId: 'thief-1', conclusion: 'responsible', evidenceIds: ['proof-one'], policyId: 'local-law-v1',
        policyDigest: 'c'.repeat(64), authorityEvidenceDigest: 'd'.repeat(64), occurredAt: time(35),
        findingDigest: 'e'.repeat(64), recordedAt: time(35) };
    const record: JurisdictionCriminalRecord = { suspectAgentId: 'thief-1', jurisdictionId: 'varrock',
        responsibleFindings: [legalFinding] };
    const state: CrimeCaseState = { caseId: 'case-one', outcomeReceiptId: 'receipt-one',
        discoveryObservationIds: [], identifications: [], legalFinding: null };
    const receipt: ThievingOutcomeReceipt = { ...outcome('one', time(20)), receiptId: 'receipt-one',
        receiptDigest: 'f'.repeat(64), recordedAt: time(20) };
    const evidence = { verifyAuditChain: () => true, getJurisdictionCriminalRecord: () => structuredClone(record) };
    const cases = { verifyAuditChain: () => true, getState: (_id: string): CrimeCaseState | null => structuredClone(state) };
    const thieving = { verifyAuditChain: () => true, getOutcome: (_id: string): ThievingOutcomeReceipt | null => structuredClone(receipt) };
    return { legalFinding, record, state, receipt, evidence, cases, thieving,
        inspect: () => inspectJurisdictionCrimeHistory(evidence, cases, thieving, request) };
}

describe('jurisdiction history source boundary', () => {
    test('deduplicates one outcome even when the source exposes multiple case bindings', () => {
        const source = doubles();
        source.record.responsibleFindings.unshift({ ...source.legalFinding, findingId: 'finding-two', caseId: 'case-two' });
        source.record.responsibleFindings.push({ ...source.legalFinding, findingId: 'finding-three' });
        source.cases.getState = caseId => ({ ...source.state, caseId });
        expect(source.inspect().incidents).toEqual([{ receiptId: 'receipt-one', occurredAt: time(20),
            caseIds: ['case-one', 'case-two'], findingIds: ['finding-one', 'finding-three', 'finding-two'] }]);
        expect(source.inspect().additionalResponsibleOutcomes).toBe(0);
    });

    test('does not read the case of a finding recorded after the historical cutoff', () => {
        const source = doubles();
        source.legalFinding.recordedAt = time(41);
        source.cases.getState = () => { throw new Error('Future case must not be read'); };
        expect(source.inspect().responsibleOutcomes).toBe(0);
    });

    const corruptions: Array<[string, (source: ReturnType<typeof doubles>) => void]> = [
        ['record actor', s => { s.record.suspectAgentId = 'thief-2'; }],
        ['record jurisdiction', s => { s.record.jurisdictionId = 'lumbridge'; }],
        ['finding actor', s => { s.legalFinding.suspectAgentId = 'thief-2'; }],
        ['finding jurisdiction', s => { s.legalFinding.jurisdictionId = 'lumbridge'; }],
        ['not-responsible source finding', s => { s.legalFinding.conclusion = 'not-proven'; }],
        ['duplicate finding identifiers', s => { s.record.responsibleFindings.push({ ...s.legalFinding }); }],
        ['absent case', s => { s.cases.getState = () => null; }],
        ['case binding mismatch', s => { s.state.caseId = 'case-other'; }],
        ['absent outcome', s => { s.thieving.getOutcome = () => null; }],
        ['outcome actor', s => { s.receipt.actorAgentId = 'thief-2'; }],
        ['outcome binding mismatch', s => { s.receipt.receiptId = 'receipt-other'; }],
        ['invalid finding time', s => { s.legalFinding.occurredAt = 'invalid'; }],
        ['invalid recording time', s => { s.legalFinding.recordedAt = 'invalid'; }],
        ['invalid outcome time', s => { s.receipt.occurredAt = 'invalid'; }],
        ['noncanonical outcome time', s => { s.receipt.occurredAt = '2030-01-01T10:20:00Z'; }],
        ['finding precedes outcome', s => { s.legalFinding.occurredAt = time(19); }],
        ['recording precedes finding', s => { s.legalFinding.recordedAt = time(34); }]
    ];
    test.each(corruptions)('rejects %s', (_label, corrupt) => {
        const source = doubles(); corrupt(source);
        expect(() => source.inspect()).toThrow();
    });

    test.each(['evidence', 'cases', 'thieving'] as const)('rejects invalid %s audit', kind => {
        const source = doubles(); source[kind].verifyAuditChain = () => false;
        expect(() => source.inspect()).toThrow();
    });

    test.each(['evidence', 'cases', 'thieving'] as const)('rejects %s audit becoming invalid during the read', kind => {
        const source = doubles(); let reads = 0;
        source[kind].verifyAuditChain = () => ++reads === 1;
        expect(() => source.inspect()).toThrow();
    });

    test.each(['evidence', 'cases', 'thieving'] as const)('rejects %s changing under a still-valid audit', kind => {
        const source = doubles(); let reads = 0;
        if (kind === 'evidence') source.evidence.getJurisdictionCriminalRecord = () => {
            const record = structuredClone(source.record);
            if (++reads > 1) record.responsibleFindings = [];
            return record;
        };
        if (kind === 'cases') source.cases.getState = () => ({ ...source.state,
            outcomeReceiptId: ++reads > 1 ? 'receipt-other' : 'receipt-one' });
        if (kind === 'thieving') source.thieving.getOutcome = () => ({ ...source.receipt,
            receiptDigest: ++reads > 1 ? '0'.repeat(64) : source.receipt.receiptDigest });
        expect(() => source.inspect()).toThrow();
    });

    const invalidRequests = [
        { ...request, actorAgentId: '' }, { ...request, jurisdictionId: '' },
        { ...request, incidentFrom: 'invalid' }, { ...request, incidentUntil: time(10) },
        { ...request, incidentUntil: time(9) }, { ...request, recordedAsOf: time(29) },
        { ...request, recordedAsOf: '2030-01-01T10:40:00Z' }
    ];
    test.each(invalidRequests)('rejects invalid history request %j', value => {
        const source = doubles();
        expect(() => inspectJurisdictionCrimeHistory(source.evidence, source.cases, source.thieving, value)).toThrow();
    });
});
