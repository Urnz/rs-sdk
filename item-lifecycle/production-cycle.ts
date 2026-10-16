import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { itemLifecycleCatalogDigest } from './catalog.js';
import { ItemLifecycleStore } from './store.js';
import type { ItemInstanceState, ItemLifecycleCatalog, ProductionToolCycleCatalog,ProductionToolUtility,
    ProductionToolCycleDefinition, ProductionToolReplacementReceipt, ProductionToolUseReceipt } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function productionToolCycleCatalogDigest(value:Omit<ProductionToolCycleCatalog,'digest'>):string{return digest(value);}
export function productionToolReceiptDigest(value:ProductionToolUseReceipt|ProductionToolReplacementReceipt):string{return digest(value);}
export function validateProductionToolCycleCatalog(value:unknown,lifecycle:ItemLifecycleCatalog):ProductionToolCycleCatalog{
    const{digest:lifecycleDigest,...lifecycleDefinition}=lifecycle;
    if(lifecycleDigest!==itemLifecycleCatalogDigest(lifecycleDefinition))throw new Error('Item lifecycle catalog digest mismatch');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Production tool cycle catalog is invalid');
    const input=value as Record<string,unknown>;
    if(Object.keys(input).sort().join(',')!=='cycles,schemaVersion'||input.schemaVersion!==2||!Array.isArray(input.cycles)
        ||input.cycles.length<1||input.cycles.length>1_000)throw new Error('Production tool cycle catalog is invalid');
    const lifecycleIds=new Set(lifecycle.items.map(item=>item.lifecycleTypeId));
    const cycles:ProductionToolCycleDefinition[]=input.cycles.map((value,index)=>{const field=`cycles[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
        const cycle=value as Record<string,unknown>;
        if(Object.keys(cycle).sort().join(',')!=='capabilityId,cycleId,lifecycleTypeId,outputItemIds,outputQuantityPerAction,skillName'
            ||typeof cycle.cycleId!=='string'||!ID.test(cycle.cycleId)||typeof cycle.lifecycleTypeId!=='string'
            ||!ID.test(cycle.lifecycleTypeId)||!lifecycleIds.has(cycle.lifecycleTypeId)||typeof cycle.capabilityId!=='string'
            ||!ID.test(cycle.capabilityId)||typeof cycle.skillName!=='string'
            ||!cycle.skillName.trim()||cycle.skillName.length>40||!Array.isArray(cycle.outputItemIds)
            ||cycle.outputItemIds.length<1||cycle.outputItemIds.length>100||cycle.outputItemIds.some(item=>!Number.isSafeInteger(item)
                ||Number(item)<0||Number(item)>65_535)||!Number.isSafeInteger(cycle.outputQuantityPerAction)
            ||Number(cycle.outputQuantityPerAction)<1||Number(cycle.outputQuantityPerAction)>1_000)
            throw new Error(`${field} is invalid`);
        const outputItemIds=cycle.outputItemIds.map(Number);
        if(new Set(outputItemIds).size!==outputItemIds.length)throw new Error(`${field} output item ids must be unique`);
        return{cycleId:cycle.cycleId,lifecycleTypeId:cycle.lifecycleTypeId,capabilityId:cycle.capabilityId,
            skillName:cycle.skillName.trim(),outputItemIds,outputQuantityPerAction:Number(cycle.outputQuantityPerAction)};});
    if(new Set(cycles.map(cycle=>cycle.cycleId)).size!==cycles.length
        ||new Set(cycles.map(cycle=>cycle.lifecycleTypeId)).size!==cycles.length)
        throw new Error('Production tool cycles must have unique ids and lifecycle bindings');
    const definition={schemaVersion:2 as const,cycles};return{...definition,digest:productionToolCycleCatalogDigest(definition)};
}
export function loadProductionToolCycleCatalog(path:string,lifecycle:ItemLifecycleCatalog):ProductionToolCycleCatalog{
    return validateProductionToolCycleCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown,lifecycle);}
export class ProductionToolCycleService{
    constructor(private readonly store:ItemLifecycleStore,private readonly catalog:ProductionToolCycleCatalog){
        const{digest:catalogDigest,...definition}=catalog;
        if(catalogDigest!==productionToolCycleCatalogDigest(definition))throw new Error('Production tool cycle catalog digest mismatch');}
    utility(cycleId:string,itemInstanceId:string,actorId:string):ProductionToolUtility{const cycle=this.cycle(cycleId),item=this.item(itemInstanceId);
        if(item.lifecycleTypeId!==cycle.lifecycleTypeId||item.ownerActorId!==actorId)throw new Error('Production tool utility ownership is invalid');
        const replaced=this.store.getReplacement(itemInstanceId)!==null,remainingSuccessfulActions=this.store.remainingUses(itemInstanceId),
            remainingOutputCapacity=remainingSuccessfulActions*cycle.outputQuantityPerAction;
        if(!Number.isSafeInteger(remainingOutputCapacity))throw new Error('Production tool utility exceeds safe capacity');
        const status=replaced?'replaced':item.status==='broken'?'broken':'available';
        return{cycleId,itemInstanceId,ownerActorId:actorId,capabilityId:cycle.capabilityId,capabilityAvailable:status==='available',
            skillName:cycle.skillName,
            outputItemIds:[...cycle.outputItemIds],outputQuantityPerAction:cycle.outputQuantityPerAction,
            remainingSuccessfulActions,remainingOutputCapacity,status};}
    recordUse(receipt:ProductionToolUseReceipt):ItemInstanceState{const cycle=this.cycle(receipt.cycleId),item=this.item(receipt.itemInstanceId),
        expectedOutput=receipt.successfulActions*cycle.outputQuantityPerAction,replay=this.store.hasOperation(receipt.receiptId);
        if(item.lifecycleTypeId!==cycle.lifecycleTypeId||item.ownerActorId!==receipt.actorId||receipt.skillName!==cycle.skillName
            ||!cycle.outputItemIds.includes(receipt.outputItemId)||!Number.isSafeInteger(receipt.outputQuantity)
            ||receipt.outputQuantity<1||receipt.outputQuantity>1_000_000||!Number.isSafeInteger(receipt.successfulActions)
            ||receipt.successfulActions<1||receipt.successfulActions>1_000_000
            ||!Number.isSafeInteger(expectedOutput)||receipt.outputQuantity!==expectedOutput
            ||(!replay&&receipt.successfulActions>this.store.remainingUses(receipt.itemInstanceId))
            ||!DIGEST.test(receipt.sourceEvidenceDigest))
            throw new Error('Production tool use receipt is invalid');
        return this.store.use(receipt.receiptId,receipt.itemInstanceId,receipt.expectedRevision,receipt.successfulActions,
            productionToolReceiptDigest(receipt),receipt.atSimulationTime);}
    replace(receipt:ProductionToolReplacementReceipt):ItemInstanceState{const cycle=this.cycle(receipt.cycleId);
        const item=this.item(receipt.replacedItemInstanceId),definition=this.lifecycleDefinition(cycle,item);
        if(item.ownerActorId!==receipt.actorId||receipt.acquiredItemId!==definition.itemId||receipt.acquiredQuantity!==1
            ||!DIGEST.test(receipt.acquisitionEvidenceDigest)||!DIGEST.test(receipt.replacementProvenanceDigest))
            throw new Error('Production tool replacement receipt is invalid');
        return this.store.replace({operationId:receipt.receiptId,replacedItemInstanceId:receipt.replacedItemInstanceId,
            replacementItemInstanceId:receipt.replacementItemInstanceId,expectedRevision:receipt.expectedRevision,
            ownerActorId:receipt.actorId,qualityBasisPoints:receipt.replacementQualityBasisPoints,
            provenanceDigest:receipt.replacementProvenanceDigest,evidenceDigest:productionToolReceiptDigest(receipt),
            atSimulationTime:receipt.atSimulationTime});}
    private cycle(cycleId:string):ProductionToolCycleDefinition{const{digest:catalogDigest,...definition}=this.catalog;
        if(catalogDigest!==productionToolCycleCatalogDigest(definition))throw new Error('Production tool cycle catalog digest mismatch');
        if(!ID.test(cycleId))throw new Error('Production cycle id is invalid');
        const cycle=this.catalog.cycles.find(candidate=>candidate.cycleId===cycleId);
        if(!cycle)throw new Error('Unknown production tool cycle');return cycle;}
    private item(itemInstanceId:string):ItemInstanceState{const item=this.store.get(itemInstanceId);
        if(!item)throw new Error('Unknown item instance');return item;}
    private lifecycleDefinition(cycle:ProductionToolCycleDefinition,item:ItemInstanceState):{itemId:number}{
        if(item.lifecycleTypeId!==cycle.lifecycleTypeId)throw new Error('Production tool lifecycle type mismatch');return item;}
}
