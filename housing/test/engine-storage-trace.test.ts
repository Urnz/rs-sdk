import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ThievingEvidenceStore, type EngineThievingEvidence } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { ingestEngineThievingOutcome } from '../../thieving-procedures/engine-bridge.js';
import { ThievingProcedureStore } from '../../thieving-procedures/store.js';
import { loadHousingEffectPolicyCatalog, loadHousingTierPolicyCatalog, loadHousingUnitCatalog } from '../config.js';
import { recordEngineHousingStorageTrace } from '../engine-storage-trace.js';
import { loadHousingSecurityPolicy } from '../security.js';
import { HousingTraceRollStore } from '../trace-roll-store.js';
import { loadPropertyCatalog } from '../../server/engine/src/mods/Properties.js';

const roots:string[]=[],config=join(import.meta.dir,'..','..','config');
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function path(name:string):string{const root=mkdtempSync(join(tmpdir(),'housing-storage-trace-'));roots.push(root);
    return join(root,`${name}.sqlite`);}
const properties=loadPropertyCatalog(join(config,'properties.json'));
const hierarchy=loadHousingTierPolicyCatalog(join(config,'housing-tier-policies.json')).policies[0]!;
const effects=loadHousingEffectPolicyCatalog(join(config,'housing-effect-policies.json'),hierarchy).policies[0]!;
const policy=loadHousingSecurityPolicy(join(config,'housing-security-policy.json'),hierarchy,effects);
const units=loadHousingUnitCatalog(join(config,'housing-units.json'),hierarchy,
    new Set(properties.properties.map(value=>value.propertyId)));
const event:EngineThievingEvidence={eventId:'storage-event-1',playerUsername:'thief1',
    procedureKind:'container-theft',target:{kind:'loc',typeId:2572,instanceIndex:null,name:'Chest',
        x:2969,z:3328,level:0},effect:'item-transfer',transferredItems:[{itemId:995,itemName:'Coins',quantity:5}],
    thievingXpDelta:10,startedAtEngineTick:100,endedAtEngineTick:101,occurredAt:'2030-01-01T10:00:00.000Z',
    storageAccess:{placementId:'falador.south-house.chest-1',placementRevision:1,
        placementSlotId:'falador.south-house.storage-1',placementEvidenceDigest:'a'.repeat(64),
        bindingDigest:'b'.repeat(64),housingUnitId:'falador.south-house.main',propertyId:'falador.south-house',
        storageSurfaceId:'private-room-chest',storageSlots:28,lockLevel:30,traceBasisPoints:4000,
        propertyStateVersion:2,actorAuthorized:false,owner:{kind:'player',id:'victim'}}};
describe('engine placed-storage trace',()=>{
    test('issues one durable trace decision and never identifies the actor from the physical trace',()=>{
        const engine=new ThievingEvidenceStore(path('engine')),thieving=new ThievingProcedureStore(path('thieving')),
            rolls=new HousingTraceRollStore(path('rolls'),thieving);
        try {
            const saved=engine.append(event);
            ingestEngineThievingOutcome(saved.eventId,engine,thieving,()=> 'agent-thief','2030-01-01T10:00:01.000Z');
            const first=recordEngineHousingStorageTrace(saved.eventId,engine,thieving,rolls,policy,hierarchy,effects,
                units,'2030-01-01T10:00:02.000Z');
            const replay=recordEngineHousingStorageTrace(saved.eventId,engine,thieving,rolls,policy,hierarchy,effects,
                units,'2030-01-01T10:00:03.000Z');
            expect(replay).toEqual(first);
            expect(rolls.get('outcome:storage-event-1')).toMatchObject({
                observationId:'storage-trace:storage-event-1'});
            expect(first.observation?.suspectAgentId??null).toBeNull();
            expect(first.observation?.actorIdentification??'none').toBe('none');
            expect(engine.verifyChain()).toBeTrue();expect(thieving.verifyAuditChain()).toBeTrue();
            expect(rolls.verifyAuditChain()).toBeTrue();
        } finally {rolls.close();thieving.close();engine.close();}
    });
    test('refuses authorized or policy-mismatched storage evidence before rolling',()=>{
        const engine=new ThievingEvidenceStore(path('engine')),thieving=new ThievingProcedureStore(path('thieving')),
            rolls=new HousingTraceRollStore(path('rolls'),thieving);
        try {
            engine.append({...event,storageAccess:{...event.storageAccess!,actorAuthorized:true}});
            ingestEngineThievingOutcome(event.eventId,engine,thieving,()=> 'agent-thief','2030-01-01T10:00:01.000Z');
            expect(()=>recordEngineHousingStorageTrace(event.eventId,engine,thieving,rolls,policy,hierarchy,effects,
                units,'2030-01-01T10:00:02.000Z')).toThrow('authorized-storage-access');
            expect(rolls.get('outcome:storage-event-1')).toBeNull();
        } finally {rolls.close();thieving.close();engine.close();}
    });
});
