import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadItemLifecycleCatalog, loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import type { ThievingOutcomeReceipt } from '../../thieving-procedures/types.js';
import { ItemProvenanceStore, loadItemProvenancePolicyCatalog,
    type ItemProvenanceEvidence } from '../index.js';

const directories: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function databasePath(): string { const directory = mkdtempSync(join(tmpdir(), 'item-provenance-'));
    directories.push(directory); return join(directory, 'provenance.sqlite'); }
function policy() { const lifecycle = loadItemLifecycleCatalog(join(config, 'item-lifecycle.json'));
    const state = loadItemStatePolicyCatalog(join(config, 'item-state-policies.json'), lifecycle);
    return loadItemProvenancePolicyCatalog(join(config, 'item-provenance-policies.json'), state); }
function evidence(id: string, at = '2030-01-01T00:00:00.000Z'): ItemProvenanceEvidence { return {
    evidenceId: id, sourceDomain: 'item-lifecycle', sourceRecordId: `source-${id}`, sourceStateVersion: 1,
    sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at }; }
function receipt(itemId: number, quantity: number): ThievingOutcomeReceipt { return { receiptId: 'theft-receipt-1',
    evidenceId: 'engine-evidence-1', procedureId: 'pickpocket.man', procedureVersion: '1.0.0',
    procedureKind: 'pickpocket', actorAgentId: 'thief', playerUsername: 'thief',
    target: { kind: 'npc', typeId: 1, instanceIndex: 1, name: 'Man', x: 3200, z: 3200, level: 0 },
    result: 'succeeded', effect: 'item-transfer', transferredItems: [{ itemId, itemName: 'Item', quantity }],
    thievingXpDelta: 8, startedAtEngineTick: 10, endedAtEngineTick: 11, sourceEventId: 'engine-event-1',
    sourceEvidenceDigest: 'b'.repeat(64), occurredAt: '2030-01-01T00:02:00.000Z',
    receiptDigest: 'c'.repeat(64), recordedAt: '2030-01-01T00:02:01.000Z' }; }

