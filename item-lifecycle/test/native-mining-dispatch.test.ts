import { afterEach,expect,test } from 'bun:test';
import { join } from 'node:path';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { miningSourceFixture } from '../../agent-skills/test/mining-demand-fixture.js';
import { persistMiningDemandInvocation } from '../../agent-skills/mining-demand-source.js';
import { persistMiningInteractionSource,readMiningInteractionSource,miningDispatchId } from '../../agent-skills/mining-interaction-source.js';
import { sealMiningOperationAdmission } from '../../agent-skills/mining-admission.js';
import { validateMiningInteractionRequest,type MiningInteractionRequest } from '../../sdk/mining-interaction.js';
import { NativeMiningDispatchStore,type NativeMiningDispatch } from '../native-mining-dispatch.js';
const fixtures:ReturnType<typeof miningSourceFixture>[]=[],dbs:OwnedDatabase[]=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close();for(const f of fixtures.splice(0))f.close();});
function fixture(){const f=miningSourceFixture();fixtures.push(f);f.admit();persistMiningDemandInvocation(f.root,f.owner,f.request);
    const request:MiningInteractionRequest={demand:f.request,dispatchSequence:1,target:{x:3230,z:3149,locId:2090,optionIndex:1}};
    return{...f,request};}
test('exact executor/sequence/target sidecar is immutable; same sequence cannot authorize another target',()=>{
    const f=fixture(),a=persistMiningInteractionSource(f.root,f.owner,f.request),b=persistMiningInteractionSource(f.root,f.owner,f.request);
    expect(a).toEqual(b);expect(readMiningInteractionSource(f.root,a.id).request).toEqual(f.request);
    expect(()=>persistMiningInteractionSource(f.root,f.owner,{...f.request,target:{...f.request.target,x:3232}})).toThrow('conflict');
    const next={...f.request,dispatchSequence:2};expect(miningDispatchId(next)).not.toBe(a.id);
    sealMiningOperationAdmission(f.root,f.request.demand);expect(()=>persistMiningInteractionSource(f.root,f.owner,next)).toThrow('sealed');
});
test('posted authority/receipts, wrong operation, excessive retargets and unrelated option are rejected',()=>{
    const f=fixture();
    for(const request of [{...f.request,owner:f.owner},{...f.request,receipt:{fulfilled:true}},
        {...f.request,dispatchSequence:f.request.demand.args.maxRetargets+1},{...f.request,demand:{...f.request.demand,operation:'close'}},
        {...f.request,target:{...f.request.target,optionIndex:2}}])expect(()=>validateMiningInteractionRequest(request as any)).toThrow();
    expect(()=>persistMiningInteractionSource(f.root,{...f.owner,username:'other'},f.request)).toThrow('population');
});
test('own dispatch schema preserves shared version/legacy data, consumes once, rolls back and reopens readonly',()=>{
    const f=fixture(),path=join(f.root,'dispatch.sqlite'),db=new OwnedDatabase(path);dbs.push(db);
    db.exec('PRAGMA user_version=37;CREATE TABLE legacy(value INTEGER);INSERT INTO legacy VALUES(9)');
    const store=new NativeMiningDispatchStore(db,true),s=persistMiningInteractionSource(f.root,f.owner,f.request);
    const row:NativeMiningDispatch={schemaVersion:1,dispatchId:s.id,demandId:f.demandId,owner:f.owner,sourceDigest:s.digest,request:f.request,level:0,
        clock:f.clock.observeNow(f.owner.clockId,1)};
    expect(()=>db.transaction(()=>{store.admit(row);throw Error('rollback');}).immediate()).toThrow('rollback');expect(store.get(row.dispatchId)).toBeNull();
    store.admit(row);expect(()=>store.admit(row)).toThrow('consumed');new NativeMiningDispatchStore(db,true);
    expect(()=>db.run('DELETE FROM native_mining_dispatch')).toThrow('immutable');expect(()=>db.run('UPDATE native_mining_dispatch SET payload=payload')).toThrow('immutable');
    expect(db.query('PRAGMA user_version').get()).toEqual({user_version:37});expect(db.query('SELECT * FROM legacy').all()).toEqual([{value:9}]);
    const read=new OwnedDatabase(path,{readonly:true});dbs.push(read);expect(new NativeMiningDispatchStore(read).read()).toEqual([row]);
    db.exec("DROP TRIGGER native_mining_dispatch_no_update;UPDATE native_mining_dispatch SET payload='{}'");expect(()=>store.read()).toThrow();
});
test('unsupported local schema rolls back attempted DDL without migrating another component',()=>{
    const db=new OwnedDatabase(':memory:');dbs.push(db);db.exec('CREATE TABLE native_mining_dispatch_schema(version INTEGER);INSERT INTO native_mining_dispatch_schema VALUES(2)');
    expect(()=>new NativeMiningDispatchStore(db,true)).toThrow('Unsupported');
    expect(db.query("SELECT name FROM sqlite_master WHERE name='native_mining_dispatch'").get()).toBeNull();
});
