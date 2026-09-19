import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { competenceSnapshotDigest,satisfiesCompetence,validateCompetenceSnapshot } from '../character-attributes/index.js';
import type { CompetenceSnapshot } from '../character-attributes/index.js';
import { itemLifecycleCatalogDigest } from './catalog.js';
import { issueVerifiedRepairAuthorization } from './repair-authorization.js';
import { ItemLifecycleStore } from './store.js';
import type { ItemInstanceState,ItemLifecycleCatalog } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i,DIGEST=/^[0-9a-f]{64}$/;
export interface RepairMaterialRequirement{itemId:number;quantity:number}
export interface ItemRepairPolicyDefinition{policyId:string;lifecycleTypeId:string;requiredStatus:'broken';
    restoredDurability:number;durationSeconds:number;materials:RepairMaterialRequirement[];
    competence:{skillId:string;minimumLevel:number};facility:{capabilityId:string}|null}
export interface ItemRepairPolicyCatalog{schemaVersion:1;policies:ItemRepairPolicyDefinition[];digest:string}
export interface RepairMaterialReceipt{receiptId:string;actorId:string;itemInstanceId:string;consumedItems:RepairMaterialRequirement[];
    consumedAtSimulationTime:string;sourceEvidenceDigest:string}
export interface RepairFacilityReceipt{receiptId:string;actorId:string;capabilityId:string;providerId:string;grantId:string;
    validFromSimulationTime:string;validUntilSimulationTime:string;sourceEvidenceDigest:string}
export interface ItemRepairRequest{operationId:string;policyId:string;itemInstanceId:string;actorId:string;expectedRevision:number;
    startedAtSimulationTime:string;finishedAtSimulationTime:string;materialReceipt:RepairMaterialReceipt;
    competenceSnapshot:CompetenceSnapshot;facilityReceipt:RepairFacilityReceipt|null}

function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{if(Object.keys(value).sort().join(',')!==keys.sort().join(','))
    throw new Error(`${field} fields are invalid`);}
function timestamp(value:unknown,field:string):string{if(typeof value!=='string'||Number.isNaN(Date.parse(value))
    ||new Date(value).toISOString()!==value)throw new Error(`${field} is invalid`);return value;}
function identifier(value:unknown,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value;}
function materials(value:unknown,field:string):RepairMaterialRequirement[]{if(!Array.isArray(value)||value.length<1||value.length>20)
    throw new Error(`${field} is invalid`);const result=value.map((entry,index)=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))
        throw new Error(`${field}[${index}] is invalid`);const item=entry as Record<string,unknown>;exact(item,['itemId','quantity'],`${field}[${index}]`);
        if(!Number.isSafeInteger(item.itemId)||Number(item.itemId)<0||Number(item.itemId)>65_535
            ||!Number.isSafeInteger(item.quantity)||Number(item.quantity)<1||Number(item.quantity)>1_000_000)
            throw new Error(`${field}[${index}] is invalid`);return{itemId:Number(item.itemId),quantity:Number(item.quantity)};});
    if(new Set(result.map(item=>item.itemId)).size!==result.length)throw new Error(`${field} item ids must be unique`);
    return result.sort((a,b)=>a.itemId-b.itemId);}
