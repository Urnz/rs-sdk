import { afterEach,describe,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ItemLifecycleStore,loadItemLifecycleCatalog,loadProductionToolCycleCatalog,ProductionToolCycleService,
    validateProductionToolCycleCatalog } from '../index.js';
import type { ProductionToolReplacementReceipt,ProductionToolUseReceipt } from '../index.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function databasePath(){const directory=mkdtempSync(join(tmpdir(),'production-tool-cycle-'));directories.push(directory);
    return join(directory,'items.sqlite');}
const configRoot=join(import.meta.dir,'..','..','config');
const lifecycle=()=>loadItemLifecycleCatalog(join(configRoot,'item-lifecycle.json'));
const cycles=()=>loadProductionToolCycleCatalog(join(configRoot,'production-tool-cycles.json'),lifecycle());
function create(store:ItemLifecycleStore){return store.create({itemInstanceId:'pickaxe-1',lifecycleTypeId:'bronze-pickaxe',
    ownerActorId:'ada',qualityBasisPoints:10_000,provenanceDigest:'a'.repeat(64),atSimulationTime:'2030-01-01T00:00:00.000Z'});}
function useReceipt(overrides:Partial<ProductionToolUseReceipt>={}):ProductionToolUseReceipt{return{receiptId:'mining-1',
    cycleId:'bronze-pickaxe-mining',itemInstanceId:'pickaxe-1',actorId:'ada',expectedRevision:1,skillName:'Mining',
    successfulActions:100,outputItemId:436,outputQuantity:100,sourceEvidenceDigest:'b'.repeat(64),
    atSimulationTime:'2030-01-01T01:00:00.000Z',...overrides};}
function replacementReceipt(overrides:Partial<ProductionToolReplacementReceipt>={}):ProductionToolReplacementReceipt{
    return{receiptId:'replacement-1',cycleId:'bronze-pickaxe-mining',replacedItemInstanceId:'pickaxe-1',
        replacementItemInstanceId:'pickaxe-2',actorId:'ada',expectedRevision:2,acquiredItemId:1265,acquiredQuantity:1,
        replacementQualityBasisPoints:9_500,replacementProvenanceDigest:'c'.repeat(64),acquisitionEvidenceDigest:'d'.repeat(64),
        atSimulationTime:'2030-01-01T02:00:00.000Z',...overrides};}

describe('production tool lifecycle vertical slice',()=>{
    test('loads one configurable bronze pickaxe mining cycle',()=>{expect(cycles().cycles[0]).toEqual({
        cycleId:'bronze-pickaxe-mining',lifecycleTypeId:'bronze-pickaxe',skillName:'Mining',outputItemIds:[436,438]});});
    test('runs verified mining through wear, breakage and audited replacement',()=>{const store=new ItemLifecycleStore(databasePath(),lifecycle());
        create(store);const service=new ProductionToolCycleService(store,cycles());
        expect(service.recordUse(useReceipt())).toMatchObject({durability:0,status:'broken',revision:2});
        const replacement=service.replace(replacementReceipt());expect(replacement).toMatchObject({itemInstanceId:'pickaxe-2',
            lifecycleTypeId:'bronze-pickaxe',durability:100,status:'usable',qualityBasisPoints:9_500,revision:1});
        expect(store.getReplacement('pickaxe-1')).toMatchObject({operationId:'replacement-1',
            replacementItemInstanceId:'pickaxe-2',ownerActorId:'ada'});
        expect(store.verifyAuditChain()).toBeTrue();store.close();});
    test('rejects unrelated production, foreign ownership and invented replacement assets',()=>{const store=new ItemLifecycleStore(databasePath(),lifecycle());
        create(store);const service=new ProductionToolCycleService(store,cycles());
        expect(()=>service.recordUse(useReceipt({skillName:'Fishing'}))).toThrow('use receipt');
        expect(()=>service.recordUse(useReceipt({outputQuantity:99}))).toThrow('use receipt');
        expect(()=>service.recordUse(useReceipt({actorId:'bob'}))).toThrow('use receipt');
        service.recordUse(useReceipt());
        expect(()=>service.replace(replacementReceipt({acquiredItemId:1351}))).toThrow('replacement receipt');
        expect(()=>service.replace(replacementReceipt({acquisitionEvidenceDigest:'free'}))).toThrow('replacement receipt');
        store.close();});
    test('replays replacement exactly and persists the relation across restart',()=>{const path=databasePath();
        let store=new ItemLifecycleStore(path,lifecycle());create(store);let service=new ProductionToolCycleService(store,cycles());
        service.recordUse(useReceipt());const replaced=service.replace(replacementReceipt());
        expect(service.replace(replacementReceipt())).toEqual(replaced);store.close();
        store=new ItemLifecycleStore(path,lifecycle());service=new ProductionToolCycleService(store,cycles());
        expect(store.getReplacement('pickaxe-1')?.replacementItemInstanceId).toBe('pickaxe-2');
        expect(service.replace(replacementReceipt())).toEqual(replaced);expect(store.verifyAuditChain()).toBeTrue();store.close();});
    test('migrates additive replacement and repair ledgers from schema v1',()=>{const path=databasePath();
        let store=new ItemLifecycleStore(path,lifecycle());store.close();
        let database=new Database(path,{strict:true});database.run('DROP TABLE item_repair_evidence');
        database.run('DROP TABLE item_replacement');database.run('PRAGMA user_version = 1');
        database.close(true);store=new ItemLifecycleStore(path,lifecycle());expect(store.getReplacement('pickaxe-1')).toBeNull();store.close();
        database=new Database(path,{strict:true});expect((database.query('PRAGMA user_version').get() as{user_version:number}).user_version).toBe(3);
        expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='item_replacement'").get()).not.toBeNull();
        expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='item_repair_evidence'").get()).not.toBeNull();
        database.close(true);});
    test('rejects ambiguous cycle configuration',()=>{const configured=cycles();expect(()=>validateProductionToolCycleCatalog({schemaVersion:1,
        cycles:[configured.cycles[0]!,{...configured.cycles[0]!,cycleId:'duplicate-binding'}]},lifecycle()))
        .toThrow('unique ids');
        const runtime=cycles(),store=new ItemLifecycleStore(databasePath(),lifecycle());
        const service=new ProductionToolCycleService(store,runtime);runtime.cycles[0]!.outputItemIds.push(440);
        expect(()=>service.recordUse(useReceipt())).toThrow('catalog digest mismatch');store.close();});
});
