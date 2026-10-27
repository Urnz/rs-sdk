import { expect,test } from 'bun:test';
import { existsSync,readFileSync,rmSync,readdirSync,copyFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnedDatabase as Database } from '../../server/engine/src/io/OwnedDatabase.js';
import { prepareExpandedBaseline,captureExpandedArchive,restoreExpandedArchive,compareExpandedArchives,verifyExpandedArchive } from '../expanded-baseline.js';
import { verifySocietyArchive } from '../archive.js';
import { expandedFixture,put } from './expanded-fixture.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { NativeMiningIntentStore } from '../../item-lifecycle/native-mining-intent.js';
import { randomUUID } from 'node:crypto';
import { NativeMiningDemandStore } from '../../item-lifecycle/native-mining-demand.js';
import { NativeMiningCoverageStore,miningCoverageSourceHeads } from '../../item-lifecycle/native-mining-coverage.js';
import { NativeMiningDispatchStore } from '../../item-lifecycle/native-mining-dispatch.js';
import { NativeMiningRequestStore } from '../../item-lifecycle/native-mining-requests.js';
import { installMiningExecutorSource } from '../../agent-skills/mining-request-source.js';
import { NativeMaterialStore } from '../../production-workflow/native-material.js';
import { NativeMortalityCoverageStore } from '../../population-lifecycle/native-coverage.js';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';

test('selected native mortality observation schema is pinned and restored; invalid head prevents a new baseline',()=>{
    const f=expandedFixture(),db=new OwnedDatabase(join(f.root,f.checkpoint)),zero={sequence:0,digest:'0'.repeat(64)};
    try{new NativeMortalityCoverageStore(db,{schemaVersion:1,selectionId:randomUUID(),worldId:f.selected.worldId,clockId:f.selected.clockId,
        clockProfileDigest:f.selected.clockProfileDigest,fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',
        maximumSimulationGapMs:1000,maximumWallGapMs:1000,agePolicyDigest:'a'.repeat(64),mortalityPolicyDigest:'b'.repeat(64),survivalSelectionDigest:null,
        actors:[{actorId:'worker',username:'worker',lifecycleId:'a'.repeat(64),membershipDigest:'b'.repeat(64)}],openingHealthHeads:{damage:zero,death:zero,binding:zero}});
    }finally{db.close(true);}
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_mortality_schema','native_mortality_selection','native_mortality_event','native_mortality_head');
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const read=new OwnedDatabase(join(f.output,'workspace',f.checkpoint),{readonly:true});try{expect(new NativeMortalityCoverageStore(read).read().entries).toEqual([]);}finally{read.close(true);}
    const changed=new OwnedDatabase(join(f.root,f.checkpoint));try{changed.run('UPDATE native_mortality_head SET sequence=1');}finally{changed.close(true);}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('head');
});

test('explicit prospective material journal is pinned and restored; corrupted head prevents a new baseline',()=>{
    const f=expandedFixture(),db=new OwnedDatabase(join(f.root,f.checkpoint));
    try{db.transaction(()=>new NativeMaterialStore(db,true)).immediate();}finally{db.close(true);}
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_material_schema','native_material_event','native_material_head','native_material_lot');
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const read=new OwnedDatabase(join(f.output,'workspace',f.checkpoint),{readonly:true});try{expect(NativeMaterialStore.read(read).entries).toEqual([]);}finally{read.close(true);}
    const changed=new OwnedDatabase(join(f.root,f.checkpoint));try{changed.run('UPDATE native_material_head SET sequence=1');}finally{changed.close(true);}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('head');
});

test('selected executor request source and descriptor restore offline; a missing prefix prevents another pin',()=>{
    const f=expandedFixture(),s={schemaVersion:1 as const,selectionId:randomUUID(),worldId:f.selected.worldId,clockId:f.selected.clockId,clockProfileDigest:f.selected.clockProfileDigest,
        fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',actors:[{actorId:'worker',username:'worker',lifecycleId:'fixture-life',
            worldId:f.selected.worldId,clockId:f.selected.clockId,clockProfileDigest:f.selected.clockProfileDigest}]};
    installMiningExecutorSource(f.root,join(f.root,f.checkpoint),s);
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_mining_request_selection','native_mining_request_event','native_mining_request_head');
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const db=new Database(join(f.output,'workspace',f.checkpoint),{readonly:true});try{expect(new NativeMiningRequestStore(db).read().selection).toEqual(s);}finally{db.close();}
    expect(readFileSync(join(f.output,'workspace/.local/agent-skills/mining-request-source.json'),'utf8')).toBe(readFileSync(join(f.root,'.local/agent-skills/mining-request-source.json'),'utf8'));
    const changed=new Database(join(f.root,f.checkpoint));try{changed.run('UPDATE native_mining_request_head SET sequence=1,digest=?',['a'.repeat(64)]);}finally{changed.close();}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('prefix');
});

