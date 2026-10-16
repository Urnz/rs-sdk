import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { LegalFinding } from '../evidence-types.js';
import { JusticeAdjudicatorGrantStore } from '../justice-adjudicator-grants.js';
import { JusticeDecisionStore, type JusticeDecisionRequest } from '../justice-decision-store.js';
import { executeJusticeDecision, JusticeExecutionStore, planJusticeExecution,
    recoverJusticeExecutions } from '../justice-execution.js';
import type { EnginePlayerCustodyRequest, EnginePlayerCustodyResult } from '../../server/gateway/admin/player-custody.js';
import type { EnginePlayerEscrowRequest, EnginePlayerEscrowResult } from '../../server/gateway/admin/player-escrow.js';

const roots: string[] = [], d = (letter: string) => letter.repeat(64);
const finding: LegalFinding = { findingId:'finding-1',caseId:'case-1',jurisdictionId:'lumbridge',
    suspectAgentId:'suspect-agent',conclusion:'responsible',evidenceIds:['evidence-1'],policyId:'crime-policy',
    policyDigest:d('a'),authorityEvidenceDigest:d('b'),occurredAt:'2026-09-28T09:00:00.000Z',
    findingDigest:d('c'),recordedAt:'2026-09-28T09:01:00.000Z' };
const request: JusticeDecisionRequest = { decisionId:'justice-1',findingId:finding.findingId,
    findingDigest:finding.findingDigest,jurisdictionId:'lumbridge',suspectAgentId:'suspect-agent',
    subjectUsername:'suspect',beneficiaryUsername:'victim',disposition:'approved',custodySeconds:300,
    custodyLocation:{x:3221,z:3219,level:0},restitution:{gp:50,items:[{id:1205,count:1}]},
    policyId:'justice-policy-v1',policyDigest:d('d'),adjudicatorAgentId:'magistrate',
    authorityEvidenceDigest:d('e'),occurredAt:'2026-09-28T09:02:00.000Z' };

function setup(conclusion: LegalFinding['conclusion']='responsible', authorized=true, revokeBeforeDecision=false) {
    const root=mkdtempSync(join(tmpdir(),'justice-'));roots.push(root);
    const sourceFinding={...finding,conclusion};
    const source={verifyAuditChain:()=>true,getFinding:(id:string)=>id===finding.findingId?sourceFinding:null};
    const grants=new JusticeAdjudicatorGrantStore(join(root,'grants.sqlite'),command=>command.authorityEvidenceDigest);
    grants.issue({grantId:'justice-grant-1',jurisdictionId:'lumbridge',adjudicatorAgentId:'magistrate',
        capabilities:['adjudication','custody','restitution'],issuedByAgentId:'chief-magistrate',
        authorityEvidenceDigest:d('9'),occurredAt:'2026-09-28T08:00:00.000Z'});
    if(revokeBeforeDecision)grants.revoke({grantId:'justice-grant-1',revokedByAgentId:'chief-magistrate',
        authorityEvidenceDigest:d('8'),occurredAt:'2026-09-28T09:01:30.000Z'});
    const decisions=new JusticeDecisionStore(join(root,'decisions.sqlite'),source,grants,
        input=>authorized&&input.policyId==='justice-policy-v1'&&input.adjudicatorAgentId==='magistrate'
            ?input.authorityEvidenceDigest:null);
    const journal=new JusticeExecutionStore(join(root,'execution.sqlite'));
    return {root,decisions,journal,grants};
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})});

