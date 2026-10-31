import type {SkillDefinition,SkillRuntimeAuthorization} from './types.js';
import {miningGatherArgs} from '../sdk/mining-demand.js';
import {nativeToolDigest as hash} from '../item-lifecycle/native-tool.js';

/** Acknowledged trial of the one C07 tin draft. Never grants a general Mining,
 * trading, bank or arbitrary-coordinate exception to learned verified execution. */
export function miningTrialAuthorization(draft:SkillDefinition):SkillRuntimeAuthorization|undefined{
    if(draft.id!=='procedure.mining.gather-tin'||draft.version!=='0.1.0'||draft.status!=='draft')return undefined;
    const [walk,gather]=draft.steps;
    if(draft.steps.length!==2||walk?.kind!=='operation'||gather?.kind!=='operation'||walk.operation!=='walk-to'||gather.operation!=='gather-loc'
        ||walk.maxAttempts!==undefined&&walk.maxAttempts!==1||gather.maxAttempts!==undefined&&gather.maxAttempts!==1
        ||hash(walk.arguments)!==hash({x:3285,z:3365,tolerance:5})||Object.keys(draft.parameters).length!==0
        ||draft.limits.maxOperations!==2||draft.limits.timeoutMs>120000
        ||hash(miningGatherArgs(gather.arguments))!==hash(miningGatherArgs({name:'rocks tin ore',match:'exact',option:'mine',item:'tin ore',skill:'Mining',timeoutMs:60000})))
        throw Error('Mining trial requires the exact bounded tin procedure');
    return{operations:['walk-to','gather-loc'],itemNames:['tin ore'],partners:[],maxQuantity:1,maxUnitPriceGp:0,maxGpPerRun:0};
}
