import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { nativeToolDigest as hash,type NativeToolOwner } from '../item-lifecycle/native-tool.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export type NativeMaterialFact=
    | {kind:'mining';lotId:string;itemId:number;owner:NativeToolOwner;clock:SimulationClockObservation;nativeEventId:string;nativeEventDigest:string}
    | {kind:'hold';operationId:string;workKind:'smelt'|'repair';intentDigest:string;escrowId:string;owner:NativeToolOwner;clock:SimulationClockObservation;
        inputs:{itemId:number;slot:number;lotId:string|null}[]}
    | {kind:'smelt';lotId:string;itemId:2349;operationId:string;owner:NativeToolOwner;clock:SimulationClockObservation;nativeEventId:string;nativeEventDigest:string};
export interface NativeMaterialEntry {sequence:number;key:string;fact:NativeMaterialFact;previousDigest:string|null;digest:string}
export interface NativeMaterialLot {lotId:string;itemId:number;ownerDigest:string;originDigest:string;spentBy:string|null;internal:boolean}
function check(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const key=(f:NativeMaterialFact)=>f.kind==='hold'?`hold:${f.operationId}`:f.lotId;
const bounded=(db:Database,table:string)=>{
    check((db.query(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n<=100000,'Native material source exceeds row limit');
};
function shape(f:NativeMaterialFact){
    check(f&&['mining','hold','smelt'].includes(f.kind)&&f.owner&&Object.keys(f.owner).sort().join(',')==='actorId,clockId,clockProfileDigest,lifecycleId,username,worldId'
        &&Object.values(f.owner).every(v=>typeof v==='string'&&v.length>0)&&/^[a-f0-9]{64}$/.test(f.owner.clockProfileDigest)
        &&f.clock.status==='running'&&f.clock.clockId===f.owner.clockId&&f.clock.profileDigest===f.owner.clockProfileDigest
        &&Number.isSafeInteger(f.clock.engineTick)&&Number(f.clock.engineTick)>=0
        &&new Date(f.clock.simulationTime).toISOString()===f.clock.simulationTime,'Invalid native material identity/clock');
    if(f.kind==='hold')check(/^[a-f0-9-]{36}$/.test(f.operationId)&&/^[a-f0-9-]{36}$/.test(f.escrowId)
        &&/^[a-f0-9]{64}$/.test(f.intentDigest)&&['repair','smelt'].includes(f.workKind)
        &&f.inputs.length===(f.workKind==='smelt'?2:1)&&f.inputs.every((i,n)=>i.itemId===(f.workKind==='smelt'?[436,438][n]:2349)
            &&Number.isSafeInteger(i.slot)&&i.slot>=0&&i.slot<28&&(i.lotId===null||typeof i.lotId==='string'))
        &&new Set(f.inputs.map(i=>i.slot)).size===f.inputs.length,'Invalid native material hold');
    else check(f.lotId===(f.kind==='mining'?`mine:${f.nativeEventId}`:`smelt:${f.operationId}`)
        &&(f.kind==='mining'?[436,438].includes(f.itemId):f.itemId===2349&&f.nativeEventId===`work:${f.operationId}`)
        &&/^[a-f0-9]{64}$/.test(f.nativeEventDigest),'Invalid native material mint');
}
/** Prospective physical witnesses only. Legacy item quantities never create lots. Own schema, shared user_version untouched. */
export class NativeMaterialStore {
    static present(db:Database){return !!db.query("SELECT 1 FROM sqlite_master WHERE name='native_material_schema'").get();}
    constructor(readonly db:Database,initialize=false){
        if(!NativeMaterialStore.present(db)){
            check(initialize&&db.inTransaction,'Native materials require explicit transactional initialization');
            check(!db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_material_event','native_material_head','native_material_lot')").get(),'Incomplete native material schema');
            db.exec(`CREATE TABLE native_material_schema(version INTEGER PRIMARY KEY CHECK(version=1));
                INSERT INTO native_material_schema VALUES(1);
                CREATE TABLE native_material_event(sequence INTEGER PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL);
                CREATE TABLE native_material_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),source_id TEXT NOT NULL,sequence INTEGER NOT NULL,digest TEXT);
                CREATE TABLE native_material_lot(lot_id TEXT PRIMARY KEY,item_id INTEGER NOT NULL,owner_digest TEXT NOT NULL,origin_digest TEXT NOT NULL,spent_by TEXT,internal INTEGER NOT NULL);
                CREATE TRIGGER native_material_no_update BEFORE UPDATE ON native_material_event BEGIN SELECT RAISE(ABORT,'Native material history is immutable'); END;
                CREATE TRIGGER native_material_no_delete BEFORE DELETE ON native_material_event BEGIN SELECT RAISE(ABORT,'Native material history is immutable'); END;`);
            db.run('INSERT INTO native_material_head VALUES(1,?,0,NULL)',[randomUUID()]);
        }
        check((db.query('SELECT version FROM native_material_schema').all() as {version:number}[]).map(r=>r.version).join(',')==='1','Unsupported native material schema');
    }
    lot(id:string):NativeMaterialLot|null{
        const r=this.db.query('SELECT * FROM native_material_lot WHERE lot_id=?').get(id) as any;
        if(r)check([0,1].includes(r.internal)&&[436,438,2349].includes(r.item_id)&&/^[a-f0-9]{64}$/.test(r.owner_digest)
            &&/^[a-f0-9]{64}$/.test(r.origin_digest)&&(r.spent_by===null||/^[a-f0-9-]{36}$/.test(r.spent_by)),'Invalid native material projection');
        return r?{lotId:r.lot_id,itemId:r.item_id,ownerDigest:r.owner_digest,originDigest:r.origin_digest,spentBy:r.spent_by,internal:r.internal===1}:null;
    }
    entry(id:string):NativeMaterialEntry|null{
        const r=this.db.query('SELECT * FROM native_material_event WHERE source_key=?').get(id) as any;if(!r)return null;
        const fact=JSON.parse(r.payload) as NativeMaterialFact;
        check(hash({sequence:r.sequence,key:r.source_key,fact,previousDigest:r.previous_digest})===r.digest&&key(fact)===r.source_key,'Native material entry differs');
        return{sequence:r.sequence,key:r.source_key,fact,previousDigest:r.previous_digest,digest:r.digest};
    }
    append(fact:NativeMaterialFact):NativeMaterialEntry{
        check(this.db.inTransaction,'Native material mutation needs its checkpoint transaction');shape(fact);
        const prior=this.entry(key(fact));if(prior){check(hash(prior.fact)===hash(fact),'Native material source reused');return prior;}
        const head=this.db.query('SELECT * FROM native_material_head WHERE singleton=1').get() as any;
        check(head&&Number.isSafeInteger(head.sequence)&&head.sequence>=0,'Native material head missing');
        const tail=this.db.query('SELECT source_key FROM native_material_event ORDER BY sequence DESC LIMIT 1').get() as {source_key:string}|null;
        const last=tail?this.entry(tail.source_key):null;check((last?.sequence??0)===head.sequence&&(last?.digest??null)===head.digest,'Native material tail differs');
        let internal=true;
        if(fact.kind==='hold')for(const input of fact.inputs){if(input.lotId===null)continue;
            const lot=this.lot(input.lotId),origin=this.entry(input.lotId)?.fact;
            check(lot&&origin&&lot.itemId===input.itemId&&lot.ownerDigest===hash(fact.owner)&&lot.spentBy===null
                &&origin.clock.simulationTime<=fact.clock.simulationTime,'Native material lot is foreign or already held');
            const changed=this.db.run('UPDATE native_material_lot SET spent_by=? WHERE lot_id=? AND spent_by IS NULL',[fact.operationId,input.lotId]);
            check(changed.changes===1,'Native material lot already spent');
        }
        else if(fact.kind==='smelt'){
            const hold=this.entry(`hold:${fact.operationId}`)?.fact;
            check(hold?.kind==='hold'&&hold.workKind==='smelt'&&hash(hold.owner)===hash(fact.owner)
                &&hold.clock.simulationTime<=fact.clock.simulationTime,'Native smelt hold missing');
            internal=hold.inputs.every(i=>i.lotId!==null&&this.lot(i.lotId)?.internal===true);
        }
        const body={sequence:head.sequence+1,key:key(fact),fact,previousDigest:head.digest},entry={...body,digest:hash(body)};
        this.db.run('INSERT INTO native_material_event VALUES(?,?,?,?,?)',[entry.sequence,entry.key,JSON.stringify(fact),entry.previousDigest,entry.digest]);
        this.db.run('UPDATE native_material_head SET sequence=?,digest=? WHERE singleton=1',[entry.sequence,entry.digest]);
        if(fact.kind!=='hold')this.db.run('INSERT INTO native_material_lot VALUES(?,?,?,?,NULL,?)',[fact.lotId,fact.itemId,hash(fact.owner),entry.digest,internal?1:0]);
        return entry;
    }
    static read(db:Database){
        for(const table of ['native_material_event','native_material_lot','native_material_head'])bounded(db,table);
        const store=new NativeMaterialStore(db),raw=db.query('SELECT source_key FROM native_material_event ORDER BY sequence').all() as {source_key:string}[];
        const entries:NativeMaterialEntry[]=[],byKey=new Map<string,NativeMaterialEntry>(),lots=new Map<string,NativeMaterialLot>(),holds=new Map<string,Extract<NativeMaterialFact,{kind:'hold'}>>();
        let previous:string|null=null;
        for(const [index,row] of raw.entries()){
            const e=store.entry(row.source_key)!;shape(e.fact);check(e.sequence===index+1&&e.previousDigest===previous,'Native material chain differs');
            const f=e.fact;
            if(f.kind==='hold'){
                for(const i of f.inputs){if(i.lotId===null)continue;const lot=lots.get(i.lotId),source=byKey.get(i.lotId)?.fact;
                    check(lot&&source&&lot.itemId===i.itemId&&lot.ownerDigest===hash(f.owner)&&lot.spentBy===null
                        &&source.clock.simulationTime<=f.clock.simulationTime,'Native material custody/quantity differs');lot!.spentBy=f.operationId;}
                holds.set(f.operationId,f);
            }else{
                const hold=f.kind==='smelt'?holds.get(f.operationId):null;
                if(f.kind==='smelt')check(hold?.workKind==='smelt'&&hash(hold.owner)===hash(f.owner)&&hold.clock.simulationTime<=f.clock.simulationTime,'Native smelt ancestry differs');
                const internal=f.kind==='mining'||hold!.inputs.every(i=>i.lotId!==null&&lots.get(i.lotId)?.internal===true);
                check(!lots.has(f.lotId),'Duplicate native material lot');
                lots.set(f.lotId,{lotId:f.lotId,itemId:f.itemId,ownerDigest:hash(f.owner),originDigest:e.digest,spentBy:null,internal});
            }
            entries.push(e);byKey.set(e.key,e);previous=e.digest;
        }
        const head=db.query('SELECT * FROM native_material_head WHERE singleton=1').get() as any;
        check(head&&/^[a-f0-9-]{36}$/.test(head.source_id)&&head.sequence===entries.length&&head.digest===previous,'Native material head differs');
        const current=db.query('SELECT lot_id FROM native_material_lot').all() as {lot_id:string}[];
        check(current.length===lots.size&&current.every(r=>hash(store.lot(r.lot_id))===hash(lots.get(r.lot_id))),'Native material projection differs');
        return{sourceId:head.source_id as string,head:{sequence:head.sequence as number,digest:head.digest as string|null},entries,lots,holds};
    }
}
