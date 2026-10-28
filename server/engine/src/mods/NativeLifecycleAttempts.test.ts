import { afterEach,beforeAll,expect,test } from 'bun:test';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import World from '../engine/World.js';
import Player,{getExpByLevel} from '../engine/entity/Player.js';
import { PlayerLoading } from '../engine/entity/PlayerLoading.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import Packet from '../io/Packet.js';
import ScriptRunner from '../engine/script/ScriptRunner.js';
import ScriptProvider from '../engine/script/ScriptProvider.js';
import ScriptState from '../engine/script/ScriptState.js';
import { loadPackedContent } from './native-food-skill-fixture.js';
import { OwnedDatabase } from '../io/OwnedDatabase.js';
import { AgentStateStore } from '../../../../agent-state/store.js';
import { SimulationClockStore } from '../../../../simulation-clock/store.js';
import { loadPopulationAgePolicy } from '../../../../population-lifecycle/age.js';
import { loadPopulationMortalityPolicy } from '../../../../population-lifecycle/mortality.js';
import { createPopulationDeathEvidence } from '../../../../population-lifecycle/death.js';
import { PlayerHealthEvidenceStore } from './PlayerHealthEvidenceStore.js';
import { NativeMortalityCoverageStore,nativeMortalityActor } from '../../../../population-lifecycle/native-coverage.js';
import { NativeLifecycleAttemptStore } from '../../../../population-lifecycle/native-attempts.js';
import { NativeLifecycleWatermarkStore } from '../../../../population-lifecycle/native-watermarks.js';
import { NativeLifecyclePolicyStore } from '../../../../population-lifecycle/native-policy.js';
import { lifecycleRouteManifest,lifecyclePolicyFiles } from '../../../../population-lifecycle/native-policy-manifest.js';
import { getActiveWorldModPolicy } from './WorldMods.js';
import { PolicyMutationStore } from '../../../../population-lifecycle/policy-mutations.js';
import { pinPolicyEnvironment,worldPolicyMutationProducers } from '../../../../population-lifecycle/policy-environment.js';
import {WorldPolicyRuntimeStore,createWorldPolicyRuntimeContract} from '../../../../population-lifecycle/world-policy-runtime.js';
import { beginPolicyMutation,withPolicyMutationObservation } from '../../../../population-lifecycle/policy-mutation-observer.js';
import { nativeToolDigest } from '../../../../item-lifecycle/native-tool.js';
import { recordNativeMortalityPass } from '../../../../population-lifecycle/native-observer.js';
import { withNativeLifecycleObservation,observeNativePopulationLogin,beginNativeLifecycleAttempt,type LifecycleObservationPorts } from './NativeLifecycleAttempts.js';
const closers:Array<()=>void>=[];beforeAll(loadPackedContent);afterEach(()=>{for(const close of closers.splice(0).reverse())close();});
function fixture(){
    const root=mkdtempSync(join(tmpdir(),'native-life-attempt-'));closers.push(()=>rmSync(root,{recursive:true,force:true}));
    const db=new OwnedDatabase(join(root,'checkpoint.sqlite'));closers.push(()=>db.close(true));
    const clock=new SimulationClockStore(join(root,'clock.sqlite'));closers.push(()=>clock.close());
    const initial='2001-01-01T00:00:00.000Z',wall='2030-01-01T00:00:00.000Z',created=clock.create({clockId:'world',profile:{schemaVersion:1,
        profileId:'native-lifecycle',version:'1.0.0',seed:'native',rate:{simulationMilliseconds:1,wallMilliseconds:1}},wallTime:wall,simulationTime:initial});
    const agents=new AgentStateStore(join(root,'agents.sqlite'),{store:clock,clockId:'world'});closers.push(()=>agents.close());
    agents.createIdentity({agentId:'alice',playerUsername:'alice',displayName:'Alice',background:'Private fixture',personalityTraits:['steady']},wall);
    agents.setCharacterBirth('alice',1,initial,'born',wall);const age=loadPopulationAgePolicy(join(import.meta.dir,'../../../../config/population-age-policy.json')),
        mortality=loadPopulationMortalityPolicy(join(import.meta.dir,'../../../../config/population-mortality-policy.json'));
    const member=agents.bindPopulationMember({agentId:'alice',playerUsername:'alice',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
        lifecyclePolicy:{...age.lifecyclePolicy,kind:'finite'},simulationClock:{clockId:'world',profileDigest:created.profileDigest},joinedAtSimulationTime:initial,
        sourceResultId:'genesis-'+'b'.repeat(24),sourceResultDigest:'c'.repeat(64)},wall),actor=nativeMortalityActor(member);
    const health=new PlayerHealthEvidenceStore(join(root,'health.sqlite'));closers.push(()=>health.close());health.bindFiniteAvatar(member);
    World.currentTick=100;const c=clock.observe('world',wall,World.currentTick);
    new NativeMortalityCoverageStore(db,{schemaVersion:1,selectionId:randomUUID(),worldId:'fixture',clockId:'world',clockProfileDigest:c.profileDigest,
        fromSimulationTime:initial,toSimulationTime:'2001-01-02T00:00:00.000Z',maximumSimulationGapMs:1200,maximumWallGapMs:1200,agePolicyDigest:age.digest,
        mortalityPolicyDigest:mortality.digest,survivalSelectionDigest:null,actors:[actor],openingHealthHeads:health.coverageHeads()});
    const store=new NativeLifecycleAttemptStore(db,true),player=new Player('alice',2n,2n);player.levels.fill(1);player.baseLevels.fill(1);
    player.levels[PlayerStat.HITPOINTS]=10;player.baseLevels[PlayerStat.HITPOINTS]=10;player.stats[PlayerStat.HITPOINTS]=getExpByLevel(10);
    const ports:LifecycleObservationPorts={db,wallTime:()=>c.wallTime,context:()=>({actor,clock:c,healthHeads:health.coverageHeads(),deathEventId:health.deathFor('alice')?.eventId??null,
        restricted:!!health.deathFor('alice')})};
    const run=<T>(f:()=>T)=>withNativeLifecycleObservation(ports,f);
    const guard={finite:(name:string)=>!!health.finiteAvatar(name),restricted:(name:string)=>!!health.deathFor(name)};
    return{root,db,store,player,ports,run,guard,clock,c,policySnapshot(){const manifest=lifecycleRouteManifest(join(import.meta.dir,'../../../..'));
        return{clock:clock.get('world')!,effective:{agePolicyDigest:age.digest,mortalityPolicyDigest:mortality.digest,bindingsDigest:'a'.repeat(64),survivalDigest:null,
            modsDigest:'b'.repeat(64)},sources:manifest.sources,files:lifecyclePolicyFiles(join(import.meta.dir,'../../../..'))};},
        watermarks(){const watermarks=new NativeLifecycleWatermarkStore(db,true);
        recordNativeMortalityPass(db,'fixture','native-mortality',c,[member],health,age.digest,mortality.digest,null);return watermarks;},
        kill(){const damageEventId=randomUUID(),event=createPopulationDeathEvidence(member,c,age,mortality,{damageEventId,sessionId:'native',engineTick:100});
        health.record({username:'alice',sessionId:'native',engineTick:100,occurredAt:c.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},damageEventId,event);return event;}};
}
test('SI-C07 actual save parsing records parsed and failed loads without calling either world admission',()=>{
    const f=fixture(),save=f.player.save(false);
    const loaded=f.run(()=>PlayerLoading.load('alice',new Packet(save),null));expect(loaded.levels[PlayerStat.HITPOINTS]).toBe(10);
    expect(()=>f.run(()=>PlayerLoading.load('alice',new Packet(new Uint8Array([1,2,3])),null))).toThrow('Invalid save');
    const r=f.store.read();expect([...r.attempts.values()].map(p=>p.result?.outcome)).toEqual(['parsed','failed']);
    expect(r.entries.every(e=>e.event.kind==='load')).toBeTrue();expect(r.faults).toBe(0);
});

