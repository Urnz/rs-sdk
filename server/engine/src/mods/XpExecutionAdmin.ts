import {validateXpExecutionArm,type XpExecutionPort,type XpExecutionReport} from '../../../../society-experiments/xp-execution.js';
export async function handleXpExecutionAdmin(req:Request,url:URL,deps:XpExecutionPort&{read(id:string):XpExecutionReport|null}){
    const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    const id=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))throw new Error('Invalid XP experiment identity');return value;};
    try{
        if(req.method==='GET')return json(deps.read(id(url.searchParams.get('id'))));
        if(req.method!=='POST')return json({error:'Method not allowed'},405);
        const text=await req.text();if(text.length>16000)return json({error:'Request too large'},413);
        const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid XP execution request');
        if(body.action==='arm' && Object.keys(body).sort().join(',')==='action,request')return json(await deps.arm(validateXpExecutionArm(body.request)));
        if(body.action==='seal' && Object.keys(body).sort().join(',')==='action,experimentId')return json(await deps.seal(id(body.experimentId)));
        throw new Error('Invalid XP execution fields');
    }catch(error){return json({error:error instanceof Error?error.message:'XP execution request failed'},409);}
}
