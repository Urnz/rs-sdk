export interface FoodLoopMetricPolicy {
    metricId: string;
    foodChainId: string;
    minimumRawStock: number;
    minimumCookedStock: number;
}
export interface ToolLoopMetricPolicy {
    metricId: string;
    productionCycleId: string;
    minimumUsableTools: number;
}
export interface LoopMetricPolicyCatalog {
    schemaVersion: 1;
    foodLoops: FoodLoopMetricPolicy[];
    toolLoops: ToolLoopMetricPolicy[];
    digest: string;
}
export interface InventoryMetricSnapshot {
    snapshotId: string;
    actorAgentId: string;
    observedAtSimulationTime: string;
    sourceDigest: string;
    items: Array<{itemId:number;quantity:number}>;
}
export interface StockMetric { itemId:number;available:number;minimum:number;shortage:number }
export interface FoodLoopMetrics {
    metricId:string;
    actorAgentId:string;
    observedAtSimulationTime:string;
    inventorySourceDigest:string;
    stock:{raw:StockMetric;cooked:StockMetric};
    consumptionWindow:{fromSimulationTime:string;toSimulationTime:string;events:number;foodUnitsConsumed:number;hungerRelief:number};
}
export interface ToolLoopMetrics {
    metricId:string;
    actorAgentId:string;
    lifecycleTypeId:string;
    usableStock:number;
    minimumUsableTools:number;
    usableToolShortage:number;
    brokenAwaitingReplacement:number;
    successfulUses:number;
    breakages:number;
    replacements:number;
    replacementCoverageBasisPoints:number|null;
    replacementsPerThousandUses:number|null;
}
