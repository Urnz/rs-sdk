import type { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import {validateOwnerBedBinding,type NativeOwnerBedBinding} from './native-owner.js';
export interface SleepWitness {id:string;operationId:string;bindingDigest:string;username:string;lifecycleId:string;
    x:number;z:number;level:number;clock:SimulationClockObservation;checkpointDigest:string;
    ownerBinding?:NativeOwnerBedBinding}
/** A contemporaneous native observation, not an uploaded entitlement or continuous legal-access proof. */
export interface NativeHousingSleepObservation {kind:'native-housing-sleep-v1';witnessId:string;witnessDigest:string;bindingDigest:string;
    username:string;lifecycleId:string;observedAtSimulationTime:string;validUntilSimulationTime:string}
export function ownerSleepBinding(w:SleepWitness){
    const binding=w.ownerBinding;if(!binding)throw Error('Owner sleep binding absent');validateOwnerBedBinding(binding);
    const i=binding.intent,bed=i.catalogs.native.beds.find(b=>b.bedSlotId===i.bedSlotId);
    if(w.operationId!==i.operationId||w.bindingDigest!==binding.digest||w.username!==i.owner.username||w.lifecycleId!==i.owner.lifecycleId
        ||w.clock.clockId!==i.clockId||w.clock.profileDigest!==i.clockProfileDigest||w.clock.status!=='running'
        ||w.clock.simulationTime<i.startsAt||w.clock.simulationTime>=i.endsAt||!bed||w.level!==bed.level
        ||Math.max(Math.abs(w.x-bed.x),Math.abs(w.z-bed.z))>1)throw Error('Native owner sleep binding differs');
    return binding;
}
export function readHousingSleep(db:Database):SleepWitness[]{
    if((db.query('SELECT COUNT(*) n FROM native_housing_sleep').get() as {n:number}).n>100000)throw Error('Housing sleep source exceeds row limit');
    let previous:string|null=null;
    const rows=db.query('SELECT * FROM native_housing_sleep ORDER BY sequence').all() as {sequence:number;witness_id:string;json:string;previous_hash:string|null;hash:string}[];
    const records=rows.map((row,index)=>{const {hash,...facts}=row,witness=JSON.parse(row.json) as SleepWitness;
        if(row.sequence!==index+1||row.previous_hash!==previous||witness.id!==row.witness_id||foodDigest(facts)!==hash)throw Error('Housing sleep witness audit differs');
        if(witness.ownerBinding)ownerSleepBinding(witness);
        previous=hash;return witness;});
    const head=db.query('SELECT * FROM native_housing_sleep_head WHERE id=1').get() as {sequence:number;hash:string|null}|null;
    if(!head||head.sequence!==rows.length||head.hash!==previous)throw Error('Housing sleep witness coverage differs');return records;
}
