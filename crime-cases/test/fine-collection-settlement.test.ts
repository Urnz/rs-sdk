import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import type { EnginePlayerEscrowResult } from '../../server/gateway/admin/player-escrow.js';
import { FineCollectionSettlementStore, planFineCollection, recoverFineCollections,
    settleFineCollection } from '../fine-collection-settlement.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const intent = { collectionId: `fine-collection:${'a'.repeat(64)}`, decisionId: 'decision-1',
    decisionDigest: 'b'.repeat(64), amountGp: 25, payerUsername: 'payer', creditorFactionId: 'town',
    treasuryActorId: 'town_treasury', intentDigest: 'c'.repeat(64), recordedAt: '2030-01-01T00:00:00.000Z' };

function fixture(coins = 100) {
    const root = mkdtempSync(join(tmpdir(), 'fine-settlement-')); roots.push(root);
    const journalPath = join(root, 'settlements.sqlite'), treasuryPath = join(root, 'treasury.sqlite');
    const journal = new FineCollectionSettlementStore(journalPath);
    planFineCollection(intent.collectionId, { verifyAuditChain: () => true,
        get: id => id === intent.collectionId ? intent : null }, journal);
    const treasury = new InstitutionTreasuryStore(treasuryPath);
    const escrow = new Map<string, { status: 'held' | 'committed'; gp: number }>();
    let balance = coins, debitCount = 0, consumeCount = 0;
    const escrower = async (request: { escrowId: string; operation: 'hold' | 'consume'; username: string;
        assets?: { gp: number; items: [] } }): Promise<EnginePlayerEscrowResult> => {
        let row = escrow.get(request.escrowId);
        if (request.operation === 'hold' && !row) {
            if (!request.assets || balance < request.assets.gp) throw new Error('Insufficient player coins');
            balance -= request.assets.gp; debitCount++; row = { status: 'held', gp: request.assets.gp };
            escrow.set(request.escrowId, row);
        } else if (request.operation === 'consume' && row?.status === 'held') {
            row.status = 'committed'; consumeCount++;
        }
        if (!row) throw new Error('Escrow is absent');
        return { ok: true, commandId: 'command', escrowId: request.escrowId, operation: request.operation,
            username: request.username, escrow: { escrowId: request.escrowId, username: request.username,
                assets: { gp: row.gp, items: [] }, status: row.status, payeeUsername: null, committedAt:
                row.status === 'committed' ? '2030-01-01T00:00:00.000Z' : null } };
    };
    return { root, journalPath, treasuryPath, journal, treasury, escrower,
        balance: () => balance, debitCount: () => debitCount, consumeCount: () => consumeCount };
}

describe('restart-safe fine collection settlement', () => {
    test('journal cannot be used to bypass the audited intent authority', () => {
        const root = mkdtempSync(join(tmpdir(), 'fine-settlement-authority-')); roots.push(root);
        const journal = new FineCollectionSettlementStore(join(root, 'journal.sqlite'));
        try { expect(() => journal.begin(intent, Symbol('fake'))).toThrow('verified intent authority'); }
        finally { journal.close(); }
    });

    test('holds once, credits once, consumes once, and exact replay is a no-op', async () => {
        const f = fixture();
        try {
            expect((await settleFineCollection(intent.collectionId, f)).phase).toBe('settled');
            expect(f.balance()).toBe(75); expect(f.debitCount()).toBe(1); expect(f.consumeCount()).toBe(1);
            expect(f.treasury.get('faction', 'town_treasury')?.balanceGp).toBe(25);
            expect((await settleFineCollection(intent.collectionId, f)).phase).toBe('settled');
            expect(f.debitCount()).toBe(1); expect(f.consumeCount()).toBe(1);
            expect(f.treasury.listExternalCredits()).toHaveLength(1);
        } finally { f.journal.close(); f.treasury.close(); }
    });

    for (const boundary of ['hold', 'credit', 'consume'] as const) test(`recovers interruption after ${boundary}`, async () => {
        const f = fixture(); let interrupted = false;
        try {
            await expect(settleFineCollection(intent.collectionId, { ...f,
                afterExternalStep: step => { if (!interrupted && step === boundary) {
                    interrupted = true; throw new Error(`stop-after-${boundary}`); } } }))
                .rejects.toThrow(`stop-after-${boundary}`);
            f.journal.close();
            const reopened = new FineCollectionSettlementStore(f.journalPath);
            try {
                expect((await recoverFineCollections({ ...f, journal: reopened })).settled)
                    .toEqual([intent.collectionId]);
                expect(f.balance()).toBe(75); expect(f.debitCount()).toBe(1); expect(f.consumeCount()).toBe(1);
                expect(f.treasury.get('faction', 'town_treasury')?.balanceGp).toBe(25);
                expect(f.treasury.listExternalCredits()).toHaveLength(1);
            } finally { reopened.close(); }
        } finally { f.treasury.close(); }
    });

    test('insufficient money fails before treasury credit and remains retryable', async () => {
        const f = fixture(10);
        try {
            await expect(settleFineCollection(intent.collectionId, f)).rejects.toThrow('Insufficient');
            expect(f.balance()).toBe(10); expect(f.journal.get(intent.collectionId)?.phase).toBe('planned');
            expect(f.treasury.listExternalCredits()).toEqual([]);
        } finally { f.journal.close(); f.treasury.close(); }
    });

    test('tampered journal and treasury sources fail closed without another movement', async () => {
        const f = fixture();
        try {
            await settleFineCollection(intent.collectionId, f);
            const raw = new Database(f.journalPath); raw.run("UPDATE fine_collection_settlement SET amount_gp=26"); raw.close();
            expect(() => f.journal.get(intent.collectionId)).toThrow('audit chain');
            const treasuryRaw = new Database(f.treasuryPath);
            treasuryRaw.run('UPDATE institution_treasury_external_credit SET amount_gp=26'); treasuryRaw.close();
            expect(() => f.treasury.listExternalCredits()).toThrow('audit');
            expect(f.debitCount()).toBe(1); expect(f.consumeCount()).toBe(1);
        } finally { f.journal.close(); f.treasury.close(); }
    });

});
