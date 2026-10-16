import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CheckpointEvidenceStore } from '../../server/engine/src/mods/CheckpointEvidenceStore.js';
import { CheckpointEvidenceLedger } from '../evidence-ledger.js';
import { recordEngineCheckpointDetection, recordEngineCheckpointInspection } from '../engine-ingestion.js';
import { checkpointEngineVerifiers } from '../engine-source-adapter.js';
import { validateCheckpointInspectionPolicy } from '../policy.js';

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(){const root=mkdtempSync(join(tmpdir(),'checkpoint-ingest-'));roots.push(root);
    return {engine:new CheckpointEvidenceStore(join(root,'engine.sqlite')),
        ledger:new CheckpointEvidenceLedger(join(root,'ledger.sqlite'))};}
const policy=validateCheckpointInspectionPolicy({schemaVersion:1,policyId:'city-checkpoints',version:'1.0.0',
    effectiveFrom:'2030-01-01T00:00:00.000Z',expiresAt:null,rules:[{jurisdictionId:'city',locationId:'bank',
        checkpointId:'bank-gate',permission:'allow',authorityId:'city-guard'}]});
describe('checkpoint engine ingestion',()=>{
    test('audits exact engine search/detection and exposes only a positive separate recognition',()=>{
        const value=setup();
        try {
            const inspected=value.engine.appendInspection({inspectionId:'inspection-1',jurisdictionId:'city',
                locationId:'bank',checkpointId:'bank-gate',authorityId:'city-guard',inspectorAgentId:'guard-1',
                subjectAgentId:'visitor1',occurredAt:'2030-01-01T10:00:00.000Z',engineTick:100,
                searchedItems:[{itemId:100,quantity:1}]});
            const detected=value.engine.appendDetection({detectionId:'detection-1',inspectionId:'inspection-1',
                subjectAgentId:'visitor1',assetId:'asset-1',itemId:100,result:'recognized-stolen',
                occurredAt:'2030-01-01T10:00:01.000Z',engineTick:101});
            recordEngineCheckpointInspection(inspected.inspectionId,value.engine,value.ledger,policy,
                '2030-01-01T10:00:02.000Z');
            expect(value.ledger.projectExposure('inspection-1','detection-1',policy,()=>true,()=>true).exposed).toBeFalse();
            recordEngineCheckpointDetection(detected.detectionId,value.engine,value.ledger,
                '2030-01-01T10:00:02.000Z');
            const verifiers=checkpointEngineVerifiers(value.engine);
            expect(value.ledger.projectExposure('inspection-1','detection-1',policy,
                verifiers.verifyInspection,verifiers.verifyDetection)).toMatchObject({exposed:true,assetId:'asset-1'});
            expect(value.ledger.verifyAuditChain()).toBeTrue();
        } finally {value.ledger.close();value.engine.close();}
    });
    test('negative detection remains non-exposing',()=>{
        const value=setup();try {
            value.engine.appendInspection({inspectionId:'inspection-1',jurisdictionId:'city',locationId:'bank',
                checkpointId:'bank-gate',authorityId:'city-guard',inspectorAgentId:'guard-1',subjectAgentId:'visitor1',
                occurredAt:'2030-01-01T10:00:00.000Z',engineTick:100,searchedItems:[{itemId:100,quantity:1}]});
            value.engine.appendDetection({detectionId:'detection-1',inspectionId:'inspection-1',subjectAgentId:'visitor1',
                assetId:'asset-1',itemId:100,result:'not-recognized',occurredAt:'2030-01-01T10:00:01.000Z',engineTick:101});
            recordEngineCheckpointInspection('inspection-1',value.engine,value.ledger,policy,'2030-01-01T10:00:02.000Z');
            recordEngineCheckpointDetection('detection-1',value.engine,value.ledger,'2030-01-01T10:00:02.000Z');
            const verify=checkpointEngineVerifiers(value.engine);
            expect(value.ledger.projectExposure('inspection-1','detection-1',policy,
                verify.verifyInspection,verify.verifyDetection).exposed).toBeFalse();
        } finally {value.ledger.close();value.engine.close();}
    });
});