test('selected native Mining dispatch schema is pinned, restored offline and rejects incompatible versions',()=>{
    const f=expandedFixture(),db=new Database(join(f.root,f.checkpoint));try{new NativeMiningDispatchStore(db,true);}finally{db.close();}
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_mining_dispatch','native_mining_dispatch_schema');
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const read=new Database(join(f.output,'workspace',f.checkpoint),{readonly:true});try{expect(new NativeMiningDispatchStore(read).read()).toEqual([]);}finally{read.close();}
    const changed=new Database(join(f.root,f.checkpoint));try{changed.run('UPDATE native_mining_dispatch_schema SET version=2');}finally{changed.close();}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('Unsupported');
});

test('selected cohort Mining coverage survives isolated restore and corrupt source prefixes prevent capture',()=>{
    const f=expandedFixture(),db=new Database(join(f.root,f.checkpoint));
    try{
        new NativeMiningDemandStore(db);new NativeMiningIntentStore(db);
        new NativeMiningCoverageStore(db,{schemaVersion:1,selectionId:randomUUID(),worldId:f.selected.worldId,clockId:f.selected.clockId,
            clockProfileDigest:f.selected.clockProfileDigest,fromSimulationTime:'2001-01-01T00:00:00.000Z',toSimulationTime:'2001-01-02T00:00:00.000Z',
            maximumSimulationGapMs:3600000,maximumWallGapMs:5000,openingHeads:miningCoverageSourceHeads(db),actors:[{actorId:'worker',username:'worker',
                lifecycleId:'fixture-life',worldId:f.selected.worldId,clockId:f.selected.clockId,clockProfileDigest:f.selected.clockProfileDigest}]});
    }finally{db.close();}
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_mining_coverage_selection','native_mining_coverage_event','native_mining_coverage_head');
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});
    restoreExpandedArchive(f.bundle,f.output);
    const restored=new Database(join(f.output,'workspace',f.checkpoint),{readonly:true});
    try{expect(new NativeMiningCoverageStore(restored).read()).toMatchObject({entries:[],head:{sequence:0,digest:null}});}finally{restored.close();}
    const altered=new Database(join(f.root,f.checkpoint));try{
        const store=new NativeMiningCoverageStore(altered),s=store.selection();store.append({kind:'sample',clock:{clockId:s.clockId,profileDigest:s.clockProfileDigest,
            status:'running',revision:1,engineTick:0,simulationTime:s.fromSimulationTime,wallTime:'2026-10-25T00:00:00.000Z'},sessionId:'fixture',rosterDigest:null,
            heads:{attempt:{sequence:1,digest:'a'.repeat(64)},intent:s.openingHeads.intent},ingressWriteFailed:false,
            actors:[{actorId:'worker',status:'offline',demandId:null}]});
    }finally{altered.close();}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('prefix');
});

