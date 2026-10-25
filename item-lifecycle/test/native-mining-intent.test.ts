import { afterEach,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeMiningIntentStore,type NativeMiningIntentRecord } from '../native-mining-intent.js';
import { readNativeMiningIntentIntervals } from '../../society-metrics/tool-demand-intervals.js';
import { loadSocietyMinimumPolicy } from '../../society-minimum/policy.js';
const dbs:Database[]=[],roots:string[]=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close(true);for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'mining-intent-'));roots.push(root);const path=join(root,'native.sqlite');
    const db=new Database(path,{strict:true});dbs.push(db);const store=new NativeMiningIntentStore(db);return{db,store,path};}
const sim=Date.UTC(2001,0,1),wall=Date.UTC(2026,9,25);
export function intentRecord():NativeMiningIntentRecord{return{schemaVersion:1,revision:1,phase:'pending',completionEventId:null,
    intent:{demandId:randomUUID(),owner:{actorId:'alice',username:'alice',lifecycleId:'life-alice',worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64)},
        outputItemId:436,contextDigest:'c'.repeat(64),authorityDigest:'d'.repeat(64),maximumWallMilliseconds:300000,expiresAtWallTime:new Date(wall+300000).toISOString()},
    sample:{clock:{clockId:'clock',profileDigest:'b'.repeat(64),engineTick:1,revision:1,status:'running',wallTime:new Date(wall).toISOString(),simulationTime:new Date(sim).toISOString()},
        sessionId:'session-1',availability:'unusable',itemInstanceId:'tool-alice',itemRevision:2,reason:null}};}
const scope={clockId:'clock',clockProfileDigest:'b'.repeat(64),actorAgentIds:['alice'],fromSimulationTime:new Date(sim).toISOString(),toSimulationTime:new Date(sim+7200000).toISOString()};
const policy=loadSocietyMinimumPolicy(join(import.meta.dir,'../../config/society-minimum-policy.json'));
const actors=[{agentId:'alice',username:'alice',lifecycleId:'life-alice'}];
function next(r:NativeMiningIntentRecord,delta=600000):NativeMiningIntentRecord{return{...r,revision:r.revision+1,sample:{...r.sample,
    clock:{...r.sample.clock,engineTick:r.sample.clock.engineTick!+1,simulationTime:new Date(Date.parse(r.sample.clock.simulationTime)+delta).toISOString(),
        wallTime:new Date(Date.parse(r.sample.clock.wallTime)+600).toISOString()}}};}

test('owned additive schema preserves shared user_version and legacy tables across reopen and reinitialization',()=>{
    const {db,path,store}=fixture();db.exec('PRAGMA user_version=37;CREATE TABLE legacy(value INTEGER);INSERT INTO legacy VALUES(9)');
    const r=intentRecord();store.write(r);new NativeMiningIntentStore(db);
    const reopened=new Database(path,{readonly:true});dbs.push(reopened);
    expect(NativeMiningIntentStore.read(reopened).entries[0]!.record).toEqual(r);
    expect(db.query('PRAGMA user_version').get()).toEqual({user_version:37});expect(db.query('SELECT * FROM legacy').all()).toEqual([{value:9}]);
    expect(()=>db.run('DELETE FROM native_mining_intent_state')).toThrow('discarded');
    expect(()=>db.run('DELETE FROM native_mining_intent_audit')).toThrow('immutable');
    expect(()=>db.run("UPDATE native_mining_intent_audit SET payload='{}'")).toThrow('immutable');
});

test('intent/terminal/revision conflicts and overlapping pending requests roll back their audit and projection atomically',()=>{
    const {db,store}=fixture(),r=intentRecord();store.write(r);const before=NativeMiningIntentStore.read(db);
    expect(()=>store.write({...next(r),intent:{...r.intent,outputItemId:438}})).toThrow('immutable');
    expect(()=>store.write(intentRecord())).toThrow();expect(NativeMiningIntentStore.read(db)).toEqual(before);
    expect(()=>db.transaction(()=>{store.write(next(r));throw Error('failure');}).immediate()).toThrow('failure');
    expect(NativeMiningIntentStore.read(db)).toEqual(before);
    const closed=store.write({...next(r),phase:'cancelled'});expect(()=>store.write(next(closed))).toThrow('terminal');
});

