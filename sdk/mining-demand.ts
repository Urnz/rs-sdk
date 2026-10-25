import type { SocietyFoodContext } from './society-food.js';
export interface MiningDemandContext extends SocietyFoodContext {operationSequence:number}
export interface MiningGatherArgs {
    name:string;match:'contains'|'exact';option:'mine'|1|3;item:'copper ore'|'tin ore';skill:'Mining';timeoutMs:number;maxRetargets:number;
}
export interface MiningDemandRequest {operation:'open'|'close';args:MiningGatherArgs;context:MiningDemandContext}
export interface NativeMiningDemandCommand {operation:'open'|'close';demandId:string;username:string;contextDigest:string}
export function isMiningDemandGather(operation:string,args:Record<string,unknown>){
    return operation==='gather-loc'&&args.skill==='Mining'&&(args.item==='copper ore'||args.item==='tin ore');
}
export function miningGatherArgs(args:Record<string,unknown>):MiningGatherArgs{
    const {name,item,skill,match='contains',option=1,timeoutMs=15000,maxRetargets=20}=args;
    if(!args||Object.keys(args).some(k=>!['name','match','option','item','skill','timeoutMs','maxRetargets'].includes(k))
        ||typeof name!=='string'||name.length<1||name.length>200||!['copper ore','tin ore'].includes(String(item))||skill!=='Mining'
        ||!['contains','exact'].includes(String(match))||!['mine',1,3].includes(option as string|number)
        ||!Number.isSafeInteger(timeoutMs)||Number(timeoutMs)<100||Number(timeoutMs)>300000
        ||!Number.isSafeInteger(maxRetargets)||Number(maxRetargets)<1||Number(maxRetargets)>100)throw Error('Invalid bounded Mining gather arguments');
    return {name,item,skill,match,option,timeoutMs,maxRetargets} as MiningGatherArgs;
}
export function validateMiningDemandRequest(value:MiningDemandRequest):MiningDemandRequest{
    const {operation,args,context}=value??{};
    if(!value||Object.keys(value).sort().join(',')!=='args,context,operation'||!['open','close'].includes(operation)||!context
        ||Object.keys(context).sort().join(',')!=='operationSequence,parametersDigest,runId,skill,stepId'
        ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(context.runId)
        ||!Number.isSafeInteger(context.operationSequence)||context.operationSequence<1||context.operationSequence>100000
        ||!/^[a-f0-9]{64}$/.test(context.parametersDigest)||!/^[a-zA-Z0-9._/-]{1,200}$/.test(context.stepId)
        ||!context.skill||Object.keys(context.skill).sort().join(',')!=='id,version'
        ||!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(context.skill.id)||!/^\d+\.\d+\.\d+$/.test(context.skill.version))throw Error('Invalid Mining demand request');
    return{operation,args:miningGatherArgs(args as unknown as Record<string,unknown>),context:structuredClone(context)};
}
