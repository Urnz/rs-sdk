import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/index.js';
import { CrimeCaseStore,CrimeEvidenceStore } from '../../crime-cases/index.js';
import { loadItemLifecycleCatalog,loadItemStatePolicyCatalog } from '../../item-lifecycle/index.js';
import { ItemProvenanceStore,loadItemProvenancePolicyCatalog } from '../../item-provenance/index.js';
import { ThievingProcedureStore,type ThievingOutcomeEvidence } from '../../thieving-procedures/index.js';
import { ReintegrationEvidenceStore,ReintegrationStateStore,validateReintegrationPolicy } from '../index.js';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const at='2030-01-01T10:00:00.000Z',observed='2030-01-01T10:01:00.000Z';

test('penance improves only optional moral standing and cannot erase title, legal history, or personality',()=>{
    const root=mkdtempSync(join(tmpdir(),'reintegration-separation-'));roots.push(root);const agents=new AgentStateStore(
        join(root,'agents.sqlite')),thieving=new ThievingProcedureStore(join(root,'thieving.sqlite'));
    agents.createIdentity({agentId:'offender',playerUsername:'offender',displayName:'Offender',background:'Test.',
        personalityTraits:['patient','careful']},at);
    const outcome:ThievingOutcomeEvidence={evidenceId:'engine-evidence',procedureId:'procedure.thieving.pickpocket',
        procedureVersion:'0.1.0',procedureKind:'pickpocket',actorAgentId:'offender',playerUsername:'offender',
        target:{kind:'npc',typeId:1,instanceIndex:42,name:'Man',x:3222,z:3218,level:0},result:'succeeded',
        effect:'item-transfer',transferredItems:[{itemId:1265,itemName:'Bronze pickaxe',quantity:1}],thievingXpDelta:8,
        startedAtEngineTick:100,endedAtEngineTick:102,sourceEventId:'engine-event',sourceEvidenceDigest:'a'.repeat(64),occurredAt:at};
    thieving.recordOutcome('receipt-1',outcome,()=>true,at);thieving.recordDiscovery('observation-1',{evidenceId:'discovery',
        outcomeReceiptId:'receipt-1',source:'direct-witness',observerAgentId:'guard',actorIdentification:'direct',
        suspectAgentId:'offender',facts:['Observed theft.'],sourceEvidenceDigest:'b'.repeat(64),occurredAt:observed},()=>true,observed);
    const cases=new CrimeCaseStore(join(root,'cases.sqlite'),thieving);cases.recordDiscovery('case-1','case-discovery',
        'observation-1',observed);cases.recordIdentification('case-1','case-identification','observation-1',observed);
    const legal=new CrimeEvidenceStore(join(root,'legal.sqlite'),cases,thieving);legal.recordCaseEvidence('proof-1',
        'case-identification',observed);legal.recordFinding({findingId:'finding-1',caseId:'case-1',jurisdictionId:'varrock',
            suspectAgentId:'offender',conclusion:'responsible',evidenceIds:['proof-1'],policyId:'local-law-v1',
            policyDigest:'c'.repeat(64),authorityEvidenceDigest:'d'.repeat(64),occurredAt:observed},()=>true,observed);
    const config=join(import.meta.dir,'..','..','config'),lifecycle=loadItemLifecycleCatalog(join(config,'item-lifecycle.json')),
        statePolicy=loadItemStatePolicyCatalog(join(config,'item-state-policies.json'),lifecycle),provenance=new ItemProvenanceStore(
            join(root,'provenance.sqlite'),loadItemProvenancePolicyCatalog(join(config,'item-provenance-policies.json'),statePolicy));
    provenance.register({eventId:'register-pickaxe',assetId:'pickaxe-1',itemId:1265,quantity:1,
        titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'victim'},evidence:{evidenceId:'origin-proof',
            sourceDomain:'item-lifecycle',sourceRecordId:'origin-1',sourceStateVersion:1,sourceEvidenceDigest:'e'.repeat(64),
            occurredAt:at}},()=>true,at);provenance.recordTheft({eventId:'theft-1',claimId:null,assetId:'pickaxe-1',
        expectedRevision:1,itemId:1265,quantity:1,titleOwner:{kind:'agent',id:'victim'},previousHolder:{kind:'agent',id:'victim'},
        thiefAgentId:'offender',unitValueCoins:null},{...outcome,receiptId:'receipt-1',receiptDigest:'f'.repeat(64),recordedAt:at},
        ()=>true,observed);
    const reintegrationEvidence=new ReintegrationEvidenceStore(join(root,'reintegration-evidence.sqlite')),
        reintegrationState=new ReintegrationStateStore(join(root,'reintegration-state.sqlite')),penance={
            kind:'religious-penance-completed' as const,eventId:'penance-1',subjectAgentId:'offender',worldProfileId:'local-world',
            occurredAt:'2030-01-01T11:00:00.000Z',sourceEvidenceDigest:'1'.repeat(64),riteId:'rite-1',institutionId:'temple'},
        policy=validateReintegrationPolicy({schemaVersion:1,policyId:'local-reintegration',version:'1.0.0',
            worldProfileId:'local-world',effectiveFrom:'2029-01-01T00:00:00.000Z',expiresAt:null,rules:[
                {eventKind:'religious-penance-completed',projection:'moral-standing',delta:1}]});
    try{reintegrationEvidence.recordEvent(penance,()=>true);expect(reintegrationState.apply('penance-adjustment',policy,
            penance.eventId,{kind:'moral-standing',worldProfileId:'local-world'},null,reintegrationEvidence,
            '2030-01-01T11:01:00.000Z')).toMatchObject({projection:'moral-standing',valueAfter:1});
        expect(legal.getJurisdictionCriminalRecord('offender','varrock').responsibleFindings).toHaveLength(1);
        expect(provenance.getAsset('pickaxe-1')).toMatchObject({titleOwner:{kind:'agent',id:'victim'},holder:{kind:'agent',id:'offender'},
            theftHistoryCount:1});expect(agents.getIdentity('offender')?.personalityTraits).toEqual(['patient','careful'])
    }finally{reintegrationState.close();reintegrationEvidence.close();provenance.close();legal.close();cases.close();thieving.close();agents.close()}
});
