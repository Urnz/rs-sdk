import type { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import { NativeMortalityCoverageStore,type MortalityActor,type MortalityHealthHeads } from './native-coverage.js';

export const lifecycleAttemptKinds=['load','login-guard','world-admission','world-reconnect','world-eviction','respawn-script','terminal-script-abort'] as const;
export type LifecycleAttemptKind=typeof lifecycleAttemptKinds[number];
export type LifecycleAttemptOutcome='parsed'|'failed'|'passed'|'blocked-restricted'|'blocked-hp-zero'|'source-unavailable'|'admitted'|'reconnected'|'evicted'|'returned'|'blocked-terminal'|'blocked-sleeping'|'blocked-busy';
export interface LifecycleAuthority {actor:MortalityActor;clock:SimulationClockObservation;healthHeads:MortalityHealthHeads;deathEventId:string|null;restricted:boolean}
export interface LifecycleVitals {hitpoints:number;terminal:boolean;finite:boolean}
export interface LifecycleAttemptEvent {
    attemptId:string;sessionId:string;username:string;kind:LifecycleAttemptKind;phase:'begin'|'result';wallTime:string;
    authority:LifecycleAuthority|null;vitals:LifecycleVitals|null;scriptName:string|null;
    outcome:LifecycleAttemptOutcome|null;scriptState:number|null;
}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function validate(e:LifecycleAttemptEvent,actors:MortalityActor[],clockId:string,profile:string){
    check(e&&/^[a-f0-9-]{36}$/.test(e.attemptId)&&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128
        &&actors.some(a=>a.username===e.username)&&lifecycleAttemptKinds.includes(e.kind)&&['begin','result'].includes(e.phase)&&stamp(e.wallTime)
        &&(e.scriptName===null||typeof e.scriptName==='string'&&e.scriptName.length>0&&e.scriptName.length<=256)
        &&(e.scriptState===null||Number.isSafeInteger(e.scriptState)&&e.scriptState>=-1&&e.scriptState<=6),'Invalid lifecycle attempt');
    if(e.phase==='begin')check(e.outcome===null&&e.scriptState===null,'Invalid lifecycle begin');
    else check(typeof e.outcome==='string'&&({load:['parsed','failed'], 'login-guard':['passed','blocked-restricted','blocked-hp-zero','source-unavailable'],
        'world-admission':['admitted'],'world-reconnect':['reconnected'],'world-eviction':['evicted'],
        'respawn-script':['returned','failed','blocked-terminal','blocked-sleeping','blocked-busy'],'terminal-script-abort':['blocked-terminal']}[e.kind] as string[]).includes(e.outcome),
        'Invalid lifecycle result');
    if(e.vitals)check(Number.isSafeInteger(e.vitals.hitpoints)&&e.vitals.hitpoints>=0&&e.vitals.hitpoints<=255
        &&typeof e.vitals.terminal==='boolean'&&typeof e.vitals.finite==='boolean','Invalid lifecycle vitals');
    if(e.authority){const a=e.authority,c=a.clock;
        check(a.actor.username===e.username&&typeof a.actor.actorId==='string'&&hex(a.actor.lifecycleId)&&hex(a.actor.membershipDigest)
            &&c?.status==='running'&&c.clockId===clockId&&c.profileDigest===profile&&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0
            &&Number.isSafeInteger(c.revision)&&c.revision>=0&&stamp(c.wallTime)&&stamp(c.simulationTime)&&c.wallTime<=e.wallTime
            &&typeof a.restricted==='boolean'&&(a.deathEventId===null||typeof a.deathEventId==='string'&&a.deathEventId.length<=256),'Invalid lifecycle authority');
        for(const d of ['damage','death','binding'] as const)check(a.healthHeads?.[d]&&Number.isSafeInteger(a.healthHeads[d].sequence)
            &&a.healthHeads[d].sequence>=0&&hex(a.healthHeads[d].digest),'Invalid lifecycle health prefix');
    }
}
/** Separate prospective attempt journal; parser success never means world admission. No gameplay authority or backfill. */
export class NativeLifecycleAttemptStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_lifecycle_selection'").get();}
    constructor(readonly db:Database,initialize=false){
        if(!NativeLifecycleAttemptStore.present(db)){
            check(initialize,'Lifecycle attempts require explicit initialization');
            const mortality=new NativeMortalityCoverageStore(db).selection(),selection={schemaVersion:1,mortalitySelectionDigest:hash(mortality),routes:[...lifecycleAttemptKinds]};
            db.transaction(()=>{
                check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_lifecycle_schema','native_lifecycle_event','native_lifecycle_head','native_lifecycle_fault')").get(),'Incomplete lifecycle attempt schema');
                db.exec(`CREATE TABLE native_lifecycle_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO native_lifecycle_schema VALUES(1);
                    CREATE TABLE native_lifecycle_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE native_lifecycle_event(sequence INTEGER PRIMARY KEY,attempt_id TEXT NOT NULL,phase TEXT NOT NULL,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL,UNIQUE(attempt_id,phase));
                    CREATE TABLE native_lifecycle_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                    INSERT INTO native_lifecycle_head VALUES(1,0,NULL);
                    CREATE TABLE native_lifecycle_fault(singleton INTEGER PRIMARY KEY CHECK(singleton=1),count INTEGER NOT NULL);
                    INSERT INTO native_lifecycle_fault VALUES(1,0);
                    CREATE TRIGGER lifecycle_event_no_update BEFORE UPDATE ON native_lifecycle_event BEGIN SELECT RAISE(ABORT,'Lifecycle history is immutable');END;
                    CREATE TRIGGER lifecycle_event_no_delete BEFORE DELETE ON native_lifecycle_event BEGIN SELECT RAISE(ABORT,'Lifecycle history is immutable');END;
                    CREATE TRIGGER lifecycle_selection_no_update BEFORE UPDATE ON native_lifecycle_selection BEGIN SELECT RAISE(ABORT,'Lifecycle selection is immutable');END;
                    CREATE TRIGGER lifecycle_selection_no_delete BEFORE DELETE ON native_lifecycle_selection BEGIN SELECT RAISE(ABORT,'Lifecycle selection is immutable');END;
                    CREATE TRIGGER lifecycle_fault_no_reset BEFORE UPDATE ON native_lifecycle_fault WHEN NEW.count<=OLD.count BEGIN SELECT RAISE(ABORT,'Lifecycle faults cannot reset');END;
                    CREATE TRIGGER lifecycle_fault_no_delete BEFORE DELETE ON native_lifecycle_fault BEGIN SELECT RAISE(ABORT,'Lifecycle faults cannot reset');END;`);
                db.run('INSERT INTO native_lifecycle_selection VALUES(1,?,?)',[JSON.stringify(selection),hash(selection)]);
            }).immediate();
        }
        check((db.query('SELECT version FROM native_lifecycle_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported lifecycle attempt schema');
    }
    selection(){const row=this.db.query('SELECT payload,digest FROM native_lifecycle_selection WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(row,'Lifecycle selection missing');const selection=JSON.parse(row.payload),mortality=new NativeMortalityCoverageStore(this.db).selection();
        check(hash(selection)===row.digest&&selection.schemaVersion===1&&selection.mortalitySelectionDigest===hash(mortality)
            &&hash(selection.routes)===hash([...lifecycleAttemptKinds]),'Lifecycle selection differs');return{selection,mortality};}
    append(event:LifecycleAttemptEvent){const {mortality}=this.selection();validate(event,mortality.actors,mortality.clockId,mortality.clockProfileDigest);
        this.db.transaction(()=>{
            const begin=this.db.query('SELECT payload FROM native_lifecycle_event WHERE attempt_id=? AND phase=?').get(event.attemptId,'begin') as {payload:string}|null;
            if(event.phase==='result'){check(begin,'Lifecycle result lacks begin');const p=JSON.parse(begin.payload) as LifecycleAttemptEvent;
                check(p.username===event.username&&p.kind===event.kind&&p.sessionId===event.sessionId&&p.scriptName===event.scriptName&&p.wallTime<=event.wallTime,'Lifecycle result identity/order differs');}
            const head=this.db.query('SELECT sequence,digest FROM native_lifecycle_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
                tail=this.db.query('SELECT sequence,digest FROM native_lifecycle_event ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;digest:string}|null;
            check(head&&head.sequence===(tail?.sequence??0)&&head.digest===(tail?.digest??null),'Lifecycle tail differs');
            const sequence=head.sequence+1,payload=JSON.stringify(event),digest=hash({sequence,payload,previousDigest:head.digest});
            this.db.run('INSERT INTO native_lifecycle_event VALUES(?,?,?,?,?,?)',[sequence,event.attemptId,event.phase,payload,head.digest,digest]);
            this.db.run('UPDATE native_lifecycle_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
        }).immediate();
    }
    fault(){this.db.run('UPDATE native_lifecycle_fault SET count=count+1 WHERE singleton=1');}
    cursor(){const head=this.db.query('SELECT sequence,digest FROM native_lifecycle_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
        tail=this.db.query('SELECT sequence,digest FROM native_lifecycle_event ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;digest:string}|null,
        fault=this.db.query('SELECT count FROM native_lifecycle_fault WHERE singleton=1').get() as {count:number}|null;
        check(head&&head.sequence===(tail?.sequence??0)&&head.digest===(tail?.digest??null)&&fault&&Number.isSafeInteger(fault.count)&&fault.count>=0,'Lifecycle cursor differs');
        return{head,faultCount:fault.count};}
    read(){const {selection,mortality}=this.selection();
        check((this.db.query('SELECT count(*) n FROM native_lifecycle_event').get() as {n:number}).n<=100000,'Lifecycle attempt row budget exceeded');
        let previous:string|null=null;const attempts=new Map<string,{begin:LifecycleAttemptEvent;result:LifecycleAttemptEvent|null}>();
        const entries=(this.db.query('SELECT * FROM native_lifecycle_event ORDER BY sequence').all() as any[]).map((row,i)=>{
            const event=JSON.parse(row.payload) as LifecycleAttemptEvent;validate(event,mortality.actors,mortality.clockId,mortality.clockProfileDigest);
            check(row.sequence===i+1&&row.attempt_id===event.attemptId&&row.phase===event.phase&&row.previous_digest===previous
                &&row.digest===hash({sequence:row.sequence,payload:row.payload,previousDigest:previous}),'Lifecycle attempt chain differs');
            if(event.phase==='begin'){check(!attempts.has(event.attemptId),'Duplicate lifecycle begin');attempts.set(event.attemptId,{begin:event,result:null});}
            else{const pair=attempts.get(event.attemptId);check(pair&&!pair.result&&pair.begin.username===event.username&&pair.begin.kind===event.kind
                &&pair.begin.sessionId===event.sessionId&&pair.begin.scriptName===event.scriptName&&pair.begin.wallTime<=event.wallTime,'Lifecycle result differs');pair.result=event;}
            previous=row.digest;return{sequence:row.sequence as number,event,digest:row.digest as string};});
        const head=this.db.query('SELECT sequence,digest FROM native_lifecycle_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
            faults=this.db.query('SELECT count FROM native_lifecycle_fault WHERE singleton=1').get() as {count:number}|null;
        check(head&&head.sequence===entries.length&&head.digest===previous&&faults&&Number.isSafeInteger(faults.count)&&faults.count>=0,'Lifecycle attempt head/fault differs');
        return{selection,mortality,head,faults:faults.count,entries,attempts};
    }
}
