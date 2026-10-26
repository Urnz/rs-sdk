import type { Database } from 'bun:sqlite';
import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import { loadItemRepairPolicyCatalog } from '../item-lifecycle/repair-policy.js';
import { nativeToolDigest as hash,nativeToolCatalog,nativeToolCycles,NATIVE_PICKAXE,type NativeToolBinding } from '../item-lifecycle/native-tool.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { outcomeCheck as check,outcomeRows as rows } from './outcome-work.js';
import { join } from 'node:path';

/** Native borrowed-DB schema. Never constructs the writable ItemLifecycleStore or infers state from current durability alone. */
export function readToolCapacityLedger(db:Database,contract:SocietyMinimumContract,configDirectory:string,at:string){
    const schema=rows(db,'item_lifecycle_schema');check(schema.length===1&&schema[0]!.singleton===1&&schema[0]!.version===3,'Unsupported native lifecycle schema');
    const catalog=nativeToolCatalog,cycles=nativeToolCycles,
        repairs=loadItemRepairPolicyCatalog(join(configDirectory,'item-repair-policies.json'),catalog);
    check(catalog.digest===contract.dependencies.tools.lifecycleCatalogDigest&&cycles.digest===contract.dependencies.tools.productionCatalogDigest,'Native tool policy differs');
    const instances=rows(db,'item_instance'),operations=rows(db,'item_lifecycle_operation'),replacements=rows(db,'item_replacement'),repairEvidence=rows(db,'item_repair_evidence');
    const audits=rows(db,'item_lifecycle_audit').sort((a,b)=>a.sequence-b.sequence),states=new Map<string,{row:Record<string,any>;owner:string;durability:number;revision:number;updated:string;retired:boolean}>();
    const byId=new Map(instances.map(r=>[r.item_instance_id,r])),byOperation=new Map(operations.map(r=>[r.operation_id,r])),
        byReplacement=new Map(replacements.map(r=>[r.operation_id,r])),byRepair=new Map(repairEvidence.map(r=>[r.operation_id,r])),firstTransfers=new Map<string,string>();
    for(const a of audits){const p=JSON.parse(a.payload_json);if(p.kind==='transferred'&&!firstTransfers.has(p.instanceId))firstTransfers.set(p.instanceId,p.detail.fromActorId);}
    const canonical=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
    const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
    let previous='0'.repeat(64),repairCount=0,replacementCount=0;const auditDigests:string[]=[],seen=new Set<string>(),versions=new Map<string,unknown>();
    const remember=(id:string,state:typeof states extends Map<string,infer S>?S:never)=>versions.set(`${id}:${state.revision}`,{
        itemInstanceId:id,lifecycleTypeId:state.row.lifecycle_type_id,itemId:state.row.item_id,ownerActorId:state.owner,durability:state.durability,
        maxDurability:state.row.max_durability,status:state.durability>0?'usable':'broken',qualityBasisPoints:state.row.quality_bps,
        provenanceDigest:state.row.provenance_digest,createdAtSimulationTime:state.row.created_at,updatedAtSimulationTime:state.updated,revision:state.revision});
    const create=(id:string,when:string,owner?:string)=>{
        const row=byId.get(id),definition=catalog.items.find(t=>t.lifecycleTypeId===row?.lifecycle_type_id);
        check(row&&definition&&!states.has(id)&&row.item_id===definition.itemId&&row.max_durability===definition.maxDurability
            &&row.created_at===when&&positive(row.quality_bps)&&row.quality_bps<=20000&&/^[a-f0-9]{64}$/.test(row.provenance_digest),'Invalid native instance creation');
        const initialOwner=owner??firstTransfers.get(id)??row.owner_actor_id;
        const value={row,owner:initialOwner,durability:definition.maxDurability,revision:1,updated:when,retired:false};states.set(id,value);remember(id,value);return value;
    };
    for(const [index,a] of audits.entries()){
        const p=JSON.parse(a.payload_json),d=p.detail,op=byOperation.get(p.operationId);
        check(a.sequence===index+1&&a.previous_hash===previous&&a.entry_hash===hash({previousHash:previous,payload:p})
            &&a.operation_id===p.operationId&&!seen.has(p.operationId)&&canonical(p.at)&&p.at<=at&&op
            &&op.kind===p.kind&&op.item_instance_id===p.instanceId&&op.occurred_at===p.at&&digest(JSON.parse(op.detail_json))===digest(d)
            &&op.request_digest===(d.requestDigest??hash(d)),'Invalid native lifecycle audit/operation');
        seen.add(p.operationId);previous=a.entry_hash;auditDigests.push(previous);
        if(p.kind==='created'){const state=create(p.instanceId,p.at);check(d.provenanceDigest===state.row.provenance_digest,'Creation provenance differs');continue;}
        const state=states.get(p.instanceId);check(state&&!state.retired&&p.at>=state.updated,'Native lifecycle state/order differs');
        const definition=catalog.items.find(t=>t.lifecycleTypeId===state.row.lifecycle_type_id)!;
        if(p.kind==='transferred'){
            check(d.fromActorId===state.owner&&typeof d.toActorId==='string'&&d.toActorId!==d.fromActorId&&/^[a-f0-9]{64}$/.test(d.evidenceDigest)
                &&d.requestDigest===hash({itemInstanceId:p.instanceId,expectedRevision:state.revision,fromActorId:d.fromActorId,toActorId:d.toActorId,evidenceDigest:d.evidenceDigest,at:p.at}),'Native transfer differs');
            state.owner=d.toActorId;
        }else if(p.kind==='replaced'){
            const r=byReplacement.get(p.operationId);
            check(state.durability===0&&r&&r.replaced_item_instance_id===p.instanceId&&r.replacement_item_instance_id===d.replacementItemInstanceId
                &&r.owner_actor_id===state.owner&&r.occurred_at===p.at&&r.evidence_digest===d.evidenceDigest,'Native replacement differs');
            const next=create(d.replacementItemInstanceId,p.at,state.owner);
            check(next.row.lifecycle_type_id===state.row.lifecycle_type_id&&next.row.provenance_digest===d.provenanceDigest&&/^[a-f0-9]{64}$/.test(d.evidenceDigest)
                &&d.requestDigest===hash({replacedId:p.instanceId,replacementId:d.replacementItemInstanceId,expectedRevision:state.revision,owner:state.owner,
                    qualityBasisPoints:next.row.quality_bps,provenanceDigest:d.provenanceDigest,evidenceDigest:d.evidenceDigest}),'Replacement type/provenance differs');
            state.retired=true;replacementCount++;
        }else{
            check(['used','repaired'].includes(p.kind)&&positive(d.amount)&&d.before===state.durability&&/^[a-f0-9]{64}$/.test(d.evidenceDigest)
                &&d.requestDigest===hash({kind:p.kind,instanceId:p.instanceId,expectedRevision:state.revision,amount:d.amount,evidenceDigest:d.evidenceDigest}),'Native tool delta differs');
            if(p.kind==='used')check(state.durability>0&&d.after===Math.max(0,state.durability-definition.wearPerUse*d.amount),'Native wear differs');
            else{
                const e=d.evidenceDetail,policy=repairs.policies.find(p=>p.policyId===e?.policyId);
                check(definition.repairable&&state.durability===0&&policy&&policy.lifecycleTypeId===definition.lifecycleTypeId&&e.policyDigest===repairs.digest
                    &&policy.restoredDurability===d.amount&&d.after===Math.min(definition.maxDurability,d.amount)
                    &&byRepair.get(p.operationId)?.material_receipt_id===e.materialReceiptId&&byRepair.get(p.operationId)?.receipt_digest===e.inputReceiptDigest,'Native repair policy/evidence differs');repairCount++;
            }
            state.durability=d.after;
        }
        state.revision++;state.updated=p.at;remember(p.instanceId,state);
    }
    check(states.size===instances.length&&operations.length===audits.length&&replacements.length===replacementCount&&repairEvidence.length===repairCount,'Unmatched native lifecycle rows');
    for(const state of states.values())check(state.row.owner_actor_id===state.owner&&state.row.durability===state.durability&&state.row.revision===state.revision
        &&state.row.updated_at===state.updated&&state.row.status===(state.durability>0?'usable':'broken'),'Native current lifecycle state differs from replay');
    const events=rows(db,'native_tool_event').map(r=>{const p=JSON.parse(r.payload);check(hash(p)===r.digest,'Native event digest differs');return{id:r.event_id,digest:r.digest,value:p};});
    const eventsById=new Map(events.map(e=>[e.id,e]));
    const bindings=rows(db,'native_tool_binding').map(r=>{const b=JSON.parse(r.payload) as NativeToolBinding,state=states.get(b.itemInstanceId);
        check(hash(b)===r.digest&&b.schemaVersion===1&&b.itemInstanceId===r.instance_id&&b.owner.actorId===r.actor_id&&b.owner.username===r.username
            &&b.catalogDigest===catalog.digest&&b.cycleDigest===cycles.digest&&['bound','quarantined'].includes(b.status)&&state
            &&b.owner.actorId===state.owner&&state.row.item_id===NATIVE_PICKAXE&&Number.isSafeInteger(b.position.inventory)&&Number.isSafeInteger(b.position.slot)&&b.position.slot>=0
            &&/^[a-f0-9]{64}$/.test(b.checkpointDigest),'Native tool binding differs');
        const opening=eventsById.get(`opening:${b.itemInstanceId}`)?.value;
        check(opening?.kind==='explicit-opening'&&opening.itemInstanceId===b.itemInstanceId&&opening.item.itemInstanceId===b.itemInstanceId
            &&digest(opening.item)===digest(versions.get(`${b.itemInstanceId}:${opening.item.revision}`))&&opening.owner.actorId===opening.item.ownerActorId
            &&opening.owner.worldId===b.owner.worldId&&opening.owner.clockId===b.owner.clockId&&opening.owner.clockProfileDigest===b.owner.clockProfileDigest
            &&/^[a-f0-9]{64}$/.test(opening.evidenceDigest),'Missing native instance opening');return b;
    });
    check(new Set(bindings.map(b=>b.owner.username)).size===bindings.length,'Duplicate native tool owner');
    return{instances:[...states.values()].map(s=>({itemInstanceId:String(s.row.item_instance_id),lifecycleTypeId:String(s.row.lifecycle_type_id),durability:s.durability,retired:s.retired})),bindings,auditDigests,
        events:events.map(({id,digest})=>({id,digest})),catalogDigest:catalog.digest,cycleDigest:cycles.digest};
}
