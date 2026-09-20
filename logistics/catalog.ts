import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDefaultFacilityCapabilityCatalog } from '../facility-capability/index.js';
import type { LogisticsCarrierMode, LogisticsCatalog, LogisticsLocation, LogisticsRoute } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
function record(value:unknown,field:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error(`${field} must be an object`);return value as Record<string,unknown>}
function exact(value:Record<string,unknown>,fields:string[],field:string):void{if(Object.keys(value).sort().join(',')!==[...fields].sort().join(','))
    throw new Error(`${field} fields are invalid`)}
function id(value:unknown,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value}
function integer(value:unknown,field:string,minimum:number,maximum=2_147_483_647):number{if(!Number.isSafeInteger(value)||Number(value)<minimum
    ||Number(value)>maximum)throw new Error(`${field} is invalid`);return Number(value)}
function text(value:unknown,field:string):string{if(typeof value!=='string'||!value.trim()||value.length>120)throw new Error(`${field} is invalid`);
    return value.trim()}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]))}
export function logisticsCatalogDigest(value:Omit<LogisticsCatalog,'digest'>):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
export function validateLogisticsCatalog(value:unknown,knownPropertyIds:ReadonlySet<string>,
    knownFacilityCapabilities:ReadonlySet<string>):LogisticsCatalog{const input=record(value,'Logistics catalog');
    exact(input,['schemaVersion','locations','routes','carrierModes'],'Logistics catalog');
    if(input.schemaVersion!==1||!Array.isArray(input.locations)||!Array.isArray(input.routes)||!Array.isArray(input.carrierModes)
        ||input.locations.length<2||input.locations.length>1_000||input.routes.length<1||input.routes.length>10_000
        ||input.carrierModes.length<2||input.carrierModes.length>100)throw new Error('Logistics catalog is invalid');
    const locations:LogisticsLocation[]=input.locations.map((entry,index)=>{const field=`locations[${index}]`,location=record(entry,field);
        exact(location,['locationId','label','propertyId','storageId'],field);const propertyId=id(location.propertyId,`${field}.propertyId`);
        if(!knownPropertyIds.has(propertyId))throw new Error(`${field}.propertyId references an unknown Property`);
        return{locationId:id(location.locationId,`${field}.locationId`),label:text(location.label,`${field}.label`),propertyId,
            storageId:id(location.storageId,`${field}.storageId`)}});
    if(new Set(locations.map(location=>location.locationId)).size!==locations.length)throw new Error('Logistics location ids must be unique');
    const locationIds=new Set(locations.map(location=>location.locationId));
    const routes:LogisticsRoute[]=input.routes.map((entry,index)=>{const field=`routes[${index}]`,route=record(entry,field);
        exact(route,['routeId','fromLocationId','toLocationId','distanceTiles'],field);const fromLocationId=id(route.fromLocationId,
            `${field}.fromLocationId`),toLocationId=id(route.toLocationId,`${field}.toLocationId`);
        if(fromLocationId===toLocationId||!locationIds.has(fromLocationId)||!locationIds.has(toLocationId))
            throw new Error(`${field} endpoint is invalid`);return{routeId:id(route.routeId,`${field}.routeId`),fromLocationId,toLocationId,
            distanceTiles:integer(route.distanceTiles,`${field}.distanceTiles`,1,1_000_000)}});
    const carrierModes:LogisticsCarrierMode[]=input.carrierModes.map((entry,index)=>{const field=`carrierModes[${index}]`,mode=record(entry,field);
        exact(mode,['carrierModeId','kind','capacityUnits','speedTilesPerSimulationMinute','fixedCostGp','costGpPer100Tiles',
            'requiredFacilityCapabilityId'],field);if(mode.kind!=='pedestrian'&&mode.kind!=='vehicle')throw new Error(`${field}.kind is invalid`);
        const requiredFacilityCapabilityId=mode.requiredFacilityCapabilityId===null?null:id(mode.requiredFacilityCapabilityId,
            `${field}.requiredFacilityCapabilityId`);if(mode.kind==='pedestrian'&&requiredFacilityCapabilityId!==null
            ||mode.kind==='vehicle'&&(!requiredFacilityCapabilityId||!knownFacilityCapabilities.has(requiredFacilityCapabilityId)))
            throw new Error(`${field} facility binding is invalid`);
        return{carrierModeId:id(mode.carrierModeId,`${field}.carrierModeId`),kind:mode.kind,
            capacityUnits:integer(mode.capacityUnits,`${field}.capacityUnits`,1,1_000_000),
            speedTilesPerSimulationMinute:integer(mode.speedTilesPerSimulationMinute,`${field}.speedTilesPerSimulationMinute`,1,1_000_000),
            fixedCostGp:integer(mode.fixedCostGp,`${field}.fixedCostGp`,0),costGpPer100Tiles:integer(mode.costGpPer100Tiles,
                `${field}.costGpPer100Tiles`,0),requiredFacilityCapabilityId}});
    if(new Set(routes.map(route=>route.routeId)).size!==routes.length||new Set(carrierModes.map(mode=>mode.carrierModeId)).size!==carrierModes.length)
        throw new Error('Logistics route and carrier ids must be unique');
    const definition={schemaVersion:1 as const,locations,routes,carrierModes};return{...definition,digest:logisticsCatalogDigest(definition)}}
export function loadDefaultLogisticsCatalog():LogisticsCatalog{const root=join(import.meta.dir,'..','config');
    const properties=JSON.parse(readFileSync(join(root,'properties.json'),'utf8')) as{properties:Array<{propertyId:string}>};
    const facilities=loadDefaultFacilityCapabilityCatalog();return validateLogisticsCatalog(
        JSON.parse(readFileSync(join(root,'logistics.json'),'utf8')) as unknown,new Set(properties.properties.map(property=>property.propertyId)),
        new Set(facilities.facilities.flatMap(facility=>facility.capabilities.map(capability=>capability.capabilityId))))}
