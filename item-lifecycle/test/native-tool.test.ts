import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { NativeToolStore, nativeToolCatalog } from '../native-tool.js';
import { ItemLifecycleStore } from '../store.js';
const databases: Database[] = [];
afterEach(()=>{for(const db of databases.splice(0)){(db as Database&{clearQueryCache():void}).clearQueryCache();db.close(true);}});
function fixture(){const db=new Database(':memory:');databases.push(db);db.run('PRAGMA user_version=42');
    const store=new NativeToolStore(db);store.lifecycle.create({itemInstanceId:'pick-1',lifecycleTypeId:'bronze-pickaxe',ownerActorId:'alice',
        qualityBasisPoints:10000,provenanceDigest:'a'.repeat(64),atSimulationTime:'2001-01-01T00:00:00.000Z'});return{db,store};}
test('borrowed lifecycle owns a component version and never changes/closes the shared DB',()=>{
    const {db,store}=fixture();expect(db.query('PRAGMA user_version').get()).toEqual({user_version:42});
    expect(db.query('SELECT version FROM item_lifecycle_schema').get()).toEqual({version:3});
    store.lifecycle.close();expect(new NativeToolStore(db).lifecycle.get('pick-1')!.durability).toBe(100);
    db.run('UPDATE item_lifecycle_schema SET version=4');expect(()=>new ItemLifecycleStore(db,nativeToolCatalog)).toThrow('newer');
});
test('borrowed lifecycle/output receipt rollback together; no pending wear can be lost',()=>{
    const {db,store}=fixture();expect(()=>db.transaction(()=>{
        store.lifecycle.use('mine-1','pick-1',1,1,'b'.repeat(64),'2001-01-01T00:00:01.000Z');
        store.append('mine-1',{kind:'mined'});throw new Error('checkpoint fault');
    }).immediate()).toThrow('checkpoint fault');
    expect(store.lifecycle.get('pick-1')!.durability).toBe(100);expect(store.event('mine-1')).toBeNull();
    expect(store.lifecycle.verifyAuditChain()).toBeTrue();
});
test('audited ownership transfer retains exact durability/provenance, including broken tools',()=>{
    const {store}=fixture();const worn=store.lifecycle.use('mine-100','pick-1',1,100,'b'.repeat(64),'2001-01-01T00:00:01.000Z');
    const move=()=>store.lifecycle.transfer('trade-1','pick-1',worn.revision,'alice','bob','c'.repeat(64),'2001-01-01T00:00:02.000Z');
    expect(move()).toMatchObject({ownerActorId:'bob',durability:0,status:'broken',provenanceDigest:'a'.repeat(64)});
    expect(move().revision).toBe(worn.revision+1);expect(store.lifecycle.verifyAuditChain()).toBeTrue();
    expect(()=>store.lifecycle.transfer('trade-1','pick-1',worn.revision,'alice','cora','c'.repeat(64),'2001-01-01T00:00:02.000Z')).toThrow('reused');
    expect(store.cycle.utility('bronze-pickaxe-mining','pick-1','bob').capabilityAvailable).toBeFalse();
});
