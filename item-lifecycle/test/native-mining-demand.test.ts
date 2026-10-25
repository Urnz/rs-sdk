import { afterEach,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeMiningDemandStore,type NativeMiningDemandObservation } from '../native-mining-demand.js';
import { readNativeToolDemandObservations } from '../../society-metrics/tool-demand.js';

const roots:string[]=[],dbs:Database[]=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close(true);for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function database(){const root=mkdtempSync(join(tmpdir(),'native-demand-'));roots.push(root);const path=join(root,'native.sqlite');
    const db=new Database(path,{strict:true});dbs.push(db);return{db,path};}
function observation(overrides:Partial<NativeMiningDemandObservation>={}):NativeMiningDemandObservation {
    return{protocol:'native-mining-demand-v1',requestId:'request-1',phase:'blocked',reason:'unusable-tool',cycleId:'bronze-pickaxe-mining',
        owner:{actorId:'alice',username:'alice',lifecycleId:'life-alice',worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64)},
        clock:{clockId:'clock',profileDigest:'b'.repeat(64),status:'running',engineTick:10,revision:1,
            simulationTime:'2001-01-01T00:00:01.000Z',wallTime:'2026-10-25T00:00:00.000Z'},bindingDigest:'c'.repeat(64),
        source:{type:1,x:3230,z:3149,level:0},item:{itemInstanceId:'tool-alice',lifecycleTypeId:'bronze-pickaxe',itemId:1265,ownerActorId:'alice',
            status:'broken',durability:0,maxDurability:100,qualityBasisPoints:10000,provenanceDigest:'d'.repeat(64),revision:2,
            createdAtSimulationTime:'2001-01-01T00:00:00.000Z',updatedAtSimulationTime:'2001-01-01T00:00:01.000Z'},...overrides};
}
const scope={clockId:'clock',clockProfileDigest:'b'.repeat(64),fromSimulationTime:'2001-01-01T00:00:00.000Z',
    toSimulationTime:'2001-01-08T00:00:00.000Z',actorAgentIds:['alice']};
const actors=[{agentId:'alice',username:'alice',lifecycleId:'life-alice'}];

test('additive upgrade preserves legacy state/user_version, reopens, and never backfills demand',()=>{
    const {db,path}=database();db.exec('PRAGMA user_version=37;CREATE TABLE legacy(value TEXT);INSERT INTO legacy VALUES(\'kept\')');
    const store=new NativeMiningDemandStore(db);expect(NativeMiningDemandStore.read(db).entries).toHaveLength(0);
    expect(db.query('PRAGMA user_version').get()).toEqual({user_version:37});expect(db.query('SELECT * FROM legacy').all()).toEqual([{value:'kept'}]);
    const event=observation();store.append(event);store.append(event);
    const reopened=new Database(path,{readonly:true,strict:true});dbs.push(reopened);
    expect(NativeMiningDemandStore.read(reopened).entries.map(e=>e.observation)).toEqual([event]);
    new NativeMiningDemandStore(db);expect(NativeMiningDemandStore.read(db).head.sequence).toBe(1);
    expect(()=>store.append({...event,reason:'invalid-evidence'})).toThrow('conflict');
    expect(()=>db.run('DELETE FROM native_mining_demand_event')).toThrow('immutable');
    expect(()=>db.run("UPDATE native_mining_demand_event SET payload='{}'")).toThrow('immutable');
});

test('unsupported version rolls back local upgrade DDL without touching legacy state',()=>{
    const {db}=database();db.exec('CREATE TABLE native_mining_demand_schema(version INTEGER PRIMARY KEY);INSERT INTO native_mining_demand_schema VALUES(2)');
    expect(()=>new NativeMiningDemandStore(db)).toThrow('Unsupported');
    expect(db.query("SELECT name FROM sqlite_master WHERE name='native_mining_demand_event'").get()).toBeNull();
    expect(db.query('SELECT * FROM native_mining_demand_schema').all()).toEqual([{version:2}]);
});

