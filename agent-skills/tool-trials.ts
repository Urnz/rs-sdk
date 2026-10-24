import type { SkillDefinition,SkillRuntimeAuthorization } from './types.js';
import { nativeToolWorkPolicy,TOOL_WORK_SKILLS } from '../production-workflow/native-tool-work-policy.js';
/** Only these two bounded drafts can receive the existing acknowledged draft-trial grant. */
export function toolTrialAuthorization(draft:SkillDefinition):SkillRuntimeAuthorization|undefined {
    if(!draft.steps.some(step=>step.kind==='operation'&&step.operation.startsWith('tool-')))return undefined;
    const kind=draft.id===TOOL_WORK_SKILLS.smelt.id?'smelt':draft.id===TOOL_WORK_SKILLS.repair.id?'repair':null;
    const walk=draft.steps[0],work=draft.steps[1],source=kind?nativeToolWorkPolicy[kind].source:null;
    if(!kind||draft.status!=='draft'||draft.version!=='0.1.0'||draft.steps.length!==2||draft.limits.maxOperations!==2
        ||draft.limits.timeoutMs>120000||walk?.kind!=='operation'||walk.operation!=='walk-to'
        ||walk.arguments.x!==source!.x-1||walk.arguments.z!==source!.z||walk.arguments.tolerance!==0
        ||work?.kind!=='operation'||work.operation!==(kind==='smelt'?'tool-smelt-bronze':'tool-repair'))
        throw new Error('Tool trial requires an exact bounded native procedure');
    return{operations:['walk-to',work.operation],itemNames:kind==='smelt'?['copper ore','tin ore','bronze bar']:['bronze bar','bronze pickaxe'],
        partners:[],maxQuantity:1,maxUnitPriceGp:0,maxGpPerRun:0};
}