export function itemRepairPolicyCatalogDigest(value:Omit<ItemRepairPolicyCatalog,'digest'>):string{return hash(value);}
export function validateItemRepairPolicyCatalog(value:unknown,lifecycle:ItemLifecycleCatalog):ItemRepairPolicyCatalog{
    const{digest:lifecycleDigest,...lifecycleDefinition}=lifecycle;
    if(lifecycleDigest!==itemLifecycleCatalogDigest(lifecycleDefinition))throw new Error('Item lifecycle catalog digest mismatch');
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Item repair policy catalog is invalid');
    const input=value as Record<string,unknown>;exact(input,['schemaVersion','policies'],'Item repair policy catalog');
    if(input.schemaVersion!==1||!Array.isArray(input.policies)||input.policies.length<1||input.policies.length>1_000)
        throw new Error('Item repair policy catalog is invalid');
    const lifecycleIds=new Set(lifecycle.items.filter(item=>item.repairable).map(item=>item.lifecycleTypeId));
    const policies:ItemRepairPolicyDefinition[]=input.policies.map((value,index)=>{const field=`policies[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);
        const policy=value as Record<string,unknown>;exact(policy,['policyId','lifecycleTypeId','requiredStatus','restoredDurability',
            'durationSeconds','materials','competence','facility'],field);
        const policyId=identifier(policy.policyId,`${field}.policyId`),lifecycleTypeId=identifier(policy.lifecycleTypeId,
            `${field}.lifecycleTypeId`);if(!lifecycleIds.has(lifecycleTypeId)||policy.requiredStatus!=='broken'
            ||!Number.isSafeInteger(policy.restoredDurability)||Number(policy.restoredDurability)<1
            ||Number(policy.restoredDurability)>1_000_000||!Number.isSafeInteger(policy.durationSeconds)
            ||Number(policy.durationSeconds)<1||Number(policy.durationSeconds)>86_400)throw new Error(`${field} is invalid`);
        if(!policy.competence||typeof policy.competence!=='object'||Array.isArray(policy.competence))throw new Error(`${field} is invalid`);
        const competence=policy.competence as Record<string,unknown>;exact(competence,['skillId','minimumLevel'],`${field}.competence`);
        const skillId=identifier(competence.skillId,`${field}.competence.skillId`);
        if(!Number.isSafeInteger(competence.minimumLevel)||Number(competence.minimumLevel)<1||Number(competence.minimumLevel)>99)
            throw new Error(`${field}.competence is invalid`);
        let facility:{capabilityId:string}|null=null;if(policy.facility!==null){if(!policy.facility||typeof policy.facility!=='object'
            ||Array.isArray(policy.facility))throw new Error(`${field}.facility is invalid`);const raw=policy.facility as Record<string,unknown>;
            exact(raw,['capabilityId'],`${field}.facility`);facility={capabilityId:identifier(raw.capabilityId,`${field}.facility.capabilityId`)};}
        return{policyId,lifecycleTypeId,requiredStatus:'broken',restoredDurability:Number(policy.restoredDurability),
            durationSeconds:Number(policy.durationSeconds),materials:materials(policy.materials,`${field}.materials`),
            competence:{skillId,minimumLevel:Number(competence.minimumLevel)},facility};});
    if(new Set(policies.map(policy=>policy.policyId)).size!==policies.length
        ||new Set(policies.map(policy=>policy.lifecycleTypeId)).size!==policies.length)
        throw new Error('Item repair policies must have unique ids and lifecycle bindings');
    const definition={schemaVersion:1 as const,policies};return{...definition,digest:itemRepairPolicyCatalogDigest(definition)};
}
export function loadItemRepairPolicyCatalog(path:string,lifecycle:ItemLifecycleCatalog):ItemRepairPolicyCatalog{
    return validateItemRepairPolicyCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown,lifecycle);}
export class ItemRepairService{
    constructor(private readonly store:ItemLifecycleStore,private readonly catalog:ItemRepairPolicyCatalog){}
    repair(request:ItemRepairRequest):ItemInstanceState{exact(request as unknown as Record<string,unknown>,['operationId','policyId',
        'itemInstanceId','actorId','expectedRevision','startedAtSimulationTime','finishedAtSimulationTime','materialReceipt',
        'competenceSnapshot','facilityReceipt'],'Item repair request');this.verifyCatalog();
        const policy=this.catalog.policies.find(item=>item.policyId===request.policyId);
        if(!policy)throw new Error('Unknown item repair policy');const item=this.store.get(request.itemInstanceId),
            replay=this.store.hasOperation(request.operationId);
        if(!item||item.lifecycleTypeId!==policy.lifecycleTypeId||item.ownerActorId!==request.actorId
            ||(item.status!==policy.requiredStatus&&!replay))
            throw new Error('Item is not eligible for this repair policy');
        const started=timestamp(request.startedAtSimulationTime,'Repair start'),finished=timestamp(request.finishedAtSimulationTime,'Repair finish');
        if((!replay&&Date.parse(started)<Date.parse(item.updatedAtSimulationTime))
            ||Date.parse(finished)-Date.parse(started)<policy.durationSeconds*1_000)
            throw new Error('Repair duration is insufficient');
        const materialReceipt=this.materialReceipt(request.materialReceipt,request,policy,item,replay);
        const competence=this.competence(request.competenceSnapshot,request.actorId,policy,started);
        const facility=this.facility(request.facilityReceipt,request.actorId,policy,started,finished,competence);
        const evidence={policyId:policy.policyId,policyDigest:this.catalog.digest,materialReceiptId:materialReceipt.receiptId,
            inputReceiptDigest:hash(materialReceipt),
            competenceSnapshotDigest:competence.digest,facilityReceiptDigest:facility?hash(facility):'0'.repeat(64),
            startedAtSimulationTime:started};
        return this.store.applyVerifiedRepair(issueVerifiedRepairAuthorization({operationId:request.operationId,
            itemInstanceId:request.itemInstanceId,expectedRevision:request.expectedRevision,
            restoredDurability:policy.restoredDurability,atSimulationTime:finished,evidence}));}
    private verifyCatalog():void{const{digest,...definition}=this.catalog;
        if(digest!==itemRepairPolicyCatalogDigest(definition))throw new Error('Item repair policy catalog digest mismatch');}
    private materialReceipt(value:RepairMaterialReceipt,request:ItemRepairRequest,policy:ItemRepairPolicyDefinition,
        item:ItemInstanceState,replay:boolean):RepairMaterialReceipt{if(!value||typeof value!=='object'||Array.isArray(value))
        throw new Error('Material receipt is invalid');
        const raw=value as unknown as Record<string,unknown>;exact(raw,['receiptId','actorId','itemInstanceId','consumedItems',
            'consumedAtSimulationTime','sourceEvidenceDigest'],'Material receipt');const consumedAt=timestamp(value.consumedAtSimulationTime,
            'Material consumption time'),consumed=materials(value.consumedItems,'Material receipt consumedItems');
        if(identifier(value.receiptId,'Material receipt id')===''||value.actorId!==request.actorId
            ||value.itemInstanceId!==request.itemInstanceId||JSON.stringify(consumed)!==JSON.stringify(policy.materials)
            ||!DIGEST.test(value.sourceEvidenceDigest)||(!replay&&Date.parse(consumedAt)<Date.parse(item.updatedAtSimulationTime))
            ||Date.parse(consumedAt)>Date.parse(request.startedAtSimulationTime))throw new Error('Material receipt is invalid');
        return{...value,consumedItems:consumed,consumedAtSimulationTime:consumedAt};}
    private competence(snapshot:CompetenceSnapshot,actorId:string,policy:ItemRepairPolicyDefinition,started:string):CompetenceSnapshot{
        if(!snapshot||typeof snapshot!=='object')throw new Error('Repair competence evidence is invalid');
        const{digest,...definition}=snapshot,validated=validateCompetenceSnapshot(definition);
        if(digest!==competenceSnapshotDigest(definition)||validated.characterAgentId!==actorId
            ||Date.parse(validated.observedAtSimulationTime)>Date.parse(started)||!satisfiesCompetence(validated,{kind:'personal-rs-skill',
                skillId:policy.competence.skillId,minimumLevel:policy.competence.minimumLevel}))
            throw new Error('Repair competence evidence is invalid');return validated;}
    private facility(value:RepairFacilityReceipt|null,actorId:string,policy:ItemRepairPolicyDefinition,started:string,finished:string,
        competence:CompetenceSnapshot):RepairFacilityReceipt|null{if(!policy.facility){if(value!==null)throw new Error('Facility receipt is unexpected');return null;}
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Repair facility evidence is invalid');
        const raw=value as unknown as Record<string,unknown>;exact(raw,['receiptId','actorId','capabilityId','providerId','grantId',
            'validFromSimulationTime','validUntilSimulationTime','sourceEvidenceDigest'],'Facility receipt');
        const from=timestamp(value.validFromSimulationTime,'Facility validity start'),until=timestamp(value.validUntilSimulationTime,
            'Facility validity end');const granted=competence.providedCapabilities.some(capability=>capability.capabilityId===policy.facility!.capabilityId
                &&capability.provider.kind==='facility'&&capability.provider.providerId===value.providerId&&capability.grantId===value.grantId);
        if(identifier(value.receiptId,'Facility receipt id')===''||value.actorId!==actorId||value.capabilityId!==policy.facility.capabilityId
            ||!ID.test(value.providerId)||!ID.test(value.grantId)||!DIGEST.test(value.sourceEvidenceDigest)||!granted
            ||Date.parse(from)>Date.parse(started)||Date.parse(until)<Date.parse(finished))
            throw new Error('Repair facility evidence is invalid');return{...value,validFromSimulationTime:from,validUntilSimulationTime:until};}
}