test('outer native transaction rolls back observation and chain head together',()=>{
    const {db}=database(),store=new NativeMiningDemandStore(db);
    expect(()=>db.transaction(()=>{store.append(observation());throw Error('checkpoint failure');}).immediate()).toThrow('checkpoint failure');
    expect(NativeMiningDemandStore.read(db)).toEqual({entries:[],head:{sequence:0,digest:null}});
    store.append(observation());expect(NativeMiningDemandStore.read(db).head.sequence).toBe(1);
});

test('reader detects truncated tails and altered history, not just row digests',()=>{
    const a=database(),store=new NativeMiningDemandStore(a.db);store.append(observation());
    a.db.exec('DROP TRIGGER native_mining_demand_no_delete;DELETE FROM native_mining_demand_event');
    expect(()=>NativeMiningDemandStore.read(a.db)).toThrow('tail mismatch');expect(()=>store.append(observation())).toThrow('tail mismatch');
    const b=database();new NativeMiningDemandStore(b.db).append(observation());
    b.db.exec("DROP TRIGGER native_mining_demand_no_update;UPDATE native_mining_demand_event SET payload='{}'");
    expect(()=>NativeMiningDemandStore.read(b.db)).toThrow('audit mismatch');
});

test('invalid clock/custody cannot attest admission or an unusable bound tool',()=>{
    const {db}=database(),store=new NativeMiningDemandStore(db),event=observation();
    expect(()=>store.append({...event,clock:{...event.clock,clockId:'foreign'}})).toThrow('clock');
    expect(()=>store.append({...event,phase:'admitted',reason:null})).toThrow('usable');
    expect(()=>store.append({...event,item:null})).toThrow('requires tool evidence');
    expect(NativeMiningDemandStore.read(db).entries).toHaveLength(0);
});

test('readonly scope counts failed native requests, never interpolates seven days between clicks',()=>{
    const {db,path}=database(),store=new NativeMiningDemandStore(db),first=observation();store.append(first);
    store.append({...first,requestId:'request-2',clock:{...first.clock,engineTick:999,simulationTime:'2001-01-07T23:59:59.000Z'}});
    const before=readFileSync(path),report=readNativeToolDemandObservations(db,scope,'world',actors);
    expect(report.actors[0]).toMatchObject({attemptedRequests:2,unusableToolRequests:2,committedRequests:0});
    expect(report.unusableDemandSimulationMilliseconds).toBeNull();expect(report.minimumVerdict).toBe('inconclusive');
    expect(report.coverage).toBe('attempt-observations-only');expect(readFileSync(path)).toEqual(before);
    expect(()=>readNativeToolDemandObservations(db,scope,'foreign',actors)).toThrow('world/clock/lifecycle');
    expect(()=>readNativeToolDemandObservations(db,scope,'world',[{...actors[0]!,lifecycleId:'other-life'}])).toThrow('lifecycle');
    const empty=readNativeToolDemandObservations(db,{...scope,fromSimulationTime:scope.toSimulationTime,toSimulationTime:'2001-01-09T00:00:00.000Z'},'world',actors);
    expect(empty.actors[0]!.attemptedRequests).toBe(0);expect(empty.minimumVerdict).toBe('inconclusive');
});

test('missing ledger stays absent and a regressed observed clock is rejected',()=>{
    const {db}=database();expect(readNativeToolDemandObservations(db,scope,'world',actors).coverage).toBe('source-absent');
    expect(NativeMiningDemandStore.present(db)).toBeFalse();const store=new NativeMiningDemandStore(db),first=observation();store.append(first);
    store.append({...first,requestId:'request-2',clock:{...first.clock,engineTick:9}});
    expect(()=>readNativeToolDemandObservations(db,scope,'world',actors)).toThrow('clock regressed');
});
