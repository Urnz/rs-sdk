import type { Database } from 'bun:sqlite';
import { nativeToolDigest as digest,type NativeToolOwner } from './native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { NativeMiningRequestStore } from './native-mining-requests.js';
import type { NativeHousingSleepObservation } from '../housing/native-sleep.js';

export interface MiningSourceHead {sequence:number;digest:string|null}
/** Installed explicitly before a baseline. This selects observation, never grants gameplay authority. */
export interface NativeMiningCoverageSelection {
    schemaVersion:1;selectionId:string;worldId:string;clockId:string;clockProfileDigest:string;
    fromSimulationTime:string;toSimulationTime:string;maximumSimulationGapMs:number;maximumWallGapMs:number;
    actors:NativeToolOwner[];openingHeads:{attempt:MiningSourceHead;intent:MiningSourceHead;executor?:MiningSourceHead};executorSelectionDigest?:string;
}
export interface NativeMiningCoverageSample {
    kind:'sample';clock:SimulationClockObservation;sessionId:string;rosterDigest:string|null;
    heads:{attempt:MiningSourceHead;intent:MiningSourceHead;executor?:MiningSourceHead};
    actors:Array<{actorId:string;status:'observed'|'observed-sleeping'|'offline'|'restricted'|'identity-unavailable'|'source-unavailable';demandId:string|null;sleep?:NativeHousingSleepObservation}>;
    ingressWriteFailed:boolean;
    executorSourceAvailable?:boolean;
}
export interface NativeMiningCoverageIngress {
    kind:'ingress';clock:SimulationClockObservation;sessionId:string;username:string;nativeActionId:string;
    heads:{attempt:MiningSourceHead;intent:MiningSourceHead;executor?:MiningSourceHead};
    dispatchId?:string;
    demandId:string|null;reason:'source-bound-request'|'compatible-request'|'no-standing-request'|'identity-unavailable'|'admission-unavailable'|'unsupported-native-path'|'pre-admission-action';
}
export type NativeMiningCoverageEvent=NativeMiningCoverageSample|NativeMiningCoverageIngress;
const check=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
function validHead(h:MiningSourceHead){check(h&&Number.isSafeInteger(h.sequence)&&h.sequence>=0
    &&(h.sequence===0?h.digest===null:hex(h.digest)),'Invalid Mining coverage source head');}
