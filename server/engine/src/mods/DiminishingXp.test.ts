import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync,readFileSync,writeFileSync,existsSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    buildXpActivityKey,
    decayRepetitionScore,
    DiminishingXpStore,
    multiplierForRepetition,
    parseDiminishingXpConfig,
    type XpActivityContext
} from './DiminishingXp.js';
import {handleXpBaselineAdmin} from './DiminishingXpAdmin.js';
import {validateXpStateSnapshot} from '../../../../society-experiments/xp-state.js';
import {XpExecutionStore} from './XpExecutionStore.js';
import {xpExecutionPolicyDigest,validateXpExecutionReport} from '../../../../society-experiments/xp-execution.js';
import {xpStateDigest} from '../../../../society-experiments/xp-state.js';
import {Database} from 'bun:sqlite';

const temporaryDirectories: string[] = [];
const executionStores:XpExecutionStore[]=[];
const context: XpActivityContext = { script: 'skill_fishing_lobster', targetKind: 'npc', targetId: 316, x: 2924, z: 3179, level: 0 };
const rawConfig = {
    affectedSkills: 'FISHING, MINING', regionSize: 64, recoveryMinutes: 60,
    tier2At: 3, tier3At: 5, tier4At: 7, tier5At: 9,
    multiplier2: 0.9, multiplier3: 0.7, multiplier4: 0.4, multiplier5: 0.15
};

function statePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'diminishing-xp-'));
    temporaryDirectories.push(directory);
    return join(directory, 'state.json');
}

