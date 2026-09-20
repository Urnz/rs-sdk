import { describe, expect, test } from 'bun:test';

import { loadDefaultBusinessRoleCatalog } from '../../business-roles/index.js';
import { loadDefaultFacilityCapabilityCatalog, type FacilityCapabilityAuthorization } from '../../facility-capability/index.js';
import { loadDefaultLogisticsCatalog, planLogisticsShipment, validateLogisticsCatalog } from '../index.js';
import type { LogisticsAuthorityEvidence, LogisticsRequest } from '../index.js';

const walking:LogisticsRequest={businessId:'varrock-smiths',actorAgentId:'courier-1',routeId:'varrock-workshop-to-falador-south',
    carrierModeId:'courier.walking',cargo:[{itemId:1265,count:28}]};
const authority:LogisticsAuthorityEvidence={evidenceId:'logistics-access-1',businessId:'varrock-smiths',actorAgentId:'courier-1',
    roleDefinitionId:'business.worker.v1',sourcePropertyId:'varrock.east-workshop',sourceStorageId:'varrock.east-workshop.loading-bay',
    sourceStorageEntitlementId:'source-storage-grant',targetPropertyId:'falador.south-house',
    targetStorageId:'falador.south-house.delivery',targetStorageEntitlementId:'target-storage-grant',
    validAt:'2030-01-01T00:00:00.000Z',sourceEvidenceDigest:'a'.repeat(64)};
const vehicleFacility:FacilityCapabilityAuthorization={subjectAgentId:'courier-1',facilityId:'varrock.east-workshop.forge',
    capabilityId:'logistics.cart-bay',at:'2030-01-01T00:00:00.000Z',propertyId:'varrock.east-workshop',businessId:null,
    capacityUnits:1,grantId:'cart-bay-grant',accessKind:'employment',sourceEvidenceId:'cart-bay-evidence',
    catalogDigest:loadDefaultFacilityCapabilityCatalog().digest};

describe('bounded logistics planning',()=>{
    test('plans a pedestrian courier with exact capacity, route, time and cost',()=>{const plan=planLogisticsShipment(
        loadDefaultLogisticsCatalog(),loadDefaultBusinessRoleCatalog(),walking,authority,null,()=>true);
        expect(plan).toMatchObject({carrierKind:'pedestrian',cargoUnits:28,capacityUnits:28,
            durationSimulationMinutes:10,costGp:13,from:{propertyId:'varrock.east-workshop'},to:{propertyId:'falador.south-house'}});
        expect(plan.planDigest).toHaveLength(64)});
    test('plans a larger handcart only with role and Property facility authority',()=>{const plan=planLogisticsShipment(
        loadDefaultLogisticsCatalog(),loadDefaultBusinessRoleCatalog(),{...walking,carrierModeId:'vehicle.handcart',
            cargo:[{itemId:1265,count:100}]},authority,vehicleFacility,()=>true,()=>true);
        expect(plan).toMatchObject({carrierKind:'vehicle',cargoUnits:100,capacityUnits:120,
            durationSimulationMinutes:5,costGp:24,vehicleFacilityAuthorization:{capabilityId:'logistics.cart-bay'}})});
    test('rejects excess cargo, unentitled vehicles, weak roles and foreign storage evidence',()=>{const catalog=loadDefaultLogisticsCatalog(),
        roles=loadDefaultBusinessRoleCatalog();
        expect(()=>planLogisticsShipment(catalog,roles,{...walking,cargo:[{itemId:1265,count:29}]},authority,null,()=>true))
            .toThrow('capacity');
        expect(()=>planLogisticsShipment(catalog,roles,{...walking,carrierModeId:'vehicle.handcart'},authority,null,()=>true,()=>true))
            .toThrow('Vehicle');
        expect(()=>planLogisticsShipment(catalog,roles,walking,{...authority,roleDefinitionId:'business.shop-clerk.v1'},null,()=>true))
            .toThrow('authority');
        expect(()=>planLogisticsShipment(catalog,roles,walking,{...authority,sourceStorageId:'foreign-storage'},null,()=>true))
            .toThrow('authority')});
    test('rejects unknown Property and facility bindings in configuration',()=>{const catalog=loadDefaultLogisticsCatalog(),
        raw={schemaVersion:catalog.schemaVersion,locations:structuredClone(catalog.locations),routes:catalog.routes,
            carrierModes:structuredClone(catalog.carrierModes)},properties=new Set(['varrock.east-workshop','falador.south-house']);
        raw.locations[0]!.propertyId='missing-property';expect(()=>validateLogisticsCatalog(raw,properties,new Set(['logistics.cart-bay'])))
            .toThrow('unknown Property');raw.locations[0]!.propertyId='varrock.east-workshop';
        raw.carrierModes[1]!.requiredFacilityCapabilityId='logistics.ship-dock';
        expect(()=>validateLogisticsCatalog(raw,properties,new Set(['logistics.cart-bay']))).toThrow('facility binding')});
});
