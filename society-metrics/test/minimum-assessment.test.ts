import { expect,test } from 'bun:test';
import { join } from 'node:path';
import { loadSocietyMinimumContract } from '../../society-minimum/contract.js';
import type { MinimumFrame } from '../../society-minimum/assessment.js';
import { projectNativeMinimumAssessment } from '../minimum-assessment.js';
const contract=loadSocietyMinimumContract(join(import.meta.dir,'../../config'));
const scope={clockId:'clock',clockProfileDigest:'a'.repeat(64),actorAgentIds:['alice','bob','carol','dave'],
    fromSimulationTime:'2001-01-02T00:00:00.000Z',toSimulationTime:'2001-01-09T00:00:00.000Z'};
const frame:MinimumFrame={...scope,contractDigest:contract.digest,worldId:'world',founderAgentIds:scope.actorAgentIds,genesisAppliedAtSimulationTime:'2001-01-01T00:00:00.000Z'};
test('missing native binding still reports all17 rules and8 unknown gates without inventing values or a PASS',()=>{
    const r=projectNativeMinimumAssessment(contract,scope,null);expect(r.requirements).toHaveLength(17);expect(r.integrity).toHaveLength(8);
    expect(r.bindingStatus).toBe('unbound');expect(r.verdict).toBe('inconclusive');expect(r.qualifiesMinimum).toBeFalse();expect(r.assessment).toBeNull();
});
test('native adapter maps positive receipt lower bounds into separate day buckets; bucket end belongs to the preceding bucket',()=>{
    // Controlled adapter fixture only; the integration test uses actual SQLite-backed native readers.
    const outcomes={scope,worldId:'world',sources:{work:{status:'available',digest:'b'.repeat(64),value:{rows:[
        {workerAgentId:'alice',stage:'food-gather',simulationTime:'2001-01-03T00:00:00.000Z',serviceCapacityAfter:null},
        {workerAgentId:'bob',stage:'food-cook',simulationTime:'2001-01-03T00:00:00.000Z',serviceCapacityAfter:null},
        {workerAgentId:'carol',stage:'repair',simulationTime:'2001-01-03T00:00:00.001Z',serviceCapacityAfter:50}]}},
        toolDemand:{status:'unavailable'}}} as any;
    const r=projectNativeMinimumAssessment(contract,scope,outcomes,frame);expect(r.bindingStatus).toBe('bound');
    const producers=r.assessment!.requirements.find(v=>v.requirementId==='productive-participants')!;
    expect(producers.cells[0]!.verdict).toBe('pass');expect(producers.cells[1]!.verdict).toBe('inconclusive');expect(producers.verdict).toBe('inconclusive');
    expect(r.requirements.find(v=>v.requirementId==='productive-stage-kinds')!.verdict).toBe('pass');expect(r.verdict).toBe('inconclusive');
    expect(r.requirements.find(v=>v.requirementId==='tool-maintenance-cycles')!.verdict).toBe('inconclusive');
    expect(r.assessment!.requirements.find(v=>v.requirementId==='tool-maintenance-cycles')!.cells.every(c=>!c.lower)).toBeTrue();
});

test('even complete native mechanics and consumed input cannot certify internal maintenance without material ancestry',()=>{
    const outcomes={scope,worldId:'world',sources:{work:{status:'available',digest:'b'.repeat(64),value:{rows:[
        {workerAgentId:'alice',stage:'repair',simulationTime:'2001-01-03T00:00:00.000Z',serviceCapacityAfter:50}]}},
        toolMaintenance:{status:'available',digest:'c'.repeat(64),value:{candidates:[{mechanicalCycleComplete:true,
            materialConsumption:'verified',inputOrigin:'unproven',qualifiesMinimum:false}]}},toolDemand:{status:'unavailable'}}} as any;
    const r=projectNativeMinimumAssessment(contract,scope,outcomes,frame);
    expect(r.sources.toolMaintenance.status).toBe('available');
    expect(r.requirements.find(v=>v.requirementId==='tool-maintenance-cycles')!.verdict).toBe('inconclusive');
    expect(r.integrity.every(g=>g.verdict==='inconclusive')).toBeTrue();expect(r.qualifiesMinimum).toBeFalse();
});
test('native diagnostic violation remains fail with an invalid run binding; private malformed binding is not echoed',()=>{
    const outcomes={scope,worldId:'world',sources:{work:{status:'invalid'},toolDemand:{status:'available',digest:'c'.repeat(64),value:{minimumVerdict:'fail'}}}} as any;
    const r=projectNativeMinimumAssessment(contract,scope,outcomes,{...frame,worldId:'PRIVATE WRONG WORLD'});
    expect(r.bindingStatus).toBe('invalid');expect(r.verdict).toBe('fail');expect(JSON.stringify(r)).not.toContain('PRIVATE');
    expect(r.integrity.every(g=>g.verdict==='inconclusive')).toBeTrue();
});
test('foreign window, clock or actor source cannot donate even a diagnostic violation to this assessment',()=>{
    for(const foreign of [{...scope,clockId:'other'},{...scope,actorAgentIds:['intruder']},
        {...scope,fromSimulationTime:'2001-01-01T00:00:00.000Z'},{...scope,toSimulationTime:'2001-01-10T00:00:00.000Z'}]){
        const outcomes={scope:foreign,worldId:'world',sources:{work:{status:'invalid'},toolDemand:{status:'available',digest:'c'.repeat(64),value:{minimumVerdict:'fail'}}}} as any;
        const r=projectNativeMinimumAssessment(contract,scope,outcomes,frame);
        expect(r.verdict).toBe('inconclusive');expect(r.diagnosticViolations).toHaveLength(0);
    }
});
