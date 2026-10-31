import type {Database} from 'bun:sqlite';
import {join} from 'node:path';
import {OwnedDatabase} from '../server/engine/src/io/OwnedDatabase.js';
import {loadPropertyCatalog} from '../server/engine/src/mods/Properties.js';
import {assertNativeFoodDomainPath} from '../food-loop/native-source.js';
import {foodDigest} from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import {nativeHousingCatalogs,type HousingNativeOptions} from './native-rent.js';
import type {CommerceActor} from '../agent-operated-shop/native-commerce.js';
import type {SimulationClockObservation} from '../simulation-clock/types.js';

export interface NativeOwnerBedIntent {
    operationId:string;worldId:string;clockId:string;clockProfileDigest:string;owner:CommerceActor;
    housingUnitId:string;bedSlotId:string;propertyVersion:number;startsAt:string;endsAt:string;
    catalogs:ReturnType<typeof nativeHousingCatalogs>;
}
export interface NativeOwnerBedBinding {intent:NativeOwnerBedIntent;digest:string}
const tables=['housing_owner_schema','housing_owner_reservation','housing_owner_head'];
function check(v:unknown,message:string):asserts v {if(!v)throw Error(message);}
export function validateOwnerBedBinding(binding:NativeOwnerBedBinding){
    const i=binding.intent,id=(s:string)=>typeof s==='string'&&/^[a-z0-9][a-z0-9._:-]{1,119}$/.test(s),
        unit=i.catalogs.units.units.find(u=>u.housingUnitId===i.housingUnitId);
    check(binding.digest===foodDigest(i)&&id(i.operationId)&&!!i.worldId&&!!i.clockId&&/^[a-f0-9]{64}$/.test(i.clockProfileDigest)
        &&id(i.owner.agentId)&&/^[a-z0-9]{1,12}$/.test(i.owner.username)&&!!i.owner.lifecycleId
        &&unit?.enabled&&i.housingUnitId===i.catalogs.native.housingUnitId&&unit.bedSlots.some(b=>b.bedSlotId===i.bedSlotId)
        &&i.catalogs.native.beds.some(b=>b.bedSlotId===i.bedSlotId)&&Number.isSafeInteger(i.propertyVersion)&&i.propertyVersion>=1
        &&Date.parse(i.endsAt)===Date.parse(i.startsAt)+unit.rentPeriodSimulationMinutes*60000,'Invalid native owner bed binding');
    for(const at of [i.startsAt,i.endsAt])check(new Date(at).toISOString()===at,'Owner bed time must be canonical UTC');
}
/** Absent on legacy worlds. A partial or unknown owner schema is never treated as empty. */
export function readOwnerBedReservations(db:Database):NativeOwnerBedBinding[]{
    const found=tables.filter(name=>db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(name));
    if(!found.length)return[];
    check(found.length===tables.length,'Incomplete owner bed schema');
    const versions=db.query('SELECT version FROM housing_owner_schema').all() as {version:number}[];
    check(versions.length===1&&versions[0]!.version===1,'Unsupported owner bed schema');
    check((db.query('SELECT COUNT(*) n FROM housing_owner_reservation').get() as {n:number}).n<=100000,'Owner bed source exceeds row limit');
    const rows=db.query('SELECT * FROM housing_owner_reservation ORDER BY sequence').all() as {sequence:number;operation_id:string;json:string;previous_hash:string|null;hash:string}[];
    let previous:string|null=null;const ids=new Set<string>();
    const bindings=rows.map((row,index)=>{const {hash,...facts}=row,binding=JSON.parse(row.json) as NativeOwnerBedBinding;validateOwnerBedBinding(binding);
        check(row.sequence===index+1&&row.previous_hash===previous&&foodDigest(facts)===hash&&row.operation_id===binding.intent.operationId&&!ids.has(row.operation_id),
            'Owner bed reservation audit differs');previous=hash;ids.add(row.operation_id);return binding;});
    const head=db.query('SELECT * FROM housing_owner_head WHERE id=1').get() as {sequence:number;hash:string|null}|null;
    check(head&&head.sequence===rows.length&&head.hash===previous,'Owner bed reservation coverage differs');return bindings;
}
export function appendOwnerBedReservation(db:Database,binding:NativeOwnerBedBinding){
    check(db.inTransaction,'Owner reservation requires its housing transaction');validateOwnerBedBinding(binding);
    // Inspect before CREATE: an interrupted/foreign schema cannot be repaired by admission.
    readOwnerBedReservations(db);
    if(!db.query("SELECT 1 FROM sqlite_master WHERE name='housing_owner_schema'").get())db.exec(`
        CREATE TABLE housing_owner_schema(version INTEGER PRIMARY KEY); INSERT INTO housing_owner_schema VALUES(1);
        CREATE TABLE housing_owner_reservation(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL);
        CREATE TABLE housing_owner_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT);
        INSERT INTO housing_owner_head VALUES(1,0,NULL);
        CREATE TRIGGER housing_owner_no_update BEFORE UPDATE ON housing_owner_reservation BEGIN SELECT RAISE(ABORT,'Owner reservations are immutable'); END;
        CREATE TRIGGER housing_owner_no_delete BEFORE DELETE ON housing_owner_reservation BEGIN SELECT RAISE(ABORT,'Owner reservations are immutable'); END;`);
    const records=readOwnerBedReservations(db),prior=records.find(b=>b.intent.operationId===binding.intent.operationId);
    if(prior){check(prior.digest===binding.digest,'Owner operation id reused');return;}
    const head=db.query('SELECT * FROM housing_owner_head WHERE id=1').get() as {sequence:number;hash:string|null},
        facts={sequence:head.sequence+1,operation_id:binding.intent.operationId,json:JSON.stringify(binding),previous_hash:head.hash},hash=foodDigest(facts);
    db.run('INSERT INTO housing_owner_reservation VALUES(?1,?2,?3,?4,?5)',[facts.sequence,facts.operation_id,facts.json,facts.previous_hash,hash]);
    db.run('UPDATE housing_owner_head SET sequence=?1,hash=?2 WHERE id=1',[facts.sequence,hash]);readOwnerBedReservations(db);
}
export function assertOwnerBedProperty(options:HousingNativeOptions,binding:NativeOwnerBedBinding){
    assertNativeFoodDomainPath({...options,checkpointPath:options.propertyPath});
    const i=binding.intent,unit=i.catalogs.units.units.find(u=>u.housingUnitId===i.housingUnitId)!,
        definition=loadPropertyCatalog(join(options.workspace,'config/properties.json')).properties.find(p=>p.propertyId===unit.propertyId),
        db=new OwnedDatabase(options.propertyPath,{readonly:true,strict:true});
    try{const p=db.query('SELECT * FROM property_state WHERE property_id=?1').get(unit.propertyId) as any;
        check(definition?.permissions.enter.some(r=>r==='owner'||r==='everyone')&&p?.status==='owned'&&p.owner_kind==='player'
            &&p.owner_id===i.owner.username&&p.version===i.propertyVersion,'Owner bed Property authority changed');
    }finally{db.close(true);}
}
export function assertOwnerBedAuthority(options:HousingNativeOptions,binding:NativeOwnerBedBinding,clock:SimulationClockObservation){
    validateOwnerBedBinding(binding);const i=binding.intent;
    check(foodDigest(nativeHousingCatalogs(options.workspace))===foodDigest(i.catalogs)&&options.worldId===i.worldId
        &&clock.clockId===i.clockId&&clock.profileDigest===i.clockProfileDigest&&['running','paused'].includes(clock.status)
        &&clock.simulationTime>=i.startsAt&&clock.simulationTime<i.endsAt,'Owner bed catalog/clock/period changed');
    assertOwnerBedProperty(options,binding);
}
