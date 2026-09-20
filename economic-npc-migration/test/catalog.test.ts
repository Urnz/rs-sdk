import { describe,expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadEconomicNpcMigrationCatalog,resolveEconomicNpcMigration,validateEconomicNpcMigrationCatalog } from '../index.js';

const catalog=()=>loadEconomicNpcMigrationCatalog(join(import.meta.dir,'..','..','config','economic-npc-migrations.json'));
describe('economic NPC migration strategy catalog',()=>{
    test('plans the finite Lumbridge General Store replacement without activating it',()=>{const configured=catalog(),
        candidate=resolveEconomicNpcMigration(configured,'lumbridge-general-store-v1');expect(configured.activation).toBe('planning-only');
        expect(candidate).toMatchObject({serviceKind:'shop',status:'planned',legacy:{npcTypeIds:['generalshopkeeper1','generalassistant1'],
            sharedInventoryId:'generalshop1'},target:{businessId:'lumbridge-general-store',institutionAgentId:'lumbridge-general-store-mind',
            ownerAgentId:'lumbridge-shopkeeper-owner',propertyId:'lumbridge.general-store',treasuryActorId:'lumbridge-general-store'},
        stages:['audit','shadow-accounting','finite-pilot','cutover']});expect(candidate.readinessGates).toHaveLength(8);
        expect(candidate.readinessGates.every(gate=>gate.status==='pending')).toBeTrue();});
    test('cannot activate or skip the ordered evidence stages through configuration',()=>{const configured=catalog(),candidate=configured.candidates[0]!;
        expect(()=>validateEconomicNpcMigrationCatalog({schemaVersion:1,activation:'active',candidates:[candidate]})).toThrow('invalid');
        expect(()=>validateEconomicNpcMigrationCatalog({schemaVersion:1,activation:'planning-only',candidates:[{...candidate,
            stages:['audit','cutover']}]})).toThrow('invalid');
        expect(()=>validateEconomicNpcMigrationCatalog({schemaVersion:1,activation:'planning-only',candidates:[{...candidate,
            status:'ready'}]})).toThrow('invalid');
        expect(()=>validateEconomicNpcMigrationCatalog({schemaVersion:1,activation:'planning-only',candidates:[{...candidate,
            readinessGates:candidate.readinessGates.slice(1)}]})).toThrow('incomplete');});
    test('rejects duplicate legacy writers, target businesses and tampered catalogs',()=>{const configured=catalog(),candidate=configured.candidates[0]!;
        expect(()=>validateEconomicNpcMigrationCatalog({schemaVersion:1,activation:'planning-only',candidates:[candidate,
            {...candidate,migrationId:'other'}]})).toThrow('Legacy economic NPC bindings');
        expect(()=>resolveEconomicNpcMigration({...configured,digest:'0'.repeat(64)},candidate.migrationId)).toThrow('digest mismatch');
        expect(()=>resolveEconomicNpcMigration(configured,'unknown')).toThrow('not planned');});
});
