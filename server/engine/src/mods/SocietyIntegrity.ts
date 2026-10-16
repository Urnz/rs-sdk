import { randomUUID } from 'node:crypto';
import { withSocietyValueMutation } from '../../../../society-integrity/runtime.js';
export function grantSocietyCheatValue(username:string,itemId:number,count:number,add:()=>number):number {
    return withSocietyValueMutation({source:'engine.cheat-value',operationId:`cheat-value:${randomUUID()}`,
        actor:`player:${username}`,payload:{itemId,requestedCount:count}},add,undefined,result=>result>0);
}
export function executeSocietyDebugProc<T>(username:string,script:string,execute:()=>T):T {
    return withSocietyValueMutation({source:'engine.debugproc',operationId:`debugproc:${randomUUID()}`,
        actor:`player:${username}`,payload:{script,assistance:'unquantified-privileged-script'}},execute);
}
