import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FineCollectionSettlementStore, planFineCollection, settleFineCollection }
    from '../../../../crime-cases/fine-collection-settlement.js';
import { InstitutionTreasuryStore } from '../../../gateway/admin/institution-treasury.js';
import type { EnginePlayerEscrowResult } from '../../../gateway/admin/player-escrow.js';
import { MarketStore } from '../engine/market/MarketStore.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('fine settlement uses the real engine shared checkpoint ledger across debit, consume and restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fine-checkpoint-integration-')); roots.push(root);
    const intent = { collectionId: `fine-collection:${'a'.repeat(64)}`, decisionId: 'decision-1',
        decisionDigest: 'b'.repeat(64), amountGp: 25, payerUsername: 'payer', creditorFactionId: 'town',
        treasuryActorId: 'town_treasury', intentDigest: 'c'.repeat(64),
        recordedAt: '2030-01-01T00:00:00.000Z' };
    const journal = new FineCollectionSettlementStore(join(root, 'journal.sqlite'));
    planFineCollection(intent.collectionId, { verifyAuditChain: () => true,
        get: id => id === intent.collectionId ? intent : null }, journal);
    const treasury = new InstitutionTreasuryStore(join(root, 'treasury.sqlite'));
    const checkpointPath = join(root, 'player-checkpoint.sqlite');
    const market = new MarketStore(checkpointPath), escrow = new PlayerInventoryEscrowStore(market);
    let coins = 100;
    const wallet = { count: () => coins,
        remove: (_id: number, amount: number) => { coins -= amount; return amount; },
        add: (_id: number, amount: number) => { coins += amount; return amount; } };
    const escrower = async (request: { escrowId: string; operation: 'hold' | 'consume';
        username: string; assets?: { gp: number; items: [] } }): Promise<EnginePlayerEscrowResult> => {
        const record = escrow.mutateWithCheckpoint(request.operation === 'hold'
            ? { operation: 'hold', escrowId: request.escrowId, username: request.username,
                assets: request.assets! }
            : { operation: 'consume', escrowId: request.escrowId, username: request.username }, wallet,
        { owner: 'payer', save: () => new Uint8Array([coins]), rollback: () => { coins = 100; } });
        return { ok: true, commandId: 'engine', escrowId: request.escrowId,
            operation: request.operation, username: request.username, escrow: record };
    };
    try {
        expect((await settleFineCollection(intent.collectionId, { journal, treasury, escrower })).phase)
            .toBe('settled');
        expect(coins).toBe(75); expect([...market.saved('payer')!]).toEqual([75]);
        const escrowId = journal.get(intent.collectionId)!.plan.escrowId;
        expect(escrow.get(escrowId)?.status).toBe('committed');
        escrow.close(); market.db.close(true);
        const reopenedMarket = new MarketStore(checkpointPath);
        const reopenedEscrow = new PlayerInventoryEscrowStore(reopenedMarket);
        try {
            expect([...reopenedMarket.saved('payer')!]).toEqual([75]);
            expect(reopenedEscrow.get(escrowId)?.status).toBe('committed');
            expect(reopenedEscrow.verifySharedAuditChain()).toBeTrue();
        } finally { reopenedEscrow.close(); reopenedMarket.db.close(true); }
    } finally { journal.close(); treasury.close(); }
});
