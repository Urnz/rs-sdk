import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {XpExecutionStore} from './XpExecutionStore.js';
import {xpExecutionPolicyDigest,type XpExecutionArmRequest} from '../../../../society-experiments/xp-execution.js';
import type {XpStateSnapshot} from '../../../../society-experiments/xp-state.js';
import type {XpActivityContext} from './DiminishingXp.js';
export const xpExecutionJournalPath=fileURLToPath(new URL('../../../../.local/admin/xp-execution.sqlite',import.meta.url));
let store:XpExecutionStore|null=null;
function journal(create=false){
    if(!store && (create||existsSync(xpExecutionJournalPath)))store=new XpExecutionStore(xpExecutionJournalPath);
    return store;
}
export function armNativeXpExecution(request:XpExecutionArmRequest,snapshot:XpStateSnapshot,policy:Parameters<typeof xpExecutionPolicyDigest>[0],calibration:Parameters<typeof xpExecutionPolicyDigest>[1]=null){
    return journal(true)!.arm(request,snapshot,xpExecutionPolicyDigest(policy,calibration));
}
export function sealNativeXpExecution(id:string){
    const current=journal();if(!current)throw new Error('Native XP execution journal unavailable');return current.seal(id);
}
export function readNativeXpExecution(id:string){
    if(!existsSync(xpExecutionJournalPath))return null;
    const source=new XpExecutionStore(xpExecutionJournalPath,true);try{return source.get(id);}finally{source.close();}
}
export function observeNativeXpExecution(player:string,skill:string,context:XpActivityContext,inputXp:number,
    policy:Parameters<typeof xpExecutionPolicyDigest>[0],capture:()=>XpStateSnapshot,execute:(strict:boolean)=>number,calibration:Parameters<typeof xpExecutionPolicyDigest>[1]=null){
    try{return journal()?.observe(player,skill,context,inputXp,xpExecutionPolicyDigest(policy,calibration),capture,execute)??execute(false);}
    catch(error){
        // A broken evidence journal cannot safely distinguish armed from unarmed players after restart.
        console.error('[XpExecution] XP calculation rejected:',error instanceof Error?error.message:'Native evidence failure');return 0;
    }
}
