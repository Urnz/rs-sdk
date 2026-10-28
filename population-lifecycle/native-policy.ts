import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import type { SimulationClockState,SimulationClockObservation } from '../simulation-clock/types.js';
import { validateSimulationClockProfile,simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { NativeLifecycleWatermarkStore,type LifecycleWatermarkStage,lifecycleWatermarkStages } from './native-watermarks.js';
import { lifecyclePolicyPaths,lifecycleSourcePaths,validateLifecycleManifest,validateLifecycleFiles,type LifecycleRouteManifest,type LifecycleFilePin } from './native-policy-manifest.js';
import {validateAdministrativeValueCursor,type AdministrativeValueCursor} from '../society-integrity/coverage.js';
import {validateExternalValueCursor,type ExternalValueCursor} from '../external-trade/value-coverage.js';

export interface LifecyclePolicySnapshot {
    clock:SimulationClockState;
    effective:{agePolicyDigest:string;mortalityPolicyDigest:string;bindingsDigest:string;survivalDigest:string|null;modsDigest:string};
    sources:LifecycleFilePin[];files:LifecycleFilePin[];
}
export interface LifecyclePolicySelection {schemaVersion:1;watermarkSelectionDigest:string;manifest:LifecycleRouteManifest;opening:LifecyclePolicySnapshot}
export interface LifecyclePolicySample {
    sessionId:string;worldId:string;position:SimulationClockObservation;wallTime:string;stage:LifecycleWatermarkStage;
    mortalityHead:{sequence:number;digest:string|null};watermarkHead:{sequence:number;digest:string|null};
    bootManifest:LifecycleRouteManifest|null;snapshot:LifecyclePolicySnapshot|null;
    mutationCursor?:{selectionDigest:string;head:{sequence:number;digest:string|null};faultCount:number;runtimeHead?:{sequence:number;digest:string|null}}|null;
    administrativeValueCursor?:AdministrativeValueCursor|null;
    externalValueCursor?:ExternalValueCursor|null;
}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function validateLifecyclePolicySnapshot(s:LifecyclePolicySnapshot){const c=s?.clock;
    check(c&&c.schemaVersion===1&&typeof c.clockId==='string'&&hex(c.profileDigest)&&['running','paused'].includes(c.status)
        &&Number.isSafeInteger(c.revision)&&c.revision>=0&&simulationClockProfileDigest(validateSimulationClockProfile(c.profile))===c.profileDigest
        &&[c.anchorWallTime,c.anchorSimulationTime,c.lastObservedWallTime,c.lastSimulationTime].every(stamp)
        &&c.lastObservedWallTime>=c.anchorWallTime&&c.lastSimulationTime>=c.anchorSimulationTime,'Invalid lifecycle policy clock');
    const p=s.effective;check(p&&hex(p.agePolicyDigest)&&hex(p.mortalityPolicyDigest)&&hex(p.bindingsDigest)&&hex(p.modsDigest)
        &&(p.survivalDigest===null||hex(p.survivalDigest)),'Invalid effective lifecycle policy');
    validateLifecycleFiles(s.sources,lifecycleSourcePaths,false);validateLifecycleFiles(s.files,lifecyclePolicyPaths);
}
function validate(e:LifecyclePolicySample){const c=e?.position;
    check(c&&c.status==='running'&&typeof c.clockId==='string'&&hex(c.profileDigest)&&stamp(c.wallTime)&&stamp(c.simulationTime)
        &&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0&&Number.isSafeInteger(c.revision)&&c.revision>=0
        &&stamp(e.wallTime)&&e.wallTime>=c.wallTime&&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128
        &&typeof e.worldId==='string'&&e.worldId.length>0&&e.worldId.length<=256&&lifecycleWatermarkStages.includes(e.stage),'Invalid lifecycle policy position');
    for(const h of [e.mortalityHead,e.watermarkHead])check(h&&Number.isSafeInteger(h.sequence)&&h.sequence>=0&&(h.sequence===0?h.digest===null:hex(h.digest)),'Invalid lifecycle policy source head');
    const cursor=e.mutationCursor;if(cursor)check(hex(cursor.selectionDigest)&&Number.isSafeInteger(cursor.faultCount)&&cursor.faultCount>=0
        &&Number.isSafeInteger(cursor.head?.sequence)&&cursor.head.sequence>=0&&(cursor.head.sequence===0?cursor.head.digest===null:hex(cursor.head.digest)),'Invalid policy mutation cursor');
    if(cursor?.runtimeHead)check(Number.isSafeInteger(cursor.runtimeHead.sequence)&&cursor.runtimeHead.sequence>=0
        &&(cursor.runtimeHead.sequence===0?cursor.runtimeHead.digest===null:hex(cursor.runtimeHead.digest)),'Invalid policy runtime cursor');
    if(e.administrativeValueCursor)validateAdministrativeValueCursor(e.administrativeValueCursor);
    if(e.externalValueCursor)validateExternalValueCursor(e.externalValueCursor);
    if(e.bootManifest)validateLifecycleManifest(e.bootManifest);if(e.snapshot)validateLifecyclePolicySnapshot(e.snapshot);
}
/** Explicit component-owned schema1. Clock/mod setters and shared schemas are untouched. */
export class NativeLifecyclePolicyStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_lifecycle_policy_selection'").get();}
    constructor(readonly db:Database,pin?:{manifest:LifecycleRouteManifest;opening:LifecyclePolicySnapshot}){
        if(!NativeLifecyclePolicyStore.present(db)){
            check(pin,'Lifecycle policy requires explicit pin');validateLifecycleManifest(pin.manifest);validateLifecyclePolicySnapshot(pin.opening);
            const w=new NativeLifecycleWatermarkStore(db).selection();
            check(pin.opening.clock.clockId===w.mortality.clockId&&pin.opening.clock.profileDigest===w.mortality.clockProfileDigest
                &&hash(pin.manifest.sources)===hash(pin.opening.sources)&&pin.opening.effective.agePolicyDigest===w.mortality.agePolicyDigest
                &&pin.opening.effective.mortalityPolicyDigest===w.mortality.mortalityPolicyDigest&&pin.opening.effective.survivalDigest===w.mortality.survivalSelectionDigest,'Lifecycle opening policy differs');
            const selection:LifecyclePolicySelection={schemaVersion:1,watermarkSelectionDigest:hash(w.selection),...pin};
            db.transaction(()=>{
                check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_lifecycle_policy_schema','native_lifecycle_policy_event','native_lifecycle_policy_head','native_lifecycle_policy_fault')").get(),'Incomplete lifecycle policy schema');
                db.exec(`CREATE TABLE native_lifecycle_policy_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO native_lifecycle_policy_schema VALUES(1);
                    CREATE TABLE native_lifecycle_policy_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE native_lifecycle_policy_event(sequence INTEGER PRIMARY KEY,session_id TEXT NOT NULL,engine_tick INTEGER NOT NULL,stage TEXT NOT NULL,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL,UNIQUE(session_id,engine_tick,stage));
                    CREATE TABLE native_lifecycle_policy_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);INSERT INTO native_lifecycle_policy_head VALUES(1,0,NULL);
                    CREATE TABLE native_lifecycle_policy_fault(singleton INTEGER PRIMARY KEY CHECK(singleton=1),count INTEGER NOT NULL);INSERT INTO native_lifecycle_policy_fault VALUES(1,0);
                    CREATE TRIGGER lifecycle_policy_event_no_update BEFORE UPDATE ON native_lifecycle_policy_event BEGIN SELECT RAISE(ABORT,'Lifecycle policy history is immutable');END;
                    CREATE TRIGGER lifecycle_policy_event_no_delete BEFORE DELETE ON native_lifecycle_policy_event BEGIN SELECT RAISE(ABORT,'Lifecycle policy history is immutable');END;
                    CREATE TRIGGER lifecycle_policy_selection_no_update BEFORE UPDATE ON native_lifecycle_policy_selection BEGIN SELECT RAISE(ABORT,'Lifecycle policy selection is immutable');END;
                    CREATE TRIGGER lifecycle_policy_selection_no_delete BEFORE DELETE ON native_lifecycle_policy_selection BEGIN SELECT RAISE(ABORT,'Lifecycle policy selection is immutable');END;
                    CREATE TRIGGER lifecycle_policy_fault_no_reset BEFORE UPDATE ON native_lifecycle_policy_fault WHEN NEW.count<=OLD.count BEGIN SELECT RAISE(ABORT,'Lifecycle policy faults cannot reset');END;
                    CREATE TRIGGER lifecycle_policy_fault_no_delete BEFORE DELETE ON native_lifecycle_policy_fault BEGIN SELECT RAISE(ABORT,'Lifecycle policy faults cannot reset');END;`);
                db.run('INSERT INTO native_lifecycle_policy_selection VALUES(1,?,?)',[JSON.stringify(selection),hash(selection)]);
            }).immediate();
        }
        check((db.query('SELECT version FROM native_lifecycle_policy_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported lifecycle policy schema');
        if(pin){const s=this.selection().selection;check(hash(pin)===hash({manifest:s.manifest,opening:s.opening}),'Lifecycle policy pin differs');}
    }
    selection(){const row=this.db.query('SELECT payload,digest FROM native_lifecycle_policy_selection WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(row,'Lifecycle policy selection absent');const selection=JSON.parse(row.payload) as LifecyclePolicySelection,w=new NativeLifecycleWatermarkStore(this.db).selection();
        validateLifecycleManifest(selection.manifest);validateLifecyclePolicySnapshot(selection.opening);
        check(selection.schemaVersion===1&&hash(selection)===row.digest&&selection.watermarkSelectionDigest===hash(w.selection)
            &&selection.opening.clock.clockId===w.mortality.clockId&&selection.opening.clock.profileDigest===w.mortality.clockProfileDigest
            &&hash(selection.manifest.sources)===hash(selection.opening.sources)&&selection.opening.effective.agePolicyDigest===w.mortality.agePolicyDigest
            &&selection.opening.effective.mortalityPolicyDigest===w.mortality.mortalityPolicyDigest&&selection.opening.effective.survivalDigest===w.mortality.survivalSelectionDigest,'Lifecycle policy selection differs');return{selection,mortality:w.mortality};}
    append(sample:LifecyclePolicySample){validate(sample);this.selection();this.db.transaction(()=>{
        const head=this.db.query('SELECT sequence,digest FROM native_lifecycle_policy_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
            tail=this.db.query('SELECT sequence,digest FROM native_lifecycle_policy_event ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;digest:string}|null;
        check(head&&head.sequence===(tail?.sequence??0)&&head.digest===(tail?.digest??null),'Lifecycle policy tail differs');
        const sequence=head.sequence+1,payload=JSON.stringify(sample),digest=hash({sequence,payload,previousDigest:head.digest});
        this.db.run('INSERT INTO native_lifecycle_policy_event VALUES(?,?,?,?,?,?,?)',[sequence,sample.sessionId,sample.position.engineTick,sample.stage,payload,head.digest,digest]);
        this.db.run('UPDATE native_lifecycle_policy_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
    }).immediate();}
    fault(){this.db.run('UPDATE native_lifecycle_policy_fault SET count=count+1 WHERE singleton=1');}
    read(){const {selection,mortality}=this.selection();check((this.db.query('SELECT count(*) n FROM native_lifecycle_policy_event').get() as {n:number}).n<=100000,'Lifecycle policy row budget exceeded');
        let previous:string|null=null;const entries=(this.db.query('SELECT * FROM native_lifecycle_policy_event ORDER BY sequence').all() as any[]).map((r,i)=>{
            const sample=JSON.parse(r.payload) as LifecyclePolicySample;validate(sample);
            check(r.sequence===i+1&&r.session_id===sample.sessionId&&r.engine_tick===sample.position.engineTick&&r.stage===sample.stage&&r.previous_digest===previous
                &&r.digest===hash({sequence:r.sequence,payload:r.payload,previousDigest:previous}),'Lifecycle policy chain differs');previous=r.digest;return{sequence:r.sequence as number,sample,digest:r.digest as string};});
        const head=this.db.query('SELECT sequence,digest FROM native_lifecycle_policy_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
            faults=this.db.query('SELECT count FROM native_lifecycle_policy_fault WHERE singleton=1').get() as {count:number}|null;
        check(head&&head.sequence===entries.length&&head.digest===previous&&faults&&Number.isSafeInteger(faults.count)&&faults.count>=0,'Lifecycle policy head/fault differs');
        return{selection,mortality,head,faults:faults.count,entries};
    }
}