describe('policy/evidence-bound justice execution',()=>{
    test('accepts an authorized responsible decision and rejects missing authority or responsibility',()=>{
        const lawful=setup();
        expect(lawful.decisions.record(request).decisionDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(lawful.decisions.record(request)).toEqual(lawful.decisions.get(request.decisionId)!);
        lawful.decisions.close();lawful.journal.close();lawful.grants.close();

        const unauthorized=setup('responsible',false);
        expect(()=>unauthorized.decisions.record(request)).toThrow('authority');
        unauthorized.decisions.close();unauthorized.journal.close();unauthorized.grants.close();

        const notProven=setup('not-proven');
        expect(()=>notProven.decisions.record(request)).toThrow('responsible');
        notProven.decisions.close();notProven.journal.close();notProven.grants.close();

        const revoked=setup('responsible',true,true);
        expect(()=>revoked.decisions.record(request)).toThrow('historical grant');
        revoked.decisions.close();revoked.journal.close();revoked.grants.close();
    });

    test('records a rejected decision but cannot execute it',()=>{
        const value=setup();
        const rejected={...request,decisionId:'justice-rejected',disposition:'rejected' as const,custodySeconds:0,
            beneficiaryUsername:null,restitution:{gp:0,items:[]}};
        value.decisions.record(rejected);
        expect(()=>planJusticeExecution(rejected.decisionId,value.decisions,value.journal,
            '2026-09-28T10:00:00.000Z')).toThrow('Rejected');
        value.decisions.close();value.journal.close();value.grants.close();
    });

    test('is restart/idempotency safe and conserves restitution across every crash boundary',async()=>{
        const value=setup();value.decisions.record(request);
        const frozen=planJusticeExecution(request.decisionId,value.decisions,value.journal,'2026-09-28T10:00:00.000Z');
        expect(planJusticeExecution(request.decisionId,value.decisions,value.journal,
            '2026-09-28T11:00:00.000Z')).toEqual(frozen);
        const balances={suspect:{gp:100,items:new Map([[1205,1]])},victim:{gp:0,items:new Map<number,number>()}};
        const escrows=new Map<string,{request:EnginePlayerEscrowRequest;status:'held'|'committed'}>();
        const custodies=new Map<string,EnginePlayerCustodyRequest>();
        const escrower=async(input:EnginePlayerEscrowRequest,commandId='command'):Promise<EnginePlayerEscrowResult>=>{
            let state=escrows.get(input.escrowId);
            if(input.operation==='hold'&&!state){const assets=input.assets!;
                expect(balances.suspect.gp).toBeGreaterThanOrEqual(assets.gp);balances.suspect.gp-=assets.gp;
                for(const item of assets.items){expect(balances.suspect.items.get(item.id)).toBeGreaterThanOrEqual(item.count);
                    balances.suspect.items.set(item.id,(balances.suspect.items.get(item.id)??0)-item.count)}
                state={request:structuredClone(input),status:'held'};escrows.set(input.escrowId,state)}
            if(input.operation==='commit'&&state?.status==='held'){balances.victim.gp+=state.request.assets!.gp;
                for(const item of state.request.assets!.items)balances.victim.items.set(item.id,
                    (balances.victim.items.get(item.id)??0)+item.count);state.status='committed'}
            return {ok:true,commandId,escrowId:input.escrowId,operation:input.operation,username:input.username,
                payeeUsername:input.payeeUsername,escrow:{escrowId:input.escrowId,username:input.username,
                    assets:state!.request.assets!,status:state!.status,payeeUsername:input.payeeUsername??null,
                    committedAt:state!.status==='committed'?'2026-09-28T10:00:03.000Z':null}};
        };
        const custodian=async(input:EnginePlayerCustodyRequest,commandId='command'):Promise<EnginePlayerCustodyResult>=>{
            const prior=custodies.get(input.custodyId);if(prior)expect(prior).toEqual(input);else custodies.set(input.custodyId,structuredClone(input));
            return {ok:true,commandId,custodyId:input.custodyId,username:input.username,
                custody:{...input,status:'active',releasedAt:null,orderDigest:d('f')}};
        };
        for(const step of ['hold','custody','commit'] as const){let crashed=false;
            await expect(executeJusticeDecision(request.decisionId,{journal:value.journal,escrower,custodian,
                now:()=>`2026-09-28T10:00:0${step==='hold'?1:step==='custody'?2:3}.000Z`,
                afterExternalStep:actual=>{if(actual===step&&!crashed){crashed=true;throw new Error(`crash-${step}`)}}}))
                .rejects.toThrow(`crash-${step}`);}
        value.journal.close();
        const reopened=new JusticeExecutionStore(join(value.root,'execution.sqlite'));
        const recovered=await recoverJusticeExecutions({journal:reopened,escrower,custodian,
            now:()=> '2026-09-28T10:00:04.000Z'});
        expect(recovered.settled).toEqual([request.decisionId]);
        expect(balances).toEqual({suspect:{gp:50,items:new Map([[1205,0]])},victim:{gp:50,items:new Map([[1205,1]])}});
        expect(escrows).toHaveLength(1);expect(custodies).toHaveLength(1);
        expect(reopened.verifyAuditChain()).toBeTrue();reopened.close();value.decisions.close();value.grants.close();
    });
});