afterEach(() => {
    for(const store of executionStores.splice(0))store.close();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function executionFixture(enabled=true){
    const path=statePath(),xp=new DiminishingXpStore(path),journalPath=join(path,'..','execution.sqlite');let now=10000;
    const currentTime=()=>new Date(now).toISOString(),journal=new XpExecutionStore(journalPath,false,currentTime);executionStores.push(journal);
    const policy={enabled,version:'1.2.0',dataSchemaVersion:2,config:rawConfig},policyDigest=xpExecutionPolicyDigest(policy);
    const capture=(names:string[])=>xp.snapshot(names,rawConfig,now),snapshot=capture(['ada','bea']);
    const request={experimentId:resetId,definitionDigest:xpStateDigest('native experiment'),cohort:['ada','bea'],expectedCohortDigest:snapshot.cohortDigest,expectedPolicyDigest:policyDigest};
    const observe=(name:string,execute?:(strict:boolean)=>number,signature=policyDigest)=>journal.observe(name,'FISHING',context,100,signature,()=>capture([name]),
        execute??(()=>enabled?xp.award(name,'FISHING',context,100,parseDiminishingXpConfig(rawConfig),now).grantedXp:100));
    const sql=(statement:string)=>{const db=new Database(journalPath);try{db.run(statement);}finally{(db as Database&{clearQueryCache():void}).clearQueryCache();db.close(true);}};
    return {xp,journal,journalPath,request,snapshot,capture,observe,sql,time:currentTime,at:(value:number)=>{now=value;}};
}
describe('first native XP calculation evidence',()=>{
    for(const enabled of [false,true])test(`binds per-player first input at calculation with XP enabled=${enabled}`,()=>{
        const f=executionFixture(enabled);f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        expect(f.observe('ada')).toBe(100);f.at(10001);expect(f.observe('bea')).toBe(100);
        const report=f.journal.seal(resetId,f.time());expect(report.complete).toBeTrue();expect(report.members.every(row=>row.status==='observed')).toBeTrue();
        expect(report.members[1]!.pending!.before!.empty).toBeTrue();expect(report.attestsPlayerStatCommit).toBeFalse();
        expect(validateXpExecutionReport(report)).toEqual(report);expect(f.xp.summary().activitiesTracked).toBe(enabled?2:0);
    });
    test('unarmed and already observed players retain normal execution; sealing with missing XP never invents evidence',()=>{
        const f=executionFixture();let calls=0;
        expect(f.observe('cora',strict=>{expect(strict).toBeFalse();calls++;return 33;})).toBe(33);
        f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);f.observe('ada');
        expect(f.observe('ada',strict=>{expect(strict).toBeFalse();calls++;return 44;})).toBe(44);expect(calls).toBe(2);
        const report=f.journal.seal(resetId,f.time());expect(report.complete).toBeFalse();expect(report.members[1]!.status).toBe('unobserved');
        expect(f.journal.seal(resetId,f.time())).toEqual(report);
    });
    test('actual repetition drift and XP policy drift reject before the calculation',()=>{
        const f=executionFixture();f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        f.xp.award('ada','FISHING',context,100,parseDiminishingXpConfig(rawConfig),10000);let calls=0;
        expect(f.observe('ada',()=>{calls++;return 100;})).toBe(0);
        expect(f.observe('bea',()=>{calls++;return 100;},xpStateDigest('changed calibration'))).toBe(0);
        expect(calls).toBe(0);expect(f.journal.seal(resetId,f.time()).members.every(row=>row.status==='rejected')).toBeTrue();
    });
    test('failed pending insertion cannot execute XP or masquerade as observed evidence',()=>{
        const f=executionFixture();f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        f.sql("CREATE TRIGGER reject_pending BEFORE INSERT ON xp_execution_event WHEN json_extract(NEW.payload,'$.kind')='pending' BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
        let calls=0;expect(f.observe('ada',()=>{calls++;return 100;})).toBe(0);expect(calls).toBe(0);
        expect(f.journal.get(resetId)!.members[0]!.status).toBe('rejected');expect(f.xp.summary().activitiesTracked).toBe(0);
    });
    test('failed outcome persistence leaves pending evidence across restart and cannot substitute a later calculation',()=>{
        const f=executionFixture();f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        f.sql("CREATE TRIGGER reject_observed BEFORE INSERT ON xp_execution_event WHEN json_extract(NEW.payload,'$.kind')='observed' BEGIN SELECT RAISE(ABORT,'injected outcome failure'); END");
        expect(f.observe('ada')).toBe(0);expect(f.xp.summary().activitiesTracked).toBe(1);
        const restarted=new XpExecutionStore(f.journalPath,false,f.time);executionStores.push(restarted);let calls=0;
        expect(restarted.observe('ada','FISHING',context,100,f.request.expectedPolicyDigest,()=>f.capture(['ada']),()=>{calls++;return 100;})).toBe(0);
        expect(calls).toBe(0);const report=restarted.seal(resetId,f.time());expect(report.members[0]!.status).toBe('pending');expect(report.complete).toBeFalse();
    });
    test('engine callback failure remains pending and yields no successful outcome',()=>{
        const f=executionFixture();f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        expect(f.observe('ada',()=>{throw new Error('Native XP hook failed');})).toBe(0);
        expect(f.journal.get(resetId)!.members[0]!.status).toBe('pending');
    });
    test('arm replay is idempotent, conflicts and overlapping cohorts roll back, seal releases ownership',()=>{
        const f=executionFixture(),armed=f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);
        expect(f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest)).toEqual(armed);
        expect(()=>f.journal.arm({...f.request,definitionDigest:xpStateDigest('other')},f.snapshot,f.request.expectedPolicyDigest)).toThrow('identity conflict');
        expect(()=>f.journal.arm({...f.request,experimentId:restoreId},f.snapshot,f.request.expectedPolicyDigest)).toThrow();expect(f.journal.get(restoreId)).toBeNull();
        f.journal.seal(resetId,f.time());expect(f.journal.arm({...f.request,experimentId:restoreId},f.snapshot,f.request.expectedPolicyDigest).sealed).toBeFalse();
    });
    test('tail deletion, fabricated report flags and future schema invalidate execution evidence',()=>{
        const f=executionFixture();f.journal.arm(f.request,f.snapshot,f.request.expectedPolicyDigest);f.observe('ada');f.observe('bea');
        const report=f.journal.seal(resetId,f.time());expect(()=>validateXpExecutionReport({...report,attestsPlayerStatCommit:true})).toThrow();
        f.sql('DELETE FROM xp_execution_event WHERE sequence=4');expect(()=>f.journal.get(resetId)).toThrow();
        f.sql('PRAGMA user_version=2');expect(()=>new XpExecutionStore(f.journalPath,true)).toThrow('schema');
    });
});

