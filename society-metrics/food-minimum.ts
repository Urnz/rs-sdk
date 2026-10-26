import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import type { MinimumCell,MinimumFraction } from '../society-minimum/assessment.js';
import type { NeedsBinding,NeedsAdmission } from '../needs/store.js';
import type { NativeIntegrationSources } from './integration-sources.js';
import type { EvaluationScope } from './evaluation.js';
import type { FoodProductionReceipt } from '../server/engine/src/mods/NativeFoodProductionStore.js';
export interface FoodActorContext {binding:NeedsBinding|null;admission:NeedsAdmission|null;initializedAt:string|null}
/** Internal join of verified native applications and ancestry; relief share is not relief/demand. */
export function projectNativeFoodMinimum(scope:EvaluationScope,worldId:string,sources:NativeIntegrationSources){
    const nutrition=sources.nutrition,lineage=sources.lineage,production=sources.production,catalog=sources.foodCatalog;
    const histories=new Map(sources.needs.status==='available'?sources.needs.value.histories.map(h=>[digest(h.binding),h.history[0]!]):[]);
    const ancestry=new Map(lineage.status==='available'?lineage.value.consumptions!.map(c=>[c.actionId,c]):[]);
    const receipts=new Map<string,FoodProductionReceipt>(production.status==='available'?production.value.flatMap(r=>r.receipt?[[`production:${r.actionId}`,r.receipt] as const]:[]):[]);
    const rows=nutrition.status==='available'?nutrition.value.applications!.filter(a=>scope.actorAgentIds.includes(a.binding.actorId)
        &&a.clock.simulationTime>scope.fromSimulationTime&&a.clock.simulationTime<=scope.toSimulationTime).map(a=>{
        const first=histories.get(digest(a.binding)),origin=ancestry.get(a.actionId);
        const ancestors=(origin?.lineage?.sourceKeys??[]).flatMap(key=>{
            const receipt=receipts.get(key);if(!receipt)return[];const p=receipt.action;
            if(p.worldId!==worldId||p.clockId!==scope.clockId||p.clockProfileDigest!==scope.clockProfileDigest
                ||receipt.clock.clockId!==scope.clockId||receipt.clock.profileDigest!==scope.clockProfileDigest||receipt.clock.simulationTime>a.clock.simulationTime)return[];
            return[{actorAgentId:p.actorId,username:p.username,lifecycleId:p.lifecycleId,at:receipt.clock.simulationTime,
                stage:receipt.outcome==='raw-gained'?'gather':receipt.outcome==='cooked'?'cook':'other'}];
        });
        return{actionId:a.actionId,binding:a.binding,admission:first?.admission??null,initializedAt:first?.state.observedAtSimulationTime??null,
            at:a.clock.simulationTime,itemId:a.receipt?.itemId??null,quantity:a.quantity,effectiveRelief:String(a.hungerRelief),
            matchingNativeScope:a.binding.worldId===worldId&&a.clock.clockId===scope.clockId&&a.clock.profileDigest===scope.clockProfileDigest
                &&a.binding.clockId===scope.clockId&&a.binding.clockProfileDigest===scope.clockProfileDigest,
            origin:origin?.origin??'unknown',internalSupply:origin?.internalSupply??'unproven',ancestors,
            completeAncestors:ancestors.length===(origin?.lineage?.sourceKeys??[]).filter(k=>k.startsWith('production:')).length};
    }):[];
    const body={protocol:'native-minimum-food-v1',scope,worldId,catalogDigest:catalog.status==='available'?catalog.value.digest:null,
        policyDigest:sources.needs.status==='available'?sources.needs.value.policy.digest:null,dynamicsDigest:sources.needs.status==='available'?sources.needs.value.dynamics.digest:null,
        nutritionAvailable:nutrition.status==='available',pending:nutrition.status==='available'?nutrition.value.pending:null,
        through:nutrition.status==='available'?nutrition.value.through:null,rows,
        boundaries:sources.foodBoundaries.status==='available'?sources.foodBoundaries.value.boundaries:[],
        sourceDigests:[nutrition,lineage,production,catalog,sources.foodBoundaries].flatMap(s=>s.status==='available'?[s.digest]:[]),
        meaning:'Actual effective relief and final use per original bucket; frozen usable capacity bounds, without current-stock backfill or WIP double credit.'};
    return{...body,digest:digest(body)};
}
export type NativeMinimumFood=ReturnType<typeof projectNativeFoodMinimum>;
type Producer=NativeMinimumFood['rows'][number]['ancestors'][number];
const min=(values:MinimumFraction[])=>values.reduce((a,b)=>BigInt(a.numerator)*BigInt(b.denominator)<=BigInt(b.numerator)*BigInt(a.denominator)?a:b);
export function foodMinimumCells(contract:SocietyMinimumContract,food:NativeMinimumFood,isOriginal:(a:FoodActorContext)=>boolean,isProducer:(p:Producer)=>boolean){
    const cells:MinimumCell[]=[],violations:Array<{requirementId:string;actionId:string}>=[],start=Date.parse(food.scope.fromSimulationTime),bucket=contract.policy.window.bucketSimulationMilliseconds;
    const allowed=new Set(contract.dependencies.food.chains.map(c=>c.cookedItem.itemId));
    const bound=(r:NativeMinimumFood['rows'][number])=>r.matchingNativeScope&&isOriginal(r);
    const internal=(r:NativeMinimumFood['rows'][number])=>r.completeAncestors&&r.internalSupply==='verified'&&r.origin==='internal'
        &&r.ancestors.some(p=>p.stage==='gather')&&r.ancestors.some(p=>p.stage==='cook')&&r.ancestors.every(isProducer);
    const globallyComplete=food.nutritionAvailable&&food.pending===0&&food.through?.clockId===food.scope.clockId
        &&food.through.profileDigest===food.scope.clockProfileDigest&&food.rows.every(bound);
    const add=(requirementId:string,subject:MinimumCell['subject'],lower:MinimumFraction|undefined,upper?:MinimumFraction)=>
        cells.push({requirementId,subject,opportunity:'positive',...(lower?{lower}:{}),...(upper?{upper}:{}),evidenceDigests:[food.digest]});
    for(let index=0;index<contract.policy.window.evaluationSimulationMilliseconds/bucket;index++){
        const end=start+(index+1)*bucket,rows=food.rows.filter(r=>Math.ceil((Date.parse(r.at)-start)/bucket)-1===index),valid=rows.filter(bound);
        const consumed=valid.filter(r=>r.quantity===1),positive=consumed.filter(r=>allowed.has(r.itemId??-1)),nonInternal=consumed.filter(r=>r.origin==='bootstrap'||r.origin==='import');
        for(const r of nonInternal)if(BigInt(r.effectiveRelief)>0n)violations.push({requirementId:'internal-food-relief-share',actionId:r.actionId});
        const finalUses=new Set(positive.filter(r=>internal(r)&&r.ancestors.some(p=>p.actorAgentId!==r.binding.actorId)).map(r=>r.actionId));
        if(finalUses.size)add('inter-actor-final-use-chains',{bucket:index},{numerator:String(finalUses.size),denominator:'1'});
        // Complete effective-relief denominator includes every food type; unrecognized foods never become internal credit.
        const total=rows.reduce((n,r)=>n+BigInt(r.effectiveRelief),0n);
        if(globallyComplete&&Date.parse(food.scope.toSimulationTime)>=end&&Date.parse(food.through!.simulationTime)>=end&&total>0n){
            const known=positive.filter(internal).reduce((n,r)=>n+BigInt(r.effectiveRelief),0n),foreign=nonInternal.reduce((n,r)=>n+BigInt(r.effectiveRelief),0n);
            add('internal-food-relief-share',{bucket:index},{numerator:String(known*10000n),denominator:String(total)},
                {numerator:String((total-foreign)*10000n),denominator:String(total)});
        }
    }
    const boundaries=food.boundaries.flatMap(b=>b.source.status==='available'&&b.source.value.contractDigest===contract.digest
        &&b.source.value.worldId===food.worldId&&b.source.value.clockId===food.scope.clockId&&b.source.value.clockProfileDigest===food.scope.clockProfileDigest
        &&b.source.value.cohort.every(isOriginal)?[b.source.value]:[]);
    for(const b of boundaries)if(b.hungerRateLower>0&&b.hungerRateUpper>=b.hungerRateLower){
        const lower=b.chains.reduce((n,c)=>n+BigInt(c.lowerRelief),0n),upper=b.chains.reduce((n,c)=>n+BigInt(c.upperRelief),0n);
        add('food-reserve-coverage',{boundary:b.at},{numerator:String(lower*3600000n),denominator:String(b.hungerRateUpper)},
            {numerator:String(upper*3600000n),denominator:String(b.hungerRateLower)});
    }
    const opening=boundaries.find(b=>b.at===food.scope.fromSimulationTime),closing=boundaries.find(b=>Date.parse(b.at)===start+contract.policy.window.evaluationSimulationMilliseconds);
    if(opening&&closing){
        const bounds=contract.policy.food.chainIds.flatMap(chainId=>{
            const a=opening.chains.find(c=>c.chainId===chainId),b=closing.chains.find(c=>c.chainId===chainId);
            return a&&b&&BigInt(a.lowerRelief)>0n&&BigInt(a.upperRelief)>=BigInt(a.lowerRelief)?[
                {lower:{numerator:String(BigInt(b.lowerRelief)*10000n),denominator:a.upperRelief},upper:{numerator:String(BigInt(b.upperRelief)*10000n),denominator:a.lowerRelief}}]:[];
        });
        const failed=bounds.filter(b=>BigInt(b.upper.numerator)<10000n*BigInt(b.upper.denominator));
        if(failed.length)add('food-stock-retention',{boundary:closing.at},undefined,min(failed.map(b=>b.upper)));
        else if(bounds.length===contract.policy.food.chainIds.length)add('food-stock-retention',{boundary:closing.at},min(bounds.map(b=>b.lower)),min(bounds.map(b=>b.upper)));
    }
    return{cells,violations,boundaryTimes:boundaries.map(b=>b.at)};
}
