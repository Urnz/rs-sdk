import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentStateStore } from '../../../agent-state/store.js';
import { CrimeCaseStore } from '../../../crime-cases/store.js';
import { ReintegrationEvidenceStore,ReintegrationStateStore,validateReintegrationPolicy } from '../../../crime-reintegration/index.js';
import { ThievingProcedureStore } from '../../../thieving-procedures/store.js';
import type { ThievingOutcomeEvidence } from '../../../thieving-procedures/types.js';
import { listAdminAgents } from './agent-state.js';

const roots: string[] = [];
const at = '2030-01-01T10:00:00.000Z', observed = '2030-01-01T10:01:00.000Z';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'admin-crime-knowledge-')); roots.push(root);
    const agentPath = join(root, 'agents.sqlite');
    const paths = { thieving: join(root, 'thieving.sqlite'), cases: join(root, 'cases.sqlite') };
    const agents = new AgentStateStore(agentPath);
    try {
        for (const agentId of ['guard-1', 'other-guard', 'actual-thief']) {
            agents.createIdentity({ agentId, playerUsername: agentId, displayName: agentId,
                background: 'Fixture agent.', personalityTraits: ['careful'] });
        }
    } finally { agents.close(); }
    const thieving = new ThievingProcedureStore(paths.thieving);
    const outcome: ThievingOutcomeEvidence = { evidenceId: 'engine-evidence',
        procedureId: 'procedure.thieving.pickpocket', procedureVersion: '0.1.0', procedureKind: 'pickpocket',
        actorAgentId: 'actual-thief', playerUsername: 'actual-thief',
        target: { kind: 'npc', typeId: 1, instanceIndex: 42, name: 'Man', x: 3222, z: 3218, level: 0 },
        result: 'succeeded', effect: 'item-transfer',
        transferredItems: [{ itemId: 995, itemName: 'Coins', quantity: 3 }], thievingXpDelta: 8,
        startedAtEngineTick: 100, endedAtEngineTick: 102, sourceEventId: 'engine-event',
        sourceEvidenceDigest: 'a'.repeat(64), occurredAt: at };
    thieving.recordOutcome('receipt-1', outcome, () => true, at);
    thieving.recordDiscovery('observation-1', { evidenceId: 'discovery-evidence',
        outcomeReceiptId: 'receipt-1', source: 'direct-witness', observerAgentId: 'guard-1',
        actorIdentification: 'direct', suspectAgentId: 'actual-thief', facts: ['Saw a theft.'],
        sourceEvidenceDigest: 'b'.repeat(64), occurredAt: observed }, () => true, observed);
    const cases = new CrimeCaseStore(paths.cases, thieving);
    cases.recordDiscovery('case-1', 'discovery-1', 'observation-1', observed);
    cases.recordIdentification('case-1', 'identification-1', 'observation-1', observed);
    cases.close(); thieving.close();
    return { agentPath, paths };
}

test('only the direct observer gets a source-linked suspect description in decision context', async () => {
    const { agentPath, paths } = fixture();
    const result = await listAdminAgents(agentPath, { skillRuns: [], crimeKnowledgePaths: paths });
    const guard = result.agents.find(value => value.identity.agentId === 'guard-1')!;
    const other = result.agents.find(value => value.identity.agentId === 'other-guard')!;
    const thief = result.agents.find(value => value.identity.agentId === 'actual-thief')!;
    expect(guard.decisionContext).toContain('Personally observed suspects (not legal findings)');
    expect(guard.decisionContext).toContain('actual-thief: Personally identified as a suspect');
    expect(guard.decisionContext).toContain('identification-1');
    expect(other.decisionContext).not.toContain('Personally observed suspects');
    expect(thief.decisionContext).not.toContain('Personally observed suspects');
    expect(guard.identity.personalityTraits).toEqual(['careful']);
});

test('a damaged case ledger contributes no suspect description to any context', async () => {
    const { agentPath, paths } = fixture();
    const raw = new Database(paths.cases);
    try { raw.run("UPDATE crime_case_event SET observer_agent_id='other-guard' WHERE event_id='identification-1'");
    } finally { raw.close(); }
    const result = await listAdminAgents(agentPath, { skillRuns: [], crimeKnowledgePaths: paths });
    for (const agent of result.agents) {
        expect(agent.decisionContext).not.toContain('Personally observed suspects');
        expect(agent.decisionContextBlockers).toContain('crime-case-knowledge');
    }
});

test('an incomplete crime source contributes no suspect description', async () => {
    const { agentPath, paths } = fixture();
    const result = await listAdminAgents(agentPath, { skillRuns: [], crimeKnowledgePaths: {
        thieving: paths.thieving, cases: join(paths.cases, 'missing.sqlite')
    } });
    for (const agent of result.agents) {
        expect(agent.decisionContext).not.toContain('Personally observed suspects');
        expect(agent.decisionContextBlockers).toContain('crime-case-knowledge');
    }
});

test('only the audience that learned a verified reform event receives its source-bound context description',async()=>{
    const{agentPath,paths}=fixture(),reintegrationEvidence=join(paths.cases,'..','reintegration-evidence.sqlite'),
        reintegrationState=join(paths.cases,'..','reintegration-state.sqlite'),evidence=new ReintegrationEvidenceStore(reintegrationEvidence),
        state=new ReintegrationStateStore(reintegrationState),event={kind:'restitution-completed' as const,eventId:'restitution-1',
            subjectAgentId:'actual-thief',worldProfileId:'local-world',occurredAt:observed,sourceEvidenceDigest:'c'.repeat(64),
            claimId:'claim-1',victimActorId:'victim'},knowledge={knowledgeId:'guard-learned-restitution',eventId:event.eventId,
            audience:{kind:'observer' as const,observerAgentId:'guard-1',worldProfileId:'local-world'},
            learnedAt:'2030-01-01T10:02:00.000Z',sourceEvidenceDigest:'d'.repeat(64)},policy=validateReintegrationPolicy({
                schemaVersion:1,policyId:'local-reintegration',version:'1.0.0',worldProfileId:'local-world',
                effectiveFrom:'2029-01-01T00:00:00.000Z',expiresAt:null,rules:[
                    {eventKind:'restitution-completed',projection:'reputation',delta:2}]});
    try{evidence.recordEvent(event,()=>true);evidence.recordKnowledge(knowledge,()=>true);state.apply('guard-reform-1',policy,
            event.eventId,knowledge.audience,knowledge.knowledgeId,evidence,'2030-01-01T10:03:00.000Z')}
    finally{state.close();evidence.close()}
    const result=await listAdminAgents(agentPath,{skillRuns:[],crimeKnowledgePaths:{...paths,reintegrationEvidence,
        reintegrationState,worldProfileId:'local-world'}}),guard=result.agents.find(value=>value.identity.agentId==='guard-1')!,
        other=result.agents.find(value=>value.identity.agentId==='other-guard')!;
    expect(guard.decisionContext).toContain('Known reintegration efforts (audience-scoped, not legal erasure)');
    expect(guard.decisionContext).toContain('actual-thief: Known completed reform effort; source events restitution-1');
    expect(other.decisionContext).not.toContain('Known reintegration efforts');
    expect(result.agents.find(value=>value.identity.agentId==='actual-thief')!.identity.personalityTraits).toEqual(['careful'])
});
