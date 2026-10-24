import { afterEach,expect,test } from 'bun:test';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentStateStore } from '../../agent-state/store.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { TradeEvidenceStore } from '../../server/engine/src/mods/TradeEvidenceStore.js';
import { JsonlLlmAuditSink } from '../../llm-runtime/audit.js';
import { ScriptedMockProvider } from '../../llm-runtime/mock-provider.js';
import { LlmOrchestrator } from '../../llm-runtime/orchestrator.js';
import { validateLlmRuntimeConfig } from '../../llm-runtime/config.js';
import { InferenceQueue } from '../../llm-runtime/queue.js';
import { SqliteInferenceQueueClaimStore } from '../../llm-runtime/inference-queue-store.js';
import { OwnedDatabase } from '../../server/engine/src/io/OwnedDatabase.js';
import { reportNativeOutcomes,type NativeOutcomeOptions } from '../native-outcomes.js';
import { providerOutcomes } from '../outcome-provider.js';
import { reportSocietyEvaluation } from '../evaluation-report.js';
import { reportSocietyDashboard } from '../dashboard.js';
import { handleAdminRequest } from '../../server/gateway/admin/routes.js';
import type { BotSupervisor } from '../../server/gateway/admin/supervisor.js';
import { BusinessManagerStore } from '../../server/gateway/admin/business-manager.js';
import { BusinessWorkStore } from '../../business-work/work.js';
import { populationNeedsBinding } from '../../needs/population-binding.js';

