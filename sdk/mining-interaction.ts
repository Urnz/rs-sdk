import { validateMiningDemandRequest,type MiningDemandRequest } from './mining-demand.js';
export interface MiningInteractionContext {demand:MiningDemandRequest;dispatchSequence:number}
export interface MiningInteractionRequest extends MiningInteractionContext {target:{x:number;z:number;locId:number;optionIndex:1|3}}
export interface NativeMiningInteractionCommand {dispatchId:string;username:string}
export function validateMiningInteractionRequest(v:MiningInteractionRequest):MiningInteractionRequest{
    if(!v||Object.keys(v).sort().join(',')!=='demand,dispatchSequence,target')throw Error('Invalid Mining interaction fields');
    const demand=validateMiningDemandRequest(v.demand),t=v.target;
    if(demand.operation!=='open'||!Number.isSafeInteger(v.dispatchSequence)||v.dispatchSequence<1||v.dispatchSequence>demand.args.maxRetargets
        ||!t||Object.keys(t).sort().join(',')!=='locId,optionIndex,x,z'
        ||![t.x,t.z,t.locId].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=16383)||![1,3].includes(t.optionIndex)
        ||typeof demand.args.option==='number'&&demand.args.option!==t.optionIndex)throw Error('Invalid bounded Mining interaction');
    return{demand,dispatchSequence:v.dispatchSequence,target:{...t}};
}
