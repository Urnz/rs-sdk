import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { Database } from 'bun:sqlite';
import { BankingLedgerStore } from './banking-ledger.js';
import { SimulationClockStore } from '../../../simulation-clock/store.js';
import type { InstitutionSettlementRecord } from './institution-settlement-orchestrator.js';
const dirs: string[] = []; afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) });
function setup() { const root = mkdtempSync(join(tmpdir(), 'bank-ledger-')); dirs.push(root); const store = new BankingLedgerStore(join(root, 'bank.sqlite'));
    store.createBank('varrock-bank', 'bank-of-varrock', 2_000, 100); store.openAccount('varrock-bank', 'forge-deposit', 'business', 'varrock-forge'); return store }
function receipt(kind: 'deposit-cleared'|'withdrawal-approved'|'interest-accrued', amountGp: number, n: string): InstitutionSettlementRecord {
    const outgoing = kind === 'deposit-cleared'; return { domain: 'banking', eventId: `bank.event.${n}`, eventKind: kind, sourceRef: `bank-journal:${n}`,
        eventDigest: n.repeat(64).slice(0,64), verifiedAt: '2026-09-06T08:00:00.000Z', settlementId: `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`,
        reservationId: `bank.reservation.${n}`, payerKind: 'business', payerActorId: outgoing ? 'varrock-forge' : 'bank-of-varrock',
        payeeKind: 'business', payeeActorId: outgoing ? 'bank-of-varrock' : 'varrock-forge', amountGp, status: 'committed',
        createdAt: '2026-09-06T08:00:00.000Z', updatedAt: '2026-09-06T08:00:00.000Z' } }
describe('banking ledger', () => {
    test('posts balanced deposit and interest entries idempotently and computes reserves', () => { const store = setup();
        const deposited = store.postSettlement('forge-deposit', 'deposit', receipt('deposit-cleared', 1_000, '1'));
        store.postSettlement('forge-deposit', 'deposit', receipt('deposit-cleared', 1_000, '1'));
        store.postSettlement('forge-deposit', 'interest', receipt('interest-accrued', 10, '2'));
        expect(deposited).toMatchObject({ debitAccount: 'asset:treasury:bank-of-varrock', creditAccount: 'liability:deposit:forge-deposit' });
        expect(store.getAccount('forge-deposit')).toMatchObject({ balanceGp: 1_010, revision: 3 });
        expect(store.listJournal()).toHaveLength(2); expect(store.listPostings(deposited.transactionId)).toEqual([
            expect.objectContaining({side:'credit',amountGp:1_000}),expect.objectContaining({side:'debit',amountGp:1_000})]);
        expect(store.verifyAuditChain()).toMatchObject({valid:true,entries:2}); expect(store.reservePosition('varrock-bank', 250)).toEqual({ depositsGp: 1_010,
            cashGp: 250, requiredReserveGp: 202, excessReserveGp: 48, reserveRatioBps: 2_000, compliant: true }); store.close() });
    test('posts withdrawals and rejects overdrafts or mismatched parties', () => { const store = setup();
        store.postSettlement('forge-deposit', 'deposit', receipt('deposit-cleared', 100, '3'));
        store.postSettlement('forge-deposit', 'withdrawal', receipt('withdrawal-approved', 40, '4'));
        expect(store.getAccount('forge-deposit')?.balanceGp).toBe(60);
        expect(() => store.postSettlement('forge-deposit', 'withdrawal', receipt('withdrawal-approved', 61, '5'))).toThrow('insufficient');
        expect(() => store.postSettlement('forge-deposit', 'deposit', receipt('interest-accrued', 1, '6'))).toThrow('kind'); store.close() });
    test('detects a missing audit link instead of validating a partial chain',()=>{const root=mkdtempSync(join(tmpdir(),'bank-audit-'));dirs.push(root);const path=join(root,'bank.sqlite');const store=new BankingLedgerStore(path);
        store.createBank('varrock-bank','bank-of-varrock',2000,100);store.openAccount('varrock-bank','forge-deposit','business','varrock-forge');store.postSettlement('forge-deposit','deposit',receipt('deposit-cleared',100,'7'));store.close();
        const db=new Database(path);db.run(`PRAGMA foreign_keys=OFF`);db.run(`DELETE FROM bank_audit_chain`);db.close();const reopened=new BankingLedgerStore(path);expect(reopened.verifyAuditChain().valid).toBeFalse();reopened.close()});
    test('migrates and backfills journal entries onto the shared simulation timeline without changing audit history',()=>{
        const root=mkdtempSync(join(tmpdir(),'bank-clock-'));dirs.push(root);const path=join(root,'bank.sqlite');
        const legacy=new BankingLedgerStore(path);legacy.createBank('varrock-bank','bank-of-varrock',2000,100);
        legacy.openAccount('varrock-bank','forge-deposit','business','varrock-forge');
        const deposit=legacy.postSettlement('forge-deposit','deposit',receipt('deposit-cleared',100,'8'),'2026-09-06T08:00:00.000Z');
        expect(deposit.simulationStamp).toBeNull();const auditHead=legacy.verifyAuditChain().headHash;legacy.close();
        const clock=new SimulationClockStore(join(root,'clock.sqlite'));clock.create({clockId:'world',profile:{schemaVersion:1,
            profileId:'bank-test',version:'1.0.0',seed:'bank-test',rate:{simulationMilliseconds:2,wallMilliseconds:1}},
        wallTime:'2026-09-06T09:00:00.000Z',simulationTime:'2030-01-01T00:00:00.000Z'});
        const store=new BankingLedgerStore(path,{store:clock,clockId:'world',engineTick:()=>120});
        const imported=store.listJournal()[0]!;expect(imported.createdAt).toBe('2026-09-06T08:00:00.000Z');
        expect(imported.simulationStamp).toMatchObject({sequence:1,engineTick:120,
            wallTime:'2026-09-06T09:00:00.000Z',simulationTime:'2030-01-01T00:00:00.000Z'});
        expect(store.verifyAuditChain()).toMatchObject({valid:true,headHash:auditHead});
        expect(store.postSettlement('forge-deposit','deposit',receipt('deposit-cleared',100,'8'))
            .simulationStamp??null).toEqual(imported.simulationStamp??null);
        store.postSettlement('forge-deposit','interest',receipt('interest-accrued',10,'9'),'2026-09-06T09:00:10.000Z');
        expect(store.listJournal().map(item=>item.simulationStamp?.sequence)).toEqual([1,2]);
        expect(store.verifyAuditChain().valid).toBeTrue();expect(clock.get('world')?.nextEventSequence).toBe(3);
        store.close();clock.close();
        const migrated=new Database(path);expect(migrated.query(`SELECT version FROM banking_ledger_schema WHERE singleton=1`).get())
            .toEqual({version:1});migrated.close();
    });
});
