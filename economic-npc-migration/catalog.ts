import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { EconomicNpcMigrationCandidate,EconomicNpcMigrationCatalog,EconomicNpcMigrationStage,
    EconomicNpcReadinessGate } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/i,PATH=/^[a-z0-9_./-]{1,240}$/i;
const STAGES:EconomicNpcMigrationStage[]=['audit','shadow-accounting','finite-pilot','cutover'];
const GATES=['legacy-stock-price-audit','persistent-identities','property-entitlement','finite-bootstrap-assets',
    'atomic-sale-settlement','procurement-replenishment','shadow-reconciliation','rollback-drill'];
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]));}
function exact(value:Record<string,unknown>,keys:string[],field:string):void{
    if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error(`${field} is invalid`);}
function identifier(value:unknown,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value;}
export function economicNpcMigrationCatalogDigest(value:Omit<EconomicNpcMigrationCatalog,'digest'>):string{
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
export function validateEconomicNpcMigrationCatalog(value:unknown):EconomicNpcMigrationCatalog{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Economic NPC migration catalog is invalid');
    const input=value as Record<string,unknown>;exact(input,['schemaVersion','activation','candidates'],'Economic NPC migration catalog');
    if(input.schemaVersion!==1||input.activation!=='planning-only'||!Array.isArray(input.candidates)
        ||input.candidates.length<1||input.candidates.length>1_000)throw new Error('Economic NPC migration catalog is invalid');
    const candidates:EconomicNpcMigrationCandidate[]=input.candidates.map((value,index)=>{const field=`candidates[${index}]`;
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${field} is invalid`);const candidate=value as Record<string,unknown>;
        exact(candidate,['migrationId','serviceKind','status','legacy','target','stages','readinessGates'],field);
        if(!['shop','repair','hospitality','transport'].includes(String(candidate.serviceKind))||candidate.status!=='planned'
            ||!Array.isArray(candidate.stages)||JSON.stringify(candidate.stages)!==JSON.stringify(STAGES)
            ||!Array.isArray(candidate.readinessGates)||candidate.readinessGates.length<1||candidate.readinessGates.length>100)
            throw new Error(`${field} is invalid`);
        if(!candidate.legacy||typeof candidate.legacy!=='object'||Array.isArray(candidate.legacy))throw new Error(`${field}.legacy is invalid`);
        const legacy=candidate.legacy as Record<string,unknown>;exact(legacy,['npcTypeIds','sharedInventoryId','sourcePaths'],`${field}.legacy`);
        if(!Array.isArray(legacy.npcTypeIds)||legacy.npcTypeIds.length<1||legacy.npcTypeIds.length>100
            ||legacy.npcTypeIds.some(value=>typeof value!=='string'||!ID.test(value))
            ||new Set(legacy.npcTypeIds).size!==legacy.npcTypeIds.length
            ||(legacy.sharedInventoryId!==null&&(typeof legacy.sharedInventoryId!=='string'||!ID.test(legacy.sharedInventoryId)))
            ||!Array.isArray(legacy.sourcePaths)||legacy.sourcePaths.length<1||legacy.sourcePaths.length>20
            ||legacy.sourcePaths.some(value=>typeof value!=='string'||!PATH.test(value)||value.includes('..')))
            throw new Error(`${field}.legacy is invalid`);
        if(!candidate.target||typeof candidate.target!=='object'||Array.isArray(candidate.target))throw new Error(`${field}.target is invalid`);
        const target=candidate.target as Record<string,unknown>;
        exact(target,['businessId','institutionAgentId','ownerAgentId','propertyId','treasuryActorId'],`${field}.target`);
        const readinessGates:EconomicNpcReadinessGate[]=candidate.readinessGates.map((value,gateIndex)=>{
            const gateField=`${field}.readinessGates[${gateIndex}]`;if(!value||typeof value!=='object'||Array.isArray(value))
                throw new Error(`${gateField} is invalid`);const gate=value as Record<string,unknown>;
            exact(gate,['gateId','status','requiredEvidence'],gateField);if(gate.status!=='pending'||typeof gate.requiredEvidence!=='string'
                ||!gate.requiredEvidence.trim()||gate.requiredEvidence.length>240)throw new Error(`${gateField} is invalid`);
            return{gateId:identifier(gate.gateId,`${gateField}.gateId`),status:'pending',requiredEvidence:gate.requiredEvidence.trim()};});
        if(new Set(readinessGates.map(gate=>gate.gateId)).size!==readinessGates.length)throw new Error(`${field} readiness gates must be unique`);
        if(JSON.stringify(readinessGates.map(gate=>gate.gateId).sort())!==JSON.stringify([...GATES].sort()))
            throw new Error(`${field} required readiness gates are incomplete`);
        return{migrationId:identifier(candidate.migrationId,`${field}.migrationId`),serviceKind:candidate.serviceKind as
            EconomicNpcMigrationCandidate['serviceKind'],status:'planned',legacy:{npcTypeIds:legacy.npcTypeIds as string[],
                sharedInventoryId:legacy.sharedInventoryId as string|null,sourcePaths:legacy.sourcePaths as string[]},
            target:{businessId:identifier(target.businessId,`${field}.target.businessId`),
                institutionAgentId:identifier(target.institutionAgentId,`${field}.target.institutionAgentId`),
                ownerAgentId:identifier(target.ownerAgentId,`${field}.target.ownerAgentId`),
                propertyId:identifier(target.propertyId,`${field}.target.propertyId`),
                treasuryActorId:identifier(target.treasuryActorId,`${field}.target.treasuryActorId`)},
            stages:[...STAGES],readinessGates};});
    if(new Set(candidates.map(candidate=>candidate.migrationId)).size!==candidates.length)
        throw new Error('Economic NPC migrations must have unique ids');
    const legacyKeys=candidates.flatMap(candidate=>candidate.legacy.npcTypeIds.map(npc=>`${candidate.serviceKind}:${npc}`));
    if(new Set(legacyKeys).size!==legacyKeys.length)throw new Error('Legacy economic NPC bindings must be unique');
    const targetBusinessIds=candidates.map(candidate=>candidate.target.businessId);
    if(new Set(targetBusinessIds).size!==targetBusinessIds.length)throw new Error('Target Business bindings must be unique');
    const institutionAgentIds=candidates.map(candidate=>candidate.target.institutionAgentId),
        treasuryActorIds=candidates.map(candidate=>candidate.target.treasuryActorId);
    if(new Set(institutionAgentIds).size!==institutionAgentIds.length)
        throw new Error('Target institution agent bindings must be unique');
    if(new Set(treasuryActorIds).size!==treasuryActorIds.length)
        throw new Error('Target treasury bindings must be unique');
    const definition={schemaVersion:1 as const,activation:'planning-only' as const,candidates};
    return{...definition,digest:economicNpcMigrationCatalogDigest(definition)};}
export function loadEconomicNpcMigrationCatalog(path:string):EconomicNpcMigrationCatalog{
    return validateEconomicNpcMigrationCatalog(JSON.parse(readFileSync(path,'utf8')) as unknown);}
export function resolveEconomicNpcMigration(catalog:EconomicNpcMigrationCatalog,migrationId:string):EconomicNpcMigrationCandidate{
    const{digest,...definition}=catalog;if(digest!==economicNpcMigrationCatalogDigest(definition))
        throw new Error('Economic NPC migration catalog digest mismatch');
    const candidate=catalog.candidates.find(item=>item.migrationId===migrationId);
    if(!candidate)throw new Error(`Economic NPC migration ${migrationId} is not planned`);return candidate;}