describe('diminishing XP policy', () => {
    test('builds an activity key from skill, activity, target and region', () => {
        expect(buildXpActivityKey('fishing', context, 64)).toBe('FISHING|skill_fishing_lobster|npc:316|0:45,49');
        expect(buildXpActivityKey('fishing', { ...context, x: 3000 }, 64)).not.toBe(buildXpActivityKey('fishing', context, 64));
    });

    test('uses the configured non-increasing reward curve at exact boundaries', () => {
        const config = parseDiminishingXpConfig(rawConfig);
        expect([1, 2, 3, 5, 7, 9].map(value => multiplierForRepetition(value, config))).toEqual([1, 1, 0.9, 0.7, 0.4, 0.15]);
    });

    test('regenerates one repetition step during every configured recovery interval', () => {
        expect(decayRepetitionScore(8, 1_000, 1_000 + 2.5 * 60 * 60_000, 60)).toBe(5.5);
        expect(decayRepetitionScore(1, 1_000, 1_000 + 2 * 60 * 60_000, 60)).toBe(0);
    });

    test('persists per-player activity counters and resumes them after restart', () => {
        const path = statePath();
        const config = parseDiminishingXpConfig(rawConfig);
        const store = new DiminishingXpStore(path);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 1_000).grantedXp).toBe(100);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 2_000).grantedXp).toBe(100);

        const restarted = new DiminishingXpStore(path);
        const third = restarted.award('Ferry14', 'FISHING', context, 100, config, 3_000);
        expect(third).toMatchObject({ grantedXp: 90, multiplier: 0.9 });
        expect(third.repetitionScore).toBeCloseTo(3, 2);
        expect(restarted.summary()).toEqual({ playersTracked: 1, activitiesTracked: 1 });
        expect(restarted.inspect(config, 3_000)).toMatchObject([{
            username: 'ferry14', activityKey: 'FISHING|skill_fishing_lobster|npc:316|0:45,49', nextMultiplier: 0.9
        }]);
    });

    test('rejects increasing curves and overlapping thresholds', () => {
        expect(() => parseDiminishingXpConfig({ ...rawConfig, multiplier4: 0.8 })).toThrow('must not increase');
        expect(() => parseDiminishingXpConfig({ ...rawConfig, tier4At: 5 })).toThrow('strictly increasing');
    });

    test('serializes rapidly scheduled awards without losing persistent updates', async () => {
        const path = statePath();
        const config = parseDiminishingXpConfig(rawConfig);
        const store = new DiminishingXpStore(path);
        await Promise.all(Array.from({ length: 25 }, (_, index) => Promise.resolve().then(() =>
            store.award('Parallel1', 'MINING', { ...context, script: 'mining', targetKind: 'loc', targetId: 2090 }, 40, config, 1_000 + index)
        )));
        const restarted = new DiminishingXpStore(path);
        expect(restarted.inspect(config, 2_000)[0]?.repetitionScore).toBeCloseTo(25, 2);
    });

    test('allows an administrator to configure a hard zero reward tier', () => {
        const path = statePath();
        const config = parseDiminishingXpConfig({ ...rawConfig, multiplier5: 0 });
        const store = new DiminishingXpStore(path);
        for (let index = 0; index < 8; index++) store.award('Ferry14', 'FISHING', context, 100, config, 1_000 + index);
        expect(store.award('Ferry14', 'FISHING', context, 100, config, 1_009).grantedXp).toBe(0);
    });
});

