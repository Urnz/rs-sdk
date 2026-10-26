import type { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
export interface SleepWitness {id:string;operationId:string;bindingDigest:string;username:string;lifecycleId:string;
    x:number;z:number;level:number;clock:SimulationClockObservation;checkpointDigest:string}
/** A contemporaneous native observation, not an uploaded entitlement or continuous legal-access proof. */
export interface NativeHousingSleepObservation {kind:'native-housing-sleep-v1';witnessId:string;witnessDigest:string;bindingDigest:string;
    username:string;lifecycleId:string;observedAtSimulationTime:string;validUntilSimulationTime:string}
export function readHousingSleep(db:Database):SleepWitness[]{
    if((db.query('SELECT COUNT(*) n FROM native_housing_sleep').get() as {n:number}).n>100000)throw Error('Housing sleep source exceeds row limit');
    let previous:string|null=null;
    const rows=db.query('SELECT * FROM native_housing_sleep ORDER BY sequence').all() as {sequence:number;witness_id:string;json:string;previous_hash:string|null;hash:string}[];
    const records=rows.map((row,index)=>{const {hash,...facts}=row,witness=JSON.parse(row.json) as SleepWitness;
        if(row.sequence!==index+1||row.previous_hash!==previous||witness.id!==row.witness_id||foodDigest(facts)!==hash)throw Error('Housing sleep witness audit differs');
        previous=hash;return witness;});
    const head=db.query('SELECT * FROM native_housing_sleep_head WHERE id=1').get() as {sequence:number;hash:string|null}|null;
    if(!head||head.sequence!==rows.length||head.hash!==previous)throw Error('Housing sleep witness coverage differs');return records;
}
