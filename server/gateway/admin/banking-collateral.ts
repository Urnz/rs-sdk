import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { InstitutionKind } from './institution-treasury.js';
import { BankingLoanStore } from './banking-loans.js';
import { listEngineProperties, requestEnginePropertyTransfer } from './properties.js';

export interface PropertyCollateralAdapter { verifyOwner(propertyId:string,owner:{kind:InstitutionKind;id:string}):Promise<{propertyId:string;owner:{kind:InstitutionKind;id:string};version:number}>;
    seize(request:{seizureId:string;propertyId:string;expectedVersion:number;from:{kind:InstitutionKind;id:string};to:{kind:'business';id:string}}):Promise<{seizureId:string;propertyId:string;owner:{kind:'business';id:string};version:number}> }
interface CollateralRow { loan_id:string;property_id:string;owner_kind:InstitutionKind;owner_id:string;property_version:number;bank_actor_id:string;status:'pledged'|'seizing'|'seized';seizure_id:string|null;created_at:string;updated_at:string }

export class EnginePropertyCollateralAdapter implements PropertyCollateralAdapter {
    async verifyOwner(propertyId:string,owner:{kind:InstitutionKind;id:string}) { const view=(await listEngineProperties()).properties.find(p=>p.propertyId===propertyId);
        if(!view?.state.owner)throw new Error('Collateral property does not have an owner');return{propertyId,owner:view.state.owner as {kind:InstitutionKind;id:string},version:view.state.version} }
    async seize(request:{seizureId:string;propertyId:string;expectedVersion:number;from:{kind:InstitutionKind;id:string};to:{kind:'business';id:string}}) {
        const result=await requestEnginePropertyTransfer({commandId:randomUUID(),transferId:request.seizureId,propertyId:request.propertyId,
            expectedVersion:request.expectedVersion,from:request.from,to:request.to});return{seizureId:result.transfer.transferId,
            propertyId:result.transfer.propertyId,owner:result.transfer.to as {kind:'business';id:string},version:result.transfer.version} }
}

export class BankingCollateralStore { private db:Database;
    constructor(path:string,private readonly loanPath:string=path){mkdirSync(dirname(path),{recursive:true});this.db=new Database(path,{create:true,strict:true});
        this.db.run('PRAGMA foreign_keys = ON');
        this.db.run(`CREATE TABLE IF NOT EXISTS bank_loan_collateral(loan_id TEXT PRIMARY KEY,property_id TEXT NOT NULL UNIQUE,
            owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,property_version INTEGER NOT NULL,bank_actor_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN('pledged','seizing','seized')),seizure_id TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`)}
    close(){this.db.close(true)}
    get(loanId:string){return this.db.query(`SELECT * FROM bank_loan_collateral WHERE loan_id=?1`).get(loanId) as CollateralRow|null}
    async pledge(loanId:string,propertyId:string,adapter:PropertyCollateralAdapter,now=new Date().toISOString()){const loans=new BankingLoanStore(this.loanPath);
        try{const loan=loans.get(loanId);if(!loan||!['approved','active'].includes(loan.status))throw new Error('Collateral requires an approved or active loan');
            const owner={kind:loan.borrowerKind,id:loan.borrowerActorId};const proof=await adapter.verifyOwner(propertyId,owner);
            if(proof.propertyId!==propertyId||proof.owner.kind!==owner.kind||proof.owner.id!==owner.id||!Number.isSafeInteger(proof.version))throw new Error('Property ownership proof does not match collateral');
            this.db.run(`INSERT INTO bank_loan_collateral VALUES(?1,?2,?3,?4,?5,?6,'pledged',NULL,?7,?7)`,[loanId,propertyId,owner.kind,owner.id,proof.version,loan.bankTreasuryActorId,now]);return this.get(loanId)}finally{loans.close()}}
    async seize(loanId:string,adapter:PropertyCollateralAdapter,now=new Date().toISOString()){const loans=new BankingLoanStore(this.loanPath);
        try{const loan=loans.get(loanId);if(!loan||loan.status!=='defaulted')throw new Error('Collateral requires a defaulted loan');const c=this.get(loanId);if(!c)throw new Error('Loan has no collateral');
            const seizureId=c.seizure_id??`loan-default:${loanId}`;if(c.status==='seized')return c;this.db.run(`UPDATE bank_loan_collateral SET status='seizing',seizure_id=?2,updated_at=?3 WHERE loan_id=?1 AND status='pledged'`,[loanId,seizureId,now]);
            const receipt=await adapter.seize({seizureId,propertyId:c.property_id,expectedVersion:c.property_version,from:{kind:c.owner_kind,id:c.owner_id},to:{kind:'business',id:c.bank_actor_id}});
            if(receipt.seizureId!==seizureId||receipt.propertyId!==c.property_id||receipt.owner.kind!=='business'||receipt.owner.id!==c.bank_actor_id||receipt.version<=c.property_version)throw new Error('Property seizure receipt does not match collateral');
            this.db.run(`UPDATE bank_loan_collateral SET status='seized',property_version=?2,updated_at=?3 WHERE loan_id=?1 AND status='seizing'`,[loanId,receipt.version,now]);return this.get(loanId)}finally{loans.close()}}
}
