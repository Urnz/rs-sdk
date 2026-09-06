import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BankingSettlementService, type BankingCompletionSource } from './banking-events.js';
import { BankingLoanStore } from './banking-loans.js';
import { BankingCollateralStore, type PropertyCollateralAdapter } from './banking-collateral.js';
import { InstitutionTreasuryStore } from './institution-treasury.js';
const dirs:string[]=[];afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})});

describe('phase 13 banking MVP',()=>{test('reopens the full verified loan to workshop seizure lifecycle',async()=>{
    const root=mkdtempSync(join(tmpdir(),'banking-mvp-'));dirs.push(root);const path=join(root,'economy.sqlite');const at='2026-01-01T00:00:00.000Z';
    const treasury=new InstitutionTreasuryStore(path);const bank=treasury.ensure('business','bank-of-varrock',at);treasury.setBalance('business','bank-of-varrock',bank.revision,1000,at);treasury.ensure('business','forge',at);treasury.reserve('business','bank-of-varrock','bank.loan.loan-1',100,at);treasury.close();
    const loans=new BankingLoanStore(path);loans.create({loanId:'loan-1',bankId:'varrock-bank',bankTreasuryActorId:'bank-of-varrock',borrowerKind:'business',borrowerActorId:'forge',principalGp:100,annualInterestBps:0,termDays:1},at);loans.close();
    const request={eventId:'bank.loan-disbursed.loan-1',eventKind:'loan-disbursed',sourceRef:'bank-core:loan-1',settlementId:'11111111-1111-4111-8111-111111111111',reservationId:'bank.loan.loan-1',payerKind:'business' as const,payerActorId:'bank-of-varrock',payeeKind:'business' as const,payeeActorId:'forge',amountGp:100};
    const source:BankingCompletionSource={verify:async evidence=>({eventId:evidence.eventId,eventDigest:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),verifiedAt:at})};
    const service=new BankingSettlementService(path);const settled=await service.settle(request,source,at);
    await expect(service.settle(request,{verify:async evidence=>({eventId:evidence.eventId,eventDigest:'f'.repeat(64),verifiedAt:at})},at)).rejects.toThrow('changed after verification');
    const reopenedLoans=new BankingLoanStore(path);reopenedLoans.disburse('loan-1',settled.settlement);
    const adapter:PropertyCollateralAdapter={verifyOwner:async(propertyId,owner)=>({propertyId,owner,version:7}),seize:async r=>({seizureId:r.seizureId,propertyId:r.propertyId,owner:r.to,version:r.expectedVersion+1})};
    const collateral=new BankingCollateralStore(path);await collateral.pledge('loan-1','varrock.east-workshop',adapter,at);collateral.close();reopenedLoans.close();
    const afterRestart=new BankingLoanStore(path);const overdue=afterRestart.accrue('loan-1','2026-01-03T00:00:00.000Z');afterRestart.defaultLoan('loan-1',overdue.revision);afterRestart.close();
    const reopenedCollateral=new BankingCollateralStore(path);expect(await reopenedCollateral.seize('loan-1',adapter)).toMatchObject({status:'seized',property_id:'varrock.east-workshop'});reopenedCollateral.close();
    const finalTreasury=new InstitutionTreasuryStore(path);expect(finalTreasury.get('business','bank-of-varrock')?.balanceGp).toBe(900);expect(finalTreasury.get('business','forge')?.balanceGp).toBe(100);finalTreasury.close();
});});
