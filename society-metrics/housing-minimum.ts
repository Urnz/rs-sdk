import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import type { SocietyMinimumContract } from '../society-minimum/contract.js';
import type { MinimumCell } from '../society-minimum/assessment.js';
import { rentIds } from '../housing/native-rent.js';
import type { NativeIntegrationSources } from './integration-sources.js';
import type { HousingAccessPoint } from './housing-access.js';
import type { FoodActorContext } from './food-minimum.js';
import type { EvaluationScope } from './evaluation.js';

function access(p:HousingAccessPoint,at:number){
    const lower=new Set<string>(),upper=new Set<string>(),active=(from:string,to:string)=>Date.parse(from)<=at&&at<Date.parse(to);
    for(const actor of p.cohort)if(!actor.active)upper.add(actor.binding.actorId);
    for(const unit of p.catalogs.units.units){
        const tier=p.catalogs.hierarchy.tiers.find(t=>t.tierId===unit.tierId);
        if(!unit.enabled||!tier||tier.rank<p.minimumTierRank)continue;
        if(unit.housingUnitId!==p.catalogs.native.housingUnitId){for(const actor of p.cohort)upper.add(actor.binding.actorId);continue;}
        const property=p.properties.find(v=>v.property_id===unit.propertyId),definition=p.propertyDefinitions.find(v=>v.propertyId===unit.propertyId);
        if(!property||!definition){for(const actor of p.cohort)upper.add(actor.binding.actorId);continue;}
        const slots=new Map<string,Set<string>>();
        const occupy=(bed:string,id:string)=>{const ids=slots.get(bed)??new Set<string>();ids.add(id);slots.set(bed,ids);};
        for(const order of p.orders){const i=order.binding.intent;if(i.housingUnitId===unit.housingUnitId&&['active','reserved'].includes(order.phase)&&active(i.startsAt,i.endsAt)){
            occupy(i.bedSlotId,rentIds(i.operationId).tenancyId);if(order.phase==='active')upper.add(i.tenant.agentId);
        }}
        for(const t of p.tenancies)if(t.housing_unit_id===unit.housingUnitId&&['active','arrears'].includes(t.status)&&active(t.starts_at,t.ends_at)){
            occupy(t.bed_slot_id,t.tenancy_id);upper.add(t.tenant_agent_id); // A plain contract is potential access, never paid native lower credit.
        }
        for(const b of p.ownerReservations??[]){const i=b.intent;if(i.housingUnitId===unit.housingUnitId&&active(i.startsAt,i.endsAt))
            occupy(i.bedSlotId,`owner:${i.operationId}`);}
        for(const grant of p.grants)if(grant.unitId===unit.housingUnitId&&active(grant.from,grant.to)){
            const actor=p.cohort.find(a=>a.binding.actorId===grant.actor.agentId&&a.binding.playerId===grant.actor.username&&a.binding.lifecycleId===grant.actor.lifecycleId);
            if(actor?.active&&slots.get(grant.bedId)?.size===1)lower.add(grant.actor.agentId);
            upper.add(grant.actor.agentId);
        }
        const free=unit.bedSlots.some(b=>!slots.has(b.bedSlotId));
        const owner=property.status==='owned'&&property.owner_kind==='player'?p.cohort.find(a=>a.binding.playerId===property.owner_id):undefined;
        if(owner&&free&&definition.permissions.enter.some(r=>r==='owner'||r==='everyone')){
            if(owner.active)lower.add(owner.binding.actorId);upper.add(owner.binding.actorId);
        }
        // Unmodelled public/visitor/employee rights cannot be treated as proven homelessness.
        if(definition.permissions.enter.some(r=>!['owner','admin'].includes(r)))for(const actor of p.cohort)upper.add(actor.binding.actorId);
    }
    for(const id of lower)upper.add(id);return{lowerActorIds:[...lower].sort(),upperActorIds:[...upper].sort()};
}
/** Stable versions/append-only heads prove unchanged authority; no interpolation across changes, failed points or excessive gaps. */
export function projectHousingMinimum(scope:EvaluationScope,worldId:string,source:NativeIntegrationSources['housingAccess']){
    const points=source.status==='available'?[...source.value.points].sort((a,b)=>a.at.localeCompare(b.at)):[];
    const intervals:Array<{from:number;to:number;cohort:HousingAccessPoint['cohort'];lowerActorIds:string[];upperActorIds:string[]}>=[],gaps:Array<{from:string;to:string;reason:string}>=[];
    const valid=points.flatMap(p=>p.source.status==='available'?[p.source.value]:[]);
    for(let index=1;index<points.length;index++){
        const a=points[index-1]!,b=points[index]!;
        const left=a.source.status==='available'?a.source.value:null,right=b.source.status==='available'?b.source.value:null;
        const from=Date.parse(a.at),to=Date.parse(b.at);
        if(!left||!right||left.worldId!==worldId||right.worldId!==worldId||left.clockId!==scope.clockId||right.clockId!==scope.clockId
            ||left.clockProfileDigest!==scope.clockProfileDigest||right.clockProfileDigest!==scope.clockProfileDigest||left.contractDigest!==right.contractDigest
            ||left.epochDigest!==right.epochDigest||digest(left.cohort)!==digest(right.cohort)||to-from>left.maximumGapSimulationMs||to<=from){
            gaps.push({from:a.at,to:b.at,reason:'Missing point, authority/membership change or observation gap; interval unknown.'});continue;
        }
        const times=[from,to,...left.grants.flatMap(g=>[Date.parse(g.from),Date.parse(g.to)]),...left.tenancies.flatMap(t=>[Date.parse(t.starts_at),Date.parse(t.ends_at)]),
            ...left.orders.flatMap(o=>[Date.parse(o.binding.intent.startsAt),Date.parse(o.binding.intent.endsAt)])];
        const cuts=[...new Set(times.filter(t=>t>=from&&t<=to))].sort((x,y)=>x-y);
        for(let i=1;i<cuts.length;i++)intervals.push({from:cuts[i-1]!,to:cuts[i]!,cohort:left.cohort,...access(left,cuts[i-1]!)});
    }
    const body={protocol:'native-legal-housing-exposure-v1',scope,worldId,contractDigest:valid[0]?.contractDigest??null,intervals,gaps,
        boundaryTimes:points.map(p=>p.at),sourceDigest:source.status==='available'?source.digest:null,
        meaning:'Capacity-backed legal access under pinned native policy, separate from sleep. Unknown authority intervals never become uncovered or covered time.'};
    return{...body,digest:digest(body)};
}
export function housingExposureCells(contract:SocietyMinimumContract,report:ReturnType<typeof projectHousingMinimum>,isOriginal:(a:FoodActorContext)=>boolean,deathAt:(id:string)=>string|null):MinimumCell[]{
    const cells:MinimumCell[]=[],start=Date.parse(report.scope.fromSimulationTime),bucket=contract.policy.window.bucketSimulationMilliseconds;
    for(const actorId of report.scope.actorAgentIds){
        const intervals=report.intervals.filter(i=>{const c=i.cohort.find(a=>a.binding.actorId===actorId);return c&&isOriginal(c);}),death=deathAt(actorId),end=death?Date.parse(death):start+contract.policy.window.evaluationSimulationMilliseconds;
        for(let index=0;index<contract.policy.window.evaluationSimulationMilliseconds/bucket;index++){
            const from=start+index*bucket,to=Math.min(from+bucket,end),denominator=to-from;if(denominator<=0)continue;
            const overlap=(i:typeof intervals[number])=>Math.max(0,Math.min(to,i.to)-Math.max(from,i.from));
            const observed=intervals.reduce((n,i)=>n+overlap(i),0);if(!observed)continue;
            const lower=intervals.filter(i=>i.lowerActorIds.includes(actorId)).reduce((n,i)=>n+overlap(i),0),absent=intervals.filter(i=>!i.upperActorIds.includes(actorId)).reduce((n,i)=>n+overlap(i),0);
            cells.push({requirementId:'legal-housing-access-time',subject:{actorAgentId:actorId,bucket:index},opportunity:'positive',
                lower:{numerator:String(lower*10000),denominator:String(denominator)},upper:{numerator:String((denominator-absent)*10000),denominator:String(denominator)},evidenceDigests:[report.digest]});
        }
    }
    return cells;
}