test('unsupported local version rolls back newly attempted DDL',()=>{
    const db=new Database(':memory:');dbs.push(db);
    db.exec('CREATE TABLE native_mining_intent_schema(version INTEGER PRIMARY KEY);INSERT INTO native_mining_intent_schema VALUES(2)');
    expect(()=>new NativeMiningIntentStore(db)).toThrow('Unsupported');
    expect(db.query("SELECT name FROM sqlite_master WHERE name='native_mining_intent_state'").get()).toBeNull();
});

test('source detects missing tail, altered audit and tampered current projection',()=>{
    const a=fixture();a.store.write(intentRecord());a.db.exec('DROP TRIGGER native_mining_intent_no_delete;DELETE FROM native_mining_intent_audit');
    expect(()=>NativeMiningIntentStore.read(a.db)).toThrow('tail');
    const b=fixture();b.store.write(intentRecord());b.db.exec("DROP TRIGGER native_mining_intent_no_update;UPDATE native_mining_intent_audit SET payload='{}'");
    expect(()=>NativeMiningIntentStore.read(b.db)).toThrow('audit');
    const c=fixture();c.store.write(intentRecord());c.db.exec("UPDATE native_mining_intent_state SET phase='cancelled'");
    expect(()=>NativeMiningIntentStore.read(c.db)).toThrow('projection');
});

test('longest confirmed request is clipped to the query window; cancellation does not erase an observed violation',()=>{
    const {db,store}=fixture();let r=intentRecord();store.write(r);
    for(let index=0;index<7;index++){r=next(r);store.write(r);}store.write({...next(r,0),phase:'cancelled'});
    const report=readNativeMiningIntentIntervals(db,scope,'world',actors,policy);
    expect(report.longestConfirmedUnusableSimulationMs).toBe(4200000);expect(report.verdict).toBe('fail');
    const clipped=readNativeMiningIntentIntervals(db,{...scope,fromSimulationTime:new Date(sim+4000000).toISOString()},'world',actors,policy);
    expect(clipped.longestConfirmedUnusableSimulationMs).toBe(200000);expect(clipped.verdict).toBe('inconclusive');
    expect(()=>readNativeMiningIntentIntervals(db,scope,'foreign',actors,policy)).toThrow('world/clock/lifecycle');
});

test('separate requests, changed tool state and unobserved open tails never become summed unusable time or a PASS',()=>{
    const {db,store}=fixture();let r=intentRecord();store.write(r);r=next(r,2400000);store.write(r);
    const end={...next(r,0),phase:'cancelled' as const};store.write(end);
    let second=intentRecord();second={...second,sample:{...second.sample,clock:{...second.sample.clock,
        simulationTime:new Date(sim+2400000).toISOString(),engineTick:3,wallTime:new Date(wall+1200).toISOString()}},
        intent:{...second.intent,expiresAtWallTime:new Date(wall+301200).toISOString()}};
    store.write(second);second=next(second,2400000);store.write(second);
    const report=readNativeMiningIntentIntervals(db,scope,'world',actors,policy);
    expect(report.longestConfirmedUnusableSimulationMs).toBe(2400000);expect(report.verdict).toBe('inconclusive');
    expect(report.requests.at(-1)!.intervals.at(-1)!.status).toBe('unobserved-open-tail');
    const changed={...next(second),sample:{...next(second).sample,itemRevision:3}};store.write(changed);
    expect(readNativeMiningIntentIntervals(db,scope,'world',actors,policy).requests.at(-1)!.intervals.some(i=>i.status==='other-or-unobserved')).toBeTrue();
});

test('forged fulfillment without a real native Mining output is invalid evidence',()=>{
    const {db,store}=fixture(),r=intentRecord();store.write(r);db.exec('CREATE TABLE native_tool_event(event_id TEXT,payload TEXT,digest TEXT)');
    store.write({...next(r),phase:'fulfilled',completionEventId:'not-a-native-output'});
    expect(()=>readNativeMiningIntentIntervals(db,scope,'world',actors,policy)).toThrow('native output');
});
