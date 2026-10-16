import { foodLoopCatalogDigest } from '../food-loop/index.js';
import { productionToolCycleCatalogDigest } from '../item-lifecycle/index.js';
import type { FoodConsumptionStore,FoodLoopCatalog } from '../food-loop/index.js';
import type { ItemLifecycleStore,ProductionToolCycleCatalog } from '../item-lifecycle/index.js';
import { loopMetricPolicyDigest } from './catalog.js';
import type { FoodLoopMetrics,InventoryMetricSnapshot,LoopMetricPolicyCatalog,StockMetric,ToolLoopMetrics } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
function time(value:string):number{const parsed=Date.parse(value);if(Number.isNaN(parsed)||new Date(parsed).toISOString()!==value)
    throw new Error('Loop metric simulation time is invalid');return parsed;}
function stock(itemId:number,minimum:number,items:Map<number,number>):StockMetric{const available=items.get(itemId)??0;
    return{itemId,available,minimum,shortage:Math.max(0,minimum-available)};}
export class ClosedLoopMetricsService{
    constructor(private readonly policies:LoopMetricPolicyCatalog,private readonly food:FoodLoopCatalog,
        private readonly tools:ProductionToolCycleCatalog){const{digest,...definition}=policies;
        if(digest!==loopMetricPolicyDigest(definition))throw new Error('Loop metric policy digest mismatch');
        const{digest:foodDigest,...foodDefinition}=food,{digest:toolDigest,...toolDefinition}=tools;
        if(foodDigest!==foodLoopCatalogDigest(foodDefinition))throw new Error('Food loop catalog digest mismatch');
        if(toolDigest!==productionToolCycleCatalogDigest(toolDefinition))throw new Error('Production tool cycle catalog digest mismatch');}
    foodMetrics(metricId:string,snapshot:InventoryMetricSnapshot,fromSimulationTime:string,
        consumption:FoodConsumptionStore):FoodLoopMetrics{const policy=this.policies.foodLoops.find(item=>item.metricId===metricId);
        if(!policy)throw new Error('Unknown food loop metric policy');this.snapshot(snapshot);const from=time(fromSimulationTime),to=time(snapshot.observedAtSimulationTime);
        if(from>to)throw new Error('Consumption metric window is invalid');const chain=this.food.chains.find(item=>item.foodChainId===policy.foodChainId)!;
        const items=new Map(snapshot.items.map(item=>[item.itemId,item.quantity]));return{metricId,actorAgentId:snapshot.actorAgentId,
            observedAtSimulationTime:snapshot.observedAtSimulationTime,inventorySourceDigest:snapshot.sourceDigest,
            stock:{raw:stock(chain.rawItem.itemId,policy.minimumRawStock,items),
                cooked:stock(chain.cookedItem.itemId,policy.minimumCookedStock,items)},
            consumptionWindow:{fromSimulationTime,toSimulationTime:snapshot.observedAtSimulationTime,
                ...consumption.summaryWindow(fromSimulationTime,snapshot.observedAtSimulationTime,snapshot.actorAgentId)}};}
    toolMetrics(metricId:string,actorAgentId:string,lifecycle:ItemLifecycleStore):ToolLoopMetrics{
        const policy=this.policies.toolLoops.find(item=>item.metricId===metricId);if(!policy)throw new Error('Unknown tool loop metric policy');
        if(!ID.test(actorAgentId))throw new Error('Actor agent id is invalid');const cycle=this.tools.cycles.find(item=>item.cycleId===policy.productionCycleId)!,
            metrics=lifecycle.loopMetrics(cycle.lifecycleTypeId,actorAgentId);return{metricId,actorAgentId,
                lifecycleTypeId:cycle.lifecycleTypeId,usableStock:metrics.usableStock,minimumUsableTools:policy.minimumUsableTools,
                usableToolShortage:Math.max(0,policy.minimumUsableTools-metrics.usableStock),
                brokenAwaitingReplacement:metrics.brokenAwaitingReplacement,successfulUses:metrics.successfulUses,
                breakages:metrics.breakages,replacements:metrics.replacements,
                replacementCoverageBasisPoints:metrics.replacementCoverageBasisPoints,
                replacementsPerThousandUses:metrics.replacementsPerThousandUses};}
    private snapshot(snapshot:InventoryMetricSnapshot):void{if(!snapshot||!ID.test(snapshot.snapshotId)||!ID.test(snapshot.actorAgentId)
        ||!DIGEST.test(snapshot.sourceDigest))throw new Error('Inventory metric snapshot is invalid');time(snapshot.observedAtSimulationTime);
        if(!Array.isArray(snapshot.items)||snapshot.items.length>10_000||snapshot.items.some(item=>!item
            ||!Number.isSafeInteger(item.itemId)||item.itemId<0||item.itemId>65_535||!Number.isSafeInteger(item.quantity)
            ||item.quantity<0||item.quantity>1_000_000)||new Set(snapshot.items.map(item=>item.itemId)).size!==snapshot.items.length)
            throw new Error('Inventory metric snapshot is invalid');}
}
