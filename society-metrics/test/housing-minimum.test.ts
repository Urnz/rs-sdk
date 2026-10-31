import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import { assessSocietyMinimum } from '../../society-minimum/assessment.js';
import { nativeHousingCatalogs,rentIds } from '../../housing/native-rent.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import { projectHousingMinimum,housingExposureCells } from '../housing-minimum.js';
import {foodDigest} from '../../server/engine/src/mods/NativeFoodConsumptionStore.js';
import type { HousingAccessPoint } from '../housing-access.js';
const root=join(import.meta.dir,'../..'),contract=loadSocietyMinimumContract(join(root,'config'));
const scope={clockId:'clock',clockProfileDigest:'a'.repeat(64),actorAgentIds:['ada','bea','cora','dora'],
    fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
const at=(hours:number)=>new Date(Date.parse(scope.fromSimulationTime)+hours*3600000).toISOString();
// Controlled projection input only. The SQLite reader and original-founder adapter are exercised separately.
function point(hour:number):HousingAccessPoint{
    const catalogs=nativeHousingCatalogs(root),unit=catalogs.units.units.find(u=>u.housingUnitId===catalogs.native.housingUnitId)!;
    return{at:at(hour),worldId:'world',clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,contractDigest:contract.digest,
        maximumGapSimulationMs:contract.policy.window.maximumTraceGapSimulationMilliseconds,
        minimumTierRank:contract.dependencies.housingHierarchy.tiers.find(t=>t.tierId===contract.policy.housing.minimumTierId)!.rank,
        catalogs,cohort:scope.actorAgentIds.map(actorId=>({binding:{worldId:'world',actorId,playerId:actorId,lifecycleId:`life-${actorId}`,
            clockId:scope.clockId,clockProfileDigest:scope.clockProfileDigest,worldProfileDigest:'b'.repeat(64),lifecyclePolicyDigest:'c'.repeat(64)},
            admission:{kind:'genesis',evidenceId:'fixture',evidenceDigest:'c'.repeat(64)},initializedAt:at(-24),active:true})),
        properties:[{property_id:unit.propertyId,status:'owned',owner_kind:'player',owner_id:'ada',version:2,updated_at:at(-24)}],
        propertyDefinitions:loadPropertyCatalog(join(root,'config/properties.json')).properties,orders:[],tenancies:[],grants:[],epochDigest:'d'.repeat(64),sourceDigests:['e'.repeat(64)]};
}
const wrapped=(p:HousingAccessPoint)=>({at:p.at,source:{status:'available' as const,value:p,digest:'f'.repeat(64)}});
function report(points:ReturnType<typeof wrapped>[]){return projectHousingMinimum(scope,'world',{status:'available',digest:'e'.repeat(64),value:{points}});}
function cells(r:ReturnType<typeof report>,original=()=>true,death=(_id:string):string|null=>null){return housingExposureCells(contract,r,original,death);}
function verdict(r:ReturnType<typeof report>){return assessSocietyMinimum(contract,{...scope,contractDigest:contract.digest,worldId:'world',founderAgentIds:scope.actorAgentIds,
    genesisAppliedAtSimulationTime:at(-24)},cells(r),[]).requirements.find(v=>v.requirementId==='legal-housing-access-time')!;}
function paid(p:HousingAccessPoint,actor='bea',operationId='rent-fixture',bedIndex=0){
    const unit=p.catalogs.units.units[0]!,bed=unit.bedSlots[bedIndex]!.bedSlotId;
    p.grants.push({actor:{agentId:actor,username:actor,lifecycleId:`life-${actor}`},unitId:unit.housingUnitId,bedId:bed,from:at(0),to:at(24)});
    p.tenancies.push({tenancy_id:rentIds(operationId).tenancyId,housing_unit_id:unit.housingUnitId,bed_slot_id:bed,tenant_agent_id:actor,status:'active',
        starts_at:at(0),ends_at:at(24),next_rent_due_at:at(24),rent_gp_per_period:500,rent_period_minutes:1440,arrears_gp:0,unit_catalog_digest:p.catalogs.units.digest,revision:1});
}
test('hourly unchanged native authority gives owner time; visitors remain unknown and endpoint-only evidence cannot PASS',()=>{
    const r=report(Array.from({length:169},(_,i)=>wrapped(point(i)))),c=cells(r);
    expect(c.filter(c=>c.subject.actorAgentId==='ada').every(c=>c.lower!.numerator==='864000000000')).toBeTrue();
    expect(verdict(r).cells.filter(c=>c.subject.actorAgentId==='ada').every(c=>c.verdict==='pass')).toBeTrue();
    expect(verdict(r).verdict).toBe('inconclusive');expect(c.find(c=>c.subject.actorAgentId==='dora')!.lower!.numerator).toBe('0');
    expect(cells(report([wrapped(point(0)),wrapped(point(168))]))).toHaveLength(0);
});
test('paid native tenancy receives daily lower credit and multiple claims on the same physical bed cannot share that credit',()=>{
    const points=Array.from({length:25},(_,i)=>{const p=point(i);paid(p);return wrapped(p);});
    expect(verdict(report(points)).cells.find(c=>c.subject.actorAgentId==='bea'&&c.subject.bucket===0)!.verdict).toBe('pass');
    for(const p of points)paid(p.source.value,'cora','rent-conflict');
    expect(cells(report(points)).filter(c=>c.subject.actorAgentId==='bea'||c.subject.actorAgentId==='cora').every(c=>c.lower!.numerator==='0')).toBeTrue();
});
test('lease expiry cuts the interval exactly; access is separate from sleep and a plain unpaid contract is upper-only',()=>{
    const points=[0,1].map(h=>{const p=point(h);paid(p);p.grants[0]!.to=at(.5);p.tenancies[0]!.ends_at=at(.5);return wrapped(p);});
    const bea=cells(report(points)).find(c=>c.subject.actorAgentId==='bea')!;expect(bea.lower!.numerator).toBe('18000000000');
    for(const p of points)p.source.value.grants=[];
    expect(cells(report(points)).find(c=>c.subject.actorAgentId==='bea')!.lower!.numerator).toBe('0');
});
test('two reserved physical beds cannot also give their owner lower capacity credit',()=>{
    const points=[0,1].map(h=>{const p=point(h);paid(p,'bea','rent-bea',0);paid(p,'cora','rent-cora',1);return wrapped(p);});
    const interval=report(points).intervals[0]!;expect(interval.lowerActorIds).toEqual(['bea','cora']);
    expect(interval.upperActorIds).toContain('ada'); // Visitor policy remains unknown, never a third proven place.
});

test('an exclusive owner reservation consumes physical capacity and gives owner access only through its verified grant',()=>{
    const points=[0,1].map(h=>{const p=point(h);paid(p,'bea','rent-bea',0);const unit=p.catalogs.units.units[0]!,bed=unit.bedSlots[1]!.bedSlotId,
        intent={operationId:'owner-period',worldId:p.worldId,clockId:p.clockId,clockProfileDigest:p.clockProfileDigest,
            owner:{agentId:'ada',username:'ada',lifecycleId:'life-ada'},housingUnitId:unit.housingUnitId,bedSlotId:bed,propertyVersion:2,
            startsAt:at(0),endsAt:at(24),catalogs:p.catalogs};
        p.ownerReservations=[{intent,digest:foodDigest(intent)}];p.grants.push({actor:intent.owner,unitId:unit.housingUnitId,bedId:bed,from:at(0),to:at(24)});return wrapped(p);});
    expect(report(points).intervals[0]!.lowerActorIds).toEqual(['ada','bea']);
    for(const p of points){p.source.value.grants=p.source.value.grants.filter(g=>g.actor.agentId!=='ada');}
    expect(report(points).intervals[0]!.lowerActorIds).toEqual(['bea']);
});
test('a rejected middle point, changed owner/version/head/cohort or long gap cannot be interpolated',()=>{
    const base=point(0);
    for(const change of [(p:HousingAccessPoint)=>{p.epochDigest='1'.repeat(64);},(p:HousingAccessPoint)=>{p.cohort[0]!.active=false;},
        (p:HousingAccessPoint)=>{p.clockId='foreign';},(p:HousingAccessPoint)=>{p.contractDigest='2'.repeat(64);}]){
        const p=point(1);change(p);expect(cells(report([wrapped(base),wrapped(p)]))).toHaveLength(0);
    }
    const invalid={at:at(.5),source:{status:'invalid',reason:'invalid'}} as any;
    expect(cells(report([wrapped(base),invalid,wrapped(point(1))]))).toHaveLength(0);
});
test('known missing access can FAIL despite unobserved time; unknown visitors never count as homelessness',()=>{
    const points=[0,1,2].map(h=>{const p=point(h);p.propertyDefinitions.forEach(d=>d.permissions.enter=['owner','admin']);return wrapped(p);});
    expect(verdict(report(points)).verdict).toBe('fail');
    expect(verdict(report([0,1,2].map(h=>wrapped(point(h))))).verdict).toBe('inconclusive');
});
test('death clips founder exposure rather than dropping the founder; no time after death or for a foreign admission is credited',()=>{
    const r=report([0,1,2].map(h=>wrapped(point(h)))),c=cells(r,()=>true,id=>id==='ada'?at(1):null);
    const ada=c.filter(c=>c.subject.actorAgentId==='ada');expect(ada).toHaveLength(1);expect(ada[0]!.lower).toEqual({numerator:'36000000000',denominator:'3600000'});
    expect(cells(r,()=>false)).toHaveLength(0);expect(cells(r,()=>true,()=>at(0))).toHaveLength(0);
});
