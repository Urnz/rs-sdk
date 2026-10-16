import { afterEach,describe,expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../agent-state/index.js';
import { projectObserverReintegrationDescriptors,ReintegrationEvidenceStore,ReintegrationStateStore,
    validateReintegrationPolicy,type ReintegrationAudience,type ReintegrationEvent,type ReintegrationKnowledge } from '../index.js';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
const occurredAt='2030-01-01T10:00:00.000Z',learnedAt='2030-01-01T10:01:00.000Z',appliedAt='2030-01-01T10:02:00.000Z';
function policy(){return validateReintegrationPolicy({schemaVersion:1,policyId:'local-reintegration',version:'1.0.0',
    worldProfileId:'local-world',effectiveFrom:'2029-01-01T00:00:00.000Z',expiresAt:null,rules:[
        {eventKind:'restitution-completed',projection:'reputation',delta:2},
        {eventKind:'compensation-paid',projection:'reputation',delta:1},
        {eventKind:'community-service-completed',projection:'reputation',delta:1},
        {eventKind:'sentence-completed',projection:'reputation',delta:1},
        {eventKind:'forgiveness-granted',projection:'reputation',delta:1},
        {eventKind:'religious-penance-completed',projection:'moral-standing',delta:1}]})}
function event(kind:ReintegrationEvent['kind'],n:number):ReintegrationEvent{const common={eventId:`event-${n}`,
    subjectAgentId:'offender',worldProfileId:'local-world',occurredAt,sourceEvidenceDigest:n.toString(16).repeat(64)};
    switch(kind){case'restitution-completed':return{...common,kind,claimId:'claim-1',victimActorId:'victim'};
        case'compensation-paid':return{...common,kind,paymentId:'payment-1',recipientActorId:'victim'};
        case'community-service-completed':return{...common,kind,serviceOrderId:'service-1',jurisdictionId:'varrock'};
        case'sentence-completed':return{...common,kind,sentenceId:'sentence-1',jurisdictionId:'varrock'};
        case'forgiveness-granted':return{...common,kind,caseId:'case-1',forgiverActorId:'observer'};
        case'religious-penance-completed':return{...common,kind,riteId:'rite-1',institutionId:'temple'}}}
function knowledge(eventId:string,n:number,audience:ReintegrationKnowledge['audience']={kind:'observer',observerAgentId:'observer',
    worldProfileId:'local-world'}):ReintegrationKnowledge{return{knowledgeId:`knowledge-${n}`,eventId,audience,learnedAt,
        sourceEvidenceDigest:((n+6)%16).toString(16).repeat(64)}}

describe('audited reintegration state',()=>{
    test('attests every supported completion source and applies each event only to its intended audience/projection',()=>{
        const root=mkdtempSync(join(tmpdir(),'reintegration-'));roots.push(root);
        const evidencePath=join(root,'evidence.sqlite'),statePath=join(root,'state.sqlite');
        let evidence=new ReintegrationEvidenceStore(evidencePath),state=new ReintegrationStateStore(statePath);
        const kinds:ReintegrationEvent['kind'][]=['restitution-completed','compensation-paid','community-service-completed',
            'sentence-completed','forgiveness-granted','religious-penance-completed'],events=kinds.map((kind,index)=>event(kind,index+1));
        try{
            expect(()=>evidence.recordEvent(events[0]!,undefined)).toThrow('not trusted');
            for(const value of events)expect(evidence.recordEvent(value,input=>input.sourceEvidenceDigest===value.sourceEvidenceDigest))
                .toEqual(value);
            const observer={kind:'observer' as const,observerAgentId:'observer',worldProfileId:'local-world'},
                community={kind:'community' as const,communityId:'varrock',worldProfileId:'local-world'},
                moral={kind:'moral-standing' as const,worldProfileId:'local-world'};
            for(let index=0;index<5;index++){const proof=knowledge(events[index]!.eventId,index+1);
                evidence.recordKnowledge(proof,(input,source)=>input.eventId===source.eventId
                    &&input.audience.kind==='observer'&&input.audience.observerAgentId==='observer')}
            const communityProof=knowledge(events[2]!.eventId,20,community);evidence.recordKnowledge(communityProof,()=>true);
            const first=state.apply('adjustment-restitution',policy(),events[0]!.eventId,observer,'knowledge-1',evidence,appliedAt);
            expect(first).toMatchObject({projection:'reputation',delta:2,valueBefore:0,valueAfter:2});
            expect(state.apply('adjustment-restitution',policy(),events[0]!.eventId,observer,'knowledge-1',evidence,appliedAt))
                .toEqual(first);expect(()=>state.apply('adjustment-duplicate',policy(),events[0]!.eventId,observer,'knowledge-1',
                    evidence,appliedAt)).toThrow('already applied');
            expect(state.apply('adjustment-community',policy(),events[2]!.eventId,community,communityProof.knowledgeId,evidence,appliedAt))
                .toMatchObject({projection:'reputation',valueAfter:1});
            expect(state.apply('adjustment-penance',policy(),events[5]!.eventId,moral,null,evidence,appliedAt))
                .toMatchObject({projection:'moral-standing',valueAfter:1});
            expect(()=>state.apply('adjustment-hidden',policy(),events[1]!.eventId,
                {kind:'observer',observerAgentId:'outsider',worldProfileId:'local-world'},null,evidence,appliedAt))
                .toThrow('not authorized');
            expect(state.getStanding('offender',observer)).toMatchObject({projection:'reputation',value:2,
                sourceEventIds:['event-1']});expect(state.getStanding('offender',community)).toMatchObject({value:1});
            expect(state.getStanding('offender',moral)).toMatchObject({projection:'moral-standing',value:1});
            expect(projectObserverReintegrationDescriptors(evidence,state,'observer','local-world')).toEqual([{
                viewerAgentId:'observer',targetAgentId:'offender',description:'Known completed reform effort',
                sourceEventIds:['event-1'],adjustmentIds:['adjustment-restitution']}]);
            expect(projectObserverReintegrationDescriptors(evidence,state,'outsider','local-world')).toEqual([]);
            evidence.close();state.close();evidence=new ReintegrationEvidenceStore(evidencePath);state=new ReintegrationStateStore(statePath);
            expect(state.getStanding('offender',observer).value).toBe(2);expect(evidence.verifyAuditChain()).toBeTrue();
            expect(state.verifyAuditChain()).toBeTrue()
        }finally{evidence.close();state.close()}
    });

    test('never mutates stable personality traits and fails closed after state tampering',()=>{
        const root=mkdtempSync(join(tmpdir(),'reintegration-invariants-'));roots.push(root);
        const agentPath=join(root,'agents.sqlite'),evidencePath=join(root,'evidence.sqlite'),statePath=join(root,'state.sqlite'),
            agents=new AgentStateStore(agentPath),
            evidence=new ReintegrationEvidenceStore(evidencePath),state=new ReintegrationStateStore(statePath);
        const observer:ReintegrationAudience={kind:'observer',observerAgentId:'observer',worldProfileId:'local-world'};
        try{agents.createIdentity({agentId:'offender',playerUsername:'offender',displayName:'Offender',background:'Test.',
                personalityTraits:['patient','careful']},occurredAt);const value=event('restitution-completed',1),proof=knowledge(value.eventId,1);
            evidence.recordEvent(value,()=>true);evidence.recordKnowledge(proof,()=>true);
            state.apply('adjustment-1',policy(),value.eventId,observer,proof.knowledgeId,evidence,appliedAt);
            expect(agents.getIdentity('offender')?.personalityTraits).toEqual(['patient','careful']);
            const raw=new Database(statePath);raw.run("UPDATE reintegration_adjustment SET subject_agent_id='other'");raw.close();
            expect(state.verifyAuditChain()).toBeFalse();expect(()=>state.getStanding('offender',observer)).toThrow('audit chain')
        }finally{state.close();evidence.close();agents.close()}
    })
});