test('SI-C07 actual World.reload observes the loaded packed identity and preserves reload failures and call count',()=>{
    const f=fixture(),journal=join(f.root,'.local/society-metrics/policy-mutations.sqlite');mkdirSync(join(journal,'..'),{recursive:true});
    const db=new OwnedDatabase(journal);closers.push(()=>db.close(true));const pack='server/engine/data/pack/server/script.dat';mkdirSync(join(f.root,pack,'..'),{recursive:true});writeFileSync(join(f.root,pack),new Uint8Array([0]));
    const sourceFiles=[...new Set(['package.json','bun.lock','server/engine/bun.lock','server/gateway/bun.lock','server/engine/src/app.ts','server/gateway/gateway.ts',
        'population-lifecycle/world-policy-runtime.ts','simulation-clock/store.ts',...worldPolicyMutationProducers.map(p=>p.path)])],
        environment=pinPolicyEnvironment({sourceFiles,files:[...sourceFiles.map(path=>({path,size:1,sha256:'a'.repeat(64)})),
            {path:pack,size:1,sha256:createHash('sha256').update(new Uint8Array([0])).digest('hex')}]},{bunVersion:Bun.version,platform:process.platform},true),
        contract=createWorldPolicyRuntimeContract(environment,{engine:{},gateway:{}}),store=new PolicyMutationStore(db,{schemaVersion:1,worldId:'fixture',clockId:f.c.clockId,
            clockProfileDigest:f.c.profileDigest,fromSimulationTime:f.c.simulationTime,toSimulationTime:'2001-01-02T00:00:00.000Z',maximumWallGapMs:1200,
            policySelectionDigest:'a'.repeat(64),environment,worldPolicyRuntimeContractDigest:nativeToolDigest(contract)});
    new WorldPolicyRuntimeStore(db,contract);
    const ports={db,worldId:'fixture',workspace:f.root,clock:()=>f.c,wallTime:()=>f.c.wallTime},original=World['reloadPackedInputs'];let calls=0;
    try{World['reloadPackedInputs']=clear=>{calls++;expect(clear).toBeFalse();return true;};
        withPolicyMutationObservation(ports,()=>World.reload(false));writeFileSync(join(f.root,pack),new Uint8Array([1]));
        withPolicyMutationObservation(ports,()=>World.reload(false));
        World['reloadPackedInputs']=()=>{calls++;return false;};withPolicyMutationObservation(ports,()=>World.reload(false));
        World['reloadPackedInputs']=()=>{calls++;throw Error('actual failed reload');};expect(()=>withPolicyMutationObservation(ports,()=>World.reload(false))).toThrow('actual failed reload');
        expect(calls).toBe(4);expect([...store.read().attempts.values()].map(p=>p.result?.outcome)).toEqual(['no-op','applied','failed','failed']);expect(store.read().faultCount).toBe(0);
    }finally{World['reloadPackedInputs']=original;}
});

