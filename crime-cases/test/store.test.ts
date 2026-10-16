import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../thieving-procedures/types.js';
import { CrimeCaseStore } from '../index.js';

const roots: string[] = [], at = '2030-01-01T10:00:00.000Z', observedAt = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths(): { thieving: string; cases: string } { const root = mkdtempSync(join(tmpdir(), 'crime-case-'));
    roots.push(root); return { thieving: join(root, 'thieving.sqlite'), cases: join(root, 'cases.sqlite') }; }
const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence-1',
    procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
    actorAgentId: 'actual-thief', playerUsername: 'Thief1',
    target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
    result: 'succeeded', effect: 'item-transfer',
    transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
    startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event-1',
    sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };

function setup() { const pathsValue = paths(), thieving = new ThievingProcedureStore(pathsValue.thieving);
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    const cases = new CrimeCaseStore(pathsValue.cases, thieving);
    return { caseDatabasePath: pathsValue.cases, thieving, cases }; }
function observe(thieving: ThievingProcedureStore, observationId: string, identification: 'none' | 'direct' | 'inferred',
    suspectAgentId: string | null) { return thieving.recordDiscovery(observationId, {
    evidenceId: `evidence-${observationId}`, outcomeReceiptId: 'receipt-1', source: 'direct-witness',
    observerAgentId: 'guard-1', actorIdentification: identification, suspectAgentId,
    facts: ['Someone took three coins.'], sourceEvidenceDigest: 'b'.repeat(64), occurredAt: observedAt
}, () => true, observedAt); }

