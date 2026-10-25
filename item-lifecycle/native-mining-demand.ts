import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { NativeToolOwner } from './native-tool.js';
import type { ItemInstanceState } from './types.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export interface NativeMiningDemandObservation {
    protocol: 'native-mining-demand-v1'; requestId: string;
    phase: 'admitted' | 'blocked' | 'committed';
    reason: 'unusable-tool' | 'unavailable-position' | 'invalid-evidence' | null;
    owner: NativeToolOwner; clock: SimulationClockObservation;
    cycleId: 'bronze-pickaxe-mining'; item: ItemInstanceState | null;
    bindingDigest: string | null;
    source: {type:number;x:number;z:number;level:number} | null;
}
export interface NativeMiningDemandEntry {sequence:number;observation:NativeMiningDemandObservation;digest:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function check(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function validate(value:NativeMiningDemandObservation):void {
    check(value.protocol==='native-mining-demand-v1'&&typeof value.requestId==='string'&&value.requestId.length>0&&value.requestId.length<=256,
        'Invalid native mining demand request');
    check(['admitted','blocked','committed'].includes(value.phase)&&value.cycleId==='bronze-pickaxe-mining','Invalid native mining demand phase/cycle');
    check(value.phase==='blocked'?['unusable-tool','unavailable-position','invalid-evidence'].includes(value.reason!):value.reason===null,
        'Invalid native mining demand reason');
    check(value.owner&&Object.keys(value.owner).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'
        &&Object.values(value.owner).every(v=>typeof v==='string'&&v.length>0&&v.length<=256),
        'Invalid native mining demand owner');
    const c=value.clock;
    check(c&&c.status==='running'&&c.clockId===value.owner.clockId&&c.profileDigest===value.owner.clockProfileDigest
        &&/^[0-9a-f]{64}$/.test(c.profileDigest)&&c.engineTick!==null&&Number.isSafeInteger(c.engineTick)&&c.engineTick>=0
        &&Number.isSafeInteger(c.revision)&&c.revision>=0&&typeof c.simulationTime==='string'&&Number.isFinite(Date.parse(c.simulationTime))
        &&typeof c.wallTime==='string'&&Number.isFinite(Date.parse(c.wallTime)),'Invalid native mining demand clock');
    check(value.bindingDigest===null||/^[0-9a-f]{64}$/.test(value.bindingDigest),'Invalid native mining demand binding');
    check(value.source===null||['type','x','z','level'].every(k=>Number.isSafeInteger(value.source![k as keyof NonNullable<typeof value.source>])),
        'Invalid native mining demand source');
    const item=value.item;
    check(item===null||(typeof item.itemInstanceId==='string'&&item.itemInstanceId.length>0&&item.itemId===1265
        &&item.lifecycleTypeId==='bronze-pickaxe'&&Number.isSafeInteger(item.revision)&&item.revision>=1
        &&Number.isSafeInteger(item.durability)&&item.durability>=0&&Number.isSafeInteger(item.maxDurability)&&item.maxDurability>0
        &&item.durability<=item.maxDurability&&['usable','broken'].includes(item.status)),'Invalid native mining demand item');
    if(value.phase!=='blocked')check(item&&item.ownerActorId===value.owner.actorId&&value.bindingDigest!==null&&value.source!==null,
        'Admitted native mining demand requires custody/source evidence');
    if(value.phase==='admitted')check(item!.status==='usable'&&item!.durability>0,'Admitted native mining demand requires a usable tool');
    if(value.reason==='unusable-tool')check(item&&item.ownerActorId===value.owner.actorId&&value.bindingDigest!==null,
        'Unusable native mining demand requires tool evidence');
}
type Head={sequence:number;digest:string|null};
function version(db:Database){
    const rows=db.query<{version:number},[]>('SELECT version FROM native_mining_demand_schema').all();
    check(rows.length===1&&rows[0]!.version===1,'Unsupported native mining demand schema');
}
function head(db:Database):Head {
    const rows=db.query<Head,[]>('SELECT sequence,digest FROM native_mining_demand_head').all();
    check(rows.length===1&&Number.isSafeInteger(rows[0]!.sequence)&&rows[0]!.sequence>=0,'Invalid native mining demand head');
    return rows[0]!;
}

/** Prospective engine observations only. A blocked click is not an interval or a completeness watermark. */
export class NativeMiningDemandStore {
    constructor(readonly db:Database){
        db.transaction(()=>{
            db.exec(`CREATE TABLE IF NOT EXISTS native_mining_demand_schema(version INTEGER PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS native_mining_demand_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT);
                CREATE TABLE IF NOT EXISTS native_mining_demand_event(sequence INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,
                    previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS native_mining_demand_no_update BEFORE UPDATE ON native_mining_demand_event
                BEGIN SELECT RAISE(ABORT,'Native mining demand history is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS native_mining_demand_no_delete BEFORE DELETE ON native_mining_demand_event
                BEGIN SELECT RAISE(ABORT,'Native mining demand history is immutable'); END;`);
            const versions=db.query('SELECT version FROM native_mining_demand_schema').all();
            if(!versions.length){
                check((db.query('SELECT 1 FROM native_mining_demand_event LIMIT 1').get()===null)
                    &&db.query('SELECT 1 FROM native_mining_demand_head LIMIT 1').get()===null,'Unversioned native mining demand data');
                db.run('INSERT INTO native_mining_demand_schema VALUES(1)');db.run('INSERT INTO native_mining_demand_head VALUES(1,0,NULL)');
            }
            version(db);head(db);
        }).immediate();
    }
    static present(db:Database):boolean{return !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_mining_demand_schema'").get();}
    static read(db:Database):{entries:NativeMiningDemandEntry[];head:Head}{
        version(db);const entries:NativeMiningDemandEntry[]=[];let previousDigest:string|null=null,sequence=0;
        const rows=db.query<{sequence:number;event_key:string;payload:string;previous_digest:string|null;digest:string},[]>(
            'SELECT * FROM native_mining_demand_event ORDER BY sequence').all();
        check(rows.length<=100000,'Native mining demand source exceeds row limit');
        for(const row of rows){
            check(row.sequence===++sequence&&row.previous_digest===previousDigest
                &&hash({sequence,eventKey:row.event_key,payload:row.payload,previousDigest})===row.digest,'Native mining demand audit mismatch');
            const observation=JSON.parse(row.payload) as NativeMiningDemandObservation;validate(observation);
            check(row.event_key===NativeMiningDemandStore.key(observation),'Native mining demand event identity mismatch');
            entries.push({sequence,observation,digest:row.digest});previousDigest=row.digest;
        }
        const current=head(db);check(current.sequence===sequence&&current.digest===previousDigest,'Native mining demand audit tail mismatch');
        return{entries,head:current};
    }
    private static key(value:NativeMiningDemandObservation){return hash({requestId:value.requestId,owner:value.owner,phase:value.phase,
        engineTick:value.clock.engineTick,clockRevision:value.clock.revision});}
    append(observation:NativeMiningDemandObservation):void {
        validate(observation);
        this.db.transaction(()=>{
            const eventKey=NativeMiningDemandStore.key(observation),payload=JSON.stringify(observation);
            const prior=this.db.query<{payload:string},[string]>('SELECT payload FROM native_mining_demand_event WHERE event_key=?').get(eventKey);
            if(prior){check(prior.payload===payload,'Native mining demand event conflict');return;}
            const priorHead=head(this.db),sequence=priorHead.sequence+1;
            // Constant-time tail check on the hot path; complete-chain validation belongs to the readonly reader.
            const tail=this.db.query<{sequence:number;digest:string},[]>('SELECT sequence,digest FROM native_mining_demand_event ORDER BY sequence DESC LIMIT 1').get();
            check(priorHead.sequence===(tail?.sequence??0)&&priorHead.digest===(tail?.digest??null),'Native mining demand audit tail mismatch');
            const digest=hash({sequence,eventKey,payload,previousDigest:priorHead.digest});
            this.db.query('INSERT INTO native_mining_demand_event VALUES(?,?,?,?,?)').run(sequence,eventKey,payload,priorHead.digest,digest);
            this.db.query('UPDATE native_mining_demand_head SET sequence=?,digest=? WHERE singleton=1').run(sequence,digest);
        }).immediate();
    }
}
