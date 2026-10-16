import {validateXpExecutionArm,validateXpExecutionReport,type XpExecutionPort} from '../../../society-experiments/xp-execution.js';
export function xpExecutionClient(origin=process.env.ENGINE_ADMIN_URL?.trim()||'http://localhost:8888',token=process.env.ENGINE_ADMIN_TOKEN?.trim()||'',
    fetcher:(url:URL,init:RequestInit)=>Promise<Response>=fetch):XpExecutionPort&{read(id:string):Promise<ReturnType<typeof validateXpExecutionReport>|null>}{
    const base=new URL(origin);
    if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)
        throw new Error('XP execution requires the local/private engine');
    const call=async(body?:unknown,id?:string)=>{
        if(!token)throw new Error('Engine admin token is required');
        const url=new URL('/api/internal/admin/xp-execution',base);if(id)url.searchParams.set('id',id);
        const response=await fetcher(url,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(5000),
            headers:{'X-Engine-Admin-Token':token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
        const value=await response.json();if(!response.ok)throw new Error(value?.error||`XP execution engine HTTP ${response.status}`);
        return value===null?null:validateXpExecutionReport(value);
    };
    return {arm:async request=>{const result=await call({action:'arm',request:validateXpExecutionArm(request)});if(!result)throw new Error('XP execution arm unavailable');return result;},
        seal:async experimentId=>{const result=await call({action:'seal',experimentId});if(!result)throw new Error('XP execution seal unavailable');return result;},
        read:async id=>call(undefined,id)};
}
