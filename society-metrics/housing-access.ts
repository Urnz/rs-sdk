import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { readStableOutcomeStore } from './population-outcomes.js';
import { nativeHousingCatalogs,readRentJournal,type NativeRentOrder,type NativeRentReceipt } from '../housing/native-rent.js';
import { NativeRentSource,readNativeRentReceipt } from '../housing/native-rent-source.js';
import { AgentStateStore } from '../agent-state/store.js';
import { NeedsStore,type DurableNeedsState } from '../needs/store.js';
import { populationNeedsBinding } from '../needs/population-binding.js';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { SIMULATION_CLOCK_STORE_SCHEMA_VERSION,type SimulationClockObservation } from '../simulation-clock/types.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import type { EvaluationScope } from './evaluation.js';
import { loadPropertyCatalog } from '../server/engine/src/mods/Properties.js';
import { join } from 'node:path';
export interface NativeHousingBoundaryPaths {clockPath:string;housingPath:string;propertyPath:string;checkpointPath:string;agentPath:string;needsPath:string}
interface Options {workspace:string;worldId:string;configDirectory:string}
function check(v:unknown):asserts v {if(!v)throw Error('Housing access source validation failed');}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface Tenancy {tenancy_id:string;housing_unit_id:string;bed_slot_id:string;tenant_agent_id:string;status:string;starts_at:string;ends_at:string;next_rent_due_at:string;
    rent_gp_per_period:number;rent_period_minutes:number;arrears_gp:number;unit_catalog_digest:string;revision:number}
