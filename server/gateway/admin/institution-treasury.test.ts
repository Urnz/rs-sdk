import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstitutionTreasuryStore } from './institution-treasury.js';

const dirs: string[] = [];
function store(): InstitutionTreasuryStore {
    const dir = mkdtempSync(join(tmpdir(), 'rs-treasury-')); dirs.push(dir);
    return new InstitutionTreasuryStore(join(dir, 'treasury.sqlite'));
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('institution treasury', () => {
    test('reserves, commits, and idempotently preserves real funds', () => {
        const treasury = store();
        const empty = treasury.ensure('business', 'forge');
        treasury.setBalance('business', 'forge', empty.revision, 1_000);
        const held = treasury.reserve('business', 'forge', 'work.iron-001', 400);
        expect(held.created).toBeTrue();
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 1_000, reservedGp: 400, availableGp: 600 });
        expect(treasury.reserve('business', 'forge', 'work.iron-001', 400).created).toBeFalse();
        const settlementId = '11111111-1111-4111-8111-111111111111';
        treasury.bindSettlement('work.iron-001', settlementId);
        treasury.commit('work.iron-001', settlementId);
        treasury.commit('work.iron-001', settlementId);
        expect(treasury.bindSettlement('work.iron-001', settlementId).status).toBe('committed');
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 600, reservedGp: 0, availableGp: 600 });
        treasury.close();
    });

    test('rejects unfunded work and releases failed work exactly once', () => {
        const treasury = store();
        const empty = treasury.ensure('faction', 'white-knights');
        treasury.setBalance('faction', 'white-knights', empty.revision, 500);
        expect(() => treasury.reserve('faction', 'white-knights', 'work.too-large', 501)).toThrow('Insufficient');
        treasury.reserve('faction', 'white-knights', 'work.patrol', 300);
        treasury.release('work.patrol'); treasury.release('work.patrol');
        expect(treasury.get('faction', 'white-knights')).toMatchObject({ balanceGp: 500, reservedGp: 0 });
        expect(() => treasury.commit('work.patrol', '22222222-2222-4222-8222-222222222222')).toThrow();
        treasury.close();
    });

    test('transfers a reserved payment between exact institutions once', () => {
        const treasury = store();
        const payer = treasury.ensure('business', 'forge');
        treasury.setBalance('business', 'forge', payer.revision, 1_000);
        treasury.ensure('faction', 'white-knights');
        treasury.reserve('business', 'forge', 'contract.fee-001', 350);
        const settlementId = '33333333-3333-4333-8333-333333333333';
        treasury.bindSettlement('contract.fee-001', settlementId);
        expect(() => treasury.transferReserved('contract.fee-001', settlementId,
            'business', 'forge')).toThrow('must be different');
        const first = treasury.transferReserved('contract.fee-001', settlementId,
            'faction', 'white-knights');
        expect(first).toMatchObject({ payerKind: 'business', payerActorId: 'forge',
            payeeKind: 'faction', payeeActorId: 'white-knights', amountGp: 350 });
        expect(treasury.transferReserved('contract.fee-001', settlementId,
            'faction', 'white-knights')).toEqual(first);
        expect(treasury.listTransfers()).toEqual([first]);
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 650, reservedGp: 0 });
        expect(treasury.get('faction', 'white-knights')).toMatchObject({ balanceGp: 350, reservedGp: 0 });
        expect(() => treasury.transferReserved('contract.fee-001', settlementId,
            'business', 'another')).toThrow('different transfer');
        expect(() => treasury.listTransfers(1_001)).toThrow('between 1 and 1000');
        treasury.close();
    });

    test('rolls back both sides when an institution transfer cannot be credited', () => {
        const treasury = store();
        const payer = treasury.ensure('business', 'forge');
        treasury.setBalance('business', 'forge', payer.revision, 100);
        const payee = treasury.ensure('faction', 'white-knights');
        treasury.setBalance('faction', 'white-knights', payee.revision, 2_147_483_647);
        treasury.reserve('business', 'forge', 'contract.overflow', 50);
        const settlementId = '44444444-4444-4444-8444-444444444444';
        treasury.bindSettlement('contract.overflow', settlementId);
        expect(() => treasury.transferReserved('contract.overflow', settlementId,
            'faction', 'white-knights')).toThrow('balance limit');
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 100, reservedGp: 50 });
        expect(treasury.get('faction', 'white-knights')).toMatchObject({ balanceGp: 2_147_483_647 });
        expect(treasury.getReservation('contract.overflow')).toMatchObject({ status: 'reserved' });
        expect(treasury.getTransfer(settlementId)).toBeNull();
        treasury.close();
    });

    test('credits and subtracts only the exact genesis treasury lot', () => {
        const treasury = store();
        const receipt = treasury.creditGenesis('business', 'forge', 'genesis-capital', 1_000,
            '2001-01-01T00:00:00.000Z');
        expect(receipt).toMatchObject({ status: 'active', amountGp: 1_000 });
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 1_000 });
        expect(treasury.creditGenesis('business', 'forge', 'genesis-capital', 1_000)).toEqual(receipt);
        treasury.setBalance('business', 'forge', treasury.get('business', 'forge')!.revision, 1_250);
        expect(treasury.resetGenesis('genesis-capital')).toMatchObject({ status: 'reset' });
        expect(treasury.get('business', 'forge')).toMatchObject({ balanceGp: 250 });
        expect(treasury.resetGenesis('genesis-capital')).toMatchObject({ status: 'reset' });
        treasury.close();
    });
});
