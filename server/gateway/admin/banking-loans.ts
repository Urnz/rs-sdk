import { mkdirSync } from 'node:fs'; import { dirname } from 'node:path'; import { Database } from 'bun:sqlite';
import type { InstitutionKind } from './institution-treasury.js';
import type { InstitutionSettlementRecord } from './institution-settlement-orchestrator.js';
export type BankLoanStatus = 'approved'|'active'|'overdue'|'defaulted'|'repaid';
export interface BankLoan { loanId:string; bankId:string; bankTreasuryActorId:string; borrowerKind:InstitutionKind;
    borrowerActorId:string; principalGp:number; principalOutstandingGp:number; interestOutstandingGp:number;
    annualInterestBps:number; termDays:number; originatedAt:string; dueAt:string; interestAccruedThrough:string;
    status:BankLoanStatus; revision:number }
interface Row { loan_id:string; bank_id:string; bank_treasury_actor_id:string; borrower_kind:InstitutionKind;
    borrower_actor_id:string; principal_gp:number; principal_outstanding_gp:number; interest_outstanding_gp:number;
    annual_interest_bps:number; term_days:number; originated_at:string; due_at:string; interest_accrued_through:string;
    status:BankLoanStatus; revision:number }
const DAY=86_400_000;
function ident(v:string,label:string){const n=v.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(n))throw new Error(`${label} is invalid`);return n}
function loan(r:Row):BankLoan{return{loanId:r.loan_id,bankId:r.bank_id,bankTreasuryActorId:r.bank_treasury_actor_id,
    borrowerKind:r.borrower_kind,borrowerActorId:r.borrower_actor_id,principalGp:r.principal_gp,
    principalOutstandingGp:r.principal_outstanding_gp,interestOutstandingGp:r.interest_outstanding_gp,
    annualInterestBps:r.annual_interest_bps,termDays:r.term_days,originatedAt:r.originated_at,dueAt:r.due_at,
    interestAccruedThrough:r.interest_accrued_through,status:r.status,revision:r.revision}}