const resetId='10000000-0000-4000-8000-000000000001',restoreId='10000000-0000-4000-8000-000000000002';
function command(store:DiminishingXpStore,kind:'reset'|'restore'='reset'){
    return {kind,commandId:kind==='reset'?resetId:restoreId,expectedStoreDigest:store.snapshot(['ada','bea'],rawConfig,10000).storeDigest,
        reason:'Controlled native XP baseline.',cohort:['ada','bea'],sourceCommandId:kind==='restore'?resetId:null};
}
describe('native XP baseline snapshots and recovery',()=>{
    test('returned snapshot counters cannot mutate authoritative memory or disk',()=>{
        const path=statePath(),store=new DiminishingXpStore(path);
        store.award('ada','FISHING',context,100,parseDiminishingXpConfig(rawConfig),1000);
        const before=store.snapshot(['ada'],rawConfig,10000),leaked=store.snapshot(['ada'],rawConfig,10000);
        Object.values(leaked.players.ada!.activities)[0]!.repetitionScore=999;
        expect(store.snapshot(['ada'],rawConfig,10000)).toEqual(before);
        expect(new DiminishingXpStore(path).snapshot(['ada'],rawConfig,10000)).toEqual(before);
    });
    test('missing state is observed as empty without creating a file; forged fields and cohorts are rejected',()=>{
        const path=statePath(),store=new DiminishingXpStore(path),snapshot=store.snapshot(['bea','ada'],rawConfig,10000);
        expect(existsSync(path)).toBeFalse();expect(snapshot.empty).toBeTrue();expect(snapshot.cohort).toEqual(['ada','bea']);
        expect(validateXpStateSnapshot(snapshot,['ada','bea'])).toEqual(snapshot);
        for(const forged of [{...snapshot,empty:false},{...snapshot,storeDigest:'forged'},{...snapshot,cohort:['ada']},
            {...snapshot,schemaVersion:2},{...snapshot,players:{ada:{activities:{}}}}])expect(()=>validateXpStateSnapshot(forged)).toThrow();
    });
    test('reset is scoped, atomic, idempotent and recoverable after restart; original timestamps remain historical',()=>{
        const path=statePath(),store=new DiminishingXpStore(path),config=parseDiminishingXpConfig(rawConfig);
        for(let i=0;i<9;i++)store.award('ada','FISHING',context,100,config,1000+i);
        store.award('cora','FISHING',context,100,config,2000);
        const before=store.snapshot(['ada','bea'],rawConfig,10000),request=command(store),reset=store.applyBaseline(request,rawConfig,10000);
        expect(reset.snapshot.empty).toBeTrue();expect(reset.receipt.before.players).toEqual(before.players);
        expect(store.summary()).toEqual({playersTracked:1,activitiesTracked:1});
        const replay=store.applyBaseline(request,rawConfig,10001);expect(replay.replayed).toBeTrue();expect(replay.receipt).toEqual(reset.receipt);
        expect(()=>store.applyBaseline({...request,reason:'Different request'},rawConfig,10001)).toThrow('identity conflict');
        const restarted=new DiminishingXpStore(path),restored=restarted.applyBaseline(command(restarted,'restore'),rawConfig,20000);
        expect(restored.snapshot.players).toEqual(before.players);expect(restored.snapshot.empty).toBeFalse();
        expect(restarted.summary()).toEqual({playersTracked:2,activitiesTracked:2});
        expect(JSON.parse(readFileSync(path,'utf8')).audit.entries).toHaveLength(2);
        expect(new DiminishingXpStore(path).snapshot(['ada','bea'],rawConfig,20000)).toEqual(restored.snapshot);
    });
    test('replaying a reset never erases later native awards',()=>{
        const store=new DiminishingXpStore(statePath()),request=command(store);store.applyBaseline(request,rawConfig,10000);
        store.award('ada','FISHING',context,100,parseDiminishingXpConfig(rawConfig),11000);
        const replay=store.applyBaseline(request,rawConfig,12000);expect(replay.replayed).toBeTrue();expect(replay.snapshot.empty).toBeFalse();
    });
    test('stale compare-and-set, absent restore source and changed configuration leave the file unchanged',()=>{
        const path=statePath(),store=new DiminishingXpStore(path),request=command(store);store.applyBaseline(request,rawConfig,10000);
        const before=readFileSync(path,'utf8');
        expect(()=>store.applyBaseline({...command(store,'restore'),expectedStoreDigest:'f'.repeat(64)},rawConfig,10000)).toThrow('compare-and-set');
        expect(()=>store.applyBaseline({...command(store,'restore'),sourceCommandId:restoreId},rawConfig,10000)).toThrow('exact native reset');
        expect(()=>store.applyBaseline(command(store,'restore'),{...rawConfig,regionSize:128},10000)).toThrow('configuration');
        expect(readFileSync(path,'utf8')).toBe(before);
    });
    test('failed persistence preserves both disk and memory; stale runtimes cannot overwrite newer awards',()=>{
        const path=statePath(),store=new DiminishingXpStore(path),stale=new DiminishingXpStore(path),config=parseDiminishingXpConfig(rawConfig);
        writeFileSync(`${path}.lock`,'held');expect(()=>store.award('ada','FISHING',context,100,config,1000)).toThrow();
        expect(store.summary().activitiesTracked).toBe(0);expect(existsSync(path)).toBeFalse();unlinkSync(`${path}.lock`);
        store.award('ada','FISHING',context,100,config,1000);
        expect(()=>stale.award('bea','FISHING',context,100,config,1001)).toThrow('changed outside');
        expect(new DiminishingXpStore(path).summary()).toEqual({playersTracked:1,activitiesTracked:1});
    });
    test('legacy v1 awards remain v1 until an explicit baseline mutation; audit corruption and future schemas fail closed',()=>{
        const path=statePath(),store=new DiminishingXpStore(path);store.award('ada','FISHING',context,100,parseDiminishingXpConfig(rawConfig),1000);
        expect(JSON.parse(readFileSync(path,'utf8')).schemaVersion).toBe(1);store.applyBaseline(command(store),rawConfig,10000);
        const valid=JSON.parse(readFileSync(path,'utf8'));expect(valid.schemaVersion).toBe(2);
        for(const bad of [{...valid,schemaVersion:3},{...valid,audit:{...valid.audit,entries:[]}},
            {...valid,audit:{...valid.audit,headHash:'f'.repeat(64)}}]){
            writeFileSync(path,JSON.stringify(bad));expect(()=>new DiminishingXpStore(path)).toThrow();
        }
    });
    test('engine boundary rejects online cohorts, active society runs, uploads and unsupported methods',async()=>{
        const path=statePath(),store=new DiminishingXpStore(path),url=new URL('http://localhost/api/internal/admin/xp-baseline?player=ada&player=bea');
        let online=false,active=false;
        const deps={capture:(names:string[])=>store.snapshot(names,rawConfig,10000),apply:(input:Parameters<typeof store.applyBaseline>[0])=>store.applyBaseline(input,rawConfig,10000),
            offline:()=>!online,assertResetAllowed:()=>{if(active)throw new Error('active society');}};
        const request=()=>new Request(url,{method:'POST',body:JSON.stringify(command(store))});
        expect((await handleXpBaselineAdmin(new Request(url),url,deps)).status).toBe(200);expect(existsSync(path)).toBeFalse();
        online=true;expect((await handleXpBaselineAdmin(request(),url,deps)).status).toBe(409);online=false;
        active=true;expect((await handleXpBaselineAdmin(request(),url,deps)).status).toBe(409);active=false;
        expect((await handleXpBaselineAdmin(new Request(url,{method:'POST',body:JSON.stringify({...command(store),snapshot:{}})}),url,deps)).status).toBe(409);
        expect((await handleXpBaselineAdmin(new Request(url,{method:'DELETE'}),url,deps)).status).toBe(405);
        expect((await handleXpBaselineAdmin(request(),url,deps)).status).toBe(200);expect(store.snapshot(['ada','bea'],rawConfig,10000).empty).toBeTrue();
    });
});
