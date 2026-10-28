import type {Database} from 'bun:sqlite';
import {readFoodLineage,type FoodLineageFact} from '../server/engine/src/mods/NativeFoodLineageStore.js';
import {readFoodDeliveries} from '../server/engine/src/mods/NativeFoodDeliveryStore.js';
import {readFoodResult,foodDigest} from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import {assertFoodProductionSchema,readFoodProductionReceipt} from '../server/engine/src/mods/NativeFoodProductionStore.js';
import {readNativeKitchen} from '../server/engine/src/mods/NativeKitchenStore.js';
import {projectFoodLineage} from '../food-loop/lineage.js';
import {NativeMaterialStore} from '../production-workflow/native-material.js';
import {NativeToolWorkStore} from '../production-workflow/native-tool-work.js';
import {readNativeToolMaintenance} from './tool-maintenance.js';
import {societyMinimumDigest as digest} from '../society-minimum/policy.js';
import type {EvaluationScope} from './evaluation.js';
import type {MortalityActor} from '../population-lifecycle/native-coverage.js';
import type {NativeTrade} from '../external-trade/source.js';

/** Verified native facts only. Coverage of their producer window is established separately by native policy seals. */
export function readLineageEvidence(db:Database,scope:EvaluationScope,worldId:string,founders:MortalityActor[],trades:NativeTrade[],configDirectory:string,
    openingProof?:(fact:Extract<FoodLineageFact,{kind:'opening'}>)=>boolean){
    const gaps=new Set<string>(),violations:Array<{source:string;eventId:string;reason:string}>=[],people=new Map(founders.map(f=>[f.actorId,f]));
    const identity=(a:{actorId:string;username:string;lifecycleId:string;worldId:string})=>a.worldId===worldId&&people.get(a.actorId)?.username===a.username&&people.get(a.actorId)?.lifecycleId===a.lifecycleId;
    const inWindow=(c:{clockId:string;profileDigest:string;simulationTime:string})=>c.clockId===scope.clockId&&c.profileDigest===scope.clockProfileDigest
        &&c.simulationTime>=scope.fromSimulationTime&&c.simulationTime<=scope.toSimulationTime;
    const attempt=<T>(name:string,run:()=>T):T|null=>{try{return run();}catch{gaps.add(`${name}-unavailable`);return null;}};
    const food=attempt('food-lineage',()=>{
        const journal=readFoodLineage(db),delivery=readFoodDeliveries(db),projection=projectFoodLineage(journal),witnesses=new Set(journal.entries.map(e=>e.sourceKey));
        for(const gap of projection.gaps)gaps.add('food-balance-or-custody-gap');
        assertFoodProductionSchema(db);const production=(db.query('SELECT action_id FROM native_food_production_actions').all() as {action_id:string}[]).map(r=>{
            const receipt=readFoodProductionReceipt(db,r.action_id);if(!receipt||!witnesses.has(`production:${r.action_id}`))gaps.add('unclosed-or-unwitnessed-production');return receipt;});
        for(const row of db.query('SELECT action_id FROM native_food_actions').all() as {action_id:string}[]){const result=readFoodResult(db,row.action_id);
            if(!result||!witnesses.has(`consumption:${row.action_id}`)||!delivery.entries.some(d=>d.actionId===row.action_id))gaps.add('unclosed-or-unwitnessed-final-use');}
        const byTrade=new Map(trades.map(t=>[t.event.eventId,t.event]));
        for(const entry of journal.entries){const f=entry.fact;
            if(f.kind==='opening'){if(!identity(f.custodian)||f.mutation.actor!==`player:${f.custodian.username}`||!openingProof?.(f))gaps.add('unbound-opening-origin');continue;}
            if(f.kind==='transfer'){if(foodDigest(byTrade.get(f.trade.eventId))!==foodDigest(f.trade))throw Error('Native trade differs');
                if(f.sides.some(s=>!identity(s.custodian)))violations.push({source:'food-transfer',eventId:f.trade.eventId,reason:'food-custody-outside-original-cohort'});continue;}
            const result=f.kind==='production'?f.receipt:f.result,action=result.action,c=f.kind==='production'?f.receipt.clock:delivery.entries.find(d=>d.actionId===action.actionId)?.clock;
            if(!c||!inWindow(c)){gaps.add('food-clock-or-window');continue;}
            if(!identity(action))violations.push({source:'food-production-or-use',eventId:action.actionId,reason:'native-food-identity-outside-original-cohort'});
        }
        for(const t of trades)if([...t.event.fromItems,...t.event.toItems].some(i=>[377,379,381].includes(i.id??-1))&&!witnesses.has(`trade:${t.event.eventId}`))gaps.add('unwitnessed-food-trade');
        if(delivery.entries.some(e=>e.legacy||!e.clock||!inWindow(e.clock)))gaps.add('unbound-food-delivery');
        if(!delivery.watermark||!inWindow(delivery.watermark.clock)||delivery.watermark.clock.simulationTime!==scope.toSimulationTime)gaps.add('food-closing-watermark');
        const kitchenReceipts=production.filter(r=>r?.custody);if(kitchenReceipts.length){const kitchen=readNativeKitchen(db);
            if(kitchenReceipts.some(r=>!kitchen.some(k=>foodDigest(k.receipt)===foodDigest(r))))gaps.add('native-business-food-custody');}
        const chains=projection.consumptions.filter(c=>c.origin==='internal'&&identity(c.consumer)&&c.gatherers.length&&c.cooks.length
            &&[...c.gatherers,...c.cooks].every(id=>people.has(id))&&[...c.gatherers,...c.cooks].some(id=>id!==c.consumer.actorId));
        if(projection.consumptions.some(c=>c.origin==='unknown'||c.origin==='mixed'))gaps.add('unproven-consumed-food-origin');
        return{journalDigest:digest(journal),head:{sequence:journal.entries.length,digest:projection.headDigest},chains:chains.map(c=>({actionId:c.actionId,consumer:c.consumer.actorId,sourceKeys:c.sourceKeys,
            at:delivery.entries.find(d=>d.actionId===c.actionId)!.clock!.simulationTime})),
            consumed:projection.consumptions.length};
    });
    const foodComplete=!!food&&!gaps.size,toolGapsBefore=new Set(gaps);
    const tools=attempt('tool-lineage',()=>{
        const maintenance=readNativeToolMaintenance(db,scope,worldId,founders.map(f=>({agentId:f.actorId,username:f.username,lifecycleId:f.lifecycleId})),configDirectory),
            materials=NativeMaterialStore.read(db),jobs=NativeToolWorkStore.read(db),events=db.query('SELECT event_id,payload FROM native_tool_event ORDER BY rowid').all() as {event_id:string;payload:string}[];
        for(const e of events){const effect=JSON.parse(e.payload),owner=effect.source?.owner??effect.intent?.owner??effect.owner;
            if(owner&&!identity(owner))violations.push({source:'tool-production',eventId:e.event_id,reason:'native-tool-identity-outside-original-cohort'});
            if(effect.kind==='mined'&&!materials.entries.some(m=>m.fact.kind==='mining'&&m.fact.nativeEventId===e.event_id))gaps.add('unwitnessed-native-material-output');}
        if(jobs.some(j=>!identity(j.intent.owner)||!inWindow(j.started)||!inWindow(j.last.clock)))gaps.add('tool-job-original-window');
        for(const e of materials.entries)if(!identity(e.fact.owner)||!inWindow(e.fact.clock))gaps.add('material-original-window');
        if(materials.entries.some(e=>e.fact.kind==='hold'&&e.fact.inputs.some(i=>i.lotId===null)))gaps.add('unproven-held-material-origin');
        if(maintenance.candidates.some(c=>c.inputOrigin!=='internal'))gaps.add('unproven-repair-input-origin');
        if((db.query('SELECT payload_json FROM item_lifecycle_audit').all() as {payload_json:string}[]).some(r=>JSON.parse(r.payload_json).kind==='replaced'))gaps.add('unproven-replacement-origin');
        return{maintenanceDigest:maintenance.digest,materialHead:materials.head,cycles:maintenance.candidates.filter(c=>c.qualifiesMinimum).map(c=>c.operationId)};
    });
    return{food,tools,completeFoodEvidence:foodComplete,completeToolEvidence:!!tools&&[...gaps].every(g=>toolGapsBefore.has(g)),gaps:[...gaps].sort(),violations};
}
