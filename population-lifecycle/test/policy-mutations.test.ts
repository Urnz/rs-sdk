import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { PolicyMutationStore } from '../policy-mutations.js';
import { policyMutationProducers,pinPolicyEnvironment,validatePolicyEnvironment } from '../policy-environment.js';
import { withPolicyMutationObservation } from '../policy-mutation-observer.js';
import { updateWorldMod,restoreWorldModBackup,loadWorldModManifests,readWorldModState } from '../../server/gateway/admin/world-mods.js';
import { updateWorldDirectorConfig } from '../../server/gateway/admin/world-director-runtime.js';
const roots:string[]=[],closes:Array<()=>void>=[],wall='2030-01-01T00:00:00.000Z',at='2001-01-01T00:00:00.000Z';
afterEach(()=>{for(const close of closes.splice(0).reverse())close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'policy-mutation-'));roots.push(root);const db=new OwnedDatabase(join(root,'mutations.sqlite'));closes.push(()=>db.close(true));
    const sourceFiles=['package.json',...new Set(policyMutationProducers.map(p=>p.path))],environment=pinPolicyEnvironment({sourceFiles,files:[...sourceFiles,
        'config/world-mods.json','server/engine/data/pack/server/script.dat'].map(path=>({path,size:1,sha256:'a'.repeat(64)}))},{bunVersion:Bun.version,platform:process.platform}),
        pin={schemaVersion:1 as const,worldId:'fixture',clockId:'world',clockProfileDigest:'b'.repeat(64),fromSimulationTime:at,toSimulationTime:'2001-01-02T00:00:00.000Z',
            maximumWallGapMs:1200,policySelectionDigest:'c'.repeat(64),environment},store=new PolicyMutationStore(db,pin),
        ports={db,worldId:'fixture',wallTime:()=>wall,clock:()=>({clockId:'world',profileDigest:pin.clockProfileDigest,status:'running' as const,wallTime:wall,simulationTime:at,revision:0,engineTick:1})};
    const manifestPath=join(root,'manifest.json'),statePath=join(root,'state.json'),backupsDir=join(root,'backups');
    writeFileSync(manifestPath,JSON.stringify({schemaVersion:1,mods:[{id:'sample.test',name:'Test',version:'1.0.0',category:'test',description:'Test mod.',dataSchemaVersion:1,
        activation:'hot-reload',hooks:['player.login'],dependencies:[],conflicts:[],disablePolicy:{mode:'stateless',description:'No state.'},
        settings:[{key:'message',label:'Message',type:'string',default:'hello',minimum:1,maximum:12,description:'Test message.'}]}]}));
    return{root,db,pin,store,ports,manifestPath,statePath,backupsDir};}
test('policy mutation actual gateway mod configure/restore and director save write paired observations without storing payloads',async()=>{
    const f=fixture();await withPolicyMutationObservation(f.ports,async()=>{
        const first=await updateWorldMod('sample.test',{enabled:true,config:{message:'changed'}},0,f.manifestPath,f.statePath,f.backupsDir);
        await restoreWorldModBackup(first.backup.id,1,'Restore original',f.manifestPath,f.statePath,f.backupsDir);
        const director={schemaVersion:1,enabled:true,seed:'private-seed',epoch:at,intervalMinutes:30};
        updateWorldDirectorConfig(director,join(f.root,'director.json'));updateWorldDirectorConfig({...director,enabled:false},join(f.root,'director.json'));
        updateWorldDirectorConfig({...director,enabled:false},join(f.root,'director.json'));
    });
    const r=f.store.read();expect([...r.attempts.values()].map(p=>p.result?.producer)).toEqual(['mod-configure','mod-restore','director-configure','director-configure','director-configure']);
    expect([...r.attempts.values()].map(p=>p.result?.outcome)).toEqual(['applied','applied','applied','applied','no-op']);expect(r.faultCount).toBe(0);
    const manifests=await loadWorldModManifests(f.manifestPath);expect((await readWorldModState(manifests,f.statePath)).mods['sample.test']!.enabled).toBeFalse();
    expect(JSON.stringify(r.entries)).not.toContain('private-seed');expect(JSON.stringify(r.entries)).not.toContain('changed');
});
test('policy mutation journal write failure or missing clock leaves a gap while actual config writes retain their original result',()=>{
    const f=fixture(),path=join(f.root,'director.json'),config={schemaVersion:1 as const,enabled:true,seed:'fixture',epoch:at,intervalMinutes:30};
    f.db.run("CREATE TRIGGER fail_mutation BEFORE INSERT ON policy_mutation_event WHEN NEW.phase='result' BEGIN SELECT RAISE(ABORT,'injected');END");
    withPolicyMutationObservation(f.ports,()=>expect(updateWorldDirectorConfig(config,path)).toEqual(config));f.db.run('DROP TRIGGER fail_mutation');
    expect([...f.store.read().attempts.values()][0]!.result).toBeNull();expect(f.store.read().faultCount).toBe(1);
    withPolicyMutationObservation({...f.ports,clock:()=>null},()=>updateWorldDirectorConfig({...config,enabled:false},path));
    expect(JSON.parse(readFileSync(path,'utf8')).enabled).toBeFalse();expect(f.store.read().faultCount).toBe(3);
    expect(()=>f.db.run('UPDATE policy_mutation_fault SET count=0')).toThrow('reset');
});
test('policy mutation own schema and immutable pin/audit support reopen and rollback without changing shared user_version',()=>{
    const f=fixture();f.db.run('PRAGMA user_version=42');new PolicyMutationStore(f.db,f.pin);
    withPolicyMutationObservation(f.ports,()=>updateWorldDirectorConfig({schemaVersion:1,enabled:false,seed:'fixture',epoch:at,intervalMinutes:30},join(f.root,'d.json')));
    const before=f.db.serialize(),event=f.store.read().entries[0]!.event;
    expect(()=>f.db.transaction(()=>{f.store.append({...event,attemptId:'10000000-0000-4000-8000-000000000001'});throw Error('rollback');}).immediate()).toThrow('rollback');
    expect(f.db.serialize()).toEqual(before);expect(f.db.query('PRAGMA user_version').get()).toEqual({user_version:42});
    expect(()=>f.db.run('DELETE FROM policy_mutation_event WHERE sequence=1')).toThrow('immutable');
    expect(()=>new PolicyMutationStore(f.db,{...f.pin,worldId:'other'})).toThrow('differs');f.db.run('UPDATE policy_mutation_head SET sequence=99');expect(()=>f.store.read()).toThrow('cursor');
});
test('policy environment inventory includes every declared producer and packed file while rejecting omissions and unsafe paths',()=>{
    const f=fixture();validatePolicyEnvironment(f.pin.environment);expect(f.pin.environment.files.some(f=>f.role==='packed')).toBeTrue();
    expect(()=>validatePolicyEnvironment({...f.pin.environment,files:f.pin.environment.files.filter(p=>p.path!==policyMutationProducers[0].path)})).toThrow('incomplete');
    expect(()=>validatePolicyEnvironment({...f.pin.environment,files:[...f.pin.environment.files,{path:'.env',role:'source',size:1,sha256:'a'.repeat(64)}] as any})).toThrow();
    expect(f.pin.environment.completeRuntimeDependencyUniverse).toBeFalse();
});
