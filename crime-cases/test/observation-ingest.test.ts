import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingDiscoverySource, ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore, CrimeEvidenceStore, CrimeObservationCursorStore,
    promoteCrimeObservation } from '../index.js';

const roots: string[] = [], at = '2030-01-01T10:00:00.000Z', later = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
    const root = mkdtempSync(join(tmpdir(), 'crime-observation-ingest-')); roots.push(root);
    const cursorPath = join(root, 'cursor.sqlite');
    const thieving = new ThievingProcedureStore(join(root, 'thieving.sqlite'));
    const cases = new CrimeCaseStore(join(root, 'cases.sqlite'), thieving);
    const evidence = new CrimeEvidenceStore(join(root, 'evidence.sqlite'), cases, thieving);
    const cursor = new CrimeObservationCursorStore(cursorPath, thieving, cases, evidence);
    const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-outcome',
        procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
        actorAgentId: 'thief', playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer',
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
        startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event',
        sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    return { thieving, cases, evidence, cursor, cursorPath };
}
function observe(thieving: ThievingProcedureStore, name: string, source: ThievingDiscoverySource,
    direct = false): void {
    thieving.recordDiscovery(`observation-${name}`, { evidenceId: `engine-${name}`,
        outcomeReceiptId: 'receipt-1', source, observerAgentId: 'guard',
        actorIdentification: direct ? 'direct' : 'none', suspectAgentId: direct ? 'thief' : null,
        facts: ['Observed incident.'], sourceEvidenceDigest: 'b'.repeat(64), occurredAt: later },
    () => true, later);
}

describe('durable Thieving observation to crime-case projection', () => {
    test('backfills unknown witness and trace without suspect, then admits only direct proof', () => {
        const { thieving, cases, evidence, cursor, cursorPath } = setup();
        try {
            observe(thieving, 'unknown', 'direct-witness');
            observe(thieving, 'trace', 'physical-trace');
            expect(thieving.listDiscoveriesAfter(0).map(value => value.sequence)).toEqual([2, 3]);
            expect(cursor.runPage(1, later).processed).toBe(1);
            expect(cursor.runPage(1, later).processed).toBe(1);
            const caseId = cases.getCaseForOutcome('receipt-1')!;
            expect(cases.getState(caseId)).toMatchObject({ identifications: [], legalFinding: null });
            expect(evidence.listEvidence(caseId).map(value => value.kind)).toEqual(['physical-trace']);
            observe(thieving, 'identified', 'direct-witness', true);
            expect(cursor.runPage(10, later).processed).toBe(1);
            expect(cases.getState(caseId)?.identifications).toHaveLength(1);
            expect(evidence.listEvidence(caseId).map(value => value.kind))
                .toEqual(['physical-trace', 'direct-identification']);
            expect(evidence.listFindings(caseId)).toEqual([]);
            expect(cursor.verifyAuditChain()).toBeTrue();
            cursor.close();
            const reopened = new CrimeObservationCursorStore(cursorPath, thieving, cases, evidence);
            expect(reopened.runPage(10, later).processed).toBe(0);
            expect(reopened.verifyAuditChain()).toBeTrue();
            reopened.close();
        } finally { evidence.close(); cases.close(); thieving.close(); }
    });

    test('retries partial cross-ledger promotion and reuses a prior case binding', () => {
        const { thieving, cases, evidence, cursor } = setup();
        try {
            observe(thieving, 'trace', 'physical-trace');
            cases.recordDiscovery('manual-case', 'manual-discovery', 'observation-trace', later);
            const partial = promoteCrimeObservation('observation-trace', thieving, cases, evidence, later);
            expect(partial).toMatchObject({ caseId: 'manual-case',
                discovery: { eventId: 'manual-discovery' }, evidence: { kind: 'physical-trace' } });
            expect(cursor.runPage(10, later).processed).toBe(1);
            expect(cases.listEvents('manual-case')).toHaveLength(1);
            expect(evidence.listEvidence('manual-case')).toHaveLength(1);
            expect(cursor.verifyAuditChain()).toBeTrue();
        } finally { cursor.close(); evidence.close(); cases.close(); thieving.close(); }
    });

    test('detects cursor tampering and never skips the source observation', () => {
        const { thieving, cases, evidence, cursor, cursorPath } = setup();
        try {
            observe(thieving, 'trace', 'physical-trace');
            expect(() => cursor.runPage(10, at)).toThrow('predates source');
            expect(cursor.current()).toBe(0);
            expect(cursor.runPage(10, later).processed).toBe(1);
            const db = new Database(cursorPath, { strict: true });
            try { db.run('UPDATE crime_observation_cursor SET source_sequence=20 WHERE sequence=1');
            } finally { db.close(true); }
            expect(cursor.verifyAuditChain()).toBeFalse();
            expect(() => cursor.runPage(10, later)).toThrow('cursor or source audit');
        } finally { cursor.close(); evidence.close(); cases.close(); thieving.close(); }
    });

    test('fails closed on ambiguous pre-existing cases for one outcome', () => {
        const { thieving, cases, evidence, cursor } = setup();
        try {
            observe(thieving, 'first', 'direct-witness');
            observe(thieving, 'second', 'direct-witness');
            cases.recordDiscovery('manual-case-1', 'manual-event-1', 'observation-first', later);
            cases.recordDiscovery('manual-case-2', 'manual-event-2', 'observation-second', later);
            expect(() => cursor.runPage(10, later)).toThrow('ambiguous case bindings');
            expect(cursor.current()).toBe(0);
        } finally { cursor.close(); evidence.close(); cases.close(); thieving.close(); }
    });
});
