import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { NativeLifecycleAttemptStore,type LifecycleAuthority,type LifecycleVitals } from './native-attempts.js';

export const lifecycleWatermarkStages=['after-terminal-guard','end-of-tick'] as const;
export type LifecycleWatermarkStage=typeof lifecycleWatermarkStages[number];
interface Head {sequence:number;digest:string|null}
export interface LifecycleWatermarkSample {
    sessionId:string;clock:SimulationClockObservation;wallTime:string;stage:LifecycleWatermarkStage;
    mortalityHead:Head;attemptHead:Head;attemptFaultCount:number;
    actors:Array<{username:string;authority:LifecycleAuthority|null}>;
    avatars:Array<{username:string;slot:number;vitals:LifecycleVitals}>;
}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function head(h:Head){check(h&&Number.isSafeInteger(h.sequence)&&h.sequence>=0&&(h.sequence===0?h.digest===null:typeof h.digest==='string'&&/^[a-f0-9]{64}$/.test(h.digest)),'Invalid lifecycle watermark prefix');}
function validate(e:LifecycleWatermarkSample){const c=e?.clock;
    check(c&&c.status==='running'&&typeof c.clockId==='string'&&/^[a-f0-9]{64}$/.test(c.profileDigest)&&stamp(c.simulationTime)&&stamp(c.wallTime)
        &&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0&&Number.isSafeInteger(c.revision)&&c.revision>=0
        &&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128&&stamp(e.wallTime)&&e.wallTime>=c.wallTime
        &&lifecycleWatermarkStages.includes(e.stage)&&Number.isSafeInteger(e.attemptFaultCount)&&e.attemptFaultCount>=0,'Invalid lifecycle watermark');
    head(e.mortalityHead);head(e.attemptHead);
    check(Array.isArray(e.actors)&&e.actors.length<=1000&&new Set(e.actors.map(a=>a.username)).size===e.actors.length
        &&e.actors.every(a=>/^[a-z0-9]{1,12}$/.test(a.username)&&(a.authority===null||typeof a.authority==='object')),'Invalid lifecycle census authority');
    check(Array.isArray(e.avatars)&&e.avatars.length<=2048&&new Set(e.avatars.map(a=>a.slot)).size===e.avatars.length,'Invalid lifecycle census slots');
    for(const a of e.avatars)check(e.actors.some(p=>p.username===a.username)&&Number.isSafeInteger(a.slot)&&a.slot>=0&&a.slot<2048
        &&Number.isSafeInteger(a.vitals?.hitpoints)&&a.vitals.hitpoints>=0&&a.vitals.hitpoints<=255
        &&typeof a.vitals.terminal==='boolean'&&typeof a.vitals.finite==='boolean','Invalid lifecycle census avatar');
}
/** Own additive schema, explicitly selected before a baseline. No upgrade/backfill of existing attempt or mortality history. */
export class NativeLifecycleWatermarkStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_lifecycle_watermark_selection'").get();}
    constructor(readonly db:Database,initialize=false){
        if(!NativeLifecycleWatermarkStore.present(db)){
            check(initialize,'Lifecycle watermarks require explicit initialization');
            const attempts=new NativeLifecycleAttemptStore(db),selection={schemaVersion:1,lifecycleSelectionDigest:hash(attempts.selection().selection),
                stages:[...lifecycleWatermarkStages],censusSource:'world-player-slots',openingAttemptCursor:attempts.cursor()};
            db.transaction(()=>{
                check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_lifecycle_watermark_schema','native_lifecycle_watermark_event','native_lifecycle_watermark_head','native_lifecycle_watermark_fault')").get(),'Incomplete lifecycle watermark schema');
                db.exec(`CREATE TABLE native_lifecycle_watermark_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO native_lifecycle_watermark_schema VALUES(1);
                    CREATE TABLE native_lifecycle_watermark_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE native_lifecycle_watermark_event(sequence INTEGER PRIMARY KEY,session_id TEXT NOT NULL,engine_tick INTEGER NOT NULL,stage TEXT NOT NULL,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL,UNIQUE(session_id,engine_tick,stage));
                    CREATE TABLE native_lifecycle_watermark_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                    INSERT INTO native_lifecycle_watermark_head VALUES(1,0,NULL);
                    CREATE TABLE native_lifecycle_watermark_fault(singleton INTEGER PRIMARY KEY CHECK(singleton=1),count INTEGER NOT NULL);INSERT INTO native_lifecycle_watermark_fault VALUES(1,0);
                    CREATE TRIGGER lifecycle_watermark_event_no_update BEFORE UPDATE ON native_lifecycle_watermark_event BEGIN SELECT RAISE(ABORT,'Lifecycle watermark history is immutable');END;
                    CREATE TRIGGER lifecycle_watermark_event_no_delete BEFORE DELETE ON native_lifecycle_watermark_event BEGIN SELECT RAISE(ABORT,'Lifecycle watermark history is immutable');END;
                    CREATE TRIGGER lifecycle_watermark_selection_no_update BEFORE UPDATE ON native_lifecycle_watermark_selection BEGIN SELECT RAISE(ABORT,'Lifecycle watermark selection is immutable');END;
                    CREATE TRIGGER lifecycle_watermark_selection_no_delete BEFORE DELETE ON native_lifecycle_watermark_selection BEGIN SELECT RAISE(ABORT,'Lifecycle watermark selection is immutable');END;
                    CREATE TRIGGER lifecycle_watermark_fault_no_reset BEFORE UPDATE ON native_lifecycle_watermark_fault WHEN NEW.count<=OLD.count BEGIN SELECT RAISE(ABORT,'Lifecycle watermark faults cannot reset');END;
                    CREATE TRIGGER lifecycle_watermark_fault_no_delete BEFORE DELETE ON native_lifecycle_watermark_fault BEGIN SELECT RAISE(ABORT,'Lifecycle watermark faults cannot reset');END;`);
                db.run('INSERT INTO native_lifecycle_watermark_selection VALUES(1,?,?)',[JSON.stringify(selection),hash(selection)]);
            }).immediate();
        }
        check((db.query('SELECT version FROM native_lifecycle_watermark_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported lifecycle watermark schema');
    }
    selection(){const row=this.db.query('SELECT payload,digest FROM native_lifecycle_watermark_selection WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(row,'Lifecycle watermark selection absent');const selection=JSON.parse(row.payload),source=new NativeLifecycleAttemptStore(this.db).selection();
        check(hash(selection)===row.digest&&selection.schemaVersion===1&&selection.lifecycleSelectionDigest===hash(source.selection)
            &&hash(selection.stages)===hash([...lifecycleWatermarkStages])&&selection.censusSource==='world-player-slots'
            &&Number.isSafeInteger(selection.openingAttemptCursor?.faultCount)&&selection.openingAttemptCursor.faultCount>=0,'Lifecycle watermark selection differs');
        head(selection.openingAttemptCursor.head);return{selection,mortality:source.mortality};}
    append(sample:LifecycleWatermarkSample){validate(sample);this.selection();
        this.db.transaction(()=>{
            const cursor=new NativeLifecycleAttemptStore(this.db).cursor();check(hash(cursor.head)===hash(sample.attemptHead)&&cursor.faultCount===sample.attemptFaultCount,'Lifecycle watermark cursor moved');
            const h=this.db.query('SELECT sequence,digest FROM native_lifecycle_watermark_head WHERE singleton=1').get() as Head|null,
                tail=this.db.query('SELECT sequence,digest FROM native_lifecycle_watermark_event ORDER BY sequence DESC LIMIT 1').get() as Head|null;
            check(h&&h.sequence===(tail?.sequence??0)&&h.digest===(tail?.digest??null),'Lifecycle watermark tail differs');
            const sequence=h.sequence+1,payload=JSON.stringify(sample),digest=hash({sequence,payload,previousDigest:h.digest});
            this.db.run('INSERT INTO native_lifecycle_watermark_event VALUES(?,?,?,?,?,?,?)',[sequence,sample.sessionId,sample.clock.engineTick,sample.stage,payload,h.digest,digest]);
            this.db.run('UPDATE native_lifecycle_watermark_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
        }).immediate();
    }
    fault(){this.db.run('UPDATE native_lifecycle_watermark_fault SET count=count+1 WHERE singleton=1');}
    read(){const {selection,mortality}=this.selection();
        check((this.db.query('SELECT count(*) n FROM native_lifecycle_watermark_event').get() as {n:number}).n<=100000,'Lifecycle watermark row budget exceeded');
        let previous:string|null=null;
        const entries=(this.db.query('SELECT * FROM native_lifecycle_watermark_event ORDER BY sequence').all() as any[]).map((r,i)=>{
            const sample=JSON.parse(r.payload) as LifecycleWatermarkSample;validate(sample);
            check(r.sequence===i+1&&r.session_id===sample.sessionId&&r.engine_tick===sample.clock.engineTick&&r.stage===sample.stage&&r.previous_digest===previous
                &&r.digest===hash({sequence:r.sequence,payload:r.payload,previousDigest:previous}),'Lifecycle watermark chain differs');previous=r.digest;
            return{sequence:r.sequence as number,sample,digest:r.digest as string};});
        const h=this.db.query('SELECT sequence,digest FROM native_lifecycle_watermark_head WHERE singleton=1').get() as Head|null,
            faults=this.db.query('SELECT count FROM native_lifecycle_watermark_fault WHERE singleton=1').get() as {count:number}|null;
        check(h&&h.sequence===entries.length&&h.digest===previous&&faults&&Number.isSafeInteger(faults.count)&&faults.count>=0,'Lifecycle watermark head/fault differs');
        return{selection,mortality,head:h,faults:faults.count,entries};
    }
}