test('SI-C07 actual World policy observation retains a clock change after census context loss without changing gameplay or the clock',()=>{
    const f=fixture();f.watermarks();const manifest=lifecycleRouteManifest(join(import.meta.dir,'../../../..')),opening=f.policySnapshot(),
        store=new NativeLifecyclePolicyStore(f.db,{manifest,opening}),policy=()=>({position:f.c,worldId:'fixture',snapshot:f.policySnapshot()}),
        ports={...f.ports,policy,bootManifest:manifest},before=f.player.save(false),clockBefore=f.clock.get('world');
    const mods=getActiveWorldModPolicy();expect(getActiveWorldModPolicy()).toEqual(mods);
    withNativeLifecycleObservation(ports,()=>World['observePopulationLifecycle']('after-terminal-guard'));
    expect(f.clock.get('world')).toEqual(clockBefore);
    const changed=f.clock.reconfigure('world',clockBefore!.revision,{...clockBefore!.profile,seed:'changed'},f.c.wallTime);
    withNativeLifecycleObservation({...ports,context:()=>null},()=>World['observePopulationLifecycle']('end-of-tick'));
    const r=store.read();expect(r.entries).toHaveLength(2);expect(r.entries[1]!.sample.snapshot!.clock).toEqual(changed);
    expect(r.entries[1]!.sample.position.profileDigest).toBe(clockBefore!.profileDigest);expect(r.entries[1]!.sample.snapshot!.clock.profileDigest).not.toBe(clockBefore!.profileDigest);
    expect(f.clock.get('world')).toEqual(changed);expect(f.player.save(false)).toEqual(before);expect(r.faults).toBe(0);
});

