import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import type { AgentPopulationMember } from '../agent-state/types.js';
import { populationDeathMembershipDigest } from './death.js';

export interface MortalityActor {actorId:string;username:string;lifecycleId:string;membershipDigest:string}
export type MortalityHealthHeads=Record<'damage'|'death'|'binding',{sequence:number;digest:string}>;
export interface MortalityCoverageSelection {
    schemaVersion:1;selectionId:string;worldId:string;clockId:string;clockProfileDigest:string;
    fromSimulationTime:string;toSimulationTime:string;maximumSimulationGapMs:number;maximumWallGapMs:number;
    agePolicyDigest:string;mortalityPolicyDigest:string;survivalSelectionDigest:string|null;
    actors:MortalityActor[];openingHealthHeads:MortalityHealthHeads;
}
export interface MortalityCoverageSample {
    clock:SimulationClockObservation;sessionId:string;stage:'after-native-mortality';priorWriteFailed:boolean;
    rosterDigest:string;agePolicyDigest:string;mortalityPolicyDigest:string;survivalSelectionDigest:string|null;
    healthHeads:MortalityHealthHeads;
    actors:Array<MortalityActor&{state:'active'|'terminal'|'unavailable';deathEventId:string|null}>;
}
export function nativeMortalityActor(member:AgentPopulationMember):MortalityActor {
    return{actorId:member.agentId,username:member.playerUsername,membershipDigest:populationDeathMembershipDigest(member),
        lifecycleId:hash({agentId:member.agentId,createdAt:member.characterLifecycle.createdAt,origin:member.characterLifecycle.origin,
            createdAtSimulationTime:member.characterLifecycle.createdAtSimulationTime,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest,
            worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,simulationClock:member.simulationClock})};
}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const mortalityRosterDigest=(actors:MortalityActor[])=>hash([...actors].sort((a,b)=>a.actorId.localeCompare(b.actorId)).map(a=>
    ({actorId:a.actorId,username:a.username,lifecycleId:a.lifecycleId,membershipDigest:a.membershipDigest})));
function heads(h:MortalityHealthHeads){for(const domain of ['damage','death','binding'] as const){const v=h?.[domain];
    check(v&&Number.isSafeInteger(v.sequence)&&v.sequence>=0&&hex(v.digest),'Invalid mortality health head');}}
function actor(a:MortalityActor){check(a&&typeof a.actorId==='string'&&a.actorId.length>0&&a.actorId.length<=128
    &&/^[a-z0-9]{1,12}$/.test(a.username)&&hex(a.lifecycleId)&&hex(a.membershipDigest),'Invalid mortality actor');}
