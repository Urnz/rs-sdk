import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { SocietyIntegrityStore, saveCreatesValue, saveValueSnapshot, type IntegrityMutation } from '../store.js';
import { withSocietyValueMutation, observeLegacySocietyRun, type IntegrityBoundary } from '../runtime.js';
import { buildWorldGenesisConfiguration, buildWorldGenesisResult, loadWorldGenesisProfileCatalog, WorldGenesisRunStore } from '../../world-genesis/index.js';
import { SimulationClockStore, simulationClockProfileDigest } from '../../simulation-clock/index.js';
import { InstitutionTreasuryStore } from '../../server/gateway/admin/institution-treasury.js';
import { PlayerRewardStore } from '../../server/engine/src/mods/PlayerRewardStore.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { bindSocietyInternalPayment } from '../../server/gateway/admin/society-integrity.js';

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
const time='2001-01-01T00:00:00.000Z',wall='2026-10-14T12:00:00.000Z',profileDigest='b'.repeat(64);
function fixture(invalidate=true,observing=true,snapshotDigest=profileDigest) {
    const directory=mkdtempSync(join(tmpdir(),'society-integrity-'));directories.push(directory);
    const profile=loadWorldGenesisProfileCatalog(join(import.meta.dir,'../../config/world-genesis-profiles.json'))
        .profiles.find(profile=>profile.profileId==='mature-society')!;
    const configuration=buildWorldGenesisConfiguration({seed:'integrity',profile,worldBuild:'local',simulationClock:{clockId:'world',profileDigest:snapshotDigest,initialSimulationTime:time}});
    const result=buildWorldGenesisResult(configuration,{assets:[
        {allocationId:'alice-money',kind:'currency',owner:{kind:'player',id:'alice'},amountGp:100},
        {allocationId:'alice-food',kind:'item',owner:{kind:'player',id:'alice'},container:'inventory',itemId:379,count:2,slot:null},
        {allocationId:'forge',kind:'business',owner:{kind:'player',id:'alice'},businessId:'forge',openingCapitalGp:200,openingInventoryDigest:'c'.repeat(64)}
    ]},wall);
    const path=join(directory,'integrity.sqlite'),store=new SocietyIntegrityStore(path);
    store.begin(result,invalidate);if(observing)store.finishBootstrap(result.resultId);store.close();
    const boundary:IntegrityBoundary={path,observe:()=>({clockId:'world',profileDigest:snapshotDigest,simulationTime:time,wallTime:wall})};
    return {directory,path,result,boundary,report:()=>{
        const source=new SocietyIntegrityStore(path,true);try{return source.report(result.resultId);}finally{source.close();}
    }};
}
const mutation:IntegrityMutation={source:'engine.cheat-value',operationId:'cheat-one',actor:'player:alice',payload:{itemId:379,count:1}};
describe('society bootstrap and runtime integrity',()=>{
    test('keeps each currency/item and embedded Business capital as a separate genesis event across restart and reset',()=>{
        const f=fixture();const report=f.report();
        expect(report.events.filter(event=>event.kind==='genesis-value')).toHaveLength(3);
        expect(report).toMatchObject({injectionCount:0,cleanRunStatus:'no-detected-injection',passesObservedInjectionGate:true});
        const reopened=new SocietyIntegrityStore(f.path);expect(reopened.begin(f.result,true).status).toBe('observing');
        expect(()=>reopened.begin(f.result,false)).toThrow('conflicts');
        reopened.reset(f.result.resultId);reopened.close();
        expect(f.report().events.filter(event=>event.kind==='genesis-value')).toHaveLength(3);
        expect(f.report().passesObservedInjectionGate).toBe(false);
    });
    test('automatically persists and invalidates a native-boundary intervention at an unchanged simulation timestamp',()=>{
        const f=fixture();let count=0;
        withSocietyValueMutation(mutation,()=>++count,f.boundary);
        expect(count).toBe(1);expect(f.report()).toMatchObject({injectionCount:1,cleanRunStatus:'contaminated',run:{invalidated:true},passesObservedInjectionGate:false});
        expect(f.report().events.find(event=>event.kind==='runtime-injection')!.stamp!.simulationTime).toBe(time);
    });
    test('the optional policy retains contamination flags even when automatic invalidation is disabled',()=>{
        const f=fixture(false);withSocietyValueMutation(mutation,()=>1,f.boundary);
        expect(f.report()).toMatchObject({injectionCount:1,cleanRunStatus:'contaminated',run:{invalidated:false},eligibleUnderInvalidationPolicy:true,passesObservedInjectionGate:false});
    });
    test('a crash or exception after starting the native mutation remains unverified, never clean',()=>{
        const f=fixture();expect(()=>withSocietyValueMutation(mutation,()=>{throw new Error('crash');},f.boundary)).toThrow('crash');
        expect(f.report()).toMatchObject({injectionCount:0,cleanRunStatus:'unverified',passesObservedInjectionGate:false});
        expect(f.report().events.find(event=>event.kind==='runtime-injection')!.status).toBe('pending');
    });
    test('clock conflicts and a broken journal block the mutation before native value changes',()=>{
        const f=fixture();let calls=0;
        expect(()=>withSocietyValueMutation(mutation,()=>++calls,{...f.boundary,observe:()=>({...f.boundary.observe(),profileDigest:'f'.repeat(64)})})).toThrow('clock');
        const db=new Database(f.path);db.run('DELETE FROM integrity_event WHERE sequence=1');db.close(true);
        expect(()=>withSocietyValueMutation(mutation,()=>++calls,f.boundary)).toThrow('corrupt');expect(calls).toBe(0);
    });
    test('a full inventory or other proven zero-effect grant does not count as an injection',()=>{
        const f=fixture();withSocietyValueMutation(mutation,()=>0,f.boundary,count=>count>0);
        expect(f.report()).toMatchObject({injectionCount:0,cleanRunStatus:'no-detected-injection',passesObservedInjectionGate:true});
    });
    test('bootstrap permits require declared allocation deltas and match both native save snapshots exactly',()=>{
        const f=fixture(true,false),source=new SocietyIntegrityStore(f.path);
        const before={coins:0,skills:[],inventory:[],bank:[],equipment:[],position:{x:1,z:1,level:0}};
        const after={...before,coins:100,inventory:[{id:379,count:2}]};
        const edit:IntegrityMutation={source:'engine.offline-save',operationId:'offline-save:one',actor:'player:alice',
            payload:{before:saveValueSnapshot(before),after:saveValueSnapshot(after)}};
        expect(()=>source.authorize(f.result.resultId,{...edit,payload:{before,after:{...after,coins:101}}})).toThrow('outside');
        source.authorize(f.result.resultId,edit);expect(()=>source.finishBootstrap(f.result.resultId)).toThrow('incomplete');source.close();
        expect(()=>withSocietyValueMutation({...edit,payload:{before,after:{...after,coins:101}}},()=>undefined,f.boundary)).toThrow('permit');
        withSocietyValueMutation(edit,()=>undefined,f.boundary);
        expect(()=>withSocietyValueMutation(edit,()=>undefined,f.boundary)).toThrow('single-use');
        const finish=new SocietyIntegrityStore(f.path);finish.finishBootstrap(f.result.resultId);finish.close();
        expect(f.report().injectionCount).toBe(0);
        withSocietyValueMutation({...edit,operationId:'offline-save:later'},()=>undefined,f.boundary);
        expect(f.report().injectionCount).toBe(1);
    });
    test('inventory relocation and value removal are not free value; positive GP, items and XP are',()=>{
        const before={coins:10,skills:[{name:'MINING',experience:10}],inventory:[{id:379,count:1}],bank:[],equipment:[],position:{x:1,z:1,level:0}};
        expect(saveCreatesValue(before,{...before,inventory:[],bank:before.inventory})).toBe(false);
        expect(saveCreatesValue(before,{...before,coins:9,inventory:[]})).toBe(false);
        expect(saveCreatesValue(before,{...before,coins:11})).toBe(true);
        expect(saveCreatesValue(before,{...before,inventory:[{id:379,count:2}]})).toBe(true);
        expect(saveCreatesValue(before,{...before,skills:[{name:'MINING',experience:11}]})).toBe(true);
    });
    test('legacy or absent history is not created by an ordinary boundary call',()=>{
        const directory=mkdtempSync(join(tmpdir(),'society-legacy-'));directories.push(directory);const path=join(directory,'absent.sqlite');
        let calls=0;withSocietyValueMutation(mutation,()=>++calls,{path,observe:()=>{throw new Error('unused');}});
        expect(calls).toBe(1);expect(existsSync(path)).toBe(false);
    });
    test('native treasury increases are detected; decreases and stale updates do not add a signal',()=>{
        const f=fixture(),treasury=new InstitutionTreasuryStore(join(f.directory,'treasury.sqlite'),f.boundary);
        const empty=treasury.ensure('business','forge');treasury.setBalance('business','forge',empty.revision,100);
        const funded=treasury.get('business','forge')!;treasury.setBalance('business','forge',funded.revision,90);
        expect(()=>treasury.setBalance('business','forge',funded.revision,120)).toThrow('changed');
        treasury.close();expect(f.report().injectionCount).toBe(1);
    });
    test('native rewards are marked once; exact replay cannot mint again or duplicate the flag',()=>{
        const f=fixture(),rewards=new PlayerRewardStore(join(f.directory,'rewards.sqlite'),f.boundary),settlement=randomUUID();let coins=0;
        const wallet={balance:()=>coins,credit:(amount:number)=>(coins+=amount,amount),remove:(amount:number)=>(coins-=amount,amount)};
        rewards.credit(settlement,'alice',50,wallet);rewards.credit(settlement,'alice',50,wallet);
        expect(coins).toBe(50);expect(f.report().injectionCount).toBe(1);rewards.close();
    });
    test('runtime Business stock grants retain their native item amount and cannot bypass marking with a genesis method name',()=>{
        const f=fixture(),businesses=new BusinessManagerStore(join(f.directory,'business.sqlite'),undefined,f.boundary);
        businesses.create({businessId:'forge',name:'Forge',summary:'Local workshop.',ownerAgentId:'alice-agent'});
        businesses.creditGenesisInventory('runtime-food','forge',379,4);businesses.creditGenesisInventory('runtime-food','forge',379,4);
        expect(businesses.listInventory('forge')[0]!.count).toBe(4);businesses.close();
        const event=f.report().events.find(event=>event.kind==='runtime-injection')!;
        expect(event.mutation).toMatchObject({source:'gateway.business-stock-genesis',payload:{itemId:379,count:4}});
        expect(f.report().injectionCount).toBe(1);
    });
    test('changing a pending operation to committed without its hash-linked resolution fails closed',()=>{
        const f=fixture();expect(()=>withSocietyValueMutation(mutation,()=>{throw new Error('crash');},f.boundary)).toThrow();
        const db=new Database(f.path);db.run("UPDATE integrity_event SET status='committed' WHERE event_id='cheat-one'");db.close(true);
        expect(()=>f.report()).toThrow('resolution');
    });
    test('a legacy applied social genesis starts future monitoring with a permanent gap rather than inventing clean history',()=>{
        const f=fixture(),runPath=join(f.directory,'runs.sqlite'),journalPath=join(f.directory,'legacy-integrity.sqlite');
        const runs=new WorldGenesisRunStore(runPath);const begun=runs.begin(f.result,{backup:'native'},wall);
        runs.finishApply(f.result.resultId,begun.revision,{verified:true},wall);runs.close();
        observeLegacySocietyRun(journalPath,runPath,f.boundary.observe,true);
        const boundary={...f.boundary,path:journalPath};withSocietyValueMutation(mutation,()=>1,boundary);
        const source=new SocietyIntegrityStore(journalPath,true);const report=source.report(f.result.resultId);
        expect(report).toMatchObject({injectionCount:1,cleanRunStatus:'contaminated',passesObservedInjectionGate:false});
        expect(report.events.find(event=>event.kind==='coverage-gap')!.status).toBe('pending');source.close();
        observeLegacySocietyRun(journalPath,runPath,f.boundary.observe,true);
        const reopened=new SocietyIntegrityStore(journalPath,true);expect(reopened.report(f.result.resultId).injectionCount).toBe(1);reopened.close();
    });
    test('uses an actual paused shared SQLite SimulationClock, without converting wall time into elapsed simulation time',()=>{
        const profile={schemaVersion:1 as const,profileId:'normal',version:'1.0.0',seed:'integrity-clock',rate:{simulationMilliseconds:1,wallMilliseconds:1}};
        const f=fixture(true,true,simulationClockProfileDigest(profile)),clock=new SimulationClockStore(join(f.directory,'clock.sqlite'));
        const created=clock.create({clockId:'world',profile,wallTime:wall,simulationTime:time});clock.pause('world',created.revision,wall);
        const boundary:IntegrityBoundary={path:f.path,observe:()=>{
            const observed=clock.observe('world','2026-10-15T12:00:00.000Z');
            return {clockId:observed.clockId,profileDigest:observed.profileDigest,simulationTime:observed.simulationTime,wallTime:'2026-10-15T12:00:00.000Z'};
        }};
        withSocietyValueMutation(mutation,()=>1,boundary);expect(clock.get('world')!.lastSimulationTime).toBe(time);clock.close();
        expect(f.report().events.find(event=>event.kind==='runtime-injection')!.stamp!.simulationTime).toBe(time);
    });
    test('native reserved and committed treasury-backed payments are redistribution, with pending debit recovery fail-closed',()=>{
        const f=fixture(),treasuryPath=join(f.directory,'treasury.sqlite'),treasury=new InstitutionTreasuryStore(treasuryPath);
        const empty=treasury.ensure('business','forge');treasury.setBalance('business','forge',empty.revision,100);
        const settlementId=randomUUID(),reservationId='legitimate-work';treasury.reserve('business','forge',reservationId,50);treasury.bindSettlement(reservationId,settlementId);
        const payment={settlementId,username:'alice',amountGp:50,reservationId,treasuryPath};
        bindSocietyInternalPayment(payment,'reserve',f.path);
        const rewards=new PlayerRewardStore(join(f.directory,'rewards.sqlite'),f.boundary);let coins=0;
        rewards.credit(settlementId,'alice',50,{balance:()=>coins,credit:amount=>(coins+=amount,amount),remove:amount=>(coins-=amount,amount)});
        expect(f.report()).toMatchObject({injectionCount:0,cleanRunStatus:'unverified',passesObservedInjectionGate:false});
        expect(()=>bindSocietyInternalPayment(payment,'commit',f.path)).toThrow('backing');
        treasury.commit(reservationId,settlementId);bindSocietyInternalPayment(payment,'commit',f.path);
        bindSocietyInternalPayment(payment,'reserve',f.path);bindSocietyInternalPayment(payment,'commit',f.path);
        expect(f.report()).toMatchObject({injectionCount:0,cleanRunStatus:'no-detected-injection',run:{invalidated:false},passesObservedInjectionGate:true});
        expect(coins+treasury.get('business','forge')!.balanceGp).toBe(100);
        rewards.close();treasury.close();
    });
    test('a funded native payment can retry after a proven zero-effect rejection without minting twice or clearing a pending debit',()=>{
        const f=fixture(),treasuryPath=join(f.directory,'treasury.sqlite'),treasury=new InstitutionTreasuryStore(treasuryPath);
        const empty=treasury.ensure('business','forge');treasury.setBalance('business','forge',empty.revision,100);
        const settlementId=randomUUID(),reservationId='retry-after-full-inventory';
        treasury.reserve('business','forge',reservationId,50);treasury.bindSettlement(reservationId,settlementId);
        const payment={settlementId,username:'alice',amountGp:50,reservationId,treasuryPath};bindSocietyInternalPayment(payment,'reserve',f.path);
        const rewards=new PlayerRewardStore(join(f.directory,'rewards.sqlite'),f.boundary);let coins=0,space=false;
        const wallet={balance:()=>coins,credit:(amount:number)=>space?(coins+=amount,amount):0,remove:(amount:number)=>(coins-=amount,amount)};
        expect(()=>rewards.credit(settlementId,'alice',50,wallet)).toThrow('incomplete');
        expect(coins).toBe(0);expect(f.report().cleanRunStatus).toBe('unverified');
        space=true;bindSocietyInternalPayment(payment,'reserve',f.path);rewards.credit(settlementId,'alice',50,wallet);
        rewards.credit(settlementId,'alice',50,wallet);expect(coins).toBe(50);expect(f.report().cleanRunStatus).toBe('unverified');
        treasury.commit(reservationId,settlementId);bindSocietyInternalPayment(payment,'commit',f.path);
        expect(f.report()).toMatchObject({injectionCount:0,passesObservedInjectionGate:true});
        expect(coins+treasury.get('business','forge')!.balanceGp).toBe(100);rewards.close();treasury.close();
    });
});
