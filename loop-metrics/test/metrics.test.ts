import { afterEach,describe,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialNeedsState,loadNeedsPolicyCatalog,needsStateDigest } from '../../needs/index.js';
import { closeFoodLoop,FoodConsumptionStore,loadFoodLoopCatalog } from '../../food-loop/index.js';
import { ItemLifecycleStore,loadItemLifecycleCatalog,loadProductionToolCycleCatalog,ProductionToolCycleService } from '../../item-lifecycle/index.js';
import { ClosedLoopMetricsService,loadLoopMetricPolicyCatalog,validateLoopMetricPolicyCatalog } from '../index.js';
import type { FoodInventoryReceipt } from '../../food-loop/index.js';
import type { InventoryMetricSnapshot } from '../index.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function database(name:string):string{const directory=mkdtempSync(join(tmpdir(),`loop-metrics-${name}-`));directories.push(directory);
    return join(directory,'ledger.sqlite');}
const root=join(import.meta.dir,'..','..','config'),food=()=>loadFoodLoopCatalog(join(root,'food-loops.json')),
    lifecycle=()=>loadItemLifecycleCatalog(join(root,'item-lifecycle.json')),
    tools=()=>loadProductionToolCycleCatalog(join(root,'production-tool-cycles.json'),lifecycle()),
    policies=()=>loadLoopMetricPolicyCatalog(join(root,'loop-metric-policies.json'),food(),tools()),
    needs=()=>loadNeedsPolicyCatalog(join(root,'needs-policies.json')).policies[0]!;
function receipt(kind:FoodInventoryReceipt['kind'],ordinal:number,inputs:FoodInventoryReceipt['inputs'],
    outputs:FoodInventoryReceipt['outputs'],skill:FoodInventoryReceipt['skill']):FoodInventoryReceipt{return{
        receiptId:`${kind}-${ordinal}`,actorAgentId:'ada',kind,occurredAtSimulationTime:`2030-01-01T0${ordinal}:00:00.000Z`,
        skill,inputs,outputs,sourceDigest:String(ordinal).repeat(64)};}
function closure(){const policy=needs(),initial=createInitialNeedsState(policy,{characterAgentId:'ada',clockId:'world',
    observedAtSimulationTime:'2030-01-01T00:00:00.000Z'}),definition={...initial,
        values:initial.values.map(item=>item.needId==='hunger'?{...item,value:4000}:item)};
    delete(definition as Partial<typeof initial>).digest;const state={...definition,digest:needsStateDigest(definition)};
    return closeFoodLoop({closureId:'closure-1',foodChainId:'lobster',state,
        gathered:receipt('gathered',1,[],[{itemId:377,quantity:1}],'Fishing'),
        processed:receipt('processed',2,[{itemId:377,quantity:1}],[{itemId:379,quantity:1}],'Cooking'),
        consumed:receipt('consumed',3,[{itemId:379,quantity:1}],[],null)},food(),policy);}
function snapshot(overrides:Partial<InventoryMetricSnapshot>={}):InventoryMetricSnapshot{return{snapshotId:'inventory-1',actorAgentId:'ada',
    observedAtSimulationTime:'2030-01-01T04:00:00.000Z',sourceDigest:'e'.repeat(64),
    items:[{itemId:377,quantity:0},{itemId:379,quantity:1}],...overrides};}
