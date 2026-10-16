import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

import { ThievingProcedureStore, type ThievingOutcomeEvidence } from '../../thieving-procedures/index.js';
import { projectCrimeOutcomes } from '../index.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): { store: ThievingProcedureStore; path: string } {
    const root = mkdtempSync(join(tmpdir(), 'crime-metrics-')); roots.push(root);
    const path = join(root, 'thieving.sqlite');
    return { store: new ThievingProcedureStore(path), path };
}
function outcome(number: number, actorAgentId = 'thief-1', result: ThievingOutcomeEvidence['result'] = 'succeeded'):
    ThievingOutcomeEvidence {
    return { evidenceId: `engine-evidence-${number}`, procedureId: 'procedure.thieving.pickpocket',
        procedureVersion: '0.1.0', procedureKind: 'pickpocket', actorAgentId,
        playerUsername: 'Thief1', target: { kind: 'npc', typeId: 1, instanceIndex: 42,
            name: 'Man', x: 3222, z: 3218, level: 0 }, result,
        effect: result === 'succeeded' ? 'item-transfer' : 'none',
        transferredItems: result === 'succeeded' ? [{ itemId: 995, itemName: 'Coins', quantity: number }] : [],
        thievingXpDelta: result === 'succeeded' ? 8 : 0,
        startedAtEngineTick: number * 100, endedAtEngineTick: number * 100 + 2,
        sourceEventId: `engine-event-${number}`, sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
}

describe('source-validated crime outcome metrics', () => {
    test('counts only selected receipts and observed discoveries, leaving unsupported dimensions unavailable', () => {
        const { store } = fixture();
        try {
            store.recordOutcome('receipt-1', outcome(1), () => true, at);
            store.recordOutcome('receipt-2', outcome(2, 'thief-1', 'failed'), () => true, at);
            store.recordOutcome('receipt-3', outcome(3), () => true, at); // Deliberately outside selected cohort.
            store.recordDiscovery('observation-1', { evidenceId: 'observation-evidence-1',
                outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'guard-1',
                actorIdentification: 'direct', suspectAgentId: 'thief-1', facts: ['Witnessed.'],
                sourceEvidenceDigest: 'b'.repeat(64), occurredAt: '2030-01-01T10:01:00.000Z'
            }, () => true, '2030-01-01T10:01:01.000Z');
            store.recordDiscovery('observation-2', { evidenceId: 'observation-evidence-2',
                outcomeReceiptId: 'receipt-1', source: 'physical-trace', observerAgentId: null,
                actorIdentification: 'none', suspectAgentId: null, facts: ['Trace.'],
                sourceEvidenceDigest: 'c'.repeat(64), occurredAt: '2030-01-01T10:02:00.000Z'
            }, () => true, '2030-01-01T10:02:01.000Z');
            store.recordDiscovery('observation-3', { evidenceId: 'observation-evidence-3',
                outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'guard-2',
                actorIdentification: 'inferred', suspectAgentId: 'someone-else', facts: ['Uncertain identity.'],
                sourceEvidenceDigest: 'd'.repeat(64), occurredAt: '2030-01-01T10:03:00.000Z'
            }, () => true, '2030-01-01T10:03:01.000Z');
            const value = projectCrimeOutcomes(store, 'thief-1', ['receipt-1', 'receipt-2']);
            expect(value.scope).toBe('selected-thieving-receipts');
            expect(value.outcomes).toEqual({ attempts: 2, succeeded: 1, failed: 1, blocked: 0 });
            expect(value.byProcedure.pickpocket).toEqual(value.outcomes);
            expect(value.outcomesWithDiscovery).toBe(1);
            expect(value.outcomesWithDirectIdentification).toBe(1);
            expect(value.outcomesWithInferredIdentification).toBe(0);
            expect(value.transferredItems).toEqual([{ itemId: 995, itemName: 'Coins', quantity: 1 }]);
            expect(value.unavailable).toEqual({ income: 'no-verified-sale-or-net-proceeds-source',
                harm: 'no-verified-victim-loss-or-valuation-source',
                recidivism: 'no-complete-adjudicated-history-or-follow-up-window',
                prospectiveRisk: 'observed-discoveries-are-not-a-risk-probability' });
        } finally { store.close(); }
    });

    test('rejects duplicates, unknown receipts, empty cohorts and another actor', () => {
        const { store } = fixture();
        try {
            store.recordOutcome('receipt-1', outcome(1), () => true, at);
            store.recordOutcome('receipt-2', outcome(2, 'thief-2'), () => true, at);
            expect(() => projectCrimeOutcomes(store, 'thief-1', [])).toThrow('cohort is invalid');
            expect(() => projectCrimeOutcomes(store, 'thief-1', ['receipt-1', 'receipt-1']))
                .toThrow('duplicates');
            expect(() => projectCrimeOutcomes(store, 'thief-1', ['missing-1'])).toThrow('does not exist');
            expect(() => projectCrimeOutcomes(store, 'thief-1', ['receipt-1', 'receipt-2']))
                .toThrow('another actor');
        } finally { store.close(); }
    });

    test('fails closed when the persisted source audit is damaged', () => {
        const { store, path } = fixture();
        store.recordOutcome('receipt-1', outcome(1), () => true, at);
        store.close();
        const raw = new Database(path);
        raw.run('UPDATE thieving_outcome SET thieving_xp_delta=9 WHERE receipt_id=?1', ['receipt-1']);
        raw.close(true);
        const damaged = new ThievingProcedureStore(path);
        try { expect(() => projectCrimeOutcomes(damaged, 'thief-1', ['receipt-1']))
            .toThrow('source audit chain is invalid'); } finally { damaged.close(); }
    });
});
