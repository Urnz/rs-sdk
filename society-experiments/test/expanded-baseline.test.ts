import { expect,test } from 'bun:test';
import { existsSync,readFileSync,rmSync,readdirSync,copyFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnedDatabase as Database } from '../../server/engine/src/io/OwnedDatabase.js';
import { prepareExpandedBaseline,captureExpandedArchive,restoreExpandedArchive,compareExpandedArchives,verifyExpandedArchive } from '../expanded-baseline.js';
import { verifySocietyArchive } from '../archive.js';
import { expandedFixture,put } from './expanded-fixture.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
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
    const f=expandedFixture(),pin=prepareExpandedBaseline(f.root,f.selected);
    const baseline=captureExpandedArchive({...f,output:f.bundle,kind:'baseline',pin,assertOffline:()=>{}});
    const treasury=new InstitutionTreasuryStore(join(f.root,'.local/economy/institution-treasury.sqlite'));
    try{treasury.setBalance('business','fixture',1,42);}finally{treasury.close();}
    // A selected report is always read from the restored native database, not supplied JSON.
    const report=(root:string)=>{const db=new Database(join(root,'.local/economy/institution-treasury.sqlite'),{readonly:true});try{return db.query("SELECT balance_gp FROM institution_treasury WHERE actor_id='fixture'").get();}finally{db.close();}};
    put(f.root,'.local/admin/long-experiments.sqlite',readFileSync(join(f.root,'.local/admin/experiment-parameters.sqlite')));
    const result=join(f.directory,'result'),manifest=captureExpandedArchive({...f,output:result,kind:'result',pin,baselineBundle:f.bundle,assertOffline:()=>{},readReport:report});
    expect(compareExpandedArchives(f.bundle,result)).toMatchObject({baselineDigest:baseline.digest,resultDigest:manifest.digest,bitIdenticalWorldRerun:false});
    expect(()=>restoreExpandedArchive(result,f.output,()=>({n:999}))).toThrow('native report');expect(existsSync(f.output)).toBeFalse();
    restoreExpandedArchive(result,f.output,report);expect(report(join(f.output,'workspace'))).toEqual({balance_gp:42});
    const unrelated=expandedFixture(),otherPin=prepareExpandedBaseline(unrelated.root,unrelated.selected);
    captureExpandedArchive({...unrelated,output:unrelated.bundle,kind:'baseline',pin:otherPin,assertOffline:()=>{}});
    expect(()=>compareExpandedArchives(unrelated.bundle,result)).toThrow('Unrelated');
    expect(verifySocietyArchive(f.bundle).digest).toBe(baseline.digest);
});
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
