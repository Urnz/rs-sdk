import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';

import { ThievingProcedureStore, type ThievingOutcomeEvidence } from '../index.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(): string { const root = mkdtempSync(join(tmpdir(), 'thieving-procedures-')); roots.push(root); return join(root, 'db.sqlite'); }
const at = '2030-01-01T10:00:00.000Z';
const outcome: ThievingOutcomeEvidence = {
    evidenceId: 'engine-evidence-1', procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0',
    procedureKind: 'pickpocket', actorAgentId: 'thief-1', playerUsername: 'Thief1',
    target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
    result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }],
    thievingXpDelta: 8, startedAtEngineTick: 100, endedAtEngineTick: 102,
    sourceEventId: 'engine-event-1', sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at
};

describe('trusted Thieving procedure outcomes and discoveries', () => {
    test('requires server verification, persists idempotently and rejects changed replay', () => {
        const databasePath = path(), store = new ThievingProcedureStore(databasePath);
        expect(() => store.recordOutcome('receipt-1', outcome)).toThrow('not trusted server evidence');
        const first = store.recordOutcome('receipt-1', outcome, () => true, at);
        expect(first).toMatchObject({ receiptId: 'receipt-1', playerUsername: 'thief1',
            effect: 'item-transfer', transferredItems: [{ itemId: 995, quantity: 3 }] });
        expect(store.recordOutcome('receipt-1', outcome, () => true, at)).toEqual(first);
        expect(() => store.recordOutcome('receipt-1', { ...outcome, thievingXpDelta: 9 }, () => true, at))
            .toThrow('reused');
        expect(store.verifyAuditChain()).toBeTrue();
        store.close();
        const reopened = new ThievingProcedureStore(databasePath);
        expect(reopened.getOutcome('receipt-1')).toEqual(first);
        expect(reopened.verifyAuditChain()).toBeTrue();
        reopened.close();
    });

    test('keeps discovery and suspect identification separate from world truth', () => {
        const store = new ThievingProcedureStore(path());
        store.recordOutcome('receipt-1', outcome, () => true, at);
        const discovery = store.recordDiscovery('observation-1', {
            evidenceId: 'discovery-evidence-1', outcomeReceiptId: 'receipt-1', source: 'owner-loss-report',
            observerAgentId: 'victim-1', actorIdentification: 'none', suspectAgentId: null,
            facts: ['Three coins are missing.'], sourceEvidenceDigest: 'b'.repeat(64),
            occurredAt: '2030-01-01T10:01:00.000Z'
        }, () => true, '2030-01-01T10:01:01.000Z');
        expect(discovery).toMatchObject({ actorIdentification: 'none', suspectAgentId: null });
        expect(JSON.stringify(discovery)).not.toContain('thief-1');
        expect(() => store.recordDiscovery('observation-2', {
            evidenceId: 'discovery-evidence-2', outcomeReceiptId: 'receipt-1', source: 'direct-witness',
            observerAgentId: 'guard-1', actorIdentification: 'direct', suspectAgentId: 'someone-else',
            facts: ['The guard saw an actor take coins.'], sourceEvidenceDigest: 'c'.repeat(64),
            occurredAt: '2030-01-01T10:02:00.000Z'
        }, () => true)).toThrow('world-truth actor');
        expect(store.listDiscoveries('receipt-1')).toEqual([discovery]);
        store.close();
    });

    test('rejects effects on failed outcomes and effect-kind mismatches', () => {
        const store = new ThievingProcedureStore(path());
        expect(() => store.recordOutcome('receipt-1', { ...outcome, result: 'failed' }, () => true, at))
            .toThrow('cannot claim effects');
        expect(() => store.recordOutcome('receipt-2', { ...outcome, effect: 'entry-completed', transferredItems: [] },
            () => true, at)).toThrow('does not match');
        store.close();
    });

    test('detects mutation of persisted world-truth facts', () => {
        const databasePath = path(), store = new ThievingProcedureStore(databasePath);
        store.recordOutcome('receipt-1', outcome, () => true, at);
        store.close();
        const raw = new Database(databasePath);
        raw.run('UPDATE thieving_outcome SET thieving_xp_delta=9 WHERE receipt_id=?1', ['receipt-1']);
        raw.close(true);
        const reopened = new ThievingProcedureStore(databasePath);
        expect(reopened.verifyAuditChain()).toBeFalse();
        reopened.close();
    });

    test('detects a missing audit entry even when the remaining chain is valid', () => {
        const databasePath = path(), store = new ThievingProcedureStore(databasePath);
        store.recordOutcome('receipt-1', outcome, () => true, at);
        store.close();
        const raw = new Database(databasePath);
        raw.run('DELETE FROM thieving_audit');
        raw.close(true);
        const reopened = new ThievingProcedureStore(databasePath);
        expect(reopened.verifyAuditChain()).toBeFalse();
        reopened.close();
    });
});