function tenancies(db:Database,catalogs:ReturnType<typeof nativeHousingCatalogs>){
    check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===2);
    const meta=db.query('SELECT catalog_digest FROM housing_tenancy_meta WHERE singleton=1').get() as {catalog_digest:string}|null;
    check(meta?.catalog_digest===catalogs.units.digest);
    const rows=db.query('SELECT * FROM housing_tenancy ORDER BY tenancy_id').all() as Tenancy[];
    const audits=db.query('SELECT * FROM housing_tenancy_audit ORDER BY sequence').all() as {sequence:number;action:string;tenancy_id:string;occurred_at:string;payload_json:string;previous_hash:string;entry_hash:string}[];
    let previous='0'.repeat(64);const reconstructed=new Map<string,Tenancy>();
    for(const [index,a] of audits.entries()){
        const p=JSON.parse(a.payload_json) as {action:string;tenancyId:string;at:string;detail:Record<string,any>};
        check(a.sequence===index+1&&a.previous_hash===previous&&a.entry_hash===hash({previousHash:previous,payload:p})&&p.action===a.action&&p.tenancyId===a.tenancy_id&&p.at===a.occurred_at);
        check(Number.isSafeInteger(Date.parse(p.at))&&new Date(p.at).toISOString()===p.at);previous=a.entry_hash;
        let t=reconstructed.get(p.tenancyId);const d=p.detail;
        if(p.action==='tenancy-created'){
            const unit=catalogs.units.units.find(u=>u.housingUnitId===d.unitId);check(!t&&unit&&unit.bedSlots.some(b=>b.bedSlotId===d.bedId));
            check(Date.parse(d.end)>Date.parse(p.at));
            t={tenancy_id:p.tenancyId,housing_unit_id:unit.housingUnitId,bed_slot_id:d.bedId,tenant_agent_id:d.tenantId,status:'active',starts_at:p.at,ends_at:d.end,
                next_rent_due_at:new Date(Date.parse(p.at)+unit.rentPeriodSimulationMinutes*60000).toISOString(),rent_gp_per_period:unit.rentGpPerPeriod,
                rent_period_minutes:unit.rentPeriodSimulationMinutes,arrears_gp:0,unit_catalog_digest:catalogs.units.digest,revision:1};reconstructed.set(p.tenancyId,t);
        }else{
            check(t);
            if(p.action==='rent-prepaid')continue;
            if(p.action==='rent-assessed'){
                check(Number.isSafeInteger(d.charges)&&d.charges>=0);t.arrears_gp+=d.charges*t.rent_gp_per_period;
                t.next_rent_due_at=new Date(Date.parse(t.next_rent_due_at)+d.charges*t.rent_period_minutes*60000).toISOString();
                t.status=Date.parse(p.at)>=Date.parse(t.ends_at)?'expired':t.arrears_gp>0?'arrears':'active';check(t.status===d.status);
            }else if(p.action==='rent-paid'){
                check(Number.isSafeInteger(d.amountGp)&&d.amountGp>0&&d.amountGp<=t.arrears_gp);t.arrears_gp-=d.amountGp;
                t.status=Date.parse(p.at)>=Date.parse(t.ends_at)?'expired':t.arrears_gp?'arrears':'active';
            }else if(p.action==='tenancy-ended')t.status='ended';
            else if(p.action==='prepaid-expired'){check(Date.parse(p.at)>=Date.parse(t.ends_at));t.status='expired';}
            else throw Error('Unknown tenancy audit action');
            t.revision++;
        }
    }
    const head=db.query('SELECT sequence,hash FROM housing_tenancy_audit_head WHERE id=1').get() as {sequence:number;hash:string}|null;
    check(head&&head.sequence===audits.length&&head.hash===previous&&rows.length===reconstructed.size
        &&rows.every(t=>digest(t)===digest(reconstructed.get(t.tenancy_id))));
    return{rows,head};
}
/** Explicit native snapshots; no writable stores, history backfill or wall→simulation conversion. */
export function loadHousingBoundaryInputs(options:Options,contract=loadSocietyMinimumContract(options.configDirectory)){
    return{contract,catalogs:nativeHousingCatalogs(options.workspace),propertyDefinitions:loadPropertyCatalog(join(options.configDirectory,'properties.json')).properties};
}
export function readHousingAccessPoint(scope:EvaluationScope,options:Options,paths:NativeHousingBoundaryPaths,at:string,
    inputs=loadHousingBoundaryInputs(options)){
    check(new Date(at).toISOString()===at&&at>=scope.fromSimulationTime&&at<=scope.toSimulationTime);
    const {contract,catalogs,propertyDefinitions}=inputs;
    check(catalogs.hierarchy.digest===contract.dependencies.housingHierarchy.digest&&catalogs.effects.digest===contract.dependencies.housingEffects.digest);
    const clock=readStableOutcomeStore(options,paths.clockPath,db=>{
        check((db.query('PRAGMA user_version').get() as {user_version:number}).user_version===SIMULATION_CLOCK_STORE_SCHEMA_VERSION);
        const row=db.query('SELECT * FROM simulation_clock WHERE clock_id=?').get(scope.clockId) as Record<string,any>|null;
        check(row&&row.status==='paused'&&row.profile_digest===scope.clockProfileDigest&&row.last_simulation_ms===Date.parse(at)
            &&simulationClockProfileDigest(JSON.parse(row.profile_json))===scope.clockProfileDigest);return{row};
    });
    const observed:SimulationClockObservation={clockId:scope.clockId,profileDigest:scope.clockProfileDigest,simulationTime:at,
        wallTime:new Date(clock.row.last_observed_wall_ms).toISOString(),status:'paused',revision:clock.row.revision,engineTick:null};
    const agents=readStableOutcomeStore(options,paths.agentPath,()=>{const store=new AgentStateStore(paths.agentPath,undefined,true);
        try{return{members:store.listPopulationMembers()};}finally{store.close();}});
    check(digest(agents.members.map(m=>m.agentId).sort())===digest([...scope.actorAgentIds].sort()));
    const cohort=readStableOutcomeStore(options,paths.needsPath,db=>{
        const store=new NeedsStore(db,contract.dependencies.needs,contract.dependencies.dynamics,{readonly:true});
        const initial=(db.query('SELECT snapshot_json FROM needs_event WHERE revision=1').all() as {snapshot_json:string}[]).map(r=>JSON.parse(r.snapshot_json) as DurableNeedsState);
        return{actors:agents.members.map(m=>{const binding=populationNeedsBinding(options.worldId,m),state=store.get(binding),first=initial.find(s=>digest(s.binding)===digest(binding));
            check(state&&first&&state.state.observedAtSimulationTime===at&&binding.clockId===scope.clockId&&binding.clockProfileDigest===scope.clockProfileDigest);
            return{binding,admission:first.admission,initializedAt:first.state.observedAtSimulationTime,active:m.status==='active'&&m.characterLifecycle.status==='active'&&!state.terminal};
        })};
    });
    const properties=readStableOutcomeStore(options,paths.propertyPath,db=>({rows:catalogs.units.units.map(unit=>{
        const p=db.query('SELECT * FROM property_state WHERE property_id=?').get(unit.propertyId) as {property_id:string;status:string;owner_kind:string|null;owner_id:string|null;version:number;updated_at:string}|null;
        check(p&&Number.isSafeInteger(p.version)&&p.version>=1&&['available','owned','locked','disabled'].includes(p.status));return p;
    })}));
    const housing=readStableOutcomeStore(options,paths.housingPath,db=>{
        const orders=readRentJournal<NativeRentOrder>(db,'housing_native'),rent=tenancies(db,catalogs);
        check(orders.every(o=>o.binding.intent.worldId===options.worldId&&o.binding.intent.clockId===scope.clockId&&o.binding.intent.clockProfileDigest===scope.clockProfileDigest
            &&o.binding.intent.startsAt<=at&&foodDigest(o.binding.intent.catalogs)===foodDigest(catalogs)));
        return{orders,...rent,journalHead:db.query('SELECT * FROM housing_native_head WHERE id=1').get()};
    });
    const native=readStableOutcomeStore(options,paths.checkpointPath,db=>({journalHead:db.query('SELECT * FROM native_rent_head WHERE id=1').get(),receipts:readRentJournal<NativeRentReceipt>(db,'native_rent').map(r=>{
        check(r.clock.clockId===scope.clockId&&r.clock.profileDigest===scope.clockProfileDigest&&r.clock.simulationTime<=at);return readNativeRentReceipt(db,r.binding)!;
    })}));
    const source=new NativeRentSource({...options,...paths});
    const grants=(()=>{try{return housing.orders.flatMap(o=>{const i=o.binding.intent;if(o.phase!=='active'||i.startsAt>at||i.endsAt<=at)return[];
            const entitlement=source.entitlement(i.operationId,observed),receipt=native.receipts.find(r=>r.binding.digest===o.binding.digest);
            check(receipt?.phase==='paid'&&entitlement.order.nativeDigest===receipt.digest);
            return[{actor:i.tenant,unitId:i.housingUnitId,bedId:i.bedSlotId,from:receipt.clock.simulationTime>i.startsAt?receipt.clock.simulationTime:i.startsAt,to:i.endsAt}];
        });}finally{source.close();}})();
    return{at,worldId:options.worldId,clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,contractDigest:contract.digest,
        maximumGapSimulationMs:contract.policy.window.maximumTraceGapSimulationMilliseconds,
        minimumTierRank:contract.dependencies.housingHierarchy.tiers.find(t=>t.tierId===contract.policy.housing.minimumTierId)!.rank,
        catalogs,cohort:cohort.actors,properties:properties.rows,propertyDefinitions,orders:housing.orders,tenancies:housing.rows,grants,
        epochDigest:digest({catalogs,propertyDefinitions,properties:properties.rows,orders:housing.orders,tenancies:housing.rows,tenancyHead:housing.head,
            housingHead:housing.journalHead,nativeHead:native.journalHead,receipts:native.receipts}),
        sourceDigests:[clock,agents,cohort,properties,housing,native].map(s=>s.sourceSnapshotDigest)};
}
export type HousingAccessPoint=ReturnType<typeof readHousingAccessPoint>;
