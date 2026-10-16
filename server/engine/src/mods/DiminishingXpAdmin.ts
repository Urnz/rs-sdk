import {xpCohort} from '../../../../society-experiments/xp-state.js';
import type {DiminishingXpStore} from './DiminishingXp.js';
export interface XpBaselineAdminDependencies {
    capture(cohort:string[]):ReturnType<DiminishingXpStore['snapshot']>;
    apply(command:Parameters<DiminishingXpStore['applyBaseline']>[0]):ReturnType<DiminishingXpStore['applyBaseline']>;
    offline(username:string):boolean;
    assertResetAllowed():void;
}
/** Authentication is owned by the internal-admin router; paths and snapshot uploads are never accepted. */
export async function handleXpBaselineAdmin(req:Request,url:URL,deps:XpBaselineAdminDependencies):Promise<Response>{
    const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    try{
        if(req.method==='GET')return json(deps.capture(xpCohort(url.searchParams.getAll('player'))));
        if(req.method!=='POST')return json({error:'Method not allowed'},405);
        const raw=await req.text();if(raw.length>16000)return json({error:'Request too large'},413);
        const body=JSON.parse(raw);
        if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).sort().join(',')!=='cohort,commandId,expectedStoreDigest,kind,reason,sourceCommandId')
            throw new Error('Invalid XP baseline command fields');
        const cohort=xpCohort(body.cohort);
        // All checks and the engine mutation are synchronous after parsing; login/ticks cannot interleave.
        for(const name of cohort)if(!deps.offline(name))throw new Error(`XP baseline player must be offline: ${name}`);
        deps.assertResetAllowed();return json(deps.apply({...body,cohort}));
    }catch(error){return json({error:error instanceof Error?error.message:'XP baseline operation failed'},409);}
}