const roots:string[]=[],closers:Array<()=>void>=[];
afterEach(()=>{for(const close of closers.splice(0).reverse())close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const wall='2026-10-24T10:00:00.000Z',sim='2001-01-01T00:00:00.000Z';
function fixture(){
    const workspace=mkdtempSync(join(tmpdir(),'si-c05-'));roots.push(workspace);mkdirSync(join(workspace,'.local'),{recursive:true});
    const agentPath=join(workspace,'.local/agent-state/agents.sqlite'),clockPath=join(workspace,'.local/simulation/simulation-clock.sqlite');
    const clock=new SimulationClockStore(clockPath);closers.push(()=>clock.close());
    const created=clock.create({clockId:'world',profile:{schemaVersion:1,profileId:'outcomes',version:'1.0.0',seed:'fixture',rate:{simulationMilliseconds:1,wallMilliseconds:1}},wallTime:wall,simulationTime:sim});
    const store=new AgentStateStore(agentPath,{store:clock,clockId:'world'});closers.push(()=>store.close());
    for(const agentId of ['alice','bob','secret'])store.createIdentity({agentId,playerUsername:agentId,displayName:agentId,background:'PRIVATE BIO',personalityTraits:['patient']},wall);
    const scope={clockId:'world',clockProfileDigest:created.profileDigest,fromSimulationTime:'2000-12-31T23:59:59.000Z',toSimulationTime:'2001-01-08T00:00:00.000Z',actorAgentIds:['alice','bob']};
    const options:NativeOutcomeOptions={workspace,worldId:'outcome-world',agentPath,clockPath,allowedActorAgentIds:['alice','bob'],allowedObserverAgentIds:['alice'],
        auditPath:join(workspace,'.local/llm-audit.jsonl'),queuePath:join(workspace,'.local/queue.sqlite'),wallWindow:{from:'2020-01-01T00:00:00.000Z',to:'2040-01-01T00:00:00.000Z'}};
    const read=()=>reportNativeOutcomes(scope,options);
    return{workspace,store,clock,scope,options,read};
}
test('actor lifecycle identity matches the native physiology binding and rejects foreign cohort clocks',()=>{
    const f=fixture(),member=f.store.bindPopulationMember({agentId:'alice',playerUsername:'alice',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},
        lifecyclePolicy:{policyId:'finite-population',version:'1.0.0',digest:'b'.repeat(64),kind:'finite'},
        simulationClock:{clockId:'world',profileDigest:f.scope.clockProfileDigest},joinedAtSimulationTime:sim,
        sourceResultId:'genesis-0123456789abcdef01234567',sourceResultDigest:'c'.repeat(64)},wall);
    const report=f.read();if(report.sources.agent.status!=='available')throw Error(JSON.stringify(report.sources.agent));
    expect(report.sources.agent.value.actors[0]?.lifecycleId).toBe(populationNeedsBinding(f.options.worldId,member).lifecycleId);
    expect(reportNativeOutcomes({...f.scope,clockProfileDigest:'d'.repeat(64)},f.options).sources.agent.status).toBe('invalid');
});
test('observer scope keeps asymmetric beliefs/cooperation/conflict and never exports private text or third-party memory',()=>{
    const f=fixture();
    for(const [agentId,actorKey,trust] of [['alice','bob',30],['bob','alice',-40],['alice','secret',99]] as const){
        const episode=f.store.createEpisode(agentId,{episodeId:`${agentId}.${actorKey}`,kind:'interaction',summary:'PRIVATE EPISODE',source:'manual',trust:'trusted',actors:[actorKey],occurredAt:wall},wall);
        f.store.setRelationship(agentId,null,{actorKey,displayName:'PRIVATE NAME',trust,notes:'PRIVATE NOTE',evidenceEpisodeIds:[episode.episodeId]},wall);
        const promise=f.store.createCommitment(agentId,{commitmentId:`promise.${agentId}.${actorKey}`,actorKey,direction:'owed-by-agent',description:'PRIVATE PROMISE',evidenceEpisodeIds:[episode.episodeId]},wall);
        f.store.setCommitmentStatus(promise.commitmentId,promise.revision,agentId==='alice'?'fulfilled':'broken',wall);
    }
    const before=readFileSync(f.options.agentPath),report=f.read();expect(report.sources.agent.status).toBe('available');
    if(report.sources.agent.status!=='available')throw Error('agent source');
    expect(report.sources.agent.value.social.relationships).toHaveLength(1);
    expect(report.sources.agent.value.social.relationships[0]).toMatchObject({observerAgentId:'alice',partnerAgentId:'bob',trust:30});
    expect(report.sources.agent.value.social.commitments[0]?.kind).toBe('observer-reported-cooperation');
    expect(JSON.stringify(report)).not.toContain('PRIVATE');expect(JSON.stringify(report)).not.toContain('secret');
    const both=reportNativeOutcomes(f.scope,{...f.options,allowedObserverAgentIds:['alice','bob']});
    if(both.sources.agent.status!=='available')throw Error('agent source');
    expect(both.sources.agent.value.social.relationships.map(r=>r.trust)).toEqual([30,-40]);
    expect(both.sources.agent.value.social.commitments[1]?.kind).toBe('observer-reported-conflict');
    expect(readFileSync(f.options.agentPath)).toEqual(before);expect(report.availability.unemploymentRate).toBeNull();
});
test('native-clock goal completion requires state evaluation; legacy skill progress never becomes strategy success',()=>{
    const f=fixture(),objective={policy:'si-b02.v1' as const,mode:'achieve' as const,purpose:'livelihood' as const,predicates:[{kind:'food-reserve-at-least' as const,value:2}]};
    f.store.createGoal('alice',{goalId:'life',horizon:'life',title:'PRIVATE GOAL'},wall);
    f.store.createGoal('alice',{goalId:'strategy',parentGoalId:'life',horizon:'long-term',title:'PRIVATE GOAL'},wall);
    f.store.createGoal('alice',{goalId:'reserve',parentGoalId:'strategy',horizon:'current',title:'PRIVATE GOAL',objective},wall);
    f.store.createGoal('alice',{goalId:'skill',parentGoalId:'reserve',horizon:'immediate',title:'PRIVATE SKILL',skill:{id:'food.safe',version:'1.0.0'},
        execution:{policy:'one-shot',requiredSuccessfulRuns:1,binding:{sourceKind:'goal',sourceId:'skill',parameters:{}}}},wall);
    // Real dispatch/outcome path records a successful skill, which does not satisfy its parent's reserve predicate.
    f.store.createAutonomyEnrollment('alice',{status:'desired',policyId:'fixture',policyVersion:'1.0.0'},wall);
    const p=f.store.getControlProfile('alice')!,runId=randomUUID();f.store.recordDecision('alice',p.revision,{decisionId:'decision',trigger:'event'},wall);
    f.store.recordSkillDispatch({runId,decisionId:'decision',agentId:'alice',goalId:'skill',skill:{id:'food.safe',version:'1.0.0'},
        binding:f.store.getGoalExecution('skill')!.binding,policyId:'fixture',policyVersion:'1.0.0'},wall);
    f.store.recordSkillRunOutcome(runId,'completed','completed','PRIVATE DETAIL',wall);
    const observation={agentId:'alice',binding:'a'.repeat(64),observedAt:wall,simulationTime:sim,
        facts:[{key:'own-food-portions',value:1,source:'own-engine-observation',cursor:wall,observedAt:wall,freshness:'fresh' as const,trust:'observed' as const}]};
    f.store.evaluateGoalStates('alice',observation,wall);
    let report=f.read();if(report.sources.agent.status!=='available')throw Error(JSON.stringify(report.sources.agent));
    expect(report.sources.agent.value.goals.rows.find(g=>g.goalId==='reserve')?.stateEvaluations[0]?.result).toBe('unsatisfied');
    expect(report.sources.agent.value.goals.rows.find(g=>g.goalId==='skill')).toMatchObject({completionBasis:'successful-skill-runs',successfulSkillRuns:1,nativeStrategySuccessInSimulationWindow:null});
    const later='2026-10-24T10:00:02.000Z';f.store.evaluateGoalStates('alice',{...observation,observedAt:later,facts:[{...observation.facts[0]!,value:2,observedAt:later,cursor:later}]},later);
    report=f.read();expect(report.sources.goalClock.status).toBe('available');if(report.sources.goalClock.status!=='available')throw Error('clock source');
    expect(report.sources.goalClock.value.transitions.find(t=>t.goalId==='reserve')).toMatchObject({basis:'state-predicate',simulationTime:'2001-01-01T00:00:02.000Z'});
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
    const foreign=reportNativeOutcomes({...f.scope,clockProfileDigest:'c'.repeat(64)},f.options);
    expect(foreign.sources.goalClock.status).toBe('invalid');
    const db=new OwnedDatabase(f.options.agentPath);try{db.run("UPDATE agent_state_evaluation SET result='satisfied' WHERE result='unsatisfied'");}finally{db.close();}
    expect(f.read().sources.agent.status).toBe('invalid');
});
test('native trades are observer-participation edges without inferred trust or access to other trades',()=>{
    const f=fixture();f.options.tradePath=join(f.workspace,'server/engine/data/mods/trade-evidence.sqlite');
    const ledger=new TradeEvidenceStore(f.options.tradePath,event=>f.clock.bindEventAtHead({clockId:'world',domain:'engine-trade',sourceId:event.eventId,sourceDigest:event.eventDigest,wallTime:event.committedAt,engineTick:event.tick}));
    try{for(const [fromUsername,toUsername]of [['alice','bob'],['bob','secret']])ledger.record({tick:1,fromUsername:fromUsername!,toUsername:toUsername!,fromItems:[{id:436,name:'Ore',count:1}],toItems:[],fromValue:0,toValue:0,committedAt:wall});}finally{ledger.close();}
    const report=f.read();expect(report.sources.trades.status).toBe('available');if(report.sources.trades.status!=='available')throw Error('trade source');
    expect(report.sources.trades.value).toHaveLength(1);expect(report.sources.trades.value[0]).toMatchObject({observerAgentId:'alice',partnerAgentId:'bob',trustChange:null});
    expect(JSON.stringify(report)).not.toContain('secret');
});
test('audited Business assignments keep requester and worker separate and do not convert shift minutes to simulation credit',()=>{
    const f=fixture();f.options.businessPath=join(f.workspace,'.local/business.sqlite');
    const manager=new BusinessManagerStore(f.options.businessPath),work=new BusinessWorkStore(f.options.businessPath);
    try{
        manager.create({businessId:'lumbridge-general-store',name:'Store',summary:'PRIVATE BUSINESS',ownerAgentId:'alice',propertyId:'lumbridge-general-store'},wall);
        const skill={id:'trade.lumbridge.give-item',version:'1.0.0'},employment=manager.hire('lumbridge-general-store',{
            workerAgentId:'bob',roleDefinitionId:'business.shop-clerk.v1',title:'Clerk',wageGp:25,requiredSkill:skill},wall);
        work.grantEntitlement({entitlementId:'counter',businessId:'lumbridge-general-store',propertyId:'lumbridge-general-store',facilityCapability:'retail.counter',validFrom:wall,validUntil:'2026-10-24T12:00:00.000Z'},wall);
        work.createWorkOrder('order','lumbridge-general-store.shop-clerk.v1',employment.employmentId,wall,'2026-10-24T11:00:00.000Z',wall);
        work.bindRequest({schemaVersion:1,workOrderId:'order',requesterAgentId:'alice',username:'bob',request:{requestId:'request',assigneeAgentId:'bob',skill,
            parameters:{},objective:'PRIVATE OBJECTIVE',rewardGp:25},target:{kind:'delivery',recipient:'alice',itemId:379,quantity:1,afterSequence:0,afterHash:'0'.repeat(64)},settlementId:'settlement',runId:null},wall);
        const report=f.read();if(report.sources.business.status!=='available')throw Error(JSON.stringify(report.sources.business));
        expect(report.sources.business.value.rows[0]).toMatchObject({registeredRequesterAgentId:'alice',assignedWorkerAgentId:'bob',productiveSimulationMs:null,queueWaitingSimulationMs:null});
        expect(JSON.stringify(report)).not.toContain('PRIVATE');
        const onlyWorker=reportNativeOutcomes({...f.scope,actorAgentIds:['bob']},f.options);
        if(onlyWorker.sources.business.status!=='available')throw Error('business source');
        expect(onlyWorker.sources.business.value.rows[0]?.registeredRequesterAgentId).toBeNull();
    }finally{work.close();manager.close();}
});
test('actual mock orchestration projects its durable queue and audit-reported usage without provider calls during reporting',async()=>{
    const f=fixture(),claims=new SqliteInferenceQueueClaimStore(f.options.queuePath!);closers.push(()=>claims.close());
    const provider=new ScriptedMockProvider([{output:{decision:'abstain',goalId:'reserve',reason:'PRIVATE REASON'},usage:{inputTokens:120,outputTokens:30,costMicros:0},providerRequestId:'mock-1'}]);
    const orchestrator=new LlmOrchestrator(validateLlmRuntimeConfig({schemaVersion:1,enabled:true,provider:'mock',model:'deterministic-scripted-v1',limits:{maxDurationMs:1000,maxModelRequests:1,maxToolCalls:1,maxCostMicros:10}}),
        provider,new JsonlLlmAuditSink(f.options.auditPath!),new InferenceQueue({claimStore:claims}));
    const plan=await orchestrator.plan({agentId:'alice',mode:'execute-immediate-goal',goal:{goalId:'reserve',title:'PRIVATE GOAL',description:'PRIVATE'},
        goalHierarchy:[{goalId:'reserve',parentGoalId:null,horizon:'immediate',title:'PRIVATE GOAL',description:'PRIVATE',priority:50}],trustedContext:'PRIVATE PROMPT',
        allowedSkills:[{id:'food.safe',version:'1.0.0',name:'Food',description:'Bounded food action'}],runId:'provider-run'});
    expect(plan.status).toBe('abstained');
    const report=f.read();if(report.sources.provider.status!=='available')throw Error(JSON.stringify(report.sources.provider));
    const measured=report.sources.provider.value;expect(measured.usage.costMicros.total).toBe('0');expect(measured.usage.inputTokens.total).toBe('120');
    expect(measured.runs[0]!.admissionToRunStartWallMs).toBeGreaterThanOrEqual(0);expect(measured.runs[0]!.providerStageElapsedWallMs).toBeGreaterThanOrEqual(0);
    expect(measured.runs[0]!.providerActiveServiceWallMs).toBeNull();expect(JSON.stringify(report)).not.toContain('PRIVATE');expect(provider.requests).toHaveLength(1);
});
test('partial, duplicate and ambiguous provider evidence never invents calls, tokens, cost or wall-to-simulation time',()=>{
    const window={from:wall,to:'2026-10-24T10:01:00.000Z'},event=(type:string,data:Record<string,unknown>={},seconds=1)=>({runId:'r',agentId:'alice',type,provider:'mock',model:'fixture',timestamp:`2026-10-24T10:00:0${seconds}.000Z`,data});
    const request=event('model.requested'),response=event('model.responded',{inputTokens:10,outputTokens:2,costMicros:7},3),json=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
    const q=[{request_id:'r',agent_id:'alice',status:'completed',enqueued_at:wall,completed_at:'2026-10-24T10:00:04.000Z'}];
    const full=providerOutcomes(json([event('run.started',{},1),request,response,response]),q,['alice'],window);
    expect(full.runs).toHaveLength(1);expect(full.usage.costMicros.total).toBe('7');expect(full.runs[0]).toMatchObject({admissionToRunStartWallMs:1000,providerStageElapsedWallMs:2000,admissionToCompletionWallMs:4000});
    expect(providerOutcomes(json([request]),null,['alice'],window).usage.costMicros.total).toBeNull();
    expect(providerOutcomes(json([request,response,{...response,data:{costMicros:9}}]),q,['alice'],window).usage.costMicros.total).toBeNull();
    expect(providerOutcomes(json([request,response]),null,['bob'],window).usage.costMicros.total).toBeNull();
    expect(()=>providerOutcomes(json([request]).trimEnd(),q,['alice'],window)).toThrow('Truncated');
    expect(()=>providerOutcomes(json([request,{...response,data:{costMicros:-1}}]),q,['alice'],window)).toThrow('count');
    expect(providerOutcomes(json([request,response]),q,['alice'],{from:wall,to:'2026-10-24T10:00:02.000Z'}).usage.costMicros.total).toBeNull();
    const missing=[...q,{...q[0]!,request_id:'unlogged',enqueued_at:request.timestamp}];
    expect(providerOutcomes(json([request,response]),missing,['alice'],window).usage.costMicros.total).toBeNull();
});
test('backend scope is checked before source reads; evaluation/dashboard/admin preserve auth and ignore uploaded paths/observer requests',async()=>{
    const f=fixture(),invalid={...f.options,agentPath:'C:/untrusted.sqlite'};
    expect(()=>reportNativeOutcomes({...f.scope,actorAgentIds:['secret']},invalid)).toThrow('backend actor scope');
    const options={configDirectory:resolve(import.meta.dir,'../../config'),nativeOutcomes:f.options};
    expect(reportSocietyEvaluation(f.scope,options).nativeOutcomes?.digest).toBe(f.read().digest);
    expect(reportSocietyDashboard(f.scope,{},options).evaluation.nativeOutcomes?.observerAgentIds).toEqual(['alice']);
    const query=new URLSearchParams({from:f.scope.fromSimulationTime,to:f.scope.toSimulationTime,clockId:'world',clockProfileDigest:f.scope.clockProfileDigest,
        agentPath:'C:/untrusted.sqlite',observer:'bob'});for(const actor of f.scope.actorAgentIds)query.append('actor',actor);
    const url=new URL(`http://localhost/api/admin/society/outcomes?${query}`),context={gatewayBots:()=>new Map(),supervisor:{} as BotSupervisor,nativeOutcomeOptions:f.options};
    expect((await handleAdminRequest(new Request(url),url,context))?.status).toBe(401);
    const response=(await handleAdminRequest(new Request(url,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),url,context))!;
    expect(response.status).toBe(200);expect((await response.json()).observerAgentIds).toEqual(['alice']);
    const denied=new URL(url);denied.searchParams.delete('actor');denied.searchParams.append('actor','secret');
    expect((await handleAdminRequest(new Request(denied,{headers:{'X-Admin-Request':'rs-sdk-admin'}}),denied,context))?.status).toBe(400);
    const missing=reportNativeOutcomes(f.scope,{...f.options,agentPath:join(f.workspace,'.local/missing.sqlite')});expect(missing.sources.agent.status).toBe('unavailable');
    expect(()=>readFileSync(join(f.workspace,'.local/missing.sqlite'))).toThrow();
    writeFileSync(f.options.auditPath!,'PRIVATE MALFORMED AUDIT');const malformed=f.read();
    expect(malformed.sources.provider.status).toBe('invalid');expect(JSON.stringify(malformed)).not.toContain('PRIVATE');
});
test('CLI exports only explicit actor/observer selection and leaves a missing native checkpoint absent',async()=>{
    const f=fixture(),checkpoint=join(f.workspace,'server/engine/data/player-checkpoints.sqlite');
    const child=Bun.spawn({cmd:[process.execPath,resolve(import.meta.dir,'../../scripts/report-society-outcomes.ts'),'--workspace',f.workspace,
        '--world',f.options.worldId,'--checkpoint',checkpoint,'--from',f.scope.fromSimulationTime,'--to',f.scope.toSimulationTime,
        '--clock-id','world','--clock-profile-digest',f.scope.clockProfileDigest,'--actor','alice','--actor','bob','--observer','alice'],stdout:'pipe',stderr:'pipe'});
    const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(exit,err).toBe(0);const report=JSON.parse(out);expect(report.observerAgentIds).toEqual(['alice']);expect(report.sources.agent.status).toBe('available');
    expect(report.sources.work.status).toBe('unavailable');expect(()=>readFileSync(checkpoint)).toThrow();
});
