import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

import { ThievingEvidenceStore, type EngineThievingEvidence } from '../../server/engine/src/mods/ThievingEvidenceStore.js';
import { assessEngineHousingStorageSource } from '../engine-storage-source.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(): string { const root = mkdtempSync(join(tmpdir(), 'housing-storage-source-'));
    roots.push(root); return join(root, 'engine.sqlite'); }
const chest: EngineThievingEvidence = { eventId: 'vanilla-chest-1', playerUsername: 'thief1',
    procedureKind: 'container-theft', target: { kind: 'loc', typeId: 2572, instanceIndex: null,
        name: 'Chest', x: 2969, z: 3328, level: 0 }, effect: 'item-transfer',
    transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 5 }], thievingXpDelta: 10,
    startedAtEngineTick: 100, endedAtEngineTick: 101, occurredAt: '2030-01-01T10:00:00.000Z' };
const storageAccess = { placementId: 'falador.south-house.chest-1', placementRevision: 1,
    placementSlotId: 'falador.south-house.storage-1', placementEvidenceDigest: 'c'.repeat(64),
    bindingDigest: 'd'.repeat(64), housingUnitId: 'falador.south-house.main',
    propertyId: 'falador.south-house', storageSurfaceId: 'private-room-chest', storageSlots: 28,
    lockLevel: 30, traceBasisPoints: 4000, propertyStateVersion: 2, actorAuthorized: false,
    owner: {kind:'player' as const,id:'victim'} };

describe('engine Housing storage source gate', () => {
    test('refuses vanilla chest evidence even at Housing coordinates with Property metadata', () => {
        const source = new ThievingEvidenceStore(path());
        try {
            const record = source.append({ ...chest, propertyAccess: { propertyId: 'falador.south-house',
                entryPointId: 'front-door', owner: { kind: 'player', id: 'victim' },
                propertyStateVersion: 2, actorAuthorized: false } });
            expect(assessEngineHousingStorageSource(record.eventId, source)).toEqual({ eligible: false,
                reason: 'missing-engine-storage-placement-link', sourceEventId: record.eventId,
                sourceEvidenceDigest: record.eventDigest });
            expect(source.verifyChain()).toBeTrue();
        } finally { source.close(); }
    });
    test('does not promote unrelated events or missing evidence', () => {
        const source = new ThievingEvidenceStore(path());
        try {
            source.append({ ...chest, procedureKind: 'pickpocket', target: { ...chest.target,
                kind: 'npc', instanceIndex: 1 } });
            expect(assessEngineHousingStorageSource(chest.eventId, source)).toEqual({ eligible: false,
                reason: 'not-container-theft' });
            expect(() => assessEngineHousingStorageSource('unknown', source)).toThrow('not found');
        } finally { source.close(); }
    });
    test('accepts only an engine-captured unauthorized placed-storage transfer',()=>{
        const source=new ThievingEvidenceStore(path());
        try {
            const record=source.append({...chest,storageAccess});
            expect(assessEngineHousingStorageSource(record.eventId,source)).toMatchObject({eligible:true,
                sourceEventId:record.eventId,sourceEvidenceDigest:record.eventDigest,storageAccess});
        } finally {source.close();}
        const authorized=new ThievingEvidenceStore(path());
        try {
            authorized.append({...chest,storageAccess:{...storageAccess,actorAuthorized:true}});
            expect(assessEngineHousingStorageSource(chest.eventId,authorized)).toMatchObject({
                eligible:false,reason:'authorized-storage-access'});
        } finally {authorized.close();}
    });
    test('rejects a damaged source chain before assessment', () => {
        const file = path(), source = new ThievingEvidenceStore(file);
        try {
            source.append(chest);
            const database = new Database(file);
            try { database.run("UPDATE thieving_engine_evidence SET target_json='{}' WHERE event_id='vanilla-chest-1'"); }
            finally { database.close(); }
            expect(() => assessEngineHousingStorageSource(chest.eventId, source)).toThrow('chain is invalid');
        } finally { source.close(); }
    });
});
