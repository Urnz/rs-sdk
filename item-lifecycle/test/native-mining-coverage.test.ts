import { afterEach,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeMiningCoverageStore,miningCoverageSourceHeads,miningRosterDigest,type NativeMiningCoverageSelection,type NativeMiningCoverageSample } from '../native-mining-coverage.js';
import { NativeMiningDemandStore } from '../native-mining-demand.js';
import { NativeMiningIntentStore } from '../native-mining-intent.js';
import { readNativeMiningCohortCoverage } from '../../society-metrics/tool-demand-coverage.js';
const dbs:Database[]=[],roots:string[]=[];
afterEach(()=>{for(const db of dbs.splice(0))db.close(true);for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
    const root=mkdtempSync(join(tmpdir(),'si-c07-coverage-'));roots.push(root);const path=join(root,'source.sqlite');
    const db=new OwnedDatabase(path,{strict:true});dbs.push(db);new NativeMiningDemandStore(db);new NativeMiningIntentStore(db);
    const actors=['alice','bob','carol','dave'].map(username=>({actorId:username,username,lifecycleId:`life-${username}`,
        worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64)}));
    const selection:NativeMiningCoverageSelection={schemaVersion:1,selectionId:randomUUID(),worldId:'world',clockId:'clock',clockProfileDigest:'b'.repeat(64),actors,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-01T00:00:01.200Z',maximumSimulationGapMs:600,maximumWallGapMs:1000,
        openingHeads:miningCoverageSourceHeads(db)};
    const store=new NativeMiningCoverageStore(db,selection),scope={clockId:selection.clockId,clockProfileDigest:selection.clockProfileDigest,
        fromSimulationTime:selection.fromSimulationTime,toSimulationTime:selection.toSimulationTime,actorAgentIds:actors.map(a=>a.actorId)};
    const outcomeActors=actors.map(a=>({agentId:a.actorId,username:a.username,lifecycleId:a.lifecycleId}));
    function sample(tick:number):NativeMiningCoverageSample{return{kind:'sample',clock:{clockId:'clock',profileDigest:'b'.repeat(64),status:'running',revision:1,engineTick:tick,
        simulationTime:new Date(Date.parse(selection.fromSimulationTime)+tick*600).toISOString(),wallTime:new Date(Date.UTC(2026,9,25)+tick*600).toISOString()},
        sessionId:'session-1',rosterDigest:miningRosterDigest(actors),heads:miningCoverageSourceHeads(db),ingressWriteFailed:false,
        actors:actors.map(a=>({actorId:a.actorId,status:'observed',demandId:null}))};}
    return{db,path,store,selection,scope,actors,outcomeActors,sample,read:()=>readNativeMiningCohortCoverage(db,scope,'world',outcomeActors)};
}
test('prospective four-founder frames bind the full window and heads, but an empty queue never proves zero demand or PASS',()=>{
    const f=fixture();for(let tick=0;tick<3;tick++)f.store.append(f.sample(tick));const before=f.db.serialize();
    const report=f.read();expect(report.observerCoverageComplete).toBeTrue();expect(report.completeDemandCoverage).toBeFalse();
    expect(report.status).toBe('observed-window');expect(report.gaps).toHaveLength(0);expect(report).toMatchObject({selectedIngresses:0,compatibleIntentIngresses:0});
    expect(f.db.serialize()).toEqual(before);
});
test('missing observer, restart, offline founder, identity/source loss, changed roster and write failure remain explicit gaps',()=>{
    for(const mode of ['missing','restart','offline','identity-unavailable','source-unavailable','roster','write','clock'] as const){
        const f=fixture();f.store.append(f.sample(0));
        if(mode!=='missing'){
            const middle=f.sample(1);
            if(mode==='restart')middle.sessionId='session-2';
            else if(['offline','identity-unavailable','source-unavailable'].includes(mode))middle.actors[3]!.status=mode as 'offline';
            else if(mode==='roster')middle.rosterDigest=null;
            else if(mode==='write')middle.ingressWriteFailed=true;
            else if(mode==='clock')middle.clock.wallTime=new Date(Date.parse(middle.clock.wallTime)+1100).toISOString();
            f.store.append(middle);
        }
        const end=f.sample(2);if(mode==='clock')end.clock.wallTime=new Date(Date.parse(end.clock.wallTime)+1100).toISOString();
        f.store.append(end);const report=f.read();expect(report.observerCoverageComplete).toBeFalse();expect(report.gaps.length).toBeGreaterThan(0);
        expect(report.completeDemandCoverage).toBeFalse();
    }
});
test('no frames or partial endpoints cannot establish coverage; late samples cannot erase prior gaps',()=>{
    const f=fixture();expect(f.read().observerCoverageComplete).toBeFalse();f.store.append(f.sample(1));
    expect(f.read().gaps.some(g=>g.reason==='unobserved-window-start')).toBeTrue();f.store.append(f.sample(2));
    expect(f.read().observerCoverageComplete).toBeFalse();
});
test('a missing founder at the pre-window bracket cannot be hidden by healthy samples inside the window',()=>{
    const f=fixture(),early=f.sample(0);early.clock.simulationTime='2000-12-31T23:59:59.900Z';early.actors[3]!.status='offline';
    const first=f.sample(1);first.clock.simulationTime='2001-01-01T00:00:00.500Z';
    const second=f.sample(2);second.clock.simulationTime='2001-01-01T00:00:01.100Z';
    const last=f.sample(3);last.clock.simulationTime='2001-01-01T00:00:01.700Z';
    for(const sample of [early,first,second,last])f.store.append(sample);
    expect(f.read().gaps).toContainEqual({kind:'observer',reason:'offline',sequence:1,actorId:'dave'});
    expect(f.read().observerCoverageComplete).toBeFalse();
});
test('legacy or unsupported native ingress is retained before tool/identity exits and cannot become a bound request',()=>{
    const f=fixture();f.store.append(f.sample(0));const frame=f.sample(1);
    f.store.append({kind:'ingress',clock:frame.clock,sessionId:frame.sessionId,username:'dave',nativeActionId:randomUUID(),
        demandId:null,reason:'no-standing-request',heads:frame.heads});f.store.append(frame);f.store.append(f.sample(2));
    expect(f.read()).toMatchObject({observerCoverageComplete:true,completeDemandCoverage:false,selectedIngresses:1,compatibleIntentIngresses:0});
    expect(f.read().gaps[0]).toMatchObject({kind:'ingress',actorId:'dave',reason:'no-standing-request'});
    expect(()=>f.store.append({kind:'ingress',clock:frame.clock,sessionId:frame.sessionId,username:'dave',nativeActionId:randomUUID(),
        demandId:null,reason:'compatible-request',heads:frame.heads})).toThrow('ingress');
});
test('window/roster/world/clock cannot be narrowed or substituted by the export caller',()=>{
    const f=fixture();
    for(const scope of [{...f.scope,actorAgentIds:['alice']},{...f.scope,toSimulationTime:'2001-01-01T00:00:01.000Z'},
        {...f.scope,clockId:'other'},{...f.scope,clockProfileDigest:'c'.repeat(64)}])expect(()=>readNativeMiningCohortCoverage(f.db,scope,'world',f.outcomeActors)).toThrow('selection');
    expect(()=>readNativeMiningCohortCoverage(f.db,f.scope,'other',f.outcomeActors)).toThrow('selection');
});
test('owned schema preserves legacy data and user_version; selection, history and conflicting observations cannot mutate',()=>{
    const f=fixture();f.db.exec('PRAGMA user_version=37;CREATE TABLE legacy(value INTEGER);INSERT INTO legacy VALUES(9)');
    const sample=f.sample(0);f.store.append(sample);f.store.append(sample);new NativeMiningCoverageStore(f.db,f.selection);
    expect(()=>new NativeMiningCoverageStore(f.db,{...f.selection,selectionId:randomUUID()})).toThrow('conflict');
    expect(()=>f.store.append({...sample,ingressWriteFailed:true})).toThrow('conflict');
    expect(()=>f.db.run('DELETE FROM native_mining_coverage_selection')).toThrow('immutable');
    expect(()=>f.db.run('UPDATE native_mining_coverage_event SET payload=payload')).toThrow('immutable');
    expect(()=>f.db.run('DELETE FROM native_mining_coverage_event')).toThrow('immutable');
    expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:37});expect(f.db.query('SELECT * FROM legacy').all()).toEqual([{value:9}]);
    const reopened=new OwnedDatabase(f.path,{readonly:true});dbs.push(reopened);expect(new NativeMiningCoverageStore(reopened).read()).toEqual(f.store.read());
});
test('rollback, altered chain/tail and substituted source prefix fail closed without backfill',()=>{
    const f=fixture();expect(()=>f.db.transaction(()=>{f.store.append(f.sample(0));throw Error('rollback');}).immediate()).toThrow('rollback');
    expect(f.store.read().entries).toHaveLength(0);
    const bad=f.sample(0);bad.heads.attempt={sequence:1,digest:'a'.repeat(64)};f.store.append(bad);
    expect(()=>f.read()).toThrow('prefix');
    const g=fixture();g.store.append(g.sample(0));g.db.exec('UPDATE native_mining_coverage_head SET sequence=0,digest=NULL');
    expect(()=>g.store.read()).toThrow('tail');
    const h=fixture();h.store.append(h.sample(0));h.db.exec("DROP TRIGGER native_mining_coverage_no_update;UPDATE native_mining_coverage_event SET payload='{}'");
    expect(()=>h.read()).toThrow('audit');
});
test('unversioned component initialization rolls back its DDL; no selection means absent, never complete',()=>{
    const f=fixture(),db=new Database(':memory:');dbs.push(db);
    expect(readNativeMiningCohortCoverage(db,f.scope,'world',f.outcomeActors).status).toBe('source-absent');
    db.exec('CREATE TABLE native_mining_coverage_head(singleton INTEGER,sequence INTEGER,digest TEXT);INSERT INTO native_mining_coverage_head VALUES(1,2,NULL)');
    expect(()=>new NativeMiningCoverageStore(db,f.selection)).toThrow('Unversioned');
    expect(db.query("SELECT name FROM sqlite_master WHERE name='native_mining_coverage_selection'").get()).toBeNull();
});
