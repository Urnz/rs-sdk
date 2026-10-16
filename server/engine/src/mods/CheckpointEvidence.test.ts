import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

import type Player from '#/engine/entity/Player.js';
import { CheckpointEvidenceStore } from './CheckpointEvidenceStore.js';
import { executeCheckpointDetection, executeCheckpointSearch,
    validateEngineCheckpointConfiguration } from './CheckpointInspection.js';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function path():string {const root=mkdtempSync(join(tmpdir(),'checkpoint-engine-'));roots.push(root);return join(root,'events.sqlite');}
const configuration=validateEngineCheckpointConfiguration({schemaVersion:1,policy:{schemaVersion:1,
    policyId:'city-checkpoints',version:'1.0.0',effectiveFrom:'2030-01-01T00:00:00.000Z',expiresAt:null,
    rules:[{jurisdictionId:'city',locationId:'bank',checkpointId:'bank-gate',permission:'allow',authorityId:'city-guard'}]},
    checkpoints:[{checkpointId:'bank-gate',inspectorAgentId:'guard-1',x:3200,z:3200,level:0,radius:2}]});
const searchId='11111111-1111-4111-8111-111111111111';
const detectionId='22222222-2222-4222-8222-222222222222';
function player(x=3200):Player {return {username:'visitor1',x,z:3200,level:0,
    getInventory:()=>({itemsFiltered:[{id:995,count:50},{id:100,count:1}]})} as unknown as Player;}
function deps(store:CheckpointEvidenceStore,subject:Player|null=player(),now=Date.parse('2030-01-01T10:00:00.000Z')) {
    return {store,configuration,subject:()=>subject,connected:()=>true,engineTick:100,now};
}
describe('engine checkpoint search and recognition journal',()=>{
    test('records an explicit server search and separate positive detection, then replays after restart',()=>{
        const file=path(),store=new CheckpointEvidenceStore(file);
        const search=executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
            expiresAt:Date.parse('2030-01-01T10:00:01.000Z')},deps(store));
        expect(search).toMatchObject({sourceKind:'completed-server-search',subjectAgentId:'visitor1',
            searchedItems:[{itemId:100,quantity:1},{itemId:995,quantity:50}]});
        const detection=executeCheckpointDetection({commandId:detectionId,inspectionId:searchId,
            subjectAgentId:'visitor1',assetId:'asset-stolen-1',itemId:100,result:'recognized-stolen',
            expiresAt:Date.parse('2030-01-01T10:00:02.000Z')},{store,engineTick:101,
                now:Date.parse('2030-01-01T10:00:01.000Z')});
        expect(detection).toMatchObject({sourceKind:'explicit-server-recognition',inspectionId:searchId,
            result:'recognized-stolen'});
        expect(store.verifyChain()).toBeTrue();store.close();
        const reopened=new CheckpointEvidenceStore(file);
        try {
            expect(reopened.getInspection(searchId)).toEqual(search);
            expect(reopened.getDetection(detectionId)).toEqual(detection);
            expect(executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
                expiresAt:0},deps(reopened,null,Date.parse('2031-01-01T00:00:00.000Z')))).toEqual(search);
        } finally {reopened.close();}
    });
    test('does not turn presence into a search and refuses recognition outside searched items',()=>{
        const store=new CheckpointEvidenceStore(path());
        try {
            expect(store.getInspection(searchId)).toBeNull();
            expect(()=>executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
                expiresAt:Date.parse('2030-01-01T10:00:01.000Z')},deps(store,player(3203))))
                .toThrow('not present');
            executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
                expiresAt:Date.parse('2030-01-01T10:00:01.000Z')},deps(store));
            expect(()=>executeCheckpointDetection({commandId:detectionId,inspectionId:searchId,
                subjectAgentId:'visitor1',assetId:'asset-unknown',itemId:777,result:'recognized-stolen',
                expiresAt:Date.parse('2030-01-01T10:00:02.000Z')},{store,engineTick:101,
                    now:Date.parse('2030-01-01T10:00:01.000Z')})).toThrow('does not match');
        } finally {store.close();}
    });
    test('persists a failed recognition and forbids rerolling that inspection/asset pair',()=>{
        const file=path(),store=new CheckpointEvidenceStore(file);
        executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
            expiresAt:Date.parse('2030-01-01T10:00:01.000Z')},deps(store));
        const failed=executeCheckpointDetection({commandId:detectionId,inspectionId:searchId,
            subjectAgentId:'visitor1',assetId:'asset-1',itemId:100,result:'not-recognized',
            expiresAt:Date.parse('2030-01-01T10:00:02.000Z')},{store,engineTick:101,
                now:Date.parse('2030-01-01T10:00:01.000Z')});
        expect(failed.result).toBe('not-recognized');store.close();
        const reopened=new CheckpointEvidenceStore(file);
        try {expect(()=>executeCheckpointDetection({commandId:'33333333-3333-4333-8333-333333333333',
            inspectionId:searchId,subjectAgentId:'visitor1',assetId:'asset-1',itemId:100,
            result:'recognized-stolen',expiresAt:Date.parse('2030-01-01T10:00:03.000Z')},
        {store:reopened,engineTick:102,now:Date.parse('2030-01-01T10:00:02.000Z')})).toThrow('cannot be rerolled');}
        finally {reopened.close();}
    });
    test('fails closed after journal tampering',()=>{
        const file=path(),store=new CheckpointEvidenceStore(file);
        executeCheckpointSearch({commandId:searchId,checkpointId:'bank-gate',subjectUsername:'visitor1',
            expiresAt:Date.parse('2030-01-01T10:00:01.000Z')},deps(store));
        const raw=new Database(file);raw.run('UPDATE checkpoint_engine_evidence SET subject_agent_id=?1',['other']);raw.close();
        expect(store.verifyChain()).toBeFalse();
        expect(()=>store.getInspection(searchId)).toThrow('audit');store.close();
    });
});