test('SI-C07 native policy observer records null authority and durable write faults without altering player or shared clock state',()=>{
    const f=fixture();f.watermarks();const store=new NativeLifecyclePolicyStore(f.db,{manifest:lifecycleRouteManifest(join(import.meta.dir,'../../../..')),opening:f.policySnapshot()}),
        before=f.clock.get('world');
    f.run(()=>World['observePopulationLifecycle']('after-terminal-guard'));expect(store.read().entries[0]!.sample.snapshot).toBeNull();
    f.db.run("CREATE TRIGGER fail_policy BEFORE INSERT ON native_lifecycle_policy_event BEGIN SELECT RAISE(ABORT,'injected');END");
    expect(()=>f.run(()=>World['observePopulationLifecycle']('end-of-tick'))).not.toThrow();f.db.run('DROP TRIGGER fail_policy');
    expect(store.read().faults).toBeGreaterThan(0);expect(f.clock.get('world')).toEqual(before);
    expect(()=>f.db.run('UPDATE native_lifecycle_policy_fault SET count=0')).toThrow('reset');
});

test('SI-C07 actual World policy frames link the independent mutation journal head and its selected policy identity',()=>{
    const f=fixture();f.watermarks();const manifest=lifecycleRouteManifest(join(import.meta.dir,'../../../..')),opening=f.policySnapshot(),
        policy=new NativeLifecyclePolicyStore(f.db,{manifest,opening}),mutationDb=new OwnedDatabase(':memory:');closers.push(()=>mutationDb.close(true));
    const sourceFiles=['package.json',...manifest.sources.map(p=>p.path)],environment=pinPolicyEnvironment({sourceFiles,files:[
        ...manifest.sources.map(p=>({path:p.path,size:p.bytes!,sha256:p.sha256!})),{path:'package.json',size:1,sha256:'a'.repeat(64)},
        {path:'server/engine/data/pack/server/script.dat',size:1,sha256:'b'.repeat(64)}]},{bunVersion:Bun.version,platform:process.platform}),
        mutations=new PolicyMutationStore(mutationDb,{schemaVersion:1,worldId:'fixture',clockId:f.c.clockId,clockProfileDigest:f.c.profileDigest,
            fromSimulationTime:f.c.simulationTime,toSimulationTime:'2001-01-02T00:00:00.000Z',maximumWallGapMs:1200,
            policySelectionDigest:nativeToolDigest(policy.selection().selection),environment}),
        mutationPorts={db:mutationDb,worldId:'fixture',clock:()=>f.c,wallTime:()=>f.c.wallTime},
        ports={...f.ports,bootManifest:manifest,policy:()=>({position:f.c,worldId:'fixture',snapshot:f.policySnapshot()})};
    withPolicyMutationObservation(mutationPorts,()=>withNativeLifecycleObservation(ports,()=>{
        World['observePopulationLifecycle']('after-terminal-guard');beginPolicyMutation('mod-configure','a'.repeat(64))?.finish('b'.repeat(64),'applied');
        World['observePopulationLifecycle']('end-of-tick');}));
    const entries=policy.read().entries;expect(entries.map(e=>e.sample.mutationCursor?.head.sequence)).toEqual([0,2]);
    expect(entries[1]!.sample.mutationCursor).toEqual(mutations.cursor());expect(mutations.read().attempts.size).toBe(1);
});

test('SI-C07 actual World slots include an orphan terminal avatar and seal parser attempts at the tick end',()=>{
    const f=fixture();f.kill();const store=f.watermarks(),slot=1901,previous=World.players[slot];
    closers.push(()=>{World.players[slot]=previous!;});World.players[slot]=f.player;f.player.populationFinite=true;f.player.populationTerminal=true;
    const before=f.player.save(false);
    f.run(()=>World['observePopulationLifecycle']('after-terminal-guard'));
    f.run(()=>PlayerLoading.load('alice',new Packet(before),null));
    f.run(()=>World['observePopulationLifecycle']('end-of-tick'));
    const r=store.read();expect(r.entries.map(e=>e.sample.stage)).toEqual(['after-terminal-guard','end-of-tick']);
    expect(r.entries[0]!.sample.avatars).toEqual([{username:'alice',slot,vitals:{hitpoints:10,terminal:true,finite:true}}]);
    expect(r.entries[0]!.sample.actors[0]!.authority!.healthHeads.death.sequence).toBe(1);
    expect(r.entries[0]!.sample.attemptHead.sequence).toBe(0);expect(r.entries[1]!.sample.attemptHead.sequence).toBe(2);
    expect(f.player.save(false)).toEqual(before);expect(r.faults).toBe(0);
});

