import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadItemLifecycleCatalog, loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { ItemProvenanceStore, loadItemProvenancePolicyCatalog } from '../../item-provenance/index.js';
import { ThievingProcedureStore, type ThievingOutcomeEvidence } from '../../thieving-procedures/index.js';
import { inspectCrimeEconomicCoverage } from '../economic-coverage.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
const at = '2030-01-01T10:00:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'crime-economic-coverage-')); roots.push(root);
    const lifecycle = loadItemLifecycleCatalog(join(config, 'item-lifecycle.json'));
    const state = loadItemStatePolicyCatalog(join(config, 'item-state-policies.json'), lifecycle);
    const policy = loadItemProvenancePolicyCatalog(join(config, 'item-provenance-policies.json'), state);
    const provenancePath = join(root, 'provenance.sqlite');
    return { thieving: new ThievingProcedureStore(join(root, 'thieving.sqlite')),
        provenance: new ItemProvenanceStore(provenancePath, policy), provenancePath, policy };
}
function outcome(id: number, actorAgentId = 'thief-1'): ThievingOutcomeEvidence {
    return { evidenceId: `engine-evidence-${id}`, procedureId: 'procedure.thieving.pickpocket',
        procedureVersion: '0.1.0', procedureKind: 'pickpocket', actorAgentId, playerUsername: 'Thief1',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 40 }],
        thievingXpDelta: 8, startedAtEngineTick: id * 100, endedAtEngineTick: id * 100 + 2,
        sourceEventId: `engine-event-${id}`, sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
}

describe('crime economic source coverage', () => {
    test('links only exact audited receipt and theft event, never inventing income or harm', () => {
        const { thieving, provenance } = fixture();
        try {
            const receipt = thieving.recordOutcome('receipt-1', outcome(1), () => true, at);
            thieving.recordOutcome('receipt-2', outcome(2), () => true, at);
            provenance.recordTheft({ eventId: 'theft-1', claimId: 'claim-1', assetId: null,
                expectedRevision: null, itemId: 995, quantity: 40,
                titleOwner: { kind: 'business', id: 'bakery' }, previousHolder: { kind: 'business', id: 'bakery' },
                thiefAgentId: 'thief-1', unitValueCoins: 1 }, receipt, () => true, at);
            const value = inspectCrimeEconomicCoverage(thieving, provenance, 'thief-1',
                ['receipt-1', 'receipt-2'], ['theft-1']);
            expect(value.receipts).toEqual([
                { receiptId: 'receipt-1', transferredItemCount: 1, linkedTheftEventIds: ['theft-1'],
                    unlinkedTransferredItems: [] },
                { receiptId: 'receipt-2', transferredItemCount: 1, linkedTheftEventIds: [],
                    unlinkedTransferredItems: [{ itemId: 995, quantity: 40 }] }
            ]);
            expect(value.unavailable.income).toContain('lack-theft-receipt');
            expect(value.unavailable.harm).toContain('no-verified-victim-loss');
        } finally { thieving.close(); provenance.close(); }
    });

    test('rejects mismatched cohorts and duplicate candidate events', () => {
        const { thieving, provenance } = fixture();
        try {
            thieving.recordOutcome('receipt-1', outcome(1), () => true, at);
            thieving.recordOutcome('receipt-2', outcome(2, 'other-1'), () => true, at);
            expect(() => inspectCrimeEconomicCoverage(thieving, provenance, 'thief-1', [], []))
                .toThrow('Receipt cohort is invalid');
            expect(() => inspectCrimeEconomicCoverage(thieving, provenance, 'thief-1', ['receipt-1', 'receipt-1'], []))
                .toThrow('duplicates');
            expect(() => inspectCrimeEconomicCoverage(thieving, provenance, 'thief-1', ['receipt-2'], []))
                .toThrow('another actor');
            expect(() => inspectCrimeEconomicCoverage(thieving, provenance, 'thief-1', ['receipt-1'], ['no-event']))
                .toThrow('does not exist');
        } finally { thieving.close(); provenance.close(); }
    });

    test('fails closed on damaged provenance audit and does not equate a claim with victim harm', () => {
        const { thieving, provenance, provenancePath, policy } = fixture();
        try {
            const receipt = thieving.recordOutcome('receipt-1', outcome(1), () => true, at);
            provenance.recordTheft({ eventId: 'theft-1', claimId: 'claim-1', assetId: null,
                expectedRevision: null, itemId: 995, quantity: 40,
                titleOwner: { kind: 'business', id: 'bakery' }, previousHolder: { kind: 'business', id: 'bakery' },
                thiefAgentId: 'thief-1', unitValueCoins: 1 }, receipt, () => true, at);
            provenance.close();
            const raw = new Database(provenancePath);
            raw.run('UPDATE item_restitution_claim SET amount_coins=9999 WHERE claim_id=?1', ['claim-1']);
            raw.close(true);
            const reopened = new ItemProvenanceStore(provenancePath, policy);
            try {
                expect(reopened.verifyAuditChain()).toBeFalse();
                expect(() => inspectCrimeEconomicCoverage(thieving, reopened, 'thief-1',
                    ['receipt-1'], ['theft-1'])).toThrow('source audit chain is invalid');
            } finally { reopened.close(); }
            const damage = new Database(provenancePath);
            damage.run("UPDATE item_restitution_claim SET amount_coins=40 WHERE claim_id='claim-1'");
            damage.run("UPDATE item_provenance_event SET quantity=41 WHERE event_id='theft-1'");
            damage.close(true);
            const damaged = new ItemProvenanceStore(provenancePath, policy);
            try { expect(() => inspectCrimeEconomicCoverage(thieving, damaged, 'thief-1',
                ['receipt-1'], ['theft-1'])).toThrow('source audit chain is invalid'); }
            finally { damaged.close(); }
        } finally { thieving.close(); }
    });
});
