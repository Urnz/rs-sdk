import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ItemLifecycleStore, loadItemLifecycleCatalog, validateItemLifecycleCatalog } from '../index.js';

const directories: string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function path(){const directory=mkdtempSync(join(tmpdir(),'item-lifecycle-'));directories.push(directory);return join(directory,'items.sqlite');}
const catalog=()=>loadItemLifecycleCatalog(join(import.meta.dir,'..','..','config','item-lifecycle.json'));
function create(store:ItemLifecycleStore){return store.create({itemInstanceId:'pickaxe-1',lifecycleTypeId:'bronze-pickaxe',
    ownerActorId:'ada',qualityBasisPoints:10_000,provenanceDigest:'a'.repeat(64),
    atSimulationTime:'2030-01-01T00:00:00.000Z'});}

describe('persistent item lifecycle',()=>{
    test('loads strict configurable lifecycle definitions',()=>{
        expect(catalog().items[0]).toMatchObject({itemId:1265,maxDurability:100,wearPerUse:1,repairable:true});
        expect(()=>validateItemLifecycleCatalog({schemaVersion:1,items:[{...catalog().items[0],wearPerUse:101}]}))
            .toThrow('invalid');
    });
    test('creates a provenance-bound instance and wears it through verified use',()=>{
        const store=new ItemLifecycleStore(path(),catalog());expect(create(store)).toMatchObject({durability:100,
            status:'usable',qualityBasisPoints:10_000,revision:1});
        const used=store.use('use-1','pickaxe-1',1,25,'b'.repeat(64),'2030-01-01T01:00:00.000Z');
        expect(used).toMatchObject({durability:75,status:'usable',revision:2});
        expect(store.verifyAuditChain()).toBeTrue();store.close();
    });
    test('breaks at zero, blocks further use and repairs only with evidence',()=>{
        const store=new ItemLifecycleStore(path(),catalog());create(store);
        expect(store.use('use-break','pickaxe-1',1,100,'b'.repeat(64),'2030-01-01T01:00:00.000Z'))
            .toMatchObject({durability:0,status:'broken',revision:2});
        expect(()=>store.use('use-after-break','pickaxe-1',2,1,'c'.repeat(64),'2030-01-01T02:00:00.000Z'))
            .toThrow('Broken item');
        expect(()=>store.repair('repair-bad','pickaxe-1',2,20,'bad','2030-01-01T02:00:00.000Z'))
            .toThrow('evidence');
        expect(store.repair('repair-1','pickaxe-1',2,20,'d'.repeat(64),'2030-01-01T02:00:00.000Z'))
            .toMatchObject({durability:20,status:'usable',revision:3});store.close();
    });
    test('makes mutation replay exact and rejects stale or changed operation ids',()=>{
        const store=new ItemLifecycleStore(path(),catalog());create(store);
        const used=store.use('use-1','pickaxe-1',1,10,'b'.repeat(64),'2030-01-01T01:00:00.000Z');
        store.use('use-2','pickaxe-1',2,10,'c'.repeat(64),'2030-01-01T02:00:00.000Z');
        expect(store.use('use-1','pickaxe-1',1,10,'b'.repeat(64),'2030-01-01T01:00:00.000Z')).toEqual(used);
        expect(()=>store.use('use-1','pickaxe-1',1,11,'b'.repeat(64),'2030-01-01T01:00:00.000Z')).toThrow('reused');
        expect(()=>store.use('use-stale','pickaxe-1',1,1,'d'.repeat(64),'2030-01-01T03:00:00.000Z')).toThrow('changed');
        expect(()=>store.use('use-backdated','pickaxe-1',3,1,'e'.repeat(64),'2029-12-31T23:00:00.000Z'))
            .toThrow('precedes');
        store.close();
    });
    test('persists across restart and detects altered audit history',()=>{
        const databasePath=path();let store=new ItemLifecycleStore(databasePath,catalog());create(store);store.close();
        store=new ItemLifecycleStore(databasePath,catalog());expect(store.get('pickaxe-1')?.provenanceDigest).toBe('a'.repeat(64));
        expect(store.verifyAuditChain()).toBeTrue();store.close();
        const database=new Database(databasePath,{strict:true});database.run("UPDATE item_lifecycle_audit SET payload_json='{}' WHERE sequence=1");database.close(true);
        store=new ItemLifecycleStore(databasePath,catalog());expect(store.verifyAuditChain()).toBeFalse();store.close();
    });
});
