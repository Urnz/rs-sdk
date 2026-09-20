import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { foodLoopCatalogDigest } from '../food-loop/index.js';
import { productionToolCycleCatalogDigest } from '../item-lifecycle/index.js';
import type { FoodLoopCatalog } from '../food-loop/index.js';
import type { ProductionToolCycleCatalog } from '../item-lifecycle/index.js';
import type { FoodLoopMetricPolicy,LoopMetricPolicyCatalog,ToolLoopMetricPolicy } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{
    if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error(`${field} is invalid`);}
function quantity(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>1_000_000)
    throw new Error('Loop metric stock target is invalid');return Number(value);}
export function loopMetricPolicyDigest(value:Omit<LoopMetricPolicyCatalog,'digest'>):string{
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function validateLoopMetricPolicyCatalog(value:unknown,food:FoodLoopCatalog,
    tools:ProductionToolCycleCatalog):LoopMetricPolicyCatalog{const{digest:foodDigest,...foodDefinition}=food;
    if(foodDigest!==foodLoopCatalogDigest(foodDefinition))throw new Error('Food loop catalog digest mismatch');
    const{digest:toolDigest,...toolDefinition}=tools;
    if(toolDigest!==productionToolCycleCatalogDigest(toolDefinition))throw new Error('Production tool cycle catalog digest mismatch');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Loop metric policy catalog is invalid');
    const input=value as Record<string,unknown>;exact(input,['schemaVersion','foodLoops','toolLoops'],'Loop metric policy catalog');
    if(input.schemaVersion!==1||!Array.isArray(input.foodLoops)||!Array.isArray(input.toolLoops)
        ||input.foodLoops.length<1||input.foodLoops.length>1_000||input.toolLoops.length<1||input.toolLoops.length>1_000)
        throw new Error('Loop metric policy catalog is invalid');
    const foodLoops:FoodLoopMetricPolicy[]=input.foodLoops.map((value,index)=>{const field=`foodLoops[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);const policy=value as Record<string,unknown>;
        exact(policy,['metricId','foodChainId','minimumRawStock','minimumCookedStock'],field);
        if(typeof policy.metricId!=='string'||!ID.test(policy.metricId)||typeof policy.foodChainId!=='string'
            ||!ID.test(policy.foodChainId)||!food.chains.some(chain=>chain.foodChainId===policy.foodChainId))throw new Error(`${field} is invalid`);
        return{metricId:policy.metricId,foodChainId:policy.foodChainId,minimumRawStock:quantity(policy.minimumRawStock),
            minimumCookedStock:quantity(policy.minimumCookedStock)};});
    const toolLoops:ToolLoopMetricPolicy[]=input.toolLoops.map((value,index)=>{const field=`toolLoops[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);const policy=value as Record<string,unknown>;
        exact(policy,['metricId','productionCycleId','minimumUsableTools'],field);
        if(typeof policy.metricId!=='string'||!ID.test(policy.metricId)||typeof policy.productionCycleId!=='string'
            ||!ID.test(policy.productionCycleId)||!tools.cycles.some(cycle=>cycle.cycleId===policy.productionCycleId))throw new Error(`${field} is invalid`);
        return{metricId:policy.metricId,productionCycleId:policy.productionCycleId,
            minimumUsableTools:quantity(policy.minimumUsableTools)};});
    const metricIds=[...foodLoops,...toolLoops].map(policy=>policy.metricId);
    if(new Set(metricIds).size!==metricIds.length)throw new Error('Loop metric policies must have unique ids');
    const definition={schemaVersion:1 as const,foodLoops,toolLoops};return{...definition,digest:loopMetricPolicyDigest(definition)};}
export function loadLoopMetricPolicyCatalog(path:string,food:FoodLoopCatalog,
    tools:ProductionToolCycleCatalog):LoopMetricPolicyCatalog{
    return validateLoopMetricPolicyCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown,food,tools);}
