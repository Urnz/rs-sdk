import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { policyMutationProducers,validatePolicyEnvironment,type PolicyEnvironmentPin,type PolicyMutationProducer } from './policy-environment.js';

export interface PolicyMutationSelection {schemaVersion:1;worldId:string;clockId:string;clockProfileDigest:string;fromSimulationTime:string;toSimulationTime:string;
    maximumWallGapMs:number;policySelectionDigest:string;environment:PolicyEnvironmentPin}
export interface PolicyMutationEvent {attemptId:string;sessionId:string;producer:PolicyMutationProducer;phase:'begin'|'result';wallTime:string;
    worldId:string;clock:SimulationClockObservation|null;beforeDigest:string|null;afterDigest:string|null;outcome:'applied'|'no-op'|'failed'|null}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function selection(s:PolicyMutationSelection){check(s?.schemaVersion===1&&typeof s.worldId==='string'&&s.worldId.length>0&&s.worldId.length<=256
    &&typeof s.clockId==='string'&&s.clockId.length>0&&hex(s.clockProfileDigest)&&stamp(s.fromSimulationTime)&&stamp(s.toSimulationTime)&&s.fromSimulationTime<s.toSimulationTime
    &&Number.isSafeInteger(s.maximumWallGapMs)&&s.maximumWallGapMs>0&&s.maximumWallGapMs<=5000&&hex(s.policySelectionDigest),'Invalid policy mutation selection');validatePolicyEnvironment(s.environment);}
