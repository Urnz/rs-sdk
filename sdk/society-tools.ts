import type { SocietyFoodContext } from './society-food.js';
export type SocietyToolOperation='tool-smelt-bronze'|'tool-repair';
export interface SocietyToolRequest {operation:SocietyToolOperation;args:Record<string,unknown>;context:SocietyFoodContext}
export function validateSocietyToolRequest(value:SocietyToolRequest):SocietyToolRequest{
    const{operation,args,context}=value??{},fields=operation==='tool-smelt-bronze'?['timeoutMs']:operation==='tool-repair'?['businessId','timeoutMs']:[];
    if(Object.keys(value??{}).sort().join(',')!=='args,context,operation'||!fields.length||!args||Array.isArray(args)
        ||Object.keys(args).sort().join(',')!==fields.sort().join(',')||!Number.isSafeInteger(args.timeoutMs)
        ||Number(args.timeoutMs)<100||Number(args.timeoutMs)>60000
        ||(operation==='tool-repair'&&(typeof args.businessId!=='string'||!/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(args.businessId)))
        ||!context||Object.keys(context).sort().join(',')!=='parametersDigest,runId,skill,stepId'
        ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(context.runId)
        ||!/^[a-f0-9]{64}$/.test(context.parametersDigest)||!/^[a-zA-Z0-9._/-]{1,200}$/.test(context.stepId)
        ||!context.skill||Object.keys(context.skill).sort().join(',')!=='id,version'
        ||!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(context.skill.id)||!/^\d+\.\d+\.\d+$/.test(context.skill.version))
        throw new Error('Invalid bounded society tool request');
    return structuredClone(value);
}
