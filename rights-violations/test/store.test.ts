import { afterEach,describe,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RightsViolationStore,type RightsViolationEvidence } from '../index.js';

const directories:string[]=[];
afterEach(()=>directories.splice(0).forEach(directory=>rmSync(directory,{recursive:true,force:true})));
function path():string{const directory=mkdtempSync(join(tmpdir(),'rights-violation-'));directories.push(directory);return join(directory,'events.sqlite')}
const base:RightsViolationEvidence={evidenceId:'item-proof-1',resourceKind:'item-ownership',resourceId:'pickaxe-1',
    owner:{kind:'agent',id:'owner'},actorAgentId:'intruder',action:'take',authorizationDecision:'denied',
    sourceDomain:'item-lifecycle',sourceStateVersion:3,sourceEvidenceDigest:'a'.repeat(64),occurredAt:'2030-01-01T00:00:00.000Z'};

describe('unified trusted rights violations',()=>{
    test('records item, storage, Property and entry violations through one immutable event shape',()=>{const store=new RightsViolationStore(path());
        try{const cases:RightsViolationEvidence[]=[base,{...base,evidenceId:'storage-proof-1',resourceKind:'storage-ownership',
                resourceId:'ore-bin',owner:{kind:'business',id:'varrock-smiths'},action:'withdraw',sourceDomain:'business-assets'},
            {...base,evidenceId:'property-proof-1',resourceKind:'property-ownership',resourceId:'varrock.east-workshop',
                owner:{kind:'business',id:'varrock-smiths'},action:'occupy',sourceDomain:'property'},
            {...base,evidenceId:'entry-proof-1',resourceKind:'entry-entitlement',resourceId:'varrock.east-workshop.private-room',
                owner:{kind:'agent',id:'resident'},action:'enter',sourceDomain:'property-access'}];
            cases.forEach((evidence,index)=>store.record({eventId:`violation-${index+1}`,evidence},()=>true,
                '2030-01-01T00:01:00.000Z'));expect(store.list()).toHaveLength(4);
            expect(store.list('intruder').map(entry=>entry.resourceKind)).toEqual([
                'item-ownership','storage-ownership','property-ownership','entry-entitlement']);expect(store.verifyAuditChain()).toBeTrue();
        }finally{store.close()}});
    test('is idempotent, survives restart and rejects evidence reuse or changed replay',()=>{const databasePath=path(),store=new RightsViolationStore(databasePath);
        const first=store.record({eventId:'violation-1',evidence:base},()=>true,'2030-01-01T00:01:00.000Z');
        expect(store.record({eventId:'violation-1',evidence:base},()=>true,'2030-01-01T00:02:00.000Z')).toEqual(first);
        expect(()=>store.record({eventId:'violation-1',evidence:{...base,action:'use'}},()=>true)).toThrow('reused');
        expect(()=>store.record({eventId:'violation-2',evidence:base},()=>true)).toThrow('already recorded');store.close();
        const reopened=new RightsViolationStore(databasePath);try{expect(reopened.get('violation-1')).toEqual(first);
            expect(reopened.verifyAuditChain()).toBeTrue()}finally{reopened.close()}});
    test('rejects untrusted, self-owned, mismatched-domain and invalid-action claims',()=>{const store=new RightsViolationStore(path());try{
        expect(()=>store.record({eventId:'violation-1',evidence:base},()=>false)).toThrow('not trusted');
        expect(()=>store.record({eventId:'violation-2',evidence:{...base,actorAgentId:'owner'}},()=>true)).toThrow('invalid');
        expect(()=>store.record({eventId:'violation-3',evidence:{...base,sourceDomain:'property'}},()=>true)).toThrow('invalid');
        expect(()=>store.record({eventId:'violation-4',evidence:{...base,action:'enter'}},()=>true)).toThrow('invalid');
        expect(()=>store.record({eventId:'violation-5',evidence:{...base,command:'punish'} as RightsViolationEvidence},()=>true)).toThrow('invalid');
        expect(store.list()).toEqual([])}finally{store.close()}});
    test('detects mutation of persisted event facts',()=>{const databasePath=path(),store=new RightsViolationStore(databasePath);
        store.record({eventId:'violation-1',evidence:base},()=>true);store.close();const database=new Database(databasePath);
        database.run(`UPDATE rights_violation_event SET actor_agent_id='other-intruder' WHERE event_id='violation-1'`);database.close();
        const reopened=new RightsViolationStore(databasePath);try{expect(reopened.verifyAuditChain()).toBeFalse()}finally{reopened.close()}});
});
