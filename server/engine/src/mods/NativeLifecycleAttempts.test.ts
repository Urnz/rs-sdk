import { afterEach,beforeAll,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
    return{db,store,player,ports,run,guard,kill(){const damageEventId=randomUUID(),event=createPopulationDeathEvidence(member,c,age,mortality,{damageEventId,sessionId:'native',engineTick:100});
        health.record({username:'alice',sessionId:'native',engineTick:100,occurredAt:c.wallTime,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},damageEventId,event);return event;}};
}
test('SI-C07 actual save parsing records parsed and failed loads without calling either world admission',()=>{
    const f=fixture(),save=f.player.save(false);
    const loaded=f.run(()=>PlayerLoading.load('alice',new Packet(save),null));expect(loaded.levels[PlayerStat.HITPOINTS]).toBe(10);
    expect(()=>f.run(()=>PlayerLoading.load('alice',new Packet(new Uint8Array([1,2,3])),null))).toThrow('Invalid save');
    const r=f.store.read();expect([...r.attempts.values()].map(p=>p.result?.outcome)).toEqual(['parsed','failed']);
    expect(r.entries.every(e=>e.event.kind==='load')).toBeTrue();expect(r.faults).toBe(0);
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