test('SI-C07 census write failure is durable and a missing current authority never creates a World witness',()=>{
    const f=fixture(),store=f.watermarks(),before=f.player.save(false);
    f.db.run("CREATE TRIGGER fail_census BEFORE INSERT ON native_lifecycle_watermark_event BEGIN SELECT RAISE(ABORT,'injected');END");
    expect(()=>f.run(()=>World['observePopulationLifecycle']('after-terminal-guard'))).not.toThrow();f.db.run('DROP TRIGGER fail_census');
    withNativeLifecycleObservation({...f.ports,context:()=>null},()=>World['observePopulationLifecycle']('end-of-tick'));
    expect(store.read().entries).toEqual([]);expect(store.read().faults).toBe(2);expect(f.player.save(false)).toEqual(before);
    expect(()=>f.db.run('UPDATE native_lifecycle_watermark_fault SET count=0')).toThrow('reset');
});
test('SI-C07 original login guard still blocks terminal and zero-HP finite actors and fails closed on source loss',()=>{
    const f=fixture();expect(f.run(()=>observeNativePopulationLogin(f.player,100,f.guard))).toBe('passed');
    f.player.levels[PlayerStat.HITPOINTS]=0;expect(f.run(()=>observeNativePopulationLogin(f.player,100,f.guard))).toBe('blocked');
    f.player.levels[PlayerStat.HITPOINTS]=10;f.kill();expect(f.run(()=>observeNativePopulationLogin(f.player,100,f.guard))).toBe('blocked');
    expect(f.run(()=>observeNativePopulationLogin(f.player,100,{...f.guard,finite(){throw Error('missing');}}))).toBe('source-unavailable');
    expect([...f.store.read().attempts.values()].map(p=>p.result?.outcome)).toEqual(['passed','blocked-hp-zero','blocked-restricted','source-unavailable']);
});
test('SI-C07 packed respawn dispatch and direct interpreter both abort terminal actors without HP or position restoration',()=>{
    const f=fixture();f.kill();f.player.populationTerminal=true;f.player.populationFinite=true;f.player.levels[PlayerStat.HITPOINTS]=0;
    const script=ScriptProvider.getByName('[queue,player_death]');expect(script).not.toBeNull();const before=f.player.save(false);
    expect(f.run(()=>f.player.runScript(ScriptRunner.init(script!,f.player),true))).toBe(ScriptState.ABORTED);
    expect(f.run(()=>ScriptRunner.execute(ScriptRunner.init(script!,f.player)))).toBe(ScriptState.ABORTED);
    expect(f.player.save(false)).toEqual(before);
    const pairs=[...f.store.read().attempts.values()];expect(pairs.map(p=>p.begin.kind)).toEqual(['respawn-script','terminal-script-abort']);
    expect(pairs.every(p=>p.result?.outcome==='blocked-terminal'&&p.result.authority?.healthHeads.death.sequence===1)).toBeTrue();
});
test('SI-C07 observer faults and missing context do not change guard or parser behavior and never invent a result',()=>{
    const f=fixture();f.db.run("CREATE TRIGGER fail_lifecycle BEFORE INSERT ON native_lifecycle_event BEGIN SELECT RAISE(ABORT,'injected');END");
    expect(f.run(()=>observeNativePopulationLogin(f.player,100,f.guard))).toBe('passed');f.db.run('DROP TRIGGER fail_lifecycle');
    expect(f.store.read().faults).toBeGreaterThan(0);expect(f.store.read().attempts.size).toBe(0);
    withNativeLifecycleObservation({...f.ports,context(){throw Error('unavailable');}},()=>{
        const attempt=beginNativeLifecycleAttempt('load','alice',100);attempt?.finish('failed');});
    expect([...f.store.read().attempts.values()][0]!.result?.authority).toBeNull();
    expect(()=>f.db.run('UPDATE native_lifecycle_fault SET count=0')).toThrow('reset');
});