test('selected standing Mining demand source is validated and reread after isolated restore',()=>{
    const f=expandedFixture(),db=new Database(join(f.root,f.checkpoint));
    try{new NativeMiningIntentStore(db);}finally{db.close();}
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables.push('native_mining_intent_state','native_mining_intent_audit','native_mining_intent_head','native_mining_intent_schema');
    const pin=prepareExpandedBaseline(f.root,f.selected);
    captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const read=new Database(join(f.output,'workspace',f.checkpoint),{readonly:true});
    try{expect(NativeMiningIntentStore.read(read)).toEqual({entries:[],head:{sequence:0,digest:null}});}finally{read.close();}
    const changed=new Database(join(f.root,f.checkpoint));
    try{changed.run("UPDATE native_mining_intent_head SET sequence=1,digest='missing'");}finally{changed.close();}
    expect(()=>prepareExpandedBaseline(f.root,f.selected)).toThrow('tail mismatch');
});
test('expanded baseline restores current needs/attributes/custody/work schemas and finance observations in another directory',()=>{
    const f=expandedFixture(),pin=prepareExpandedBaseline(f.root,f.selected);
    const manifest=captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});
    expect(manifest.files.some(r=>r.path===f.checkpoint)).toBeTrue();
    expect(manifest.files.some(r=>r.path.includes('finance-boundaries/opening.json'))).toBeTrue();
    restoreExpandedArchive(f.bundle,f.output);
    for(const s of pin.stores){const db=new Database(join(f.output,'workspace',s.path),{readonly:true});try{expect(db.query('PRAGMA quick_check').get()).toEqual({quick_check:'ok'});}finally{db.close();}}
    expect(readFileSync(join(f.output,'workspace/.local/society-metrics/finance-boundaries/opening.json'),'utf8')).toContain('preserved');
    expect(verifyExpandedArchive(f.bundle).digest).toBe(manifest.digest);
    console.log('SI-C06_EXPANDED_ACCEPTANCE',JSON.stringify({baselineDigest:manifest.digest,pinDigest:pin.digest,stores:pin.stores,
        checkpointIncluded:true,financeObservationIncluded:true,restoredInSeparateDirectory:true,provider:pin.selection.provider,reportVersion:pin.selection.reportVersion}));
});
test.each(['state','source','config','cache','missing','model','engine-config','director-override'] as const)('pinned %s drift never publishes or initializes defaults',mode=>{
        const f=expandedFixture(),pin=prepareExpandedBaseline(f.root,f.selected);
        if(mode==='state'){const db=new Database(join(f.root,f.checkpoint));db.run('CREATE TABLE injected(value INTEGER)');db.close();}
        if(mode==='source')put(f.root,'source.ts','export const drift = true;');
        if(mode==='config')put(f.root,'config/simulation-clock.json','{"drift":true}');
        if(mode==='cache')put(f.root,'server/engine/data/pack/server/script.dat','drift');
        if(mode==='model')put(f.root,'config/llm-runtime.json','{"provider":"mock","model":"other"}');
        if(mode==='engine-config')put(f.root,'server/engine/data/config/world.json','{"drift":true}');
        if(mode==='director-override')put(f.root,'.local/admin/world-director.json','{"drift":true}');
        if(mode==='missing')rmSync(join(f.root,f.checkpoint));
        expect(()=>captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}})).toThrow();
        expect(existsSync(f.bundle)).toBeFalse();if(mode==='missing')expect(existsSync(join(f.root,f.checkpoint))).toBeFalse();
});
test('result is tied to exact baseline/plan and native report is re-read before restore publication',()=>{
    const phase=<T>(name:string,run:()=>T):T=>{const start=performance.now();try{return run();}
        finally{console.info('[expanded-restore-phase]',JSON.stringify({name,wallMs:Math.round(performance.now()-start)}));}};
    const f=phase('fixture',expandedFixture),pin=phase('prepare',()=>prepareExpandedBaseline(f.root,f.selected));
    const baseline=phase('baseline-capture',()=>captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}}));
    const treasury=new InstitutionTreasuryStore(join(f.root,'.local/economy/institution-treasury.sqlite'));
    try{treasury.setBalance('business','fixture',1,42);}finally{treasury.close();}
    // A selected report is always read from the restored native database, not supplied JSON.
    const report=(root:string)=>{const db=new Database(join(root,'.local/economy/institution-treasury.sqlite'),{readonly:true});try{return db.query("SELECT balance_gp FROM institution_treasury WHERE actor_id='fixture'").get();}finally{db.close();}};
    put(f.root,'.local/admin/long-experiments.sqlite',readFileSync(join(f.root,'.local/admin/experiment-parameters.sqlite')));
    const result=join(f.directory,'result'),manifest=phase('result-capture',()=>captureExpandedArchive({...f,output:result,kind:'result',pin,baselineBundle:f.bundle,assertOffline:()=>{},readReport:report}));
    expect(phase('compare',()=>compareExpandedArchives(f.bundle,result))).toMatchObject({baselineDigest:baseline.digest,resultDigest:manifest.digest,bitIdenticalWorldRerun:false});
    expect(()=>phase('reject-report-drift',()=>restoreExpandedArchive(result,f.output,()=>({n:999})))).toThrow('native report');expect(existsSync(f.output)).toBeFalse();
    phase('result-restore',()=>restoreExpandedArchive(result,f.output,report));expect(report(join(f.output,'workspace'))).toEqual({balance_gp:42});
    const unrelated=phase('unrelated-fixture',expandedFixture),otherPin=phase('unrelated-prepare',()=>prepareExpandedBaseline(unrelated.root,unrelated.selected));
    phase('unrelated-capture',()=>captureExpandedArchive({...unrelated,output:unrelated.bundle,kind:'baseline',pin:otherPin,assertOffline:()=>{}}));
    expect(()=>phase('reject-unrelated',()=>compareExpandedArchives(unrelated.bundle,result))).toThrow('Unrelated');
    expect(phase('baseline-verify',()=>verifySocietyArchive(f.bundle)).digest).toBe(baseline.digest);