export function miningRosterDigest(actors:NativeToolOwner[]){
    return digest([...actors].sort((a,b)=>a.actorId.localeCompare(b.actorId)).map(a=>({actorId:a.actorId,username:a.username,lifecycleId:a.lifecycleId,
        worldId:a.worldId,clockId:a.clockId,clockProfileDigest:a.clockProfileDigest})));
}
export function validateMiningCoverageSelection(s:NativeMiningCoverageSelection){
    check(s?.schemaVersion===1&&uuid(s.selectionId)&&typeof s.worldId==='string'&&s.worldId.length>0&&s.worldId.length<=256
        &&typeof s.clockId==='string'&&s.clockId.length>0&&hex(s.clockProfileDigest),'Invalid Mining coverage selection');
    check(stamp(s.fromSimulationTime)&&stamp(s.toSimulationTime)&&Date.parse(s.toSimulationTime)>Date.parse(s.fromSimulationTime)
        &&Number.isSafeInteger(s.maximumSimulationGapMs)&&s.maximumSimulationGapMs>0
        &&Number.isSafeInteger(s.maximumWallGapMs)&&s.maximumWallGapMs>0&&s.maximumWallGapMs<=5000,'Invalid Mining coverage window');
    check(Array.isArray(s.actors)&&s.actors.length>0&&s.actors.length<=1000
        &&new Set(s.actors.map(a=>a.actorId)).size===s.actors.length&&new Set(s.actors.map(a=>a.username)).size===s.actors.length,'Invalid Mining coverage roster');
    for(const a of s.actors)check(Object.keys(a).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'
        &&typeof a.actorId==='string'&&a.actorId.length>0&&a.actorId.length<=256&&/^[a-z0-9]{1,12}$/.test(a.username)
        &&typeof a.lifecycleId==='string'&&a.lifecycleId.length>0&&a.lifecycleId.length<=256
        &&a.worldId===s.worldId&&a.clockId===s.clockId&&a.clockProfileDigest===s.clockProfileDigest,'Mining coverage owner differs');
    validHead(s.openingHeads.attempt);validHead(s.openingHeads.intent);
    if(s.executorSelectionDigest!==undefined){check(hex(s.executorSelectionDigest),'Invalid executor selection digest');validHead(s.openingHeads.executor!);}
}
function validate(s:NativeMiningCoverageSelection,e:NativeMiningCoverageEvent){
    const c=e?.clock;
    check(c&&c.status==='running'&&c.clockId===s.clockId&&c.profileDigest===s.clockProfileDigest
        &&stamp(c.wallTime)&&stamp(c.simulationTime)&&Number.isSafeInteger(c.revision)&&c.revision>=0
        &&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0
        &&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128,'Invalid Mining coverage clock/session');
    if(s.executorSelectionDigest!==undefined||e.heads?.executor!==undefined)validHead(e.heads.executor!);
    if(e.kind==='sample'){
        if(s.executorSelectionDigest!==undefined)check(typeof e.executorSourceAvailable==='boolean','Missing executor producer witness');
        validHead(e.heads.attempt);validHead(e.heads.intent);
        check((e.rosterDigest===null||hex(e.rosterDigest))&&typeof e.ingressWriteFailed==='boolean'
            &&Array.isArray(e.actors)&&e.actors.length===s.actors.length&&new Set(e.actors.map(a=>a.actorId)).size===s.actors.length,'Invalid Mining coverage sample');
        for(const a of e.actors)check(s.actors.some(o=>o.actorId===a.actorId)
            &&['observed','observed-sleeping','offline','restricted','identity-unavailable','source-unavailable'].includes(a.status)
            &&(a.demandId===null||uuid(a.demandId)),'Invalid Mining coverage actor sample');
        for(const a of e.actors){if(a.status!=='observed-sleeping'){check(a.sleep===undefined,'Unexpected sleep observer proof');continue;}
            const p=a.sleep,owner=s.actors.find(o=>o.actorId===a.actorId)!;
            check(p?.kind==='native-housing-sleep-v1'&&uuid(p.witnessId)&&hex(p.witnessDigest)&&hex(p.bindingDigest)&&p.username===owner.username&&p.lifecycleId===owner.lifecycleId
                &&p.observedAtSimulationTime===c.simulationTime&&stamp(p.validUntilSimulationTime)&&Date.parse(p.validUntilSimulationTime)>Date.parse(c.simulationTime),'Invalid sleep observer proof');}
    }else{
        validHead(e.heads.attempt);validHead(e.heads.intent);
        check(e.kind==='ingress'&&s.actors.some(a=>a.username===e.username)&&uuid(e.nativeActionId)
            &&(e.demandId===null||uuid(e.demandId))
            &&['source-bound-request','compatible-request','no-standing-request','identity-unavailable','admission-unavailable','unsupported-native-path','pre-admission-action'].includes(e.reason)
            &&(e.reason!=='compatible-request'&&e.reason!=='source-bound-request'||e.demandId!==null)
            &&(e.dispatchId===undefined||uuid(e.dispatchId))&&(e.reason!=='source-bound-request'||e.dispatchId===e.nativeActionId),'Invalid Mining coverage ingress');
    }
}
export interface NativeMiningCoverageEntry {sequence:number;event:NativeMiningCoverageEvent;digest:string}
/** Constant-time hot-path prefix heads; export validates the complete underlying chains. */
export function miningCoverageSourceHeads(db:Database){
    const read=(kind:'attempt'|'intent')=>{
        const base=kind==='attempt'?'native_mining_demand':'native_mining_intent',table=kind==='attempt'?`${base}_event`:`${base}_audit`;
        const versions=db.query<{version:number},[]>(`SELECT version FROM ${base}_schema`).all();
        check(versions.length===1&&versions[0]!.version===1,'Mining coverage source schema differs');
        const rows=db.query<MiningSourceHead,[]>(`SELECT sequence,digest FROM ${base}_head`).all();
        check(rows.length===1,'Mining coverage source head missing');const current=rows[0]!;validHead(current);
        const tail=db.query<MiningSourceHead,[]>(`SELECT sequence,digest FROM ${table} ORDER BY sequence DESC LIMIT 1`).get();
        check(current.sequence===(tail?.sequence??0)&&current.digest===(tail?.digest??null),'Mining coverage source tail differs');return current;
    };
    return{attempt:read('attempt'),intent:read('intent'),...(NativeMiningRequestStore.present(db)?{executor:new NativeMiningRequestStore(db).head()}:{})};
}
function head(db:Database):MiningSourceHead{
    const rows=db.query<MiningSourceHead,[]>('SELECT sequence,digest FROM native_mining_coverage_head').all();
    check(rows.length===1,'Missing Mining coverage head');validHead(rows[0]!);return rows[0]!;
}
/** Own additive schema, immutable selection and audit. No retrospective backfill or item effects. */
export class NativeMiningCoverageStore {
    constructor(readonly db:Database,selection?:NativeMiningCoverageSelection){
        if(selection){validateMiningCoverageSelection(selection);db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_mining_coverage_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS native_mining_coverage_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                CREATE TABLE IF NOT EXISTS native_mining_coverage_event(sequence INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS native_mining_coverage_selection_no_update BEFORE UPDATE ON native_mining_coverage_selection BEGIN SELECT RAISE(ABORT,'Mining coverage selection is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_coverage_selection_no_delete BEFORE DELETE ON native_mining_coverage_selection BEGIN SELECT RAISE(ABORT,'Mining coverage selection is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_coverage_no_update BEFORE UPDATE ON native_mining_coverage_event BEGIN SELECT RAISE(ABORT,'Mining coverage history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_coverage_no_delete BEFORE DELETE ON native_mining_coverage_event BEGIN SELECT RAISE(ABORT,'Mining coverage history is immutable'); END;`);
            if(!db.query('SELECT 1 FROM native_mining_coverage_selection').get()){
                check(!db.query('SELECT 1 FROM native_mining_coverage_event').get()&&!db.query('SELECT 1 FROM native_mining_coverage_head').get(),'Unversioned Mining coverage data');
                check(digest(miningCoverageSourceHeads(db))===digest(selection.openingHeads),'Mining coverage opening heads differ');
                db.run('INSERT INTO native_mining_coverage_selection VALUES(1,?,?)',[JSON.stringify(selection),digest(selection)]);
                db.run('INSERT INTO native_mining_coverage_head VALUES(1,0,NULL)');
            }
            check(digest(this.selection())===digest(selection),'Mining coverage selection conflict');head(db);
        }).immediate();}else{this.selection();head(db);}
    }
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_mining_coverage_selection'").get();}
    selection():NativeMiningCoverageSelection{
        const rows=this.db.query<{payload:string;digest:string},[]>('SELECT payload,digest FROM native_mining_coverage_selection').all();
        check(rows.length===1,'Missing Mining coverage selection');const s=JSON.parse(rows[0]!.payload) as NativeMiningCoverageSelection;
        validateMiningCoverageSelection(s);check(digest(s)===rows[0]!.digest,'Mining coverage selection digest differs');return s;
    }
    append(event:NativeMiningCoverageEvent){
        validate(this.selection(),event);
        this.db.transaction(()=>{
            const payload=JSON.stringify(event),eventKey=digest({kind:event.kind,sessionId:event.sessionId,tick:event.clock.engineTick,
                action:event.kind==='ingress'?event.nativeActionId:null});
            const prior=this.db.query<{payload:string},[string]>('SELECT payload FROM native_mining_coverage_event WHERE event_key=?').get(eventKey);
            if(prior){check(prior.payload===payload,'Mining coverage observation conflict');return;}
            const previous=head(this.db),tail=this.db.query<MiningSourceHead,[]>('SELECT sequence,digest FROM native_mining_coverage_event ORDER BY sequence DESC LIMIT 1').get();
            check(previous.sequence===(tail?.sequence??0)&&previous.digest===(tail?.digest??null),'Mining coverage tail differs');
            const sequence=previous.sequence+1,hash=digest({sequence,eventKey,payload,previousDigest:previous.digest});
            this.db.run('INSERT INTO native_mining_coverage_event VALUES(?,?,?,?,?)',[sequence,eventKey,payload,previous.digest,hash]);
            this.db.run('UPDATE native_mining_coverage_head SET sequence=?,digest=? WHERE singleton=1',[sequence,hash]);
        }).immediate();
    }
    read(){
        const selection=this.selection();
        check((this.db.query('SELECT COUNT(*) n FROM native_mining_coverage_event').get() as {n:number}).n<=100000,'Mining coverage source exceeds row limit');
        const entries:NativeMiningCoverageEntry[]=[];let previousDigest:string|null=null,sequence=0;
        for(const row of this.db.query<{sequence:number;event_key:string;payload:string;previous_digest:string|null;digest:string},[]>('SELECT * FROM native_mining_coverage_event ORDER BY sequence').all()){
            check(row.sequence===++sequence&&row.previous_digest===previousDigest&&digest({sequence,eventKey:row.event_key,payload:row.payload,previousDigest})===row.digest,'Mining coverage audit differs');
            const event=JSON.parse(row.payload) as NativeMiningCoverageEvent;validate(selection,event);
            check(row.event_key===digest({kind:event.kind,sessionId:event.sessionId,tick:event.clock.engineTick,action:event.kind==='ingress'?event.nativeActionId:null}),'Mining coverage event identity differs');
            entries.push({sequence,event,digest:row.digest});previousDigest=row.digest;
        }
        const current=head(this.db);check(current.sequence===sequence&&current.digest===previousDigest,'Mining coverage audit tail differs');
        return{selection,entries,head:current};
    }
}
