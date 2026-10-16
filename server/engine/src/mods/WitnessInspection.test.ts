import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { ThievingEvidenceStore } from './ThievingEvidenceStore.js';
import { EngineWitnessInspectionStore } from './WitnessInspectionStore.js';
import { anonymousVisualDigest, witnessSessionToken, WitnessContinuityTracker, selectVisibleWitnesses } from './WitnessContinuity.js';
import { executeWitnessInspection, loadWitnessInspectionPolicy, type WitnessInspectionPlayer } from './WitnessInspection.js';

const NOW = Date.parse('2026-09-27T09:00:00.000Z');
const COMMAND = '22222222-2222-4222-8222-222222222222';
function player(username:string,slot:number): WitnessInspectionPlayer {
    return {username,slot,x:3200,z:3200,level:0,isActive:true,visibility:0,
        generateAppearance:()=>new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])};
}
function fixture(run:(value:ReturnType<typeof setup>)=>void): void {
    const root = mkdtempSync(join(tmpdir(),'witness-inspection-'));
    const value = setup(root);
    try {run(value);} finally {value.engine.close();value.inspections.close();rmSync(root,{recursive:true,force:true});}
}
function setup(root:string) {
    const engine = new ThievingEvidenceStore(join(root,'engine.sqlite'));
    const inspections = new EngineWitnessInspectionStore(join(root,'inspection.sqlite'));
    const observer = player('witness',5), target = player('suspect',8);
    const tracker = new WitnessContinuityTracker();
    tracker.remember(observer,target,anonymousVisualDigest(target.generateAppearance()),1,NOW);
    engine.append({eventId:'event-1',playerUsername:'hiddenwrong',procedureKind:'pickpocket',
        target:{kind:'npc',typeId:1,instanceIndex:1,name:'Man',x:3200,z:3200,level:0},effect:'item-transfer',
        transferredItems:[{itemId:995,itemName:'Coins',quantity:3}],thievingXpDelta:1,startedAtEngineTick:1,
        endedAtEngineTick:1,occurredAt:new Date(NOW).toISOString(),sightSnapshot:{actor:{x:3200,z:3200,level:0},
            radius:15,candidates:[{username:'witness',x:3200,z:3200,level:0}],continuity:{
                actorSessionToken:witnessSessionToken(target),visualDigest:anonymousVisualDigest(target.generateAppearance()),
                observers:[{username:'witness',sessionToken:witnessSessionToken(observer)}]}}});
    const command = {commandId:COMMAND,eventId:'event-1',observerUsername:'witness',targetPlayerSlot:8,expiresAt:NOW+2000};
    const deps = {engine,inspections,observer:()=>observer,target:()=>target,visible:()=>true,lineOfSight:()=>true,
        connected:()=>true,engineTick:2,now:NOW+1000,policy:loadWitnessInspectionPolicy(),tracker};
    return {root,engine,inspections,observer,target,command,deps};
}
describe('independent server witness person inspection',()=>{
    test('production capture excludes hidden actor and client visibility capacity omissions',()=>{
        const actor=player('suspect',8),observer=player('witness',5),omitted=player('omitted',6);
        expect(selectVisibleWitnesses(actor,[actor,observer,omitted],slot=>slot===5,()=>true)).toEqual([observer]);
        actor.visibility=2;
        expect(selectVisibleWitnesses(actor,[observer],()=>true,()=>true)).toEqual([]);
        actor.visibility=0;observer.visibility=2;
        expect(selectVisibleWitnesses(actor,[observer],()=>true,()=>true)).toEqual([]);
        observer.visibility=0;
        expect(selectVisibleWitnesses(actor,[observer],()=>true,()=>false)).toEqual([]);
    });
    test('samples explicit visible entity, not hidden event actor, and replays after durable reopening',()=>fixture(value=>{
        const result = executeWitnessInspection(value.command,value.deps);
        expect(result.recognizedPlayerUsername).toBe('suspect');
        expect(result.recognizedPlayerUsername).not.toBe(value.engine.get('event-1')!.playerUsername);
        expect(value.inspections.verifyChain()).toBe(true);
        const reopened = new EngineWitnessInspectionStore(join(value.root,'inspection.sqlite'));
        try {
            expect(executeWitnessInspection(value.command,{...value.deps,inspections:reopened,
                observer:()=>null,target:()=>null,now:NOW+400_000})).toEqual(result);
            expect(()=>executeWitnessInspection({...value.command,observerUsername:'other'},
                {...value.deps,inspections:reopened})).toThrow('reused');
            expect(()=>executeWitnessInspection({...value.command,targetPlayerSlot:9},
                {...value.deps,inspections:reopened})).toThrow('reused');
        } finally {reopened.close();}
    }));
    test('visual digest ignores packet username and stats, not visible appearance',()=>{
        const first = new Uint8Array(30).fill(1), labels = first.slice(), visual = first.slice();
        labels.fill(2,19);visual[0]=2;
        expect(anonymousVisualDigest(first)).toBe(anonymousVisualDigest(labels));
        expect(anonymousVisualDigest(first)).not.toBe(anonymousVisualDigest(visual));
        expect(()=>anonymousVisualDigest(new Uint8Array(11))).toThrow();
    });
    test('expired, hidden, disconnected, nonvisible, LOS miss and out-of-range cannot inspect',()=>fixture(value=>{
        const bad = [
            {...value.deps,now:NOW+300_001}, {...value.deps,visible:()=>false},
            {...value.deps,lineOfSight:()=>false}, {...value.deps,connected:()=>false}
        ];
        for(const deps of bad) expect(()=>executeWitnessInspection(value.command,deps)).toThrow();
        value.target.visibility=2;expect(()=>executeWitnessInspection(value.command,value.deps)).toThrow();
        value.target.visibility=0;value.target.x+=9;expect(()=>executeWitnessInspection(value.command,value.deps)).toThrow();
        value.target.x-=9;value.target.level=1;expect(()=>executeWitnessInspection(value.command,value.deps)).toThrow();
        expect(value.inspections.get(COMMAND)).toBeNull();
    }));
    test('session replacement or visual change cannot bridge old anonymous event',()=>fixture(value=>{
        expect(()=>executeWitnessInspection(value.command,{...value.deps,target:()=>({...value.target})})).toThrow();
        expect(()=>executeWitnessInspection(value.command,{...value.deps,observer:()=>({...value.observer})})).toThrow();
        value.target.generateAppearance=()=>new Uint8Array(15).fill(42);
        expect(()=>executeWitnessInspection(value.command,value.deps)).toThrow();
    }));
    test('visibility loss and return cannot revive an older anonymous event',()=>fixture(value=>{
        value.deps.tracker.refresh(2,NOW+1000,()=>false);
        value.deps.tracker.remember(value.observer,value.target,anonymousVisualDigest(value.target.generateAppearance()),3,NOW+2000);
        expect(()=>executeWitnessInspection({...value.command,expiresAt:NOW+4000},
            {...value.deps,engineTick:3,now:NOW+2000})).toThrow('continuity');
        expect(value.inspections.get(COMMAND)).toBeNull();
    }));
    test('tracking capacity eviction and skipped world refresh fail closed',()=>fixture(value=>{
        const tracker=new WitnessContinuityTracker(1,10000),visual=anonymousVisualDigest(value.target.generateAppearance());
        tracker.remember(value.observer,value.target,visual,1,NOW);
        tracker.remember({}, {},visual,1,NOW);
        expect(tracker.has(value.observer,value.target,1,2,visual)).toBe(false);
        value.deps.tracker.refresh(4,NOW+3000,()=>true);
        expect(value.deps.tracker.has(value.observer,value.target,1,4,visual)).toBe(false);
    }));
    test('legacy event and corrupt independent journal fail closed',()=>fixture(value=>{
        const original=value.engine.get('event-1')!;
        const {eventDigest,recordHash,previousHash,...input}=original;
        delete input.sightSnapshot!.continuity;input.eventId='legacy-1';value.engine.append(input);
        expect(()=>executeWitnessInspection({...value.command,eventId:'legacy-1'},value.deps)).toThrow('continuity');
        executeWitnessInspection(value.command,value.deps);
        const db=new Database(join(value.root,'inspection.sqlite'));
        db.run("UPDATE witness_inspection SET receipt_digest=?1",['f'.repeat(64)]);db.close();
        expect(value.inspections.verifyChain()).toBe(false);
        expect(()=>executeWitnessInspection(value.command,value.deps)).toThrow('audit');
    }));
    test('strict configurable policy bounds reject unexpected or excessive settings',()=>{
        expect(loadWitnessInspectionPolicy('{"version":1,"maxDistance":3,"maxEventAgeMs":5000}').maxDistance).toBe(3);
        for(const raw of ['{}','{"version":1,"maxDistance":16,"maxEventAgeMs":5000}',
            '{"version":1,"maxDistance":3,"maxEventAgeMs":5000,"alwaysRecognize":true}'])
            expect(()=>loadWitnessInspectionPolicy(raw)).toThrow();
    });
});