// Three archive captures, two restore paths and two SQLite-backed worlds exceeded the generic5 s timer
// under the focused consumer run (6.876 s); isolated phase tracing measured2.128 s. Keep each phase visible.
},15000);
test('WAL-only checkpoint rows survive native state pinning and archive reopen',()=>{
    const f=expandedFixture(),db=new Database(join(f.directory,'wal.sqlite'),{create:true}),copies=join(f.directory,'wal-copy');mkdirSync(copies);
    try{db.run('PRAGMA journal_mode=WAL');db.run('PRAGMA wal_autocheckpoint=0');db.run('CREATE TABLE proof(value INTEGER)');db.run('INSERT INTO proof VALUES(42)');
        for(const suffix of ['','-wal','-shm'])copyFileSync(join(f.directory,'wal.sqlite')+suffix,join(copies,'state.sqlite')+suffix);
    }finally{db.close();}
    for(const suffix of ['','-wal','-shm'])copyFileSync(join(copies,'state.sqlite')+suffix,join(f.root,f.checkpoint)+suffix);
    f.selected.stores.find(s=>s.role==='checkpoint')!.requiredTables=['proof'];
    const pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});restoreExpandedArchive(f.bundle,f.output);
    const read=new Database(join(f.output,'workspace',f.checkpoint),{readonly:true});try{expect(read.query('SELECT * FROM proof').get()).toEqual({value:42});}finally{read.close();}
});
test('schema mismatch, capture-time state drift and offline refusal retain no partial output',()=>{
    const f=expandedFixture(),pin=prepareExpandedBaseline(f.root,f.selected);let first=true;
    expect(()=>captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{if(first){first=false;put(f.root,'source.ts','dirty inside guard');}}})).toThrow('drift');
    expect(existsSync(f.bundle)).toBeFalse();
    const g=expandedFixture(),db=new Database(join(g.root,'.local/agent-state/agents.sqlite'));try{db.run('PRAGMA user_version=999');}finally{db.close();}
    expect(()=>prepareExpandedBaseline(g.root,g.selected)).toThrow('Unsupported');
    const h=expandedFixture(),hpin=prepareExpandedBaseline(h.root,h.selected);
    expect(()=>captureExpandedArchive({...h,output:h.bundle,kind:'baseline',pin:hpin,assertOffline:()=>{throw Error('writer active');}})).toThrow('writer active');
    expect(existsSync(h.bundle)).toBeFalse();expect(readdirSync(h.directory).some(n=>n.startsWith('.society-stage-'))).toBeFalse();
});
test('CLI verifies expanded evidence and restores baseline schema in the unpublished validator',()=>{
    const f=expandedFixture(),pin=prepareExpandedBaseline(f.root,f.selected);captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});
    const cli=join(import.meta.dir,'../../scripts/society-benchmark.ts'),run=(...args:string[])=>Bun.spawnSync([process.execPath,cli,...args],{stdout:'pipe',stderr:'pipe'});
    const verified=run('--command','verify','--bundle',f.bundle);expect(verified.exitCode,verified.stderr.toString()).toBe(0);
    const restored=run('--command','restore','--bundle',f.bundle,'--output',f.output);expect(restored.exitCode,restored.stderr.toString()).toBe(0);
    expect(JSON.parse(restored.stdout.toString()).expandedBaselineVerified).toBeTrue();
});
