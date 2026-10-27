import type { Database } from 'bun:sqlite';
import { NativeMaterialStore } from '../production-workflow/native-material.js';
import type { NativeToolWorkRecord } from '../production-workflow/native-tool-work.js';
import { nativeSmeltRecipe,nativeToolWorkPolicy } from '../production-workflow/native-tool-work-policy.js';
import { nativeToolDigest as hash } from '../item-lifecycle/native-tool.js';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { PlayerInventoryEscrowStore } from '../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { outcomeRows as rows,outcomeCheck as check } from './outcome-work.js';

/** Join a prospective physical lot journal to independently checked native effects and actual material escrow. */
export function readToolMaterialOrigin(db:Database,jobs:NativeToolWorkRecord[],events:Map<string,{id:string;digest:string;value:any}>,
    verifiedUseIds:Set<string>,identity:(owner:any)=>boolean){
    if(!NativeMaterialStore.present(db))return null;
    const source=NativeMaterialStore.read(db),byJob=new Map(jobs.map(j=>[j.intent.operationId,j])),verifiedLots=new Map<string,{from:string;digests:string[]}>(),
        repairOrigins=new Map<string,{from:string;digests:string[]}>();
    for(const name of ['player_inventory_escrow','player_inventory_escrow_audit','player_inventory_escrow_business_binding']){
        // An empty, pre-baseline journal does not require work/escrow tables to exist yet.
        if(source.holds.size)rows(db,name);
    }
    const escrow=source.holds.size?new PlayerInventoryEscrowStore({db,checkpoint(){throw Error('Readonly material source');}},true):null,
        purposes=new Map(source.holds.size?rows(db,'player_inventory_escrow_business_binding').map(r=>[r.escrow_id,r.binding_digest]):[]),
        consumes=new Map<string,any[]>();
    if(source.holds.size)for(const row of rows(db,'player_inventory_escrow_audit'))if(row.operation==='consume'){
        const list=consumes.get(row.escrow_id)??[];list.push(row);consumes.set(row.escrow_id,list);}
    const holdProofs=new Map<string,{from:string;digests:string[]}|null>();
    for(const entry of source.entries){const f=entry.fact;if(!identity(f.owner))continue;
        if(f.kind==='hold'){
            const job=byJob.get(f.operationId),held=escrow!.get(f.escrowId),spent=consumes.get(f.escrowId)??[],completed=job?.phase==='completed';
            check(job&&job.intent.kind===f.workKind&&hash(job.intent.owner)===hash(f.owner)&&job.intentDigest===f.intentDigest
                &&job.intent.escrowId===f.escrowId&&hash(job.started)===hash(f.clock)&&job.intent.policyDigest===nativeToolWorkPolicy.digest
                &&held&&held.username===f.owner.username&&held.payeeUsername===null&&held.error===null&&held.createdAt===job.started.wallTime
                &&purposes.get(f.escrowId)===f.intentDigest&&digest(held.assets)===digest({gp:0,items:f.inputs.map(i=>({id:i.itemId,count:1}))}),
                'Native material hold/WIP differs');
            const expectedConsumed=f.workKind==='repair'||completed;
            check(spent.length===(expectedConsumed?1:0)&&held!.status===(expectedConsumed?'committed':'held')
                &&(!expectedConsumed||spent[0].occurred_at===(f.workKind==='repair'?job!.started.wallTime:job!.last.clock.wallTime)),
                'Native material consumption differs');
            const initial=f.workKind==='repair'?held:{...held!,status:'held',committedAt:null,updatedAt:held!.createdAt};
            check(hash(initial)===job!.materialDigest,'Native material initial custody differs');
            const ancestry=f.inputs.map(i=>i.lotId===null?undefined:verifiedLots.get(i.lotId));
            const proof=ancestry.every(a=>!!a)?{from:ancestry.map(a=>a!.from).sort()[0]!,
                digests:[entry.digest,...ancestry.flatMap(a=>a!.digests)]}:null;
            holdProofs.set(f.operationId,proof);if(f.workKind==='repair'&&proof)repairOrigins.set(f.operationId,proof);
        }else{
            const event=events.get(f.nativeEventId),effect=event?.value;
            check(event&&event.digest===f.nativeEventDigest,'Native material effect source differs');
            if(f.kind==='mining'){
                check(verifiedUseIds.has(f.nativeEventId)&&effect.kind==='mined'&&hash(effect.source.owner)===hash(f.owner)
                    &&hash(effect.source.clock)===hash(f.clock)&&effect.source.outputItemId===f.itemId&&effect.source.outputQuantity===1,
                    'Native material mining proof differs');
                verifiedLots.set(f.lotId,{from:f.clock.simulationTime,digests:[entry.digest,event!.digest]});
            }else{
                const job=byJob.get(f.operationId);
                check(job?.phase==='completed'&&job.intent.kind==='smelt'&&effect.kind==='smelted'&&hash(effect.intent)===job.intentDigest
                    &&hash(effect.result)===hash(job.result)&&hash(effect.clock)===hash(f.clock)&&hash(job.last.clock)===hash(f.clock)
                    &&hash(f.owner)===hash(job.intent.owner)&&effect.materialDigest===job.materialDigest
                    &&effect.workSimulationMs===job.progressMs&&job.progressMs===nativeSmeltRecipe.durationSimulationMinutes*60000
                    &&effect.nativeWorkTicks===job.workTicks&&job.workTicks>=nativeToolWorkPolicy.smelt.durationTicks
                    &&job.result?.script==='[queue,smelting_ore]'&&job.result.tool===null
                    &&digest(job.result.inputItems)===digest([{id:436,count:1},{id:438,count:1}])
                    &&digest(job.result.outputItems)===digest([{id:2349,count:1}]),'Native material smelt proof differs');
                const proof=holdProofs.get(f.operationId);if(proof)verifiedLots.set(f.lotId,{from:proof.from,digests:[entry.digest,event!.digest,...proof.digests]});
            }
        }
    }
    return{sourceId:source.sourceId,head:source.head,repairOrigins};
}
