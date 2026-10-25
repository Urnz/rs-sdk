import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { nativeToolDigest as digest,type NativeToolOwner } from './native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export const nativeMiningDemandSessionId=randomUUID();
export interface NativeMiningIntent {
    demandId:string;owner:NativeToolOwner;outputItemId:436|438;contextDigest:string;authorityDigest:string;
    maximumWallMilliseconds:number;expiresAtWallTime:string;
    /** Absent on legacy records; no fresh-admission claim may be inferred for them. */
    attemptSequenceAtAdmission?:number;
}
export interface NativeMiningIntentRecord {
    schemaVersion:1;intent:NativeMiningIntent;revision:number;phase:'pending'|'fulfilled'|'cancelled'|'expired';
    sample:{clock:SimulationClockObservation;sessionId:string;availability:'usable'|'unusable'|'unknown';
        itemInstanceId:string|null;itemRevision:number|null;reason:string|null};
    completionEventId:string|null;
}
export interface NativeMiningIntentEntry {sequence:number;record:NativeMiningIntentRecord;digest:string}
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validate(r:NativeMiningIntentRecord){
    const i=r?.intent,s=r?.sample,c=s?.clock,o=i?.owner;
    check(r?.schemaVersion===1&&Number.isSafeInteger(r.revision)&&r.revision>=1&&['pending','fulfilled','cancelled','expired'].includes(r.phase),
        'Invalid native mining intent record');
    check(i&&/^[a-f0-9-]{36}$/.test(i.demandId)&&[436,438].includes(i.outputItemId)&&hex(i.contextDigest)&&hex(i.authorityDigest),
        'Invalid native mining intent identity');
    check(Number.isSafeInteger(i.maximumWallMilliseconds)&&i.maximumWallMilliseconds>=100&&i.maximumWallMilliseconds<=300000
        &&typeof i.expiresAtWallTime==='string'&&Number.isFinite(Date.parse(i.expiresAtWallTime)),'Invalid native mining intent lifetime');
    check(o&&Object.keys(o).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'
        &&Object.values(o).every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&hex(o.clockProfileDigest),'Invalid native mining intent owner');
    check(c&&c.clockId===o.clockId&&c.profileDigest===o.clockProfileDigest&&c.status==='running'
        &&typeof c.simulationTime==='string'&&Number.isFinite(Date.parse(c.simulationTime))&&typeof c.wallTime==='string'&&Number.isFinite(Date.parse(c.wallTime))
        &&c.engineTick!==null&&Number.isSafeInteger(c.engineTick)&&c.engineTick>=0&&Number.isSafeInteger(c.revision)&&c.revision>=0,
        'Invalid native mining intent clock');
    check(s&&typeof s.sessionId==='string'&&s.sessionId.length>0&&s.sessionId.length<=128
        &&['usable','unusable','unknown'].includes(s.availability)&&(s.reason===null||typeof s.reason==='string'&&s.reason.length<=128)
        &&(s.itemInstanceId===null? s.itemRevision===null : typeof s.itemInstanceId==='string'&&s.itemInstanceId.length>0&&s.itemInstanceId.length<=256
            &&Number.isSafeInteger(s.itemRevision)&&Number(s.itemRevision)>=1),'Invalid native mining intent sample');
    if(s.availability!=='unknown')check(s.itemInstanceId!==null,'Known tool availability needs a native instance');
    check(r.phase==='fulfilled'?typeof r.completionEventId==='string'&&r.completionEventId.length>0:r.completionEventId===null,
        'Invalid native mining intent completion');
}
function transition(prior:NativeMiningIntentRecord|undefined,next:NativeMiningIntentRecord){
    validate(next);
    check(next.revision===(prior?.revision??0)+1,'Native mining intent revision differs');
    if(!prior){check(next.phase==='pending'&&Date.parse(next.intent.expiresAtWallTime)-Date.parse(next.sample.clock.wallTime)===next.intent.maximumWallMilliseconds,
        'Native mining intent must begin pending with its exact lifetime');return;}
    check(prior.phase==='pending'&&digest(prior.intent)===digest(next.intent),'Native mining intent is immutable or terminal');
    check(Date.parse(next.sample.clock.simulationTime)>=Date.parse(prior.sample.clock.simulationTime)
        &&Date.parse(next.sample.clock.wallTime)>=Date.parse(prior.sample.clock.wallTime)
        &&next.sample.clock.revision>=prior.sample.clock.revision,'Native mining intent clock regressed');
    // A process restart may reset engineTick; readers treat a different session as an evidence gap.
    if(next.sample.sessionId===prior.sample.sessionId)check(next.sample.clock.engineTick!>=prior.sample.clock.engineTick!,'Native mining intent tick regressed');
}
function version(db:Database){
    const rows=db.query<{version:number},[]>('SELECT version FROM native_mining_intent_schema').all();
    check(rows.length===1&&rows[0]!.version===1,'Unsupported native mining intent schema');
}
type Head={sequence:number;digest:string|null};
function head(db:Database):Head{
    const rows=db.query<Head,[]>('SELECT sequence,digest FROM native_mining_intent_head').all();
    check(rows.length===1&&Number.isSafeInteger(rows[0]!.sequence)&&rows[0]!.sequence>=0,'Invalid native mining intent head');return rows[0]!;
}

