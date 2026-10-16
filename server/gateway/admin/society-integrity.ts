import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { SocietyIntegrityStore, type IntegrityMutation } from '../../../society-integrity/store.js';
import { societyIntegrityDbPath, nativeSocietyValuePaths, nativeSocietyPathMatches, initializeNativeSocietyObserver } from '../../../society-integrity/runtime.js';

/** Called only by the native settlement coordinator; callers cannot submit an origin label. */
export function bindSocietyInternalPayment(input:{settlementId:string;username:string;amountGp:number;reservationId:string;
    treasuryPath:string},phase:'reserve'|'commit',integrityPath=societyIntegrityDbPath) {
    if(nativeSocietyPathMatches(integrityPath,societyIntegrityDbPath)) {
        if(!nativeSocietyPathMatches(input.treasuryPath,nativeSocietyValuePaths.treasury))return;
        initializeNativeSocietyObserver();
    }
    if(!existsSync(integrityPath))return;
    const integrity=new SocietyIntegrityStore(integrityPath);
    try {
        if(!integrity.active().length && phase==='reserve')return;
        const db=new Database(input.treasuryPath,{readonly:true,strict:true});
        try {
            const row=db.query(`SELECT r.*,t.balance_gp,t.reserved_gp FROM institution_treasury_reservation r
                JOIN institution_treasury t ON t.actor_kind=r.actor_kind AND t.actor_id=r.actor_id WHERE reservation_id=?1`)
                .get(input.reservationId) as {settlement_id:string;amount_gp:number;status:string;actor_kind:string;actor_id:string;
                    balance_gp:number;reserved_gp:number}|null;
            if(!row || row.settlement_id!==input.settlementId || row.amount_gp!==input.amountGp
                || (phase==='reserve' && row.status!=='committed' && (row.status!=='reserved' || row.reserved_gp<input.amountGp || row.balance_gp<row.reserved_gp))
                || (phase==='commit' && row.status!=='committed'))throw new Error('Society payment lacks exact native treasury backing');
            const mutation:IntegrityMutation={source:'engine.player-reward',operationId:`player-reward:${input.settlementId}`,
                actor:`player:${input.username.toLowerCase()}`,payload:{amountGp:input.amountGp}};
            const backing={reservationId:input.reservationId,settlementId:input.settlementId,amountGp:row.amount_gp,
                payerKind:row.actor_kind,payerId:row.actor_id};
            if(phase==='reserve' && row.status==='committed' && !integrity.hasTransferBinding(mutation,backing))
                throw new Error('Committed transfer has no previously observed society backing');
            if(phase==='reserve')integrity.authorizeTransfer(mutation,backing);
            else integrity.completeTransfer(mutation,backing);
        }finally{(db as Database & {clearQueryCache():void}).clearQueryCache();db.close(true);}
    }finally{integrity.close();}
}
