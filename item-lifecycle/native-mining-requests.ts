import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash,type NativeToolOwner } from './native-tool.js';
import { validateMiningDemandRequest,type MiningDemandRequest } from '../sdk/mining-demand.js';
export interface MiningExecutorSelection {schemaVersion:1;selectionId:string;worldId:string;clockId:string;clockProfileDigest:string;
    fromSimulationTime:string;toSimulationTime:string;actors:NativeToolOwner[]}
export interface MiningExecutorAdmission {schemaVersion:1;username:string;checksum:string;args:MiningDemandRequest['args'];context:MiningDemandRequest['context'];
    admittedAt:string;expiresAtWallTime:string;digest:string}
export interface MiningExecutorRequest {schemaVersion:1;demandId:string;owner:NativeToolOwner;admission:MiningExecutorAdmission;phase:'requested'|'closed'}
export interface MiningExecutorHead {sequence:number;digest:string|null}
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const key=(r:MiningDemandRequest)=>{const h=hash(['native-mining-demand',r.context.runId,r.context.stepId,r.context.operationSequence]);
    return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
function selection(s:MiningExecutorSelection){
    check(s?.schemaVersion===1&&typeof s.selectionId==='string'&&s.selectionId.length>0&&s.selectionId.length<=128&&typeof s.worldId==='string'
        &&typeof s.clockId==='string'&&hex(s.clockProfileDigest)&&time(s.fromSimulationTime)&&time(s.toSimulationTime)&&s.fromSimulationTime<s.toSimulationTime
        &&Array.isArray(s.actors)&&s.actors.length>0&&s.actors.length<=1000&&new Set(s.actors.map(a=>a.actorId)).size===s.actors.length
        &&new Set(s.actors.map(a=>a.username)).size===s.actors.length,'Invalid executor request selection');
    for(const a of s.actors)check(a.worldId===s.worldId&&a.clockId===s.clockId&&a.clockProfileDigest===s.clockProfileDigest
        &&Object.keys(a).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'&&Object.values(a).every(v=>typeof v==='string'&&v.length>0&&v.length<=256)
        &&/^[a-z0-9]{1,12}$/.test(a.username),'Invalid executor request owner');
}
function validate(s:MiningExecutorSelection,r:MiningExecutorRequest){
    const a=r?.admission;check(r?.schemaVersion===1&&['requested','closed'].includes(r.phase)&&a?.schemaVersion===1,'Invalid executor request');
    const request=validateMiningDemandRequest({operation:'open',args:a.args,context:a.context}),{digest,...body}=a;
    check(a.username===r.owner.username&&s.actors.some(o=>hash(o)===hash(r.owner))&&a.digest===hash(body)&&hex(a.checksum)
        &&time(a.admittedAt)&&time(a.expiresAtWallTime)&&Date.parse(a.expiresAtWallTime)-Date.parse(a.admittedAt)===a.args.timeoutMs&&r.demandId===key(request),'Executor request admission differs');
}
/** Explicit pre-baseline installation only. Component-owned additive tables; never changes shared user_version. */
export class NativeMiningRequestStore {
    constructor(readonly db:Database,install?:MiningExecutorSelection){
        if(install){selection(install);db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_mining_request_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS native_mining_request_event(sequence INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS native_mining_request_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                CREATE TRIGGER IF NOT EXISTS native_mining_request_selection_no_update BEFORE UPDATE ON native_mining_request_selection BEGIN SELECT RAISE(ABORT,'Executor request selection is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_request_selection_no_delete BEFORE DELETE ON native_mining_request_selection BEGIN SELECT RAISE(ABORT,'Executor request selection is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_request_no_update BEFORE UPDATE ON native_mining_request_event BEGIN SELECT RAISE(ABORT,'Executor requests are immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_request_no_delete BEFORE DELETE ON native_mining_request_event BEGIN SELECT RAISE(ABORT,'Executor requests are immutable'); END;`);
            if(!db.query('SELECT 1 FROM native_mining_request_selection').get()){
                check(!db.query('SELECT 1 FROM native_mining_request_event').get()&&!db.query('SELECT 1 FROM native_mining_request_head').get(),'Unselected executor request history');
                db.run('INSERT INTO native_mining_request_selection VALUES(1,?,?)',[JSON.stringify(install),hash(install)]);db.run('INSERT INTO native_mining_request_head VALUES(1,0,NULL)');
            }
            check(hash(this.selection())===hash(install),'Executor request selection conflict');this.read();
        }).immediate();}else{this.selection();this.head();}
    }
    static present(db:Database){return!!db.query("SELECT 1 FROM sqlite_master WHERE name='native_mining_request_selection'").get();}
    selection():MiningExecutorSelection{const rows=this.db.query('SELECT payload,digest FROM native_mining_request_selection').all() as {payload:string;digest:string}[];
        check(rows.length===1,'Missing executor selection');const s=JSON.parse(rows[0]!.payload);selection(s);check(hash(s)===rows[0]!.digest,'Executor selection differs');return s;}
    head():MiningExecutorHead{const rows=this.db.query('SELECT sequence,digest FROM native_mining_request_head').all() as MiningExecutorHead[];
        check(rows.length===1&&Number.isSafeInteger(rows[0]!.sequence)&&rows[0]!.sequence>=0&&(rows[0]!.sequence===0?rows[0]!.digest===null:hex(rows[0]!.digest)),'Executor request head differs');return rows[0]!;}
    current(demandId:string){const s=this.selection(),values=this.db.query('SELECT * FROM native_mining_request_event WHERE event_key IN (?,?) ORDER BY sequence')
        .all(`${demandId}:requested`,`${demandId}:closed`) as {sequence:number;event_key:string;payload:string;previous_digest:string|null;digest:string}[];
        for(const row of values){const r=JSON.parse(row.payload) as MiningExecutorRequest;validate(s,r);
            check(r.demandId===demandId&&row.event_key===`${demandId}:${r.phase}`&&row.digest===hash({sequence:row.sequence,eventKey:row.event_key,payload:row.payload,previousDigest:row.previous_digest}),'Executor request row differs');}
        if(!values.length)return null;const first=JSON.parse(values[0]!.payload) as MiningExecutorRequest;
        check(first.phase==='requested'&&(values.length===1||hash({...first,phase:'closed'})===hash(JSON.parse(values[1]!.payload))),'Executor request terminal differs');
        return JSON.parse(values.at(-1)!.payload) as MiningExecutorRequest;
    }
    append(r:MiningExecutorRequest){validate(this.selection(),r);this.db.transaction(()=>{
        const eventKey=`${r.demandId}:${r.phase}`,payload=JSON.stringify(r),prior=this.db.query('SELECT payload FROM native_mining_request_event WHERE event_key=?').get(eventKey) as {payload:string}|null;
        if(prior){check(prior.payload===payload,'Executor request identity conflict');return;}
        const open=this.db.query('SELECT payload FROM native_mining_request_event WHERE event_key=?').get(`${r.demandId}:requested`) as {payload:string}|null;
        if(r.phase==='closed')check(open&&hash({...JSON.parse(open.payload),phase:'closed'})===hash(r),'Executor close has no matching request');
        const h=this.head(),tail=this.db.query('SELECT sequence,digest FROM native_mining_request_event ORDER BY sequence DESC LIMIT 1').get() as MiningExecutorHead|null;
        check(h.sequence===(tail?.sequence??0)&&h.digest===(tail?.digest??null),'Executor request tail differs');
        const sequence=h.sequence+1,digest=hash({sequence,eventKey,payload,previousDigest:h.digest});
        this.db.run('INSERT INTO native_mining_request_event VALUES(?,?,?,?,?)',[sequence,eventKey,payload,h.digest,digest]);this.db.run('UPDATE native_mining_request_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
    }).immediate();}
    read(){const s=this.selection(),entries:Array<{sequence:number;record:MiningExecutorRequest;digest:string}>=[];
        check((this.db.query('SELECT COUNT(*) n FROM native_mining_request_event').get() as {n:number}).n<=100000,'Executor request limit exceeded');
        let previousDigest:string|null=null;const open=new Map<string,MiningExecutorRequest>(),closed=new Set<string>();
        for(const row of this.db.query('SELECT * FROM native_mining_request_event ORDER BY sequence').all() as {sequence:number;event_key:string;payload:string;previous_digest:string|null;digest:string}[]){
            const r=JSON.parse(row.payload) as MiningExecutorRequest;validate(s,r);
            check(row.sequence===entries.length+1&&row.event_key===`${r.demandId}:${r.phase}`&&row.previous_digest===previousDigest
                &&row.digest===hash({sequence:row.sequence,eventKey:row.event_key,payload:row.payload,previousDigest}),'Executor request chain differs');
            if(r.phase==='requested'){check(!open.has(r.demandId),'Duplicate executor request');open.set(r.demandId,r);}
            else{check(!closed.has(r.demandId)&&open.has(r.demandId)&&hash({...open.get(r.demandId),phase:'closed'})===hash(r),'Executor closure differs');closed.add(r.demandId);}
            entries.push({sequence:row.sequence,record:r,digest:row.digest});previousDigest=row.digest;
        }
        const head=this.head();check(head.sequence===entries.length&&head.digest===previousDigest,'Executor request prefix missing');return{selection:s,entries,head};
    }
}