describe('separate crime discovery and suspect identification events', () => {
    test('does not reveal the hidden offender from a discovery without identification', () => {
        const { thieving, cases } = setup();
        try { observe(thieving, 'observation-1', 'none', null);
            const discovery = cases.recordDiscovery('case-1', 'case-event-1', 'observation-1', observedAt);
            expect(discovery).toMatchObject({ kind: 'discovery-recorded', suspectAgentId: null,
                identification: 'none' });
            expect(cases.getState('case-1')).toEqual({ caseId: 'case-1', outcomeReceiptId: 'receipt-1',
                discoveryObservationIds: ['observation-1'], identifications: [], legalFinding: null });
            expect(JSON.stringify(cases.getState('case-1'))).not.toContain('actual-thief');
            expect(() => cases.recordIdentification('case-1', 'case-event-2', 'observation-1', observedAt))
                .toThrow('does not identify');
            expect(cases.verifyAuditChain()).toBeTrue();
        } finally { cases.close(); thieving.close(); }
    });
    test('records identification as a second idempotent event without a legal finding', () => {
        const { thieving, cases } = setup();
        try { observe(thieving, 'observation-1', 'direct', 'actual-thief');
            expect(() => cases.recordIdentification('case-1', 'case-event-2', 'observation-1', observedAt))
                .toThrow('requires a recorded');
            cases.recordDiscovery('case-1', 'case-event-1', 'observation-1', observedAt);
            const identified = cases.recordIdentification('case-1', 'case-event-2', 'observation-1', observedAt);
            expect(cases.recordIdentification('case-1', 'case-event-2', 'observation-1', observedAt))
                .toEqual(identified);
            expect(cases.getState('case-1')).toMatchObject({ legalFinding: null,
                identifications: [{ observationId: 'observation-1', suspectAgentId: 'actual-thief',
                    identification: 'direct', observerAgentId: 'guard-1' }] });
            expect(cases.listEvents('case-1').map(value => value.kind))
                .toEqual(['discovery-recorded', 'suspect-identified']);
            expect(cases.verifyAuditChain()).toBeTrue();
        } finally { cases.close(); thieving.close(); }
    });
    test('rejects changed event ids and a case id reused for another crime', () => {
        const { thieving, cases } = setup();
        try { observe(thieving, 'observation-1', 'none', null);
            cases.recordDiscovery('case-1', 'case-event-1', 'observation-1', observedAt);
            expect(() => cases.recordDiscovery('case-2', 'case-event-1', 'observation-1', observedAt))
                .toThrow('reused');
            thieving.recordOutcome('receipt-2', { ...outcome, evidenceId: 'engine-evidence-2',
                sourceEventId: 'engine-event-2' }, () => true, at);
            thieving.recordDiscovery('observation-2', { evidenceId: 'evidence-observation-2',
                outcomeReceiptId: 'receipt-2', source: 'owner-loss-report', observerAgentId: 'victim-1',
                actorIdentification: 'none', suspectAgentId: null, facts: ['Three coins are gone.'],
                sourceEvidenceDigest: 'c'.repeat(64), occurredAt: observedAt }, () => true, observedAt);
            expect(() => cases.recordDiscovery('case-1', 'case-event-2', 'observation-2', observedAt))
                .toThrow('another outcome');
        } finally { cases.close(); thieving.close(); }
    });
    test('persists across restart and rejects missing audit rows', () => {
        const { thieving, cases, caseDatabasePath } = setup();
        try { observe(thieving, 'observation-1', 'inferred', 'possible-thief');
            cases.recordDiscovery('case-1', 'case-event-1', 'observation-1', observedAt);
            cases.recordIdentification('case-1', 'case-event-2', 'observation-1', observedAt);
        } finally { cases.close(); }
        const reopened = new CrimeCaseStore(caseDatabasePath, thieving);
        expect(reopened.verifyAuditChain()).toBeTrue();
        expect(reopened.getState('case-1')?.identifications[0]?.suspectAgentId).toBe('possible-thief');
        reopened.close();
        const raw = new Database(caseDatabasePath); raw.run('DELETE FROM crime_case_audit WHERE event_id=?1', ['case-event-2']);
        raw.close();
        const damaged = new CrimeCaseStore(caseDatabasePath, thieving);
        try { expect(damaged.verifyAuditChain()).toBeFalse(); } finally { damaged.close(); thieving.close(); }
    });
    test('describes a suspect only to the agent who directly identified them', () => {
        const { thieving, cases } = setup();
        try {
            observe(thieving, 'unidentified', 'none', null);
            cases.recordDiscovery('case-1', 'discovery-unidentified', 'unidentified', observedAt);
            expect(cases.getWitnessSuspectDescription('guard-1', 'actual-thief')).toBeNull();
            observe(thieving, 'inferred', 'inferred', 'possible-thief');
            cases.recordDiscovery('case-1', 'discovery-inferred', 'inferred', observedAt);
            cases.recordIdentification('case-1', 'identification-inferred', 'inferred', observedAt);
            expect(cases.getWitnessSuspectDescription('guard-1', 'possible-thief')).toBeNull();
            observe(thieving, 'direct', 'direct', 'actual-thief');
            cases.recordDiscovery('case-1', 'discovery-direct', 'direct', observedAt);
            cases.recordIdentification('case-1', 'identification-direct', 'direct', observedAt);
            expect(cases.getWitnessSuspectDescription('guard-1', 'actual-thief')).toEqual({
                viewerAgentId: 'guard-1', targetAgentId: 'actual-thief',
                description: 'Personally identified as a suspect during a theft',
                sourceCaseEventIds: ['identification-direct']
            });
            expect(cases.getWitnessSuspectDescription('other-guard', 'actual-thief')).toBeNull();
            expect(cases.getWitnessSuspectDescription('guard-1', 'bystander')).toBeNull();
            expect(cases.listWitnessSuspectDescriptionsForViewers(['guard-1', 'other-guard']))
                .toEqual([cases.getWitnessSuspectDescription('guard-1', 'actual-thief')!]);
            expect(cases.getState('case-1')?.legalFinding).toBeNull();
        } finally { cases.close(); thieving.close(); }
    });
    test('rejects a witnessed description after case audit tampering', () => {
        const { thieving, cases, caseDatabasePath } = setup();
        try {
            observe(thieving, 'direct', 'direct', 'actual-thief');
            cases.recordDiscovery('case-1', 'discovery-direct', 'direct', observedAt);
            cases.recordIdentification('case-1', 'identification-direct', 'direct', observedAt);
            const raw = new Database(caseDatabasePath);
            try { raw.run("UPDATE crime_case_event SET observer_agent_id='other-guard' WHERE event_id='identification-direct'");
            } finally { raw.close(); }
            expect(() => cases.getWitnessSuspectDescription('guard-1', 'actual-thief'))
                .toThrow('audit chain');
        } finally { cases.close(); thieving.close(); }
    });
});
