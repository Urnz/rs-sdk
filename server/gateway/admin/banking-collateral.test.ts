import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BankingCollateralStore, type PropertyCollateralAdapter } from './banking-collateral.js';
import { BankingLoanStore } from './banking-loans.js';
import type { InstitutionSettlementRecord } from './institution-settlement-orchestrator.js';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})});
function disbursement():InstitutionSettlementRecord{return{domain:'banking',eventId:'loan.disbursed.1',eventKind:'loan-disbursed',sourceRef:'bank:1',eventDigest:'a'.repeat(64),verifiedAt:'2026-01-01T00:00:00.000Z',settlementId:'11111111-1111-4111-8111-111111111111',reservationId:'loan.disburse.1',payerKind:'business',payerActorId:'bank',payeeKind:'business',payeeActorId:'forge',amountGp:100,status:'committed',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}}
describe('loan collateral',()=>{test('reads default from the loan ledger and seizes an exact workshop once',async()=>{const root=mkdtempSync(join(tmpdir(),'collateral-'));dirs.push(root);const path=join(root,'db.sqlite');
    const loans=new BankingLoanStore(path);loans.create({loanId:'loan-1',bankId:'varrock',bankTreasuryActorId:'bank',borrowerKind:'business',borrowerActorId:'forge',principalGp:100,annualInterestBps:0,termDays:1},'2026-01-01T00:00:00.000Z');
    const collateral=new BankingCollateralStore(path);let seizures=0;const adapter:PropertyCollateralAdapter={verifyOwner:async(propertyId,owner)=>({propertyId,owner,version:3}),seize:async request=>{seizures++;return{seizureId:request.seizureId,propertyId:request.propertyId,owner:request.to,version:4}}};
    await collateral.pledge('loan-1','varrock.east-workshop',adapter);await expect(collateral.seize('loan-1',adapter)).rejects.toThrow('defaulted');
    loans.disburse('loan-1',disbursement());const overdue=loans.accrue('loan-1','2026-01-03T00:00:00.000Z');loans.defaultLoan('loan-1',overdue.revision);
    expect(await collateral.seize('loan-1',adapter)).toMatchObject({status:'seized'});await collateral.seize('loan-1',adapter);expect(seizures).toBe(1);collateral.close();loans.close()})});
