import { createHash } from 'node:crypto';

import { businessRoleHasPermission, resolveBusinessRole, type BusinessRoleCatalog } from '../business-roles/index.js';
import type { FacilityCapabilityAuthorization } from '../facility-capability/index.js';
import { logisticsCatalogDigest } from './catalog.js';
import type { LogisticsAuthorityEvidence, LogisticsCargo, LogisticsCatalog, LogisticsPlan, LogisticsRequest } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{0,127}$/,DIGEST=/^[0-9a-f]{64}$/;
export type LogisticsAuthorityVerifier=(evidence:LogisticsAuthorityEvidence)=>boolean;
export type VehicleFacilityVerifier=(authorization:FacilityCapabilityAuthorization)=>boolean;
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function cargo(values:LogisticsCargo[]):LogisticsCargo[]{if(values.length<1||values.length>1_000)throw new Error('Logistics cargo is invalid');
    const result=values.map(value=>{if(!Number.isSafeInteger(value.itemId)||value.itemId<0||value.itemId>65_535
        ||!Number.isSafeInteger(value.count)||value.count<1||value.count>2_147_483_647)throw new Error('Logistics cargo is invalid');
        return{itemId:value.itemId,count:value.count}}).sort((a,b)=>a.itemId-b.itemId);
    if(new Set(result.map(value=>value.itemId)).size!==result.length)throw new Error('Logistics cargo item ids must be unique');return result}
export function planLogisticsShipment(catalog:LogisticsCatalog,roles:BusinessRoleCatalog,request:LogisticsRequest,
    authority:LogisticsAuthorityEvidence,vehicleFacilityAuthorization:FacilityCapabilityAuthorization|null,
    verifyAuthority?:LogisticsAuthorityVerifier,verifyVehicleFacility?:VehicleFacilityVerifier):LogisticsPlan{
    const{digest,...definition}=catalog;if(digest!==logisticsCatalogDigest(definition))throw new Error('Logistics catalog digest mismatch');
    const route=catalog.routes.find(value=>value.routeId===request.routeId),mode=catalog.carrierModes.find(value=>value.carrierModeId===request.carrierModeId);
    if(!route||!mode||!ID.test(request.businessId)||!ID.test(request.actorAgentId))throw new Error('Logistics request is invalid');
    const from=catalog.locations.find(value=>value.locationId===route.fromLocationId)!,to=catalog.locations.find(value=>value.locationId===route.toLocationId)!;
    const normalizedCargo=cargo(request.cargo),cargoUnits=normalizedCargo.reduce((sum,value)=>sum+value.count,0);
    if(!Number.isSafeInteger(cargoUnits)||cargoUnits>mode.capacityUnits)throw new Error('Logistics carrier capacity exceeded');
    const role=resolveBusinessRole(roles,authority.roleDefinitionId);
    if(!businessRoleHasPermission(role,'logistics','operate')||authority.businessId!==request.businessId
        ||authority.actorAgentId!==request.actorAgentId||authority.sourcePropertyId!==from.propertyId
        ||authority.sourceStorageId!==from.storageId||authority.targetPropertyId!==to.propertyId
        ||authority.targetStorageId!==to.storageId||!ID.test(authority.evidenceId)||!ID.test(authority.sourceStorageEntitlementId)
        ||!ID.test(authority.targetStorageEntitlementId)||!DIGEST.test(authority.sourceEvidenceDigest)
        ||!Number.isFinite(Date.parse(authority.validAt))||!verifyAuthority?.(authority))throw new Error('Logistics authority is invalid');
    if(mode.kind==='vehicle'){if(!vehicleFacilityAuthorization||vehicleFacilityAuthorization.subjectAgentId!==request.actorAgentId
            ||vehicleFacilityAuthorization.propertyId!==from.propertyId
            ||vehicleFacilityAuthorization.capabilityId!==mode.requiredFacilityCapabilityId
            ||!verifyVehicleFacility?.(vehicleFacilityAuthorization))throw new Error('Vehicle facility entitlement is invalid');
    }else if(vehicleFacilityAuthorization!==null)throw new Error('Pedestrian shipment cannot claim vehicle authority');
    const durationSimulationMinutes=Math.ceil(route.distanceTiles/mode.speedTilesPerSimulationMinute),
        variableCost=Math.ceil(route.distanceTiles*mode.costGpPer100Tiles/100),costGp=mode.fixedCostGp+variableCost;
    if(!Number.isSafeInteger(costGp))throw new Error('Logistics cost exceeds safe bounds');
    const planWithoutDigest={businessId:request.businessId,actorAgentId:request.actorAgentId,routeId:route.routeId,from,to,
        carrierModeId:mode.carrierModeId,carrierKind:mode.kind,cargo:normalizedCargo,cargoUnits,capacityUnits:mode.capacityUnits,
        durationSimulationMinutes,costGp,authorityEvidenceId:authority.evidenceId,vehicleFacilityAuthorization,
        catalogDigest:catalog.digest};return{...planWithoutDigest,planDigest:hash(planWithoutDigest)}}
