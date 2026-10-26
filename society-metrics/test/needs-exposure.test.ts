import { expect,test } from 'bun:test';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { needsStateDigest } from '../../needs/profile.js';
import type { DurableNeedsState } from '../../needs/store.js';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { join } from 'node:path';
import { criticalOffset,needsExposureCells } from '../needs-exposure.js';
import { fixture,at } from './native-boundary-fixture.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config'));
const rule=(cells:ReturnType<typeof needsExposureCells>,id:string)=>cells.filter(c=>c.requirementId===id&&c.subject.actorAgentId==='ada');
test('threshold crossings follow native integer and signed remainder semantics at millisecond precision',()=>{
    expect(criticalOffset(7999,3599999,8000,1,2)).toEqual({critical:false,crossing:1});
    expect(criticalOffset(8000,0,8000,-1000,10000)).toEqual({critical:true,crossing:3600});
    expect(criticalOffset(8000,-3599999,8000,-1,2)).toEqual({critical:true,crossing:1});
    expect(criticalOffset(7999,-3599999,8000,1,8000000)).toEqual({critical:false,crossing:7199999});
    expect(criticalOffset(10000,0,8000,0,100)).toEqual({critical:true,crossing:100});
});
test('real SQLite history replays saturated critical needs across day boundaries; daily ratios keep the whole original day denominator',()=>{
    const f=fixture();f.scope.toSimulationTime=at(96);f.advance(96);
    const before=readFileSync(f.options.databasePath),exposure=f.read().needsExposure,cells=needsExposureCells(contract,exposure);
    expect(exposure.actors[0]!.channels.every(c=>c.reason===null)).toBeTrue();
    const fatigue=rule(cells,'fatigue-continuous-critical-time')[0]!;
    // Offline awake: fatigue first reaches8000 after32h, then64h critical.
    expect(fatigue.lower).toEqual({numerator:String(64*3600000),denominator:'1'});
    expect(fatigue.upper!.numerator).toBe(String(7*86400000)); // Remaining3 days are unknown.
    const satisfied=rule(cells,'fatigue-satisfied-time');expect(satisfied[0]!.lower).toEqual({numerator:String(86400000*10000),denominator:'86400000'});
    expect(satisfied[1]!.lower!.numerator).toBe(String(8*3600000*10000));expect(satisfied[2]!.upper!.numerator).toBe('0');
    expect(readFileSync(f.options.databasePath)).toEqual(before);
});
test('native meal interrupts hunger critical time at its actual timestamp without changing fatigue history',()=>{
    const f=fixture();f.scope.toSimulationTime=at(41);f.advance(40);f.consume(40.5);f.advance(41);
    const exposure=f.read().needsExposure,channels=exposure.actors[0]!.channels;
    expect(channels.every(c=>c.reason===null)).toBeTrue();
    const hunger=channels.find(c=>c.needId==='hunger')!;
    expect(hunger.intervals.filter(i=>i.critical).map(i=>(i.to-i.from)/3600000)).toEqual([0.5]);
    expect(channels.find(c=>c.needId==='fatigue')!.intervals.filter(i=>i.critical).map(i=>(i.to-i.from)/3600000)).toEqual([9]);
});
test('missing nutrition watermark withholds hunger evidence and preserves replayable fatigue evidence',()=>{
    const f=fixture();f.scope.toSimulationTime=at(48);f.advance(48);
    f.db.run('UPDATE native_food_delivery_head SET watermark_json=NULL,watermark_digest=NULL');
    const channels=f.read().needsExposure.actors[0]!.channels;
    expect(channels.find(c=>c.needId==='hunger')!.intervals).toHaveLength(0);
    expect(channels.find(c=>c.needId==='fatigue')!.intervals.some(s=>s.critical)).toBeTrue();
});
test('audited mode changes and sleep expiry replay both recovery and awake accumulation',()=>{
    const f=fixture();f.scope.toSimulationTime=at(42);f.advance(32);
    // Use the actual player-time authority; no fabricated sleep state in the needs ledger.
    f.clock.recordPlayerPresence('world','ada','online',at(32));
    f.clock.startPlayerSleep('world','ada',{
        sleeperKind:'human-player',sleepPlaceId:'bed',access:{kind:'bed-entitlement',evidenceId:'bed',sourceDigest:'a'.repeat(64),validUntilSimulationTime:at(36)},
        fatigueRecoveryMultiplierBasisPoints:10000
    },at(32));
    const current=f.persistence.needs.get(f.bindings[0]!)!;
    f.persistence.needs.advance({binding:f.bindings[0]!,clock:f.observation(42),expectedRevision:current.revision,
        history:f.clock.getPlayerTimeHistory('world','ada'),playerTime:f.clock.getPlayerTimeState('world','ada')});
    const channel=f.read().needsExposure.actors[0]!.channels.find(c=>c.needId==='fatigue')!;
    expect(channel.reason).toBeNull();expect(channel.intervals.some(i=>!i.critical&&i.to===Date.parse(at(42)))).toBeTrue();
});
test('truncated or corrupt clock history is not interpolated into satisfied time',()=>{
    const f=fixture();f.clock.recordPlayerPresence('world','ada','online',at(0));
    const current=f.persistence.needs.get(f.bindings[0]!)!;
    f.persistence.needs.advance({binding:f.bindings[0]!,clock:f.observation(48),expectedRevision:current.revision,
        history:f.clock.getPlayerTimeHistory('world','ada'),playerTime:f.clock.getPlayerTimeState('world','ada')});
    f.scope.toSimulationTime=at(48);
    const db=new OwnedDatabase(f.options.clockPath);try{db.run("DELETE FROM simulation_player_time_history WHERE player_id='ada'");}finally{db.close(true);}
    expect(f.read().needsExposure.actors.every(a=>a.channels.length===0)).toBeTrue();
});
test('a hash-consistent but non-replayable later state preserves verified critical prefix and never supplies post-gap time',()=>{
    const f=fixture();f.scope.toSimulationTime=at(72);f.advance(48);f.advance(60);f.advance(72);
    const db=new OwnedDatabase(f.options.databasePath);
    try{
        const row=db.query("SELECT state_key,snapshot_json FROM needs_event WHERE revision=3 AND json_extract(snapshot_json,'$.binding.actorId')='ada'").get() as {state_key:string;snapshot_json:string};
        const state=JSON.parse(row.snapshot_json) as DurableNeedsState;state.state.values.find(v=>v.needId==='fatigue')!.value=0;
        const {digest:_,...body}=state.state;state.state.digest=needsStateDigest(body);
        const json=JSON.stringify(state),hash=createHash('sha256').update(json).digest('hex');
        db.run('UPDATE needs_event SET snapshot_json=?1,snapshot_digest=?2 WHERE state_key=?3 AND revision=3',[json,hash,row.state_key]);
        db.run('UPDATE needs_event SET previous_digest=?1 WHERE state_key=?2 AND revision=4',[hash,row.state_key]);
    }finally{db.close(true);}
    const exposure=f.read().needsExposure,channel=exposure.actors[0]!.channels.find(c=>c.needId==='fatigue')!;
    expect(channel.reason).not.toBeNull();expect(channel.intervals.reduce((n,s)=>n+s.to-s.from,0)).toBe(48*3600000);
    const cell=rule(needsExposureCells(contract,exposure),'fatigue-continuous-critical-time')[0]!;
    expect(cell.lower!.numerator).toBe(String(16*3600000));expect(cell.upper!.numerator).toBe(String(7*86400000));
    expect(exposure.actors[0]!.channels.find(c=>c.needId==='hunger')!.reason).toBeNull();
});