describe('closed economy loop metrics',()=>{
    test('reports evidenced food stock, shortages and windowed final consumption',()=>{const consumption=new FoodConsumptionStore(database('food'),food());
        consumption.record(closure());const service=new ClosedLoopMetricsService(policies(),food(),tools());
        expect(service.foodMetrics('lobster-food-loop',snapshot(),'2030-01-01T00:00:00.000Z',consumption)).toEqual({
            metricId:'lobster-food-loop',actorAgentId:'ada',observedAtSimulationTime:'2030-01-01T04:00:00.000Z',
            inventorySourceDigest:'e'.repeat(64),stock:{raw:{itemId:377,available:0,minimum:1,shortage:1},
                cooked:{itemId:379,available:1,minimum:2,shortage:1}},consumptionWindow:{
                fromSimulationTime:'2030-01-01T00:00:00.000Z',toSimulationTime:'2030-01-01T04:00:00.000Z',
                events:1,foodUnitsConsumed:1,hungerRelief:1800}});consumption.close();});
    test('reports live tool stock, unmet replacement and replacement rates from the lifecycle ledger',()=>{
        const store=new ItemLifecycleStore(database('tool'),lifecycle()),cycleService=new ProductionToolCycleService(store,tools()),
            service=new ClosedLoopMetricsService(policies(),food(),tools());store.create({itemInstanceId:'pickaxe-1',
                lifecycleTypeId:'bronze-pickaxe',ownerActorId:'ada',qualityBasisPoints:10_000,provenanceDigest:'a'.repeat(64),
                atSimulationTime:'2030-01-01T00:00:00.000Z'});
        cycleService.recordUse({receiptId:'use-1',cycleId:'bronze-pickaxe-mining',itemInstanceId:'pickaxe-1',actorId:'ada',
            expectedRevision:1,skillName:'Mining',successfulActions:100,outputItemId:436,outputQuantity:100,
            sourceEvidenceDigest:'b'.repeat(64),atSimulationTime:'2030-01-01T01:00:00.000Z'});
        expect(service.toolMetrics('bronze-pickaxe-tool-loop','ada',store)).toMatchObject({usableStock:0,
            usableToolShortage:1,brokenAwaitingReplacement:1,successfulUses:100,breakages:1,replacements:0,
            replacementCoverageBasisPoints:0,replacementsPerThousandUses:0});
        cycleService.replace({receiptId:'replacement-1',cycleId:'bronze-pickaxe-mining',replacedItemInstanceId:'pickaxe-1',
            replacementItemInstanceId:'pickaxe-2',actorId:'ada',expectedRevision:2,acquiredItemId:1265,acquiredQuantity:1,
            replacementQualityBasisPoints:10_000,replacementProvenanceDigest:'c'.repeat(64),acquisitionEvidenceDigest:'d'.repeat(64),
            atSimulationTime:'2030-01-01T02:00:00.000Z'});
        expect(service.toolMetrics('bronze-pickaxe-tool-loop','ada',store)).toEqual({metricId:'bronze-pickaxe-tool-loop',
            actorAgentId:'ada',lifecycleTypeId:'bronze-pickaxe',usableStock:1,minimumUsableTools:1,usableToolShortage:0,
            brokenAwaitingReplacement:0,successfulUses:100,breakages:1,replacements:1,
            replacementCoverageBasisPoints:10_000,replacementsPerThousandUses:10});store.close();});
    test('rejects untrusted stock snapshots and unknown catalog bindings',()=>{const consumption=new FoodConsumptionStore(database('bad'),food()),
        service=new ClosedLoopMetricsService(policies(),food(),tools());expect(()=>service.foodMetrics('lobster-food-loop',
            snapshot({sourceDigest:'invented'}),'2030-01-01T00:00:00.000Z',consumption)).toThrow('snapshot');
        expect(()=>service.foodMetrics('lobster-food-loop',snapshot({items:[{itemId:379,quantity:1},{itemId:379,quantity:2}]}),
            '2030-01-01T00:00:00.000Z',consumption)).toThrow('snapshot');consumption.close();
        const configured=policies();expect(()=>validateLoopMetricPolicyCatalog({schemaVersion:1,foodLoops:[{
            ...configured.foodLoops[0]!,foodChainId:'unknown'}],toolLoops:configured.toolLoops},food(),tools())).toThrow('invalid');});
    test('rejects tampered source catalogs before projecting metrics',()=>{const configuredFood=food();
        expect(()=>new ClosedLoopMetricsService(policies(),{...configuredFood,digest:'0'.repeat(64)},tools())).toThrow('digest mismatch');
        const configuredTools=tools();expect(()=>new ClosedLoopMetricsService(policies(),food(),
            {...configuredTools,digest:'0'.repeat(64)})).toThrow('digest mismatch');});
});
