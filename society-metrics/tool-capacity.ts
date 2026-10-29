import { loadSocietyMinimumContract,type SocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { MinimumCell } from '../society-minimum/assessment.js';
import { readStableOutcomeStore } from './population-outcomes.js';
import { readNativeFoodBoundary,type NativeFoodBoundaryPaths } from './food-boundaries.js';
import type { NativeIntegrationOptions,NativeIntegrationSources,readWealthBoundary } from './integration-sources.js';
import { readToolCapacityLedger } from './tool-capacity-ledger.js';
import type { EvaluationScope } from './evaluation.js';
import type { FoodActorContext } from './food-minimum.js';
import { nativeToolDigest } from '../item-lifecycle/native-tool.js';

/** Frozen physical capacity; no current-state backfill, writable store or guessed instance from an item stack. */
export function readNativeToolCapacityBoundary(scope:EvaluationScope,options:NativeIntegrationOptions,paths:NativeFoodBoundaryPaths,wealth:ReturnType<typeof readWealthBoundary>,
    shared?:{contract:SocietyMinimumContract;physical:ReturnType<typeof readNativeFoodBoundary>}){
    const contract=shared?.contract??loadSocietyMinimumContract(options.configDirectory),physical=shared?.physical??readNativeFoodBoundary(scope,options,paths,wealth),at=wealth.simulationTime;
    const ledger=readStableOutcomeStore(options,paths.checkpointPath,db=>({...readToolCapacityLedger(db,contract,options.configDirectory,at),
        saves:(db.query('SELECT owner,save FROM accounts').all() as {owner:string;save:Uint8Array}[])
            .map(r=>({owner:r.owner,nativeDigest:nativeToolDigest([...r.save]),assetDigest:digest([...r.save])}))}));
    const cycles=contract.dependencies.tools.cycles.map(({cycle,item})=>{
        const instances=ledger.instances.filter(r=>r.lifecycleTypeId===item.lifecycleTypeId),capacity=(r:typeof instances[number])=>
            r.retired?0n:BigInt(Math.floor(r.durability/item.wearPerUse))*BigInt(cycle.outputQuantityPerAction);
        // Unlocated/quarantined instances and unbound physical copies remain possible upper capacity.
        let lower=0n,upper=instances.reduce((n,r)=>n+capacity(r),0n);
        const assets=wealth.assets.filter(a=>a.itemId===item.itemId),matched=new Set<string>();
        for(const b of ledger.bindings){
            const instance=instances.find(r=>r.itemInstanceId===b.itemInstanceId);if(!instance||instance.retired)continue;
            const actor=physical.cohort.find(a=>a.binding.actorId===b.owner.actorId);
            if(!actor||b.owner.worldId!==options.worldId||b.owner.clockId!==scope.clockId||b.owner.clockProfileDigest!==scope.clockProfileDigest
                ||b.owner.username!==actor.binding.playerId||b.owner.lifecycleId!==actor.binding.lifecycleId)throw Error('Native capacity binding identity differs');
            const owned=assets.filter(a=>a.owner===b.owner.username&&a.location.startsWith('player-')),
                exact=owned.filter(a=>a.location===({93:'player-inventory',94:'player-equipment',95:'player-bank'} as Record<number,string>)[b.position.inventory]
                    &&(a.evidence as {slot:number}).slot===b.position.slot&&a.count==='1');
            const e=exact[0]?.evidence as {checkpointDigest?:string}|undefined;
            // readWealth uses canonical JSON for save hashes; native identity hashes the raw byte array in its stored order.
            const save=ledger.saves.find(s=>s.owner===b.owner.username);
            if(b.status!=='bound'||owned.reduce((n,a)=>n+BigInt(a.count),0n)!==1n||exact.length!==1||!e?.checkpointDigest
                ||save?.nativeDigest!==b.checkpointDigest||save.assetDigest!==e.checkpointDigest)continue;
            matched.add(digest(exact[0]));
            if([93,94].includes(b.position.inventory)&&physical.eligiblePlayerUsernames.includes(b.owner.username))lower+=capacity(instance);
        }
        const uncertain=assets.filter(a=>!matched.has(digest(a))).reduce((n,a)=>n+BigInt(a.count),0n);
        upper+=uncertain*BigInt(Math.floor(item.maxDurability/item.wearPerUse))*BigInt(cycle.outputQuantityPerAction);
        return{cycleId:cycle.cycleId,lifecycleTypeId:item.lifecycleTypeId,capabilityId:cycle.capabilityId,
            outputItemIds:cycle.outputItemIds,outputQuantityPerAction:cycle.outputQuantityPerAction,lower:String(lower),upper:String(upper)};
    });
    return{at,worldId:options.worldId,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,contractDigest:contract.digest,
        cohort:physical.cohort,cycles,auditDigests:ledger.auditDigests,events:ledger.events,
        sourceDigests:[ledger.sourceSnapshotDigest,physical.agentSnapshotDigest,physical.healthSnapshotDigest,physical.needsSnapshotDigest],
        meaning:'Remaining mechanical output capacity, with bound physical eligible inventory/equipment lower and uncertain custody upper. Separate from internal maintenance provenance and complete universe/enforcement coverage.'};
}
export function projectToolCapacity(scope:EvaluationScope,worldId:string,source:NativeIntegrationSources['toolBoundaries']){
    const body={protocol:'native-tool-service-capacity-v1',scope,worldId,boundaries:source.status==='available'?source.value.boundaries:[],
        sourceDigest:source.status==='available'?source.digest:null};return{...body,digest:digest(body)};
}
export function toolCapacityCells(contract:SocietyMinimumContract,report:ReturnType<typeof projectToolCapacity>,isOriginal:(a:FoodActorContext)=>boolean):MinimumCell[]{
    const valid=report.boundaries.flatMap(b=>b.source.status==='available'&&b.source.value.contractDigest===contract.digest&&b.source.value.worldId===report.worldId
        &&b.source.value.clockId===report.scope.clockId&&b.source.value.clockProfileDigest===report.scope.clockProfileDigest
        &&b.source.value.cohort.length===report.scope.actorAgentIds.length&&b.source.value.cohort.every(isOriginal)?[b.source.value]:[]);
    const opening=valid.find(b=>b.at===report.scope.fromSimulationTime),closing=valid.find(b=>Date.parse(b.at)===Date.parse(report.scope.fromSimulationTime)+contract.policy.window.evaluationSimulationMilliseconds);
    const closingEvents=new Map(closing?.events.map(e=>[e.id,e.digest])??[]);
    if(!opening||!closing||closing.auditDigests.length<opening.auditDigests.length||opening.auditDigests.some((v,i)=>v!==closing.auditDigests[i])
        ||opening.events.some(e=>closingEvents.get(e.id)!==e.digest))return[];
    const bounds=contract.policy.tools.cycleIds.flatMap(cycleId=>{
        const a=opening.cycles.find(c=>c.cycleId===cycleId),b=closing.cycles.find(c=>c.cycleId===cycleId);
        if(!a||!b||BigInt(a.lower)<=0n||BigInt(a.upper)<BigInt(a.lower)||BigInt(b.upper)<BigInt(b.lower)
            ||digest([a.capabilityId,a.outputItemIds,a.outputQuantityPerAction,a.lifecycleTypeId])!==digest([b.capabilityId,b.outputItemIds,b.outputQuantityPerAction,b.lifecycleTypeId]))return[];
        return[{lower:{numerator:String(BigInt(b.lower)*10000n),denominator:a.upper},upper:{numerator:String(BigInt(b.upper)*10000n),denominator:a.lower}}];
    });
    const minimum=(values:typeof bounds[number]['lower'][])=>values.reduce((a,b)=>BigInt(a.numerator)*BigInt(b.denominator)<=BigInt(b.numerator)*BigInt(a.denominator)?a:b);
    const failed=bounds.filter(b=>BigInt(b.upper.numerator)<BigInt(contract.policy.tools.minimumServiceCapacityRetentionBasisPoints)*BigInt(b.upper.denominator));
    if(failed.length)return[{requirementId:'tool-service-capacity-retention',subject:{boundary:closing.at},opportunity:'positive',upper:minimum(failed.map(b=>b.upper)),evidenceDigests:[report.digest]}];
    return bounds.length===contract.policy.tools.cycleIds.length?[{requirementId:'tool-service-capacity-retention',subject:{boundary:closing.at},opportunity:'positive',
        lower:minimum(bounds.map(b=>b.lower)),upper:minimum(bounds.map(b=>b.upper)),evidenceDigests:[report.digest]}]:[];
}
