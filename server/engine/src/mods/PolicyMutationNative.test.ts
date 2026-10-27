import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnedDatabase } from '../io/OwnedDatabase.js';
import { PolicyMutationStore } from '../../../../population-lifecycle/policy-mutations.js';
import { pinPolicyEnvironment,policyMutationProducers } from '../../../../population-lifecycle/policy-environment.js';
import { withPolicyMutationObservation } from '../../../../population-lifecycle/policy-mutation-observer.js';
import { reloadHotWorldMods,type ActiveWorldModSnapshot } from './WorldMods.js';
import { WorldDirectorEventStore } from './WorldDirectorEventStore.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){const root=mkdtempSync(join(tmpdir(),'native-policy-mutation-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
    const db=new OwnedDatabase(join(root,'mutations.sqlite'));cleanup.push(()=>db.close(true));
    const sourceFiles=['package.json',...new Set(policyMutationProducers.map(p=>p.path))],environment=pinPolicyEnvironment({sourceFiles,
        files:[...sourceFiles,'server/engine/data/pack/server/script.dat'].map(path=>({path,size:1,sha256:'a'.repeat(64)}))},{bunVersion:Bun.version,platform:process.platform}),
        clock={clockId:'world',profileDigest:'b'.repeat(64),status:'running' as const,wallTime:'2030-01-01T00:00:00.000Z',simulationTime:'2001-01-01T00:00:00.000Z',revision:0,engineTick:1},
        store=new PolicyMutationStore(db,{schemaVersion:1,worldId:'fixture',clockId:clock.clockId,clockProfileDigest:clock.profileDigest,fromSimulationTime:clock.simulationTime,
            toSimulationTime:'2001-01-02T00:00:00.000Z',maximumWallGapMs:1200,policySelectionDigest:'c'.repeat(64),environment}),
        ports={db,worldId:'fixture',clock:()=>clock,wallTime:()=>clock.wallTime};
    return{root,db,store,ports};}
test('SI-C07 native mod activation journals an intratick change and reversal without global mod state or live stores',()=>{
    const f=fixture();let current:ActiveWorldModSnapshot={schemaVersion:1,revision:0,loadedAt:f.ports.wallTime(),lastReloadAt:null,loadError:null,metrics:{},
        mods:{'sample.hot':{enabled:false,config:{message:'original'},version:'1.0.0',dataSchemaVersion:1,activation:'hot-reload',appliedRevision:0}}};
    const original=structuredClone(current.mods),activate=(enabled:boolean,revision:number)=>withPolicyMutationObservation(f.ports,()=>reloadHotWorldMods({current,
        load:()=>({...structuredClone(current),revision,mods:{'sample.hot':{...current.mods['sample.hot']!,enabled,appliedRevision:revision}}}),
        apply:next=>{current=next;},read:()=>current}));
    activate(true,1);activate(false,2);expect(current.mods['sample.hot']!.enabled).toBe(original['sample.hot']!.enabled);
    expect([...f.store.read().attempts.values()].map(p=>p.result?.outcome)).toEqual(['applied','applied']);
    expect(f.store.read().entries.every(e=>e.event.producer==='mod-hot-reload')).toBeTrue();expect(f.store.read().faultCount).toBe(0);
});
test('SI-C07 native director acceptance, duplicate and conflicting id retain original durable semantics while observation failure stays a gap',()=>{
    const f=fixture(),events=new WorldDirectorEventStore(join(f.root,'events.sqlite'));cleanup.push(()=>events.close());
    const event={eventId:'world-event-0123456789abcdef01234567',cycleKey:'cycle-1',selectionDigest:'d'.repeat(64),kind:'world-flavor' as const,
        templateId:'fixture',templateVersion:'1.0.0',title:'Local signal',summary:'Private fixture signal',regions:[],tags:[]};
    withPolicyMutationObservation(f.ports,()=>{expect(events.accept(event).created).toBeTrue();expect(events.accept(event).created).toBeFalse();
        expect(()=>events.accept({...event,summary:'different'})).toThrow('reused');});
    expect([...f.store.read().attempts.values()].map(p=>p.result?.outcome)).toEqual(['applied','no-op','failed']);
    f.db.run("CREATE TRIGGER fail_mutation BEFORE INSERT ON policy_mutation_event BEGIN SELECT RAISE(ABORT,'injected');END");
    withPolicyMutationObservation(f.ports,()=>expect(events.accept({...event,eventId:'world-event-1123456789abcdef01234567'}).created).toBeTrue());
    expect(f.store.read().faultCount).toBe(1);expect(events.get(event.eventId)?.summary).toBe(event.summary);
    expect(JSON.stringify(f.store.read().entries)).not.toContain('Private fixture signal');
});
