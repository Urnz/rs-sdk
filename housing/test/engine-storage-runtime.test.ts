import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';
import type { PropertyView } from '../../server/engine/src/mods/PropertyRuntime.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog, loadHousingUnitCatalog,
    loadFurnishingCatalog } from '../config.js';
import { loadEngineHousingStorageLocations, resolveEngineHousingStorageAccess,
    type EngineHousingStorageRuntimeDependencies } from '../engine-storage-runtime.js';
import { FurnishingPlacementStore } from '../furnishing-store.js';
import { loadStorageSurfaceBindings } from '../placed-storage-security.js';
import { loadHousingSecurityPolicy } from '../security.js';

const roots: string[] = [], config = join(import.meta.dir, '..', '..', 'config');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
const properties = loadPropertyCatalog(join(config,'properties.json'));
const hierarchy = loadHousingTierPolicyCatalog(join(config,'housing-tier-policies.json')).policies[0]!;
const effects = loadHousingEffectPolicyCatalog(join(config,'housing-effect-policies.json'),hierarchy).policies[0]!;
const units = loadHousingUnitCatalog(join(config,'housing-units.json'),hierarchy,
    new Set(properties.properties.map(value=>value.propertyId)));
const furnishings = loadFurnishingCatalog(join(config,'housing-furnishings.json'),
    new Set(properties.properties.map(value=>value.propertyId)));
const policy = loadHousingSecurityPolicy(join(config,'housing-security-policy.json'),hierarchy,effects);
const bindings = loadStorageSurfaceBindings(join(config,'housing-storage-bindings.json'),furnishings,units,policy);
const locations = loadEngineHousingStorageLocations(join(config,'housing-engine-storage-locations.json'));
function setup() {
    const root=mkdtempSync(join(tmpdir(),'engine-storage-runtime-'));roots.push(root);
    const placements=new FurnishingPlacementStore(join(root,'placements.sqlite'),furnishings);
    const definition=properties.properties.find(value=>value.propertyId==='falador.south-house')!;
    const property={...definition,state:{propertyId:definition.propertyId,status:'owned' as const,
        owner:{kind:'player' as const,id:'owner1'},acquiredAt:'2030-01-01T00:00:00.000Z',
        updatedAt:'2030-01-01T00:00:00.000Z',version:2}};
    const deps:EngineHousingStorageRuntimeDependencies={placements,locations,bindings,furnishings,policy,hierarchy,effects,units,
        property:(id:string)=>id===property.propertyId?property:null,
        canEnter:(_property:PropertyView,username:string,_isAdmin:boolean):boolean=>username==='owner1'};
    const target={kind:'loc' as const,typeId:2572,instanceIndex:null,name:'Chest',x:2969,z:3328,level:0};
    return {placements,deps,target};
}
function place(store:FurnishingPlacementStore):void {
    store.place({placementId:'falador.south-house.chest-1',propertyId:'falador.south-house',
        placementSlotId:'falador.south-house.storage-1',propertyAuthorityDigest:'b'.repeat(64),
        evidence:{assetId:'asset-chest-1',ownerAgentId:'owner1',furnishingTypeId:'wooden-chest',
            sourceDigest:'a'.repeat(64)},atSimulationTime:'2030-01-01T00:00:00.000Z'});
}
describe('engine Housing storage runtime',()=>{
    test('binds the exact engine loc to active placement, entitlement and private-room security',()=>{
        const value=setup();
        try {
            expect(()=>resolveEngineHousingStorageAccess(value.target,'thief1',false,value.deps))
                .toThrow('active audited placement');
            place(value.placements);
            expect(resolveEngineHousingStorageAccess(value.target,'thief1',false,value.deps)).toMatchObject({
                placementId:'falador.south-house.chest-1',placementRevision:1,
                housingUnitId:'falador.south-house.main',propertyId:'falador.south-house',
                storageSurfaceId:'private-room-chest',storageSlots:28,lockLevel:30,
                traceBasisPoints:4000,propertyStateVersion:2,actorAuthorized:false,
                owner:{kind:'player',id:'owner1'}});
            expect(resolveEngineHousingStorageAccess(value.target,'owner1',false,value.deps)?.actorAuthorized).toBeTrue();
        } finally {value.placements.close();}
    });
    test('does not infer storage from Property entry or nearby inventory alone',()=>{
        const value=setup();
        try { place(value.placements);
            expect(resolveEngineHousingStorageAccess({...value.target,typeId:999},'thief1',false,value.deps)).toBeUndefined();
            expect(resolveEngineHousingStorageAccess({...value.target,x:2970},'thief1',false,value.deps)).toBeUndefined();
            value.placements.remove('falador.south-house.chest-1',1,'2030-01-01T01:00:00.000Z');
            expect(()=>resolveEngineHousingStorageAccess(value.target,'thief1',false,value.deps))
                .toThrow('active audited placement');
        } finally {value.placements.close();}
    });
});
