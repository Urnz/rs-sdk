import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
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

    test('credits a verified external settlement once with an immutable audit receipt', () => {
        const treasury = store(), evidence = { settlementId:'55555555-5555-4555-8555-555555555555',
            kind:'business' as const,actorId:'forge',amountGp:75,sourceRef:'shop.sale.order-1',
            status:'committed' as const,occurredAt:'2026-09-20T10:00:00.000Z' };
        expect(() => treasury.creditExternalSettlement(evidence)).toThrow('not trusted');
        const first=treasury.creditExternalSettlement(evidence,()=>true,'2026-09-20T10:00:01.000Z');
        expect(first).toMatchObject({actorId:'forge',amountGp:75,sourceRef:'shop.sale.order-1'});
        expect(treasury.creditExternalSettlement(evidence,()=>true)).toEqual(first);
        expect(treasury.getExternalCredit(evidence.settlementId)).toEqual(first);
        expect(treasury.listExternalCredits()).toEqual([first]);
        expect(() => treasury.verifyExternalCreditAudit()).not.toThrow();
        expect(treasury.get('business','forge')).toMatchObject({balanceGp:75});
        expect(() => treasury.creditExternalSettlement({...evidence,amountGp:76},()=>true))
            .toThrow('settlement id was reused');
        expect(treasury.get('business','forge')).toMatchObject({balanceGp:75});
        treasury.close();
    });

    test('external-credit audit survives restart and exact retry does not append', () => {
        const dir=mkdtempSync(join(tmpdir(),'rs-treasury-audit-'));dirs.push(dir);
        const path=join(dir,'treasury.sqlite');
        const evidence={settlementId:'66666666-6666-4666-8666-666666666666',kind:'faction' as const,
            actorId:'guard',amountGp:40,sourceRef:'fine.settlement-1',status:'committed' as const,
            occurredAt:'2026-09-20T10:00:00.000Z'};
        let treasury=new InstitutionTreasuryStore(path);
        const first=treasury.creditExternalSettlement(evidence,()=>true);
        treasury.close();
        treasury=new InstitutionTreasuryStore(path);
        expect(treasury.getExternalCredit(evidence.settlementId)).toEqual(first);
        expect(treasury.creditExternalSettlement(evidence,()=>true)).toEqual(first);
        treasury.close();
        const db=new Database(path);
        expect((db.query('SELECT COUNT(*) AS n FROM institution_treasury_external_credit_audit')
            .get() as {n:number}).n).toBe(1);
        db.close();
    });

    test('external-credit read and write fail closed after receipt or audit tampering', () => {
        for(const tamper of ['receipt','audit']){
            const dir=mkdtempSync(join(tmpdir(),'rs-treasury-tamper-'));dirs.push(dir);
            const path=join(dir,'treasury.sqlite'),treasury=new InstitutionTreasuryStore(path);
            const evidence={settlementId:'77777777-7777-4777-8777-777777777777',kind:'business' as const,
                actorId:'forge',amountGp:12,sourceRef:'shop.sale.order-7',status:'committed' as const,
                occurredAt:'2026-09-20T10:00:00.000Z'};
            treasury.creditExternalSettlement(evidence,()=>true);
            const db=new Database(path);
            db.run(tamper==='receipt'
                ?'UPDATE institution_treasury_external_credit SET amount_gp=13'
                :'UPDATE institution_treasury_external_credit_audit SET receipt_hash=\'tampered\'');
            db.close();
            expect(() => treasury.getExternalCredit(evidence.settlementId)).toThrow('audit');
            expect(() => treasury.listExternalCredits()).toThrow('audit');
            expect(() => treasury.creditExternalSettlement({...evidence,settlementId:
                '88888888-8888-4888-8888-888888888888'},()=>true)).toThrow('audit');
            expect(treasury.get('business','forge')?.balanceGp).toBe(12);
            treasury.close();
        }
    });

    test('preexisting unaudited receipt blocks only external-credit path', () => {
        const dir=mkdtempSync(join(tmpdir(),'rs-treasury-legacy-'));dirs.push(dir);
        const path=join(dir,'treasury.sqlite'),treasury=new InstitutionTreasuryStore(path);
        treasury.ensure('business','forge');
        const db=new Database(path);
        db.run(`INSERT INTO institution_treasury_external_credit VALUES
            ('99999999-9999-4999-8999-999999999999','business','forge',9,'legacy.source','2026-09-20')`);
        db.close();
        const evidence={settlementId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'business' as const,
            actorId:'forge',amountGp:12,sourceRef:'shop.sale.order-8',status:'committed' as const,
            occurredAt:'2026-09-20T10:00:00.000Z'};
        expect(() => treasury.getExternalCredit('99999999-9999-4999-8999-999999999999')).toThrow('incomplete');
        expect(() => treasury.creditExternalSettlement(evidence,()=>true)).toThrow('incomplete');
        expect(treasury.get('business','forge')).toMatchObject({balanceGp:0});
        treasury.creditGenesis('business','forge','genesis-legacy',5);
        expect(treasury.get('business','forge')).toMatchObject({balanceGp:5});
        treasury.close();
    });

    test('failed audit insert rolls back external credit and account creation', () => {
        const dir=mkdtempSync(join(tmpdir(),'rs-treasury-rollback-'));dirs.push(dir);
        const path=join(dir,'treasury.sqlite'),treasury=new InstitutionTreasuryStore(path);
        const db=new Database(path);
        db.run(`CREATE TRIGGER reject_credit_audit BEFORE INSERT ON institution_treasury_external_credit_audit
            BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
        db.close();
        const evidence={settlementId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',kind:'business' as const,
            actorId:'forge',amountGp:12,sourceRef:'shop.sale.order-9',status:'committed' as const,
            occurredAt:'2026-09-20T10:00:00.000Z'};
        expect(() => treasury.creditExternalSettlement(evidence,()=>true)).toThrow('audit unavailable');
        expect(treasury.get('business','forge')).toBeNull();
        expect(treasury.getExternalCredit(evidence.settlementId)).toBeNull();
        treasury.close();
    });

    test('verified external-credit listing exposes all receipts sharing one source reference', () => {
        const treasury=store();
        const evidence={settlementId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'faction' as const,
            actorId:'guard',amountGp:10,sourceRef:'fine.collection-1',status:'committed' as const,
            occurredAt:'2026-09-20T10:00:00.000Z'};
        const first=treasury.creditExternalSettlement(evidence,()=>true);
        const second=treasury.creditExternalSettlement({...evidence,
            settlementId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},()=>true);
        expect(treasury.listExternalCredits()).toEqual([first,second]);
        treasury.close();
    });
});