/** Standing engine-owned request, distinct from a one-shot Mining script. No inventory or wear effects. */
export class NativeMiningIntentStore {
    constructor(readonly db:Database){
        db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_mining_intent_schema(version INTEGER PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS native_mining_intent_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                CREATE TABLE IF NOT EXISTS native_mining_intent_state(demand_id TEXT PRIMARY KEY,username TEXT NOT NULL,phase TEXT NOT NULL,
                    sequence INTEGER NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS native_mining_intent_actor ON native_mining_intent_state(username) WHERE phase='pending';
                CREATE TABLE IF NOT EXISTS native_mining_intent_audit(sequence INTEGER PRIMARY KEY,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS native_mining_intent_no_update BEFORE UPDATE ON native_mining_intent_audit
                BEGIN SELECT RAISE(ABORT,'Native mining intent history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_intent_no_delete BEFORE DELETE ON native_mining_intent_audit
                BEGIN SELECT RAISE(ABORT,'Native mining intent history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_intent_state_no_delete BEFORE DELETE ON native_mining_intent_state
                BEGIN SELECT RAISE(ABORT,'Native mining intent cannot be discarded'); END;`);
            if(!db.query('SELECT 1 FROM native_mining_intent_schema').get()){
                check(!db.query('SELECT 1 FROM native_mining_intent_state').get()&&!db.query('SELECT 1 FROM native_mining_intent_audit').get()
                    &&!db.query('SELECT 1 FROM native_mining_intent_head').get(),'Unversioned native mining intent data');
                db.run('INSERT INTO native_mining_intent_schema VALUES(1)');db.run('INSERT INTO native_mining_intent_head VALUES(1,0,NULL)');
            }
            version(db);head(db);
        }).immediate();
    }
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_mining_intent_schema'").get();}
    static read(db:Database){
        version(db);let previousDigest:string|null=null,sequence=0;const latest=new Map<string,NativeMiningIntentEntry>(),entries:NativeMiningIntentEntry[]=[];
        check((db.query('SELECT COUNT(*) n FROM native_mining_intent_audit').get() as {n:number}).n<=100000,'Native mining intent source exceeds row limit');
        for(const row of db.query<{sequence:number;payload:string;previous_digest:string|null;digest:string},[]>(
            'SELECT * FROM native_mining_intent_audit ORDER BY sequence').all()){
            check(row.sequence===++sequence&&row.previous_digest===previousDigest&&digest({sequence,payload:row.payload,previousDigest})===row.digest,
                'Native mining intent audit mismatch');
            const record=JSON.parse(row.payload) as NativeMiningIntentRecord;transition(latest.get(record.intent?.demandId)?.record,record);
            const entry={sequence,record,digest:row.digest};entries.push(entry);latest.set(record.intent.demandId,entry);previousDigest=row.digest;
        }
        const current=head(db);check(current.sequence===sequence&&current.digest===previousDigest,'Native mining intent tail mismatch');
        const states=db.query<{demand_id:string;username:string;phase:string;sequence:number;payload:string;digest:string},[]>('SELECT * FROM native_mining_intent_state').all();
        check(states.length===latest.size,'Native mining intent state missing');
        const pending=new Set<string>();
        for(const row of states){const last=latest.get(row.demand_id);check(last&&row.username===last.record.intent.owner.username&&row.phase===last.record.phase
            &&row.sequence===last.sequence&&row.payload===JSON.stringify(last.record)&&row.digest===digest(last.record),'Native mining intent projection differs');
            if(row.phase==='pending'){check(!pending.has(row.username),'Ambiguous standing native mining demand');pending.add(row.username);}}
        return{entries,head:current};
    }
    get(id:string):NativeMiningIntentRecord|null{
        const row=this.db.query<{sequence:number;payload:string;digest:string},[string]>(
            'SELECT sequence,payload,digest FROM native_mining_intent_state WHERE demand_id=?').get(id);if(!row)return null;
        const record=JSON.parse(row.payload) as NativeMiningIntentRecord;validate(record);
        const audit=this.db.query<{payload:string},[number]>('SELECT payload FROM native_mining_intent_audit WHERE sequence=?').get(row.sequence);
        check(record.intent.demandId===id&&digest(record)===row.digest&&audit?.payload===row.payload,'Native mining intent projection differs');return record;
    }
    pending():NativeMiningIntentRecord[]{
        return this.db.query<{demand_id:string},[]>('SELECT demand_id FROM native_mining_intent_state WHERE phase=\'pending\' ORDER BY demand_id').all()
            .map(row=>this.get(row.demand_id)!);
    }
    write(record:NativeMiningIntentRecord):NativeMiningIntentRecord{
        this.db.transaction(()=>{
            transition(this.get(record.intent.demandId)??undefined,record);const priorHead=head(this.db);
            const tail=this.db.query<Head,[]>('SELECT sequence,digest FROM native_mining_intent_audit ORDER BY sequence DESC LIMIT 1').get();
            check(priorHead.sequence===(tail?.sequence??0)&&priorHead.digest===(tail?.digest??null),'Native mining intent tail mismatch');
            const sequence=priorHead.sequence+1,payload=JSON.stringify(record),hash=digest({sequence,payload,previousDigest:priorHead.digest});
            this.db.query('INSERT INTO native_mining_intent_audit VALUES(?,?,?,?)').run(sequence,payload,priorHead.digest,hash);
            this.db.query(`INSERT INTO native_mining_intent_state VALUES(?,?,?,?,?,?) ON CONFLICT(demand_id) DO UPDATE SET
                phase=excluded.phase,sequence=excluded.sequence,payload=excluded.payload,digest=excluded.digest`)
                .run(record.intent.demandId,record.intent.owner.username,record.phase,sequence,payload,digest(record));
            this.db.query('UPDATE native_mining_intent_head SET sequence=?,digest=? WHERE singleton=1').run(sequence,hash);
        }).immediate();
        return record;
    }
}