function validateSelection(s:MortalityCoverageSelection){
    check(s?.schemaVersion===1&&/^[a-f0-9-]{36}$/.test(s.selectionId)&&typeof s.worldId==='string'&&s.worldId.length>0&&s.worldId.length<=256
        &&typeof s.clockId==='string'&&s.clockId.length>0&&hex(s.clockProfileDigest)&&stamp(s.fromSimulationTime)&&stamp(s.toSimulationTime)
        &&s.toSimulationTime>s.fromSimulationTime&&Number.isSafeInteger(s.maximumSimulationGapMs)&&s.maximumSimulationGapMs>0
        &&Number.isSafeInteger(s.maximumWallGapMs)&&s.maximumWallGapMs>0&&s.maximumWallGapMs<=5000
        &&hex(s.agePolicyDigest)&&hex(s.mortalityPolicyDigest)&&(s.survivalSelectionDigest===null||hex(s.survivalSelectionDigest)),'Invalid mortality selection');
    check(Array.isArray(s.actors)&&s.actors.length>0&&s.actors.length<=1000&&new Set(s.actors.map(a=>a.actorId)).size===s.actors.length
        &&new Set(s.actors.map(a=>a.username)).size===s.actors.length,'Invalid mortality roster');s.actors.forEach(actor);heads(s.openingHealthHeads);
}
function validate(s:MortalityCoverageSelection,e:MortalityCoverageSample){const c=e?.clock;
    check(c&&c.status==='running'&&c.clockId===s.clockId&&c.profileDigest===s.clockProfileDigest&&stamp(c.simulationTime)&&stamp(c.wallTime)
        &&Number.isSafeInteger(c.engineTick)&&Number(c.engineTick)>=0&&Number.isSafeInteger(c.revision)&&c.revision>=0
        &&typeof e.sessionId==='string'&&e.sessionId.length>0&&e.sessionId.length<=128&&e.stage==='after-native-mortality'
        &&typeof e.priorWriteFailed==='boolean'&&hex(e.rosterDigest)&&hex(e.agePolicyDigest)&&hex(e.mortalityPolicyDigest)
        &&(e.survivalSelectionDigest===null||hex(e.survivalSelectionDigest)),'Invalid mortality sample');
    check(Array.isArray(e.actors)&&e.actors.length<=1000&&new Set(e.actors.map(a=>a.actorId)).size===e.actors.length,'Invalid mortality sample roster');
    for(const a of e.actors){actor(a);check(['active','terminal','unavailable'].includes(a.state)&&(a.deathEventId===null||typeof a.deathEventId==='string'&&a.deathEventId.length<=256)
        &&(a.state==='terminal'?a.deathEventId!==null:a.deathEventId===null),'Invalid mortality state');}heads(e.healthHeads);
}
/** Explicit pre-baseline selection, own schema1. Records completed native passes, never infers them from heartbeat or avatars. */
export class NativeMortalityCoverageStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_mortality_selection'").get();}
    constructor(readonly db:Database,selection?:MortalityCoverageSelection){
        if(!NativeMortalityCoverageStore.present(db)){
            check(selection,'Mortality coverage requires explicit selection');validateSelection(selection);
            db.transaction(()=>{
                check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_mortality_schema','native_mortality_event','native_mortality_head')").get(),'Incomplete mortality schema');
                db.exec(`CREATE TABLE native_mortality_schema(version INTEGER PRIMARY KEY CHECK(version=1));INSERT INTO native_mortality_schema VALUES(1);
                    CREATE TABLE native_mortality_selection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL,digest TEXT NOT NULL);
                    CREATE TABLE native_mortality_event(sequence INTEGER PRIMARY KEY,session_id TEXT NOT NULL,engine_tick INTEGER NOT NULL,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL,UNIQUE(session_id,engine_tick));
                    CREATE TABLE native_mortality_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                    INSERT INTO native_mortality_head VALUES(1,0,NULL);
                    CREATE TRIGGER mortality_selection_no_update BEFORE UPDATE ON native_mortality_selection BEGIN SELECT RAISE(ABORT,'Mortality selection is immutable');END;
                    CREATE TRIGGER mortality_selection_no_delete BEFORE DELETE ON native_mortality_selection BEGIN SELECT RAISE(ABORT,'Mortality selection is immutable');END;
                    CREATE TRIGGER mortality_event_no_update BEFORE UPDATE ON native_mortality_event BEGIN SELECT RAISE(ABORT,'Mortality history is immutable');END;
                    CREATE TRIGGER mortality_event_no_delete BEFORE DELETE ON native_mortality_event BEGIN SELECT RAISE(ABORT,'Mortality history is immutable');END;`);
                db.run('INSERT INTO native_mortality_selection VALUES(1,?,?)',[JSON.stringify(selection),hash(selection)]);
            }).immediate();
        }
        check((db.query('SELECT version FROM native_mortality_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported mortality schema');
        if(selection)check(hash(this.selection())===hash(selection),'Mortality selection differs');
    }
    selection(){const r=this.db.query('SELECT payload,digest FROM native_mortality_selection WHERE singleton=1').get() as {payload:string;digest:string}|null;
        check(r,'Mortality selection absent');const s=JSON.parse(r.payload) as MortalityCoverageSelection;validateSelection(s);check(hash(s)===r.digest,'Mortality selection corrupt');return s;}
    append(sample:MortalityCoverageSample){const selection=this.selection();validate(selection,sample);
        this.db.transaction(()=>{const head=this.db.query('SELECT sequence,digest FROM native_mortality_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null,
            tail=this.db.query('SELECT sequence,digest FROM native_mortality_event ORDER BY sequence DESC LIMIT 1').get() as {sequence:number;digest:string}|null;
            check(head&&head.sequence===(tail?.sequence??0)&&head.digest===(tail?.digest??null),'Mortality tail differs');
            const sequence=head.sequence+1,payload=JSON.stringify(sample),digest=hash({sequence,payload,previousDigest:head.digest});
            this.db.run('INSERT INTO native_mortality_event VALUES(?,?,?,?,?,?)',[sequence,sample.sessionId,sample.clock.engineTick,payload,head.digest,digest]);
            this.db.run('UPDATE native_mortality_head SET sequence=?,digest=? WHERE singleton=1',[sequence,digest]);
        }).immediate();
    }
    read(){const selection=this.selection();
        check((this.db.query('SELECT count(*) n FROM native_mortality_event').get() as {n:number}).n<=100000,'Mortality row budget exceeded');
        let previous:string|null=null;
        const entries=(this.db.query('SELECT * FROM native_mortality_event ORDER BY sequence').all() as any[]).map((r,i)=>{
            const sample=JSON.parse(r.payload) as MortalityCoverageSample;validate(selection,sample);
            check(r.sequence===i+1&&r.session_id===sample.sessionId&&r.engine_tick===sample.clock.engineTick&&r.previous_digest===previous
                &&r.digest===hash({sequence:r.sequence,payload:r.payload,previousDigest:previous}),'Mortality chain differs');previous=r.digest;
            return{sequence:r.sequence as number,sample,digest:r.digest as string};});
        const head=this.db.query('SELECT sequence,digest FROM native_mortality_head WHERE singleton=1').get() as {sequence:number;digest:string|null}|null;
        check(head&&head.sequence===entries.length&&head.digest===previous,'Mortality head differs');return{selection,head,entries};
    }
}
