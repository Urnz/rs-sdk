import type { Database } from 'bun:sqlite';
import { loadSocietyMinimumContract } from '../society-minimum/contract.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { nativeToolDigest as hash,nativeToolCycles } from '../item-lifecycle/native-tool.js';
import { productionToolReceiptDigest } from '../item-lifecycle/production-cycle.js';
import { NativeToolWorkStore } from '../production-workflow/native-tool-work.js';
import { nativeRepairPolicy,nativeRepairPolicies,nativeToolWorkPolicy } from '../production-workflow/native-tool-work-policy.js';
import { PlayerInventoryEscrowStore } from '../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { readToolCapacityLedger } from './tool-capacity-ledger.js';
import { outcomeCheck as check,outcomeRows as rows,outcomeTime as time,readNativeWorkerEvidence,type OutcomeActor } from './outcome-work.js';
import type { EvaluationScope } from './evaluation.js';
import { readToolMaterialOrigin } from './tool-material-origin.js';

/** Mechanical evidence and material consumption are separate from fungible input origin.
 * A nearby smelt receipt or matching inventory quantity never establishes lot ancestry. */
export function readNativeToolMaintenance(db:Database,scope:EvaluationScope,worldId:string,actors:OutcomeActor[],configDirectory:string){
    const contract=loadSocietyMinimumContract(configDirectory),from=time(scope.fromSimulationTime),to=time(scope.toSimulationTime);
    check(to>from&&actors.length===scope.actorAgentIds.length&&new Set(actors.map(a=>a.agentId)).size===actors.length
        &&actors.every(a=>scope.actorAgentIds.includes(a.agentId)),'Invalid maintenance actor scope');
    const selected=new Map(actors.map(a=>[a.agentId,a]));
    const identity=(owner:any)=>{const a=selected.get(owner?.actorId);if(!a)return false;
        check(owner.worldId===worldId&&owner.clockId===scope.clockId&&owner.clockProfileDigest===scope.clockProfileDigest
            &&owner.username===a.username&&owner.lifecycleId===a.lifecycleId,'Maintenance owner/world/lifecycle differs');return true;};
    const within=(at:string)=>time(at)>from&&time(at)<=to;
    // Replay the entire available ledger; later history cannot be mistaken for a selected-window cycle.
    const ledger=readToolCapacityLedger(db,contract,configDirectory,'9999-12-31T23:59:59.999Z');
    const work=readNativeWorkerEvidence(db,scope,worldId,actors),jobs=NativeToolWorkStore.present(db)?NativeToolWorkStore.read(db):[];
    const operations=new Map<string,any>(ledger.history.map(e=>[e.operationId,e]));
    const events=new Map(ledger.nativeEvents.map(e=>[e.id,e]));
    const usesByAfter=new Map<string,any>(),usesByBefore=new Map<string,any>(),verifiedUseIds=new Set<string>();
    for(const event of ledger.nativeEvents){const e=event.value;if(e.kind!=='mined'||!identity(e.source?.owner))continue;
        const s=e.source,cycle=nativeToolCycles.cycles.find(c=>c.lifecycleTypeId===e.before?.lifecycleTypeId),op=operations.get(event.id);
        check(cycle&&s.actionId===event.id&&s.clock.clockId===scope.clockId&&s.clock.profileDigest===scope.clockProfileDigest&&s.clock.status==='running'
            &&Number.isSafeInteger(s.clock.engineTick)&&s.clock.engineTick>=0&&s.outputQuantity===1&&cycle.outputItemIds.includes(s.outputItemId)
            &&/^[a-f0-9]{64}$/.test(s.checkpointDigest)&&e.lifecycleAuditValid===true&&op?.kind==='used'&&op.detail.amount===1
            &&op.instanceId===e.before.itemInstanceId&&op.at===s.clock.simulationTime&&e.before.ownerActorId===s.owner.actorId
            &&e.after.revision===e.before.revision+1&&digest(e.before)===digest(ledger.versions.get(`${op.instanceId}:${e.before.revision}`))
            &&digest(e.after)===digest(ledger.versions.get(`${op.instanceId}:${e.after.revision}`))
            &&op.detail.evidenceDigest===productionToolReceiptDigest({receiptId:event.id,cycleId:cycle.cycleId,itemInstanceId:op.instanceId,
                actorId:s.owner.actorId,expectedRevision:e.before.revision,skillName:'Mining',successfulActions:1,outputItemId:s.outputItemId,
                outputQuantity:1,sourceEvidenceDigest:hash(s),atSimulationTime:s.clock.simulationTime}),'Native maintenance use proof differs');
        usesByAfter.set(`${op.instanceId}:${e.after.revision}`,event);usesByBefore.set(`${op.instanceId}:${e.before.revision}`,event);
        verifiedUseIds.add(event.id);
    }
    const materialSource=readToolMaterialOrigin(db,jobs,events,verifiedUseIds,identity);
    const candidates:Array<{operationId:string;cycleId:string;itemInstanceId:string;actorAgentId:string;at:string;
        wearEventId:string|null;reuseEventId:string|null;mechanicalCycleComplete:boolean;materialConsumption:'verified';
        inputOrigin:'internal'|'unproven';originFromSimulationTime:string|null;qualifiesMinimum:boolean;evidenceDigests:string[];gaps:string[]}>=[];
    const repairJobs=jobs.filter(j=>j.intent.kind==='repair'&&j.phase==='completed'&&identity(j.intent.owner)&&within(j.last.clock.simulationTime));
    if(repairJobs.length){
        for(const name of ['player_inventory_escrow','player_inventory_escrow_audit','player_inventory_escrow_business_binding'])rows(db,name);
        // Readonly constructor verifies the existing chain and never creates schema or checkpoints.
        const escrow=new PlayerInventoryEscrowStore({db,checkpoint(){throw Error('Readonly maintenance source');}},true);
        const purposes=new Map(rows(db,'player_inventory_escrow_business_binding').map(r=>[r.escrow_id,r.binding_digest]));
        const consumed=new Map<string,any[]>();for(const r of rows(db,'player_inventory_escrow_audit')){
            if(r.operation==='consume'){const list=consumed.get(r.escrow_id)??[];list.push(r);consumed.set(r.escrow_id,list);}}
        for(const job of repairJobs){const intent=job.intent,id=intent.itemInstanceId!,op=operations.get(intent.operationId),event=events.get(`work:${intent.operationId}`),
            effect=event?.value,result=job.result!,e=op?.detail.evidenceDetail,held=escrow.get(intent.escrowId),consumption=consumed.get(intent.escrowId);
            const material={receiptId:intent.escrowId,actorId:intent.owner.actorId,itemInstanceId:id,consumedItems:nativeRepairPolicy.materials,
                consumedAtSimulationTime:job.started.simulationTime,sourceEvidenceDigest:job.materialDigest};
            const authorization={operationId:intent.operationId,itemInstanceId:id,expectedRevision:intent.expectedRevision!,
                restoredDurability:nativeRepairPolicy.restoredDurability,atSimulationTime:job.last.clock.simulationTime,evidence:e};
            check(op?.kind==='repaired'&&op.instanceId===id&&op.at===job.last.clock.simulationTime&&intent.policyDigest===nativeToolWorkPolicy.digest
                &&e?.policyId===nativeRepairPolicy.policyId&&e.policyDigest===nativeRepairPolicies.digest&&e.startedAtSimulationTime===job.started.simulationTime
                &&e.materialReceiptId===intent.escrowId&&e.inputReceiptDigest===digest(material)&&op.detail.evidenceDigest===hash(authorization)
                &&intent.expectedRevision!==null&&digest(result.tool)===digest(ledger.versions.get(`${id}:${intent.expectedRevision+1}`))
                &&result.tool?.ownerActorId===intent.owner.actorId&&result.kind==='repair'&&result.tool.durability===nativeRepairPolicy.restoredDurability
                &&digest(result.inputItems)===digest([{id:2349,count:1}])&&result.outputItems.length===0&&result.script===null
                &&held?.status==='committed'&&held.username===intent.owner.username&&held.payeeUsername===null&&held.error===null
                &&digest(held.assets)===digest({gp:0,items:[{id:2349,count:1}]})&&hash(held)===job.materialDigest
                &&purposes.get(intent.escrowId)===job.intentDigest&&consumption?.length===1
                &&consumption[0].occurred_at===job.started.wallTime&&held.committedAt===job.started.wallTime
                &&effect?.kind==='repaired'&&effect.materialDigest===job.materialDigest&&hash(effect.intent)===job.intentDigest
                &&hash(effect.result)===hash(result)&&effect.clock.simulationTime===op.at
                &&job.progressMs===nativeRepairPolicy.durationSeconds*1000&&effect.workSimulationMs===job.progressMs
                &&/^[a-f0-9]{64}$/.test(result.checkpointDigest),'Native maintenance repair/material proof differs');
            const wear=usesByAfter.get(`${id}:${intent.expectedRevision}`),reuse=usesByBefore.get(`${id}:${intent.expectedRevision!+1}`),
                wearValid=!!wear&&wear.value.after.durability===0&&within(wear.value.source.clock.simulationTime)
                    &&wear.value.source.clock.simulationTime<=job.started.simulationTime&&hash(wear.value.source.owner)===hash(intent.owner),
                reuseValid=!!reuse&&within(reuse.value.source.clock.simulationTime)&&reuse.value.source.clock.simulationTime>=op.at
                    &&hash(reuse.value.source.owner)===hash(intent.owner);
            const origin=materialSource?.repairOrigins.get(intent.operationId);
            candidates.push({operationId:intent.operationId,cycleId:'bronze-pickaxe-mining',itemInstanceId:id,actorAgentId:intent.owner.actorId,at:op.at,
                wearEventId:wearValid?wear.id:null,reuseEventId:reuseValid?reuse.id:null,mechanicalCycleComplete:wearValid&&reuseValid,
                materialConsumption:'verified',inputOrigin:origin?'internal':'unproven',originFromSimulationTime:origin?.from??null,qualifiesMinimum:wearValid&&reuseValid&&!!origin,
                evidenceDigests:[...new Set([op.digest,event!.digest,job.intentDigest,job.materialDigest,...(wearValid?[wear.digest]:[]),...(reuseValid?[reuse.digest]:[]),...(origin?.digests??[])])],
                gaps:[...(!wearValid?['No exact native breakage in the evaluation window.']:[]),...(!reuseValid?['No exact native reuse after this repair in the evaluation window.']:[]),
                    ...(!origin?['Consumed bronze has no verified prospective lot/custody ancestry.']:[])]});
        }
    }
    const body={protocol:'native-tool-maintenance-v1',scope,worldId,contractDigest:contract.digest,candidates,
        materialSource:materialSource?{sourceId:materialSource.sourceId,head:materialSource.head}:null,replacementCoverage:'unproven',completeCoverage:false,
        sourceDigests:[digest(ledger.auditDigests),digest(ledger.events),digest(work)],
        meaning:'Exact native wear/repair/reuse, audited consumption and prospective physical material ancestry; legacy/copied/reloaded unknown inputs and replacement remain unproved.'};
    return{...body,digest:digest(body)};
}
