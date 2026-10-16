import {validateXpStateSnapshot,xpCohort} from '../../../society-experiments/xp-state.js';
export function xpBaselineClient(origin=process.env.ENGINE_ADMIN_URL?.trim()||'http://localhost:8888',
    token=process.env.ENGINE_ADMIN_TOKEN?.trim()||'',fetcher:(url:URL,init:RequestInit)=>Promise<Response>=fetch){
    const base=new URL(origin);
    if(base.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(base.hostname) || base.username || base.password
        || base.pathname!=='/' || base.search || base.hash)throw new Error('XP baseline requires the local/private engine');
    return async(cohort:string[],command?:unknown)=>{
        const names=xpCohort(cohort);if(!token)throw new Error('Engine admin token is required');
        const url=new URL('/api/internal/admin/xp-baseline',base);if(command===undefined)for(const name of names)url.searchParams.append('player',name);
        const response=await fetcher(url,{method:command===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(5000),
            headers:{'X-Engine-Admin-Token':token,'Content-Type':'application/json'},...(command===undefined?{}:{body:JSON.stringify(command)})});
        const result=await response.json();if(!response.ok)throw new Error(result?.error||`XP baseline engine HTTP ${response.status}`);
        if(command===undefined)return validateXpStateSnapshot(result,names);
        validateXpStateSnapshot(result.snapshot,names);return result;
    };
}