export class BankingLoanStore{
    private db:Database;
    constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.db=new Database(path,{create:true,strict:true});
        this.db.run('PRAGMA foreign_keys = ON');
        this.db.run(`CREATE TABLE IF NOT EXISTS bank_loan (loan_id TEXT PRIMARY KEY, bank_id TEXT NOT NULL,
            bank_treasury_actor_id TEXT NOT NULL, borrower_kind TEXT NOT NULL CHECK(borrower_kind IN ('business','faction')),
            borrower_actor_id TEXT NOT NULL, principal_gp INTEGER NOT NULL CHECK(principal_gp>0),
            principal_outstanding_gp INTEGER NOT NULL CHECK(principal_outstanding_gp>=0), interest_outstanding_gp INTEGER NOT NULL CHECK(interest_outstanding_gp>=0),
            annual_interest_bps INTEGER NOT NULL CHECK(annual_interest_bps BETWEEN 0 AND 10000), term_days INTEGER NOT NULL CHECK(term_days BETWEEN 1 AND 3650),
            originated_at TEXT NOT NULL, due_at TEXT NOT NULL, interest_accrued_through TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('approved','active','overdue','defaulted','repaid')), revision INTEGER NOT NULL)`);
        this.db.run(`CREATE TABLE IF NOT EXISTS bank_loan_payment (settlement_id TEXT PRIMARY KEY, loan_id TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE, event_digest TEXT NOT NULL, amount_gp INTEGER NOT NULL,
            interest_gp INTEGER NOT NULL, principal_gp INTEGER NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY(loan_id) REFERENCES bank_loan(loan_id))`);
        this.db.run(`CREATE TABLE IF NOT EXISTS bank_loan_disbursement (loan_id TEXT PRIMARY KEY,
            settlement_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,event_digest TEXT NOT NULL,
            amount_gp INTEGER NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(loan_id) REFERENCES bank_loan(loan_id))`)}
    close(){this.db.close(true)}
    get(idInput:string){const r=this.db.query(`SELECT * FROM bank_loan WHERE loan_id=?1`).get(ident(idInput,'Loan id')) as Row|null;return r?loan(r):null}
    create(input:{loanId:string;bankId:string;bankTreasuryActorId:string;borrowerKind:InstitutionKind;borrowerActorId:string;
        principalGp:number;annualInterestBps:number;termDays:number},now=new Date().toISOString()):BankLoan{
        if(!Number.isSafeInteger(input.principalGp)||input.principalGp<1||input.principalGp>2_147_483_647)throw new Error('Loan principal is invalid');
        if(!Number.isSafeInteger(input.annualInterestBps)||input.annualInterestBps<0||input.annualInterestBps>10_000)throw new Error('Loan interest is invalid');
        if(!Number.isSafeInteger(input.termDays)||input.termDays<1||input.termDays>3650)throw new Error('Loan term is invalid');
        const due=new Date(Date.parse(now)+input.termDays*DAY).toISOString();this.db.run(`INSERT INTO bank_loan VALUES(?1,?2,?3,?4,?5,?6,0,0,?7,?8,?9,?10,?9,'approved',1)`,
            [ident(input.loanId,'Loan id'),ident(input.bankId,'Bank id'),ident(input.bankTreasuryActorId,'Bank treasury actor id'),input.borrowerKind,
                ident(input.borrowerActorId,'Borrower id'),input.principalGp,input.annualInterestBps,input.termDays,now,due]);return this.get(input.loanId)!}
    disburse(loanId:string,s:InstitutionSettlementRecord):BankLoan{const l=this.get(loanId);if(!l)throw new Error('Loan does not exist');
        const old=this.db.query(`SELECT settlement_id,event_id,event_digest,amount_gp FROM bank_loan_disbursement WHERE loan_id=?1`).get(l.loanId) as {settlement_id:string;event_id:string;event_digest:string;amount_gp:number}|null;
        if(old){if(old.settlement_id!==s.settlementId||old.event_id!==s.eventId||old.event_digest!==s.eventDigest||old.amount_gp!==s.amountGp)throw new Error('Loan disbursement changed after posting');return l}
        if(l.status!=='approved')throw new Error('Active loan has no immutable disbursement receipt');if(s.domain!=='banking'||s.status!=='committed'||s.eventKind!=='loan-disbursed'||s.amountGp!==l.principalGp
            ||s.payerKind!=='business'||s.payerActorId!==l.bankTreasuryActorId||s.payeeKind!==l.borrowerKind||s.payeeActorId!==l.borrowerActorId)throw new Error('Loan disbursement receipt does not match');
        const tx=this.db.transaction(()=>{this.db.run(`INSERT INTO bank_loan_disbursement VALUES(?1,?2,?3,?4,?5,?6)`,[l.loanId,s.settlementId,s.eventId,s.eventDigest,s.amountGp,s.updatedAt]);
            this.db.run(`UPDATE bank_loan SET principal_outstanding_gp=principal_gp,status='active',revision=revision+1 WHERE loan_id=?1 AND status='approved'`,[l.loanId])});tx.immediate();return this.get(l.loanId)!}
    accrue(loanId:string,asOf:string):BankLoan{const l=this.get(loanId);if(!l)throw new Error('Loan does not exist');if(l.status==='approved'||l.status==='repaid')return l;
        const days=Math.floor((Date.parse(asOf)-Date.parse(l.interestAccruedThrough))/DAY);if(days<=0)return l;
        const interest=Math.floor(l.principalOutstandingGp*l.annualInterestBps*days/(10_000*365));const nextStatus=Date.parse(asOf)>Date.parse(l.dueAt)&&l.principalOutstandingGp+l.interestOutstandingGp+interest>0?'overdue':l.status;
        this.db.run(`UPDATE bank_loan SET interest_outstanding_gp=interest_outstanding_gp+?2,interest_accrued_through=?3,status=?4,revision=revision+1 WHERE loan_id=?1`,[l.loanId,interest,new Date(Date.parse(l.interestAccruedThrough)+days*DAY).toISOString(),nextStatus]);return this.get(l.loanId)!}
    repay(loanId:string,s:InstitutionSettlementRecord,now=new Date().toISOString()):BankLoan{let l=this.get(loanId);if(!l)throw new Error('Loan does not exist');
        const old=this.db.query(`SELECT amount_gp,event_digest FROM bank_loan_payment WHERE settlement_id=?1`).get(s.settlementId) as {amount_gp:number;event_digest:string}|null;
        if(old){if(old.amount_gp!==s.amountGp||old.event_digest!==s.eventDigest)throw new Error('Loan repayment changed after posting');return l}l=this.accrue(loanId,now);
        if(s.domain!=='banking'||s.status!=='committed'||s.eventKind!=='repayment-cleared'||s.payerKind!==l.borrowerKind||s.payerActorId!==l.borrowerActorId
            ||s.payeeKind!=='business'||s.payeeActorId!==l.bankTreasuryActorId)throw new Error('Loan repayment receipt does not match');
        const owed=l.principalOutstandingGp+l.interestOutstandingGp;if(s.amountGp>owed)throw new Error('Loan repayment exceeds amount due');
        const interest=Math.min(s.amountGp,l.interestOutstandingGp),principal=s.amountGp-interest;
        const tx=this.db.transaction(()=>{this.db.run(`INSERT INTO bank_loan_payment VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,[s.settlementId,l.loanId,s.eventId,s.eventDigest,s.amountGp,interest,principal,now]);
            this.db.run(`UPDATE bank_loan SET interest_outstanding_gp=interest_outstanding_gp-?2,principal_outstanding_gp=principal_outstanding_gp-?3,
                status=CASE WHEN interest_outstanding_gp-?2+principal_outstanding_gp-?3=0 THEN 'repaid' ELSE status END,revision=revision+1 WHERE loan_id=?1`,[l.loanId,interest,principal])});tx.immediate();return this.get(l.loanId)!}
    defaultLoan(loanId:string,expectedRevision:number):BankLoan{const l=this.get(loanId);if(!l)throw new Error('Loan does not exist');if(l.status==='defaulted')return l;
        if(l.status!=='overdue')throw new Error('Only an overdue loan may default');const changed=this.db.run(`UPDATE bank_loan SET status='defaulted',revision=revision+1 WHERE loan_id=?1 AND revision=?2 AND status='overdue'`,[l.loanId,expectedRevision]);
        if(changed.changes!==1)throw new Error('Loan changed before default');return this.get(l.loanId)!}
}