function validate(e:PolicyMutationEvent){check(e&&/^[a-f0-9-]{36}$/.test(e.attemptId)&&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128
    &&policyMutationProducers.some(p=>p.id===e.producer)&&['begin','result'].includes(e.phase)&&stamp(e.wallTime)&&typeof e.worldId==='string'&&e.worldId.length>0&&e.worldId.length<=256
    &&(e.beforeDigest===null||hex(e.beforeDigest))&&(e.afterDigest===null||hex(e.afterDigest)),'Invalid policy mutation event');
    if(e.phase==='begin')check(e.outcome===null&&e.afterDigest===null,'Invalid policy mutation begin');else check(['applied','no-op','failed'].includes(String(e.outcome)),'Invalid policy mutation outcome');
    const c=e.clock;if(c)check(typeof c.clockId==='string'&&hex(c.profileDigest)&&['running','paused'].includes(c.status)&&stamp(c.wallTime)&&stamp(c.simulationTime)
        &&Number.isSafeInteger(c.revision)&&c.revision>=0&&(c.engineTick===null||Number.isSafeInteger(c.engineTick)&&c.engineTick>=0),'Invalid policy mutation clock');
}
/** Independent, explicitly pinned store shared by the gateway and engine; never changes the checkpoint/clock schema. */
export class PolicyMutationStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='policy_mutation_selection'").get();}
    constructor(readonly db:Database,pin?:PolicyMutationSelection){
        if(!PolicyMutationStore.present(db)){check(pin,'Policy mutations require explicit pin');selection(pin);
            db.transaction(()=>{check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('policy_mutation_schema','policy_mutation_event','policy_mutation_head','policy_mutation_fault')").get(),'Incomplete policy mutation schema');
                db.exec(`CREATE TABLE policy_mutation_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO policy_mutation_schema VALUES(1);
                    CREATE TABLE policy_mutation_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE policy_mutation_event(sequence INTEGER PRIMARY KEY,attempt_id TEXT NOT NULL,phase TEXT NOT NULL,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL,UNIQUE(attempt_id,phase));
                    CREATE TABLE policy_mutation_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);INSERT INTO policy_mutation_head VALUES(1,0,NULL);
                    CREATE TABLE policy_mutation_fault(singleton INTEGER PRIMARY KEY CHECK(singleton=1),count INTEGER NOT NULL);INSERT INTO policy_mutation_fault VALUES(1,0);
                    CREATE TRIGGER policy_mutation_selection_no_update BEFORE UPDATE ON policy_mutation_selection BEGIN SELECT RAISE(ABORT,'Policy mutation selection is immutable');END;
                    CREATE TRIGGER policy_mutation_selection_no_delete BEFORE DELETE ON policy_mutation_selection BEGIN SELECT RAISE(ABORT,'Policy mutation selection is immutable');END;
                    CREATE TRIGGER policy_mutation_event_no_update BEFORE UPDATE ON policy_mutation_event BEGIN SELECT RAISE(ABORT,'Policy mutation history is immutable');END;
                    CREATE TRIGGER policy_mutation_event_no_delete BEFORE DELETE ON policy_mutation_event BEGIN SELECT RAISE(ABORT,'Policy mutation history is immutable');END;
                    CREATE TRIGGER policy_mutation_fault_no_reset BEFORE UPDATE ON policy_mutation_fault WHEN NEW.count<=OLD.count BEGIN SELECT RAISE(ABORT,'Policy mutation faults cannot reset');END;
                    CREATE TRIGGER policy_mutation_fault_no_delete BEFORE DELETE ON policy_mutation_fault BEGIN SELECT RAISE(ABORT,'Policy mutation faults cannot reset');END;`);
                db.run('INSERT INTO policy_mutation_selection VALUES(1,?,?)',[JSON.stringify(pin),hash(pin)]);
            }).immediate();}
        check((db.query('SELECT version FROM policy_mutation_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported policy mutation schema');
        if(pin)check(hash(pin)===hash(this.selection()),'Policy mutation pin differs');
    }
    selection(){const row=this.db.query('SELECT payload,digest FROM policy_mutation_selection WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(row,'Policy mutation selection absent');const s=JSON.parse(row.payload) as PolicyMutationSelection;selection(s);check(hash(s)===row.digest,'Policy mutation selection corrupt');return s;}
    cursor(){const head=this.db.query('SELECT sequence,digest FROM policy_mutation_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
        tail=this.db.query('SELECT sequence,digest FROM policy_mutation_event ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;digest:string}|null,
        fault=this.db.query('SELECT count FROM policy_mutation_fault WHERE singleton=1').get() as {count:number}|null;
        check(head&&head.sequence===(tail?.sequence??0)&&head.digest===(tail?.digest??null)&&fault&&Number.isSafeInteger(fault.count)&&fault.count>=0,'Policy mutation cursor differs');
        return{selectionDigest:hash(this.selection()),head,faultCount:fault.count};}
    append(event:PolicyMutationEvent){validate(event);this.selection();this.db.transaction(()=>{
        if(event.phase==='result'){const row=this.db.query("SELECT payload FROM policy_mutation_event WHERE attempt_id=? AND phase='begin'").get(event.attemptId) as {payload:string}|null;
            check(row,'Policy mutation result lacks begin');const begin=JSON.parse(row.payload) as PolicyMutationEvent;
            check(begin.producer===event.producer&&begin.worldId===event.worldId&&begin.sessionId===event.sessionId&&begin.beforeDigest===event.beforeDigest&&begin.wallTime<=event.wallTime,'Policy mutation pair differs');}
        const {head}=this.cursor(),sequence=head.sequence+1,payload=JSON.stringify(event),digest=hash({sequence,payload,previousDigest:head.digest});
        this.db.run('INSERT INTO policy_mutation_event VALUES(?,?,?,?,?,?)',[sequence,event.attemptId,event.phase,payload,head.digest,digest]);this.db.run('UPDATE policy_mutation_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
    }).immediate();}
    fault(){this.db.run('UPDATE policy_mutation_fault SET count=count+1 WHERE singleton=1');}
    read(){const selection=this.selection();check((this.db.query('SELECT count(*) n FROM policy_mutation_event').get() as {n:number}).n<=100000,'Policy mutation row budget exceeded');
        let previous:string|null=null;const attempts=new Map<string,{begin:PolicyMutationEvent;result:PolicyMutationEvent|null}>();
        const entries=(this.db.query('SELECT * FROM policy_mutation_event ORDER BY sequence').all() as any[]).map((r,i)=>{const event=JSON.parse(r.payload) as PolicyMutationEvent;validate(event);
            check(r.sequence===i+1&&r.attempt_id===event.attemptId&&r.phase===event.phase&&r.previous_digest===previous&&r.digest===hash({sequence:r.sequence,payload:r.payload,previousDigest:previous}),'Policy mutation chain differs');
            if(event.phase==='begin'){check(!attempts.has(event.attemptId),'Duplicate policy mutation begin');attempts.set(event.attemptId,{begin:event,result:null});}
            else{const p=attempts.get(event.attemptId);check(p&&!p.result&&p.begin.producer===event.producer&&p.begin.worldId===event.worldId&&p.begin.sessionId===event.sessionId
                &&p.begin.beforeDigest===event.beforeDigest&&p.begin.wallTime<=event.wallTime,'Policy mutation pair differs');p.result=event;}
            previous=r.digest;return{sequence:r.sequence as number,event,digest:r.digest as string};});
        const cursor=this.cursor();check(cursor.head.sequence===entries.length&&cursor.head.digest===previous,'Policy mutation head differs');return{selection,entries,attempts,...cursor};
    }
}