describe('item title, custody and provenance ledger', () => {
    test('keeps title and custody independent while preserving theft history through later trade', () => {
        const store = new ItemProvenanceStore(databasePath(), policy());
        try { const created = store.register({ eventId: 'register-pickaxe', assetId: 'pickaxe-1', itemId: 1265,
                quantity: 1, titleOwner: { kind: 'agent', id: 'alice' }, holder: { kind: 'business', id: 'smiths' },
                evidence: evidence('create-proof') }, () => true);
            expect(created).toMatchObject({ titleOwner: { id: 'alice' }, holder: { id: 'smiths' }, revision: 1 });
            const retitled = store.transferTitle({ eventId: 'gift-title', assetId: 'pickaxe-1', expectedRevision: 1,
                from: { kind: 'agent', id: 'alice' }, to: { kind: 'agent', id: 'bob' },
                evidence: evidence('title-proof', '2030-01-01T00:01:00.000Z') }, () => true);
            expect(retitled).toMatchObject({ titleOwner: { id: 'bob' }, holder: { id: 'smiths' }, revision: 2 });
            const stolen = store.recordTheft({ eventId: 'steal-pickaxe', claimId: null, assetId: 'pickaxe-1',
                expectedRevision: 2, itemId: 1265, quantity: 1, titleOwner: { kind: 'agent', id: 'bob' },
                previousHolder: { kind: 'business', id: 'smiths' }, thiefAgentId: 'thief', unitValueCoins: null },
            receipt(1265, 1), () => true);
            expect(stolen).toMatchObject({ titleAfter: { id: 'bob' }, holderAfter: { id: 'thief' } });
            const traded = store.transferCustody({ eventId: 'player-trade', assetId: 'pickaxe-1', expectedRevision: 3,
                from: { kind: 'agent', id: 'thief' }, to: { kind: 'agent', id: 'buyer' },
                evidence: { ...evidence('trade-proof', '2030-01-01T00:03:00.000Z'), sourceDomain: 'trade' } }, () => true);
            expect(traded).toMatchObject({ titleOwner: { id: 'bob' }, holder: { id: 'buyer' },
                theftHistoryCount: 1, revision: 4 });
            expect(store.listEvents('pickaxe-1').map(value => value.kind)).toEqual([
                'registered', 'title-transferred', 'stolen', 'custody-transferred']);
            expect(store.verifyAuditChain()).toBeTrue();
        } finally { store.close(); }
    });
    test('records fungible theft as value restitution without minting asset identities', () => {
        const store = new ItemProvenanceStore(databasePath(), policy());
        try { const theft = store.recordTheft({ eventId: 'steal-coins', claimId: 'coins-claim-1', assetId: null,
                expectedRevision: null, itemId: 995, quantity: 40, titleOwner: { kind: 'business', id: 'bakery' },
                previousHolder: { kind: 'business', id: 'bakery' }, thiefAgentId: 'thief', unitValueCoins: 1 },
            receipt(995, 40), () => true, '2030-01-01T00:02:02.000Z');
            expect(theft.assetId).toBeNull(); expect(store.getAsset('coins-claim-1')).toBeNull();
            expect(store.getClaim('coins-claim-1')).toMatchObject({ quantity: 40, amountCoins: 40, status: 'open' });
            expect(store.verifyAuditChain()).toBeTrue();
        } finally { store.close(); }
    });
    test('v2 claim audit rejects changed or deleted claim amounts before reads', () => {
        const path = databasePath(), store = new ItemProvenanceStore(path, policy());
        try { store.recordTheft({ eventId: 'steal-coins', claimId: 'coins-claim-1', assetId: null,
                expectedRevision: null, itemId: 995, quantity: 40,
                titleOwner: { kind: 'business', id: 'bakery' }, previousHolder: { kind: 'business', id: 'bakery' },
                thiefAgentId: 'thief', unitValueCoins: 1 }, receipt(995, 40), () => true);
            expect(store.verifyAuditChain()).toBeTrue();
            store.close();
            const raw = new Database(path);
            raw.run('UPDATE item_restitution_claim SET amount_coins=9999 WHERE claim_id=?1', ['coins-claim-1']);
            raw.close(true);
            const damaged = new ItemProvenanceStore(path, policy());
            try { expect(damaged.verifyAuditChain()).toBeFalse();
                expect(() => damaged.getClaim('coins-claim-1')).toThrow('claim audit is invalid'); }
            finally { damaged.close(); }
            const deleted = new Database(path);
            deleted.run('DELETE FROM item_restitution_claim WHERE claim_id=?1', ['coins-claim-1']);
            deleted.close(true);
            const missing = new ItemProvenanceStore(path, policy());
            try { expect(missing.verifyAuditChain()).toBeFalse();
                expect(() => missing.getClaim('coins-claim-1')).toThrow('claim audit is invalid'); }
            finally { missing.close(); }
        } finally { /* closed before out-of-band mutation */ }
    });
    test('v1 migration snapshots claims but does not authenticate their historical values', () => {
        const path = databasePath(), store = new ItemProvenanceStore(path, policy());
        store.recordTheft({ eventId: 'steal-coins', claimId: 'coins-claim-1', assetId: null,
            expectedRevision: null, itemId: 995, quantity: 40,
            titleOwner: { kind: 'business', id: 'bakery' }, previousHolder: { kind: 'business', id: 'bakery' },
            thiefAgentId: 'thief', unitValueCoins: 1 }, receipt(995, 40), () => true);
        store.close();
        const raw = new Database(path);
        raw.run('DROP TABLE item_restitution_claim_audit');
        raw.run('PRAGMA user_version = 1');
        raw.close(true);
        const migrated = new ItemProvenanceStore(path, policy());
        try { expect(migrated.verifyAuditChain()).toBeTrue();
            expect(() => migrated.getClaim('coins-claim-1')).toThrow('not historically authenticated');
            expect(migrated.getClaim('missing-claim')).toBeNull(); }
        finally { migrated.close(); }
        const check = new Database(path);
        expect((check.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
        check.close(true);
    });
    test('rejects inconsistent legacy claims without committing a partial migration', () => {
        const path = databasePath(), store = new ItemProvenanceStore(path, policy());
        store.recordTheft({ eventId: 'steal-coins', claimId: 'coins-claim-1', assetId: null,
            expectedRevision: null, itemId: 995, quantity: 40,
            titleOwner: { kind: 'business', id: 'bakery' }, previousHolder: { kind: 'business', id: 'bakery' },
            thiefAgentId: 'thief', unitValueCoins: 1 }, receipt(995, 40), () => true);
        store.close();
        const raw = new Database(path);
        raw.run('DROP TABLE item_restitution_claim_audit');
        raw.run('UPDATE item_restitution_claim SET amount_coins=9999 WHERE claim_id=?1', ['coins-claim-1']);
        raw.run('PRAGMA user_version = 1');
        raw.close(true);
        expect(() => new ItemProvenanceStore(path, policy())).toThrow('migration verification failed');
        const check = new Database(path);
        try { expect((check.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
            expect((check.query("SELECT name FROM sqlite_master WHERE name='item_restitution_claim_audit'")
                .get() as { name: string } | null)).toBeNull(); }
        finally { check.close(true); }
    });
    test('supports shared provenance lots and exact idempotent retries', () => {
        const store = new ItemProvenanceStore(databasePath(), policy());
        try { const input = { eventId: 'register-lobsters', assetId: 'lobster-lot-1', itemId: 379, quantity: 20,
                titleOwner: { kind: 'business' as const, id: 'fishers' },
                holder: { kind: 'business' as const, id: 'fishers' }, evidence: evidence('lot-proof') };
            const first = store.register(input, () => true), replay = store.register(input, () => true);
            expect(replay).toEqual(first); expect(first).toMatchObject({ stateMode: 'batch', quantity: 20 });
            expect(() => store.register({ ...input, quantity: 21 }, () => true)).toThrow('reused');
        } finally { store.close(); }
    });
    test('fails closed for untrusted or mismatched theft evidence and detects audit mutation', () => {
        const path = databasePath(), store = new ItemProvenanceStore(path, policy());
        expect(() => store.register({ eventId: 'register-pickaxe', assetId: 'pickaxe-1', itemId: 1265, quantity: 1,
            titleOwner: { kind: 'agent', id: 'alice' }, holder: { kind: 'agent', id: 'alice' },
            evidence: evidence('proof') }, () => false)).toThrow('not trusted');
        expect(() => store.recordTheft({ eventId: 'wrong-theft', claimId: 'claim-1', assetId: null,
            expectedRevision: null, itemId: 995, quantity: 41, titleOwner: { kind: 'agent', id: 'alice' },
            previousHolder: { kind: 'agent', id: 'alice' }, thiefAgentId: 'thief', unitValueCoins: 1 },
        receipt(995, 40), () => true)).toThrow('exact Thieving evidence');
        store.recordTheft({ eventId: 'valid-theft', claimId: 'claim-2', assetId: null, expectedRevision: null,
            itemId: 995, quantity: 40, titleOwner: { kind: 'agent', id: 'alice' },
            previousHolder: { kind: 'agent', id: 'alice' }, thiefAgentId: 'thief', unitValueCoins: 1 },
        receipt(995, 40), () => true); store.close();
        const database = new Database(path); database.run("UPDATE item_provenance_event SET quantity=39 WHERE event_id='valid-theft'");
        database.close(); const reopened = new ItemProvenanceStore(path, policy());
        try { expect(reopened.verifyAuditChain()).toBeFalse(); } finally { reopened.close(); }
    });

    test('detects a missing audit entry for an otherwise intact provenance event', () => {
        const path = databasePath(), store = new ItemProvenanceStore(path, policy());
        store.register({ eventId: 'register-pickaxe', assetId: 'pickaxe-1', itemId: 1265, quantity: 1,
            titleOwner: { kind: 'agent', id: 'alice' }, holder: { kind: 'agent', id: 'alice' },
            evidence: evidence('proof') }, () => true);
        store.close();
        const database = new Database(path);
        database.run('DELETE FROM item_provenance_audit');
        database.close();
        const reopened = new ItemProvenanceStore(path, policy());
        try { expect(reopened.verifyAuditChain()).toBeFalse(); } finally { reopened.close(); }
    });
});
