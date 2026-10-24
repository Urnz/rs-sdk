import World from '../engine/World.js';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import ObjType from '../cache/config/ObjType.js';
import NpcType from '../cache/config/NpcType.js';
import VarPlayerType from '../cache/config/VarPlayerType.js';
import { PlayerStat } from '../engine/entity/PlayerStat.js';
import JavaRandom from '../util/JavaRandom.js';
import { NativeFoodProductionStore, LOBSTER, validateFoodProductionAction } from './NativeFoodProductionStore.js';
import { BusinessManagerStore } from '../../../gateway/admin/business-manager.js';
import { BusinessAssetStore } from '../../../../business-assets/store.js';
import { handleInternalAdminRequest } from '../web/pages/internal-admin.js';
import { executeFoodSkillRequest, foodSkillActionId, foodSkillCheckpointPath, verifyFoodSkillRunSources, type NativeFoodSkillOptions } from '../../../gateway/admin/native-food-skills.js';
import { verifyAndPromoteSkill } from '../../../../agent-skills/verifier.js';
import { SkillExecutor } from '../../../../agent-skills/executor.js';
import { RsSdkSkillRuntime } from '../../../../agent-skills/rs-sdk-runtime.js';
import { validateSkillDefinition } from '../../../../agent-skills/validation.js';
import type { BotActions } from '../../../../sdk/actions.js';
import type { NativeFoodSkillCommand } from '../../../../sdk/society-food.js';
import { BusinessWorkStore, loadDefaultBusinessWorkPolicyCatalog, validateBusinessWorkPolicyCatalog } from '../../../../business-work/index.js';
import { loadDefaultBusinessRoleCatalog } from '../../../../business-roles/index.js';
import { AgentStateStore } from '../../../../agent-state/store.js';
import { InstitutionTreasuryStore } from '../../../gateway/admin/institution-treasury.js';
import { PlayerRewardStore } from './PlayerRewardStore.js';
import { readEconomicObservation } from '../../../gateway/admin/economic-observer-source.js';
import { adoptBoundedImmediatePlan } from '../../../gateway/admin/bounded-plan-adoption.js';
import { buildLlmPlanningInput } from '../../../../llm-runtime/planning.js';
import { LlmOrchestrator } from '../../../../llm-runtime/orchestrator.js';
import { ScriptedMockProvider } from '../../../../llm-runtime/mock-provider.js';
import { MemoryLlmAuditSink } from '../../../../llm-runtime/audit.js';
import { validateLlmRuntimeConfig } from '../../../../llm-runtime/config.js';
import type { GatewayBotSnapshot } from '../../../gateway/admin/types.js';
import { runPlayerStrategy, type PlayerStrategyContext } from '../../../gateway/admin/player-strategy-runtime.js';
import { CapabilityGapStore } from '../../../../agent-skills/capability-gaps.js';
import {runEconomicCooperation} from '../../../gateway/admin/economic-cooperation-runtime.js';
import {EconomicContractStore} from '../../../gateway/admin/economic-contracts.js';
import {recordAndSettleEconomicContractEvidence} from '../../../gateway/admin/economic-contract-settlement.js';
import type {CooperationPolicy} from '../../../gateway/admin/economic-cooperation-policy.js';
import type {AdminSkillRun} from '../../../gateway/admin/skill-history.js';
import {institutionTreasuryPathFor as cooperationTreasuryPath} from '../../../gateway/admin/treasury-paths.js';

import {root, loadPackedContent, fixture, kitchen, grant, request, options, sdkHarness, definition, closers, closeNativeFoodFixtures} from './native-food-skill-fixture.js';
beforeAll(loadPackedContent);
afterEach(closeNativeFoodFixtures);
test('SI-B02 model plan → adoption → native raw output does not satisfy cooked food reserve', async () => {
    const f = kitchen(), path = join(f.dir, 'agents.sqlite'), now = new Date().toISOString();
    const agents = new AgentStateStore(path); closers.push(() => agents.close());
    // Test-only reviewed definition; this does not publish a draft or alter a runtime allowlist.
    const skill = { ...definition('gather'), status: 'verified' as const };
    const reference = { id: skill.id, version: skill.version };
    agents.createIdentity({ agentId: 'prodtest', playerUsername: 'prodtest', displayName: 'Local', background: 'Fixture', personalityTraits: ['careful'] }, now);
    agents.createGoal('prodtest', { goalId: 'life', horizon: 'life', title: 'Live' }, now);
    agents.createGoal('prodtest', { goalId: 'strategy', parentGoalId: 'life', horizon: 'long-term', title: 'Eat' }, now);
    agents.createGoal('prodtest', { goalId: 'food', parentGoalId: 'strategy', horizon: 'current', title: 'Have cooked food',
        objective: { policy: 'si-b02.v1', mode: 'maintain', purpose: 'livelihood', predicates: [{ kind: 'food-reserve-at-least', value: 1 }] } }, now);
    agents.setSkillKnowledge('prodtest', reference, 'known', null, now);
    agents.setWorkingMemory('prodtest', null, { summary: 'At native lobster source', observedAt: now }, now);
    agents.createAutonomyEnrollment('prodtest', { status: 'desired', policyId: 'private-local-default', policyVersion: '1.0.0' }, now);
    agents.claimAutonomyEnrollment('prodtest', 1, 'native-test', new Date(Date.parse(now) + 60000).toISOString(), now);
    const observe = () => {
        const at = new Date().toISOString();
        const inventory = f.inv.items.flatMap(item => item ? [{ id: item.id, count: item.count }] : []);
        const gateway = { username: 'prodtest', status: 'active', lastStateReceivedAt: Date.parse(at),
            state: { player: { name: 'prodtest', isDead: false }, inventory } } as unknown as GatewayBotSnapshot;
        const o = readEconomicObservation('prodtest', { agentPath: path, workspace: f.dir, now: at,
            gatewayBots: new Map([['prodtest', gateway]]) });
        agents.evaluateGoalStates('prodtest', o, at); return o;
    };
    observe();
    const decisionId = 'native-plan';
    agents.recordDecision('prodtest', agents.getControlProfile('prodtest')!.revision, { decisionId, trigger: 'event' }, now);
    const input = buildLlmPlanningInput(agents.getSnapshot('prodtest')!, { context: { now }, runId: decisionId,
        availableSkills: [{ ...reference, name: skill.name, description: skill.description }] });
    const provider = new ScriptedMockProvider([{ output: { decision: 'propose_goal_plan', goalId: 'food',
        goals: [{ goalId: 'gather-food', parentGoalId: 'food', horizon: 'immediate', title: 'Gather food', description: 'One bounded attempt', priority: 70 }],
        tool: { name: 'execute_skill', arguments: { skillId: skill.id, version: skill.version } }, reason: 'Start acquiring food' }, usage: { costMicros: 0 } }]);
    const plan = await new LlmOrchestrator(validateLlmRuntimeConfig({ schemaVersion: 1, enabled: true,
        provider: 'mock', model: 'scripted', limits: { maxDurationMs: 1000, maxModelRequests: 1,
            maxToolCalls: 1, maxCostMicros: 0, maxOutputTokens: 1000 } }), provider, new MemoryLlmAuditSink()).plan(input);
    if (plan.decision?.kind !== 'propose-goal-plan') throw new Error(plan.reason);
    agents.createGoalProposal('prodtest', { proposalId: 'native-proposal', runId: decisionId, anchorGoalId: 'food', anchorGoalRevision: 1,
        goals: plan.decision.goals, skill: plan.decision.skill, reason: plan.decision.reason });
    observe(); const at = new Date().toISOString();
    const adopted = adoptBoundedImmediatePlan(agents, 'native-proposal', skill, { enabled: true,
        maxOperations: 1, maxTimeoutMs: 15000, allowedSkills: [{ ...reference, operations: ['food-gather'],
            itemNames: ['raw lobster'], maxQuantity: 1 }] }, {}, at);
    const runId = randomUUID();
    agents.recordSkillDispatch({ runId, decisionId, agentId: 'prodtest', goalId: adopted.goalId, skill: reference,
        binding: agents.getGoalExecution(adopted.goalId)!.binding, policyId: 'private-local-default', policyVersion: '1.0.0' });
    JavaRandom.setSeed(4096); f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
        const result = await new SkillExecutor(runtime).execute(skill, { runId });
        expect(result.status).toBe('completed'); expect(f.inv.getItemCount(377)).toBe(1);
        agents.recordSkillRunOutcome(runId, 'completed', 'completed', 'Native raw lobster receipt');
    });
    observe();
    expect(agents.getGoal(adopted.goalId)).toMatchObject({ status: 'active', stateEvaluation: { result: 'unsatisfied' } });
    expect(agents.getGoalExecution(adopted.goalId)).toMatchObject({ completion: { kind: 'native-state' }, progress: { successfulRuns: 1 } });
    // A second real packed-content action turns raw input into ready food.
    const cooked = f.cook(); expect(f.receipt(cooked)?.outcome).toBe('cooked');
    expect(f.inv.getItemCount(379)).toBe(1); observe();
    expect(agents.getGoal(adopted.goalId)?.status).toBe('completed');
    expect(agents.getGoal('food')).toMatchObject({ status: 'active', stateEvaluation: { result: 'satisfied' } });
}, 15000);

test('SI-B05 voluntary work offer → separate model consent → SDK native skill proof → finite reward',async()=>{
    const f=kitchen(),agentPath=join(f.dir,'.local/economy/agents.sqlite'),contractsPath=join(f.dir,'contracts.sqlite'),policyPath=join(f.dir,'cooperation.json');
    const s=new AgentStateStore(agentPath);closers.push(()=>s.close());const skill={...definition('gather'),status:'verified' as const};
    s.createIdentity({agentId:'kitchen-mind',displayName:'Kitchen',background:'Independent Business',personalityTraits:['careful'],controlProfile:{role:'institution',subjectKind:'business',subjectId:'fish-kitchen',
        decisionIntervalMs:60000,maxDecisionsPerDay:10,dailyLlmBudgetMicros:0,dailyOperationalBudgetGp:25}});
    s.createIdentity({agentId:'worker',playerUsername:'prodtest',displayName:'Worker',background:'Voluntary native service',personalityTraits:['independent']});
    s.setSkillKnowledge('worker',skill,'known',null);
    for(const id of ['kitchen-mind','worker']){s.createAutonomyEnrollment(id,{status:'desired',policyId:'private-local-default',policyVersion:'1.0.0'});
        s.claimAutonomyEnrollment(id,1,'native-cooperation',new Date(Date.now()+600000).toISOString());}
    s.setRelationship('kitchen-mind',null,{actorKey:'agent.worker',displayName:'Worker',trust:30});
    s.setRelationship('worker',null,{actorKey:'agent.kitchen-mind',displayName:'Kitchen',trust:20});
    const treasuryPath=cooperationTreasuryPath(agentPath),treasury=new InstitutionTreasuryStore(treasuryPath);treasury.setBalance('business','fish-kitchen',1,25);treasury.close();
    const pay={gp:5,items:[],service:null},service={gp:0,items:[],service:'one-native-invocation',skill:{id:skill.id,version:skill.version}};
    const policy:CooperationPolicy={schemaVersion:1,grants:['kitchen-mind','worker'].map(id=>({agentId:id,role:id==='worker'?'player':'institution',subjectKind:id==='worker'?'player':'business',
        subjectId:id==='worker'?'prodtest':'fish-kitchen',policyId:'private-local-default',policyVersion:'1.0.0',minimumTrust:0,maxGpPerAction:5,maxGpPerDay:10,maxItemUnits:0,maxTtlMs:300000,
        templates:[{templateId:'gather-shift',kind:'work',title:'Voluntary lobster input work',summary:'Pay only for canonical native gathering',ttlMs:300000,
            ownProvides:id==='worker'?service:pay,partnerProvides:id==='worker'?pay:service}]}))};writeFileSync(policyPath,JSON.stringify(policy));
    let modelCalls=0;const opts={agentPath,contractsPath,policyPath,requiredLeaseOwner:'native-cooperation',maxLlmCostMicros:0,
        playerState:()=>({observedAt:new Date().toISOString(),world:{player:{name:'prodtest',isDead:false},inventory:[]} as unknown as import('../../../../sdk/types.js').BotWorldState}),
        plan:async(input:import('../../../../llm-runtime/types.js').LlmPlanningInput)=>new LlmOrchestrator(validateLlmRuntimeConfig({schemaVersion:1,enabled:true,provider:'mock',model:'scripted',
            limits:{maxDurationMs:1000,maxModelRequests:1,maxToolCalls:1,maxCostMicros:0,maxOutputTokens:1000}}),new ScriptedMockProvider([request=>{
                modelCalls++;const choice=request.economicAlternatives!.find(a=>a.action===(request.agentId==='worker'?'accept-offer':'propose-work'))!;
                return {output:{decision:'select_economic_action',goalId:request.goal.goalId,alternativeId:choice.optionId,tool:null,goals:[],reason:'Independent bounded cooperation choice'},usage:{costMicros:0}};
            }]),new MemoryLlmAuditSink()).plan(input)};
    const event=(agentId:string)=>({agentId,eventId:randomUUID(),sourceKey:`own:${agentId}:work`,type:'significant-economic-change' as const,occurredAt:new Date().toISOString(),summary:'Own work opportunity'});
    const proposal=event('kitchen-mind');expect((await runEconomicCooperation('kitchen-mind',proposal,opts))?.status).toBe('completed');
    let contracts=new EconomicContractStore(contractsPath);expect(contracts.listContracts()).toHaveLength(0);contracts.close();
    expect((await runEconomicCooperation('worker',event('worker'),opts))?.status).toBe('completed');
    contracts=new EconomicContractStore(contractsPath);const contract=contracts.listContracts()[0]!;contracts.close();
    const avatars=new Map([['kitchen-mind',null],['worker','prodtest']]);
    const sources={workspace:f.dir,worldId:'fixture-world',checkpointPath:f.path,businessPath:f.businessPath};
    const fake:AdminSkillRun={runId:randomUUID(),username:'prodtest',skill,status:'completed',reason:'ACK',message:'No native proof',operations:1,durationMs:1,parameters:{},
        startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),events:[]};
    await expect(recordAndSettleEconomicContractEvidence(contract.contractId,'worker',fake,avatars,{agentPath,contractsPath,treasuryPath,nativeEvidence:sources})).rejects.toThrow('canonical native');
    const original=f.ports.identity;f.ports.identity=(...args)=>{const value=original(...args);return value?{...value,clock:{...value.clock,wallTime:new Date().toISOString()}}:null;};
    let terminal:AdminSkillRun|undefined;
    JavaRandom.setSeed(4096);f.player.setVar(VarPlayerType.getId('action_delay'),World.currentTick);
    await sdkHarness(f,async sdk=>{const runtime=new RsSdkSkillRuntime({} as BotActions,sdk,grant);runtime.test=async()=>true;
        const result=await new SkillExecutor(runtime).execute(skill,{runId:randomUUID()});expect(result.status).toBe('completed');
        terminal={...result,username:'prodtest',startedAt:result.events[0]!.timestamp,finishedAt:result.events.at(-1)!.timestamp};});
    const rewards=new PlayerRewardStore(f.path,false,f.market.db);closers.push(()=>rewards.close());let credits=0;
    const rewarder=async(username:string,amount:number,settlementId:string)=>{let receipt:ReturnType<PlayerRewardStore['credit']>;
        f.market.db.transaction(()=>{receipt=rewards.credit(settlementId,username,amount,{balance:()=>f.inv.getItemCount(995),credit:n=>{credits++;f.inv.add(995,n);return n;},remove:n=>f.inv.remove(995,n)});
            f.market.checkpoint(username,f.player.save(false),true);}).immediate();
        return {ok:true,commandId:randomUUID(),username,amount,settlementId,reward:{status:'committed' as const,coinsBefore:receipt!.coinsBefore!,coinsAfter:receipt!.coinsAfter!}};};
    const settlement={agentPath,contractsPath,treasuryPath,nativeEvidence:sources,rewarder};
    const paid=await recordAndSettleEconomicContractEvidence(contract.contractId,'worker',terminal!,avatars,settlement);
    expect(paid.contract.status).toBe('fulfilled');await recordAndSettleEconomicContractEvidence(contract.contractId,'worker',terminal!,avatars,settlement);
    await runEconomicCooperation('kitchen-mind',proposal,opts);expect(modelCalls).toBe(2);expect(credits).toBe(1);expect(f.inv.getItemCount(995)).toBe(5);expect(f.inv.getItemCount(377)).toBe(1);
    const reopened=new InstitutionTreasuryStore(treasuryPath);expect(reopened.get('business','fish-kitchen')?.balanceGp).toBe(20);reopened.close();
},15000);

test('SI-B03 model choice between resource paths → SDK native outcome → state evaluation', async () => {
    const f=kitchen(), agentPath=join(f.dir,'strategy-agents.sqlite'), agentId='abstract-node', start=new Date().toISOString();
    f.inv.add(995,20); f.market.checkpoint('prodtest',f.player.save(false),true);
    const agents=new AgentStateStore(agentPath); closers.push(()=>agents.close());
    const gather={...definition('gather'),status:'verified' as const};
    // The alternative shop view/definition is a controlled preflight fixture, not a native shop receipt.
    const purchase=validateSkillDefinition({schemaVersion:1,id:'fixture.food.purchase',version:'1.0.0',status:'verified',
        name:'Acquire one observed cooked food',description:'One bounded purchase',tags:[],parameters:{},
        sharing:{visibility:'shared'},provenance:{authorKind:'human',authorId:'fixture',createdAt:start},
        limits:{maxOperations:1,timeoutMs:1000},preconditions:[],steps:[{kind:'operation',id:'buy',operation:'buy-from-shop',
            arguments:{name:'Lobster',match:'exact',amount:1}}]});
    const definitions=[gather,purchase];
    agents.createIdentity({agentId,playerUsername:'prodtest',displayName:'Local planner',background:'Independent resource planning',personalityTraits:['careful']},start);
    agents.createGoal(agentId,{goalId:'life',horizon:'life',title:'Live'},start);
    agents.createGoal(agentId,{goalId:'strategy',parentGoalId:'life',horizon:'long-term',title:'Resources'},start);
    agents.createGoal(agentId,{goalId:'reserve',parentGoalId:'strategy',horizon:'current',title:'Cooked food reserve',objective:{policy:'si-b02.v1',
        mode:'maintain',purpose:'livelihood',predicates:[{kind:'food-reserve-at-least',value:1}]}},start);
    for(const d of definitions) agents.setSkillKnowledge(agentId,d,'known',null,start);
    agents.createAutonomyEnrollment(agentId,{status:'desired',policyId:'private-local-default',policyVersion:'1.0.0'},start);
    agents.claimAutonomyEnrollment(agentId,1,'native-strategy',new Date(Date.parse(start)+60000).toISOString(),start);
    const profile=agents.getControlProfile(agentId)!;
    agents.setControlProfile(agentId,profile.revision,{...profile,dailyOperationalBudgetGp:100},start);
    const event={eventId:'native-strategy',agentId,type:'significant-economic-change' as const,sourceKey:'fixture-resource-change',
        occurredAt:start,summary:'Resource situation changed'};
    const read=async ():Promise<PlayerStrategyContext>=>{
        const now=new Date().toISOString(), type=NpcType.get(f.npc.type);
        const world={tick:World.currentTick,player:{name:'prodtest',isDead:false,worldX:f.player.x,worldZ:f.player.z,level:f.player.level},
            inventory:f.inv.items.flatMap((i,slot)=>i?[{slot,id:i.id,name:ObjType.get(i.id).name,count:i.count,optionsWithIndex:[]}]:[]),
            skills:[{name:'Fishing',baseLevel:f.player.baseLevels[PlayerStat.FISHING]}],
            nearbyLocs:[],nearbyNpcs:[{id:f.npc.type,name:type.name,reachable:true,
                optionsWithIndex:(type.op??[]).flatMap((text,index)=>text?[{text,opIndex:index+1}]:[])}],
            shop:{isOpen:true,shopItems:[{id:379,name:'Lobster',count:2,buyPrice:2,sellPrice:1}]}} as unknown as import('../../../../sdk/types.js').BotWorldState;
        const gateway={username:'prodtest',status:'active',state:world,lastStateReceivedAt:Date.parse(now)} as unknown as GatewayBotSnapshot;
        agents.evaluateGoalStates(agentId,readEconomicObservation(agentId,{agentPath,workspace:f.dir,now,gatewayBots:new Map([['prodtest',gateway]])}),now);
        const previous=agents.getWorkingMemory(agentId);
        agents.setWorkingMemory(agentId,previous?.revision??null,{summary:'At native lobster source',observedAt:now},now);
        return {snapshot:agents.getSnapshot(agentId)!,profile:agents.getControlProfile(agentId)!,parent:agents.getGoal('reserve')!,world,observedAt:now,now,
            definitions,incoming:[],spentGp:0,maxLlmCostMicros:0,blockers:[],trustedContext:'Need one cooked-food portion. Native raw food requires processing.',
            sourceAreas:JSON.parse(readFileSync(join(f.dir,'config/native-food-production.json'),'utf8')).sources,
            config:{enabled:true,maxOperations:1,maxTimeoutMs:15000,allowedSkills:[{...gather,operations:['food-gather'],itemNames:['raw lobster'],maxQuantity:1},
                {...purchase,risk:'shop-buy',operations:['buy-from-shop'],itemNames:['lobster'],maxQuantity:1,maxUnitPriceGp:5,maxGpPerRun:5,maxGpPerDay:100}]}};
    };
    let calls=0;
    const result=await runPlayerStrategy(event,{agentPath,read,gaps:new CapabilityGapStore(join(f.dir,'strategy-gaps.json')),
        plan:async(context,request)=>new LlmOrchestrator(validateLlmRuntimeConfig({schemaVersion:1,enabled:true,provider:'mock',model:'scripted',
            limits:{maxDurationMs:1000,maxModelRequests:1,maxToolCalls:1,maxCostMicros:0,maxOutputTokens:1000}}),
        new ScriptedMockProvider([input=>{calls++;expect(input.alternatives).toHaveLength(2);
            return {output:{decision:'select_alternative',goalId:'reserve',alternativeId:input.alternatives!.find(o=>o.skill.id===gather.id)!.optionId,
                goals:[],tool:null,reason:'Choose the observed production path and retain cash for later needs'},usage:{costMicros:0}};}]),
        new MemoryLlmAuditSink()).plan(buildLlmPlanningInput(context.snapshot,{context:{now:context.now},runId:event.eventId,
            availableSkills:definitions,strategy:{parentGoalId:'reserve',alternatives:request.options.map(({binding,...o})=>o)}})),
        dispatch:async(goalId,d,binding,decisionId)=>{
            const runId=randomUUID();agents.recordSkillDispatch({runId,decisionId,agentId,goalId,skill:d,binding,policyId:'private-local-default',policyVersion:'1.0.0'});
            JavaRandom.setSeed(4096);f.player.setVar(VarPlayerType.getId('action_delay'),World.currentTick);
            await sdkHarness(f,async sdk=>{const runtime=new RsSdkSkillRuntime({} as BotActions,sdk,grant);runtime.test=async()=>true;
                const outcome=await new SkillExecutor(runtime).execute(d,{runId,parameters:binding.parameters});
                expect(outcome.status).toBe('completed');
                expect(outcome.events.find(e=>e.type==='step.succeeded')?.data).toMatchObject({receipt:{outcome:'raw-gained'}});
                agents.recordSkillRunOutcome(runId,'completed','completed','Canonical native gathering receipt');});
            await read();return {runId,status:'completed',reason:'Native attempt complete'};
        }});
    if(result.status!=='completed')throw new Error(result.reason);
    const record=agents.getPlayerStrategy(event.eventId)!;
    expect(calls).toBe(1);expect(record.status).toBe('dispatched');
    expect(agents.getGoal(record.goalId!)).toMatchObject({status:'active',stateEvaluation:{result:'unsatisfied'}});
    expect(f.inv.getItemCount(377)).toBe(1);
    const cooked=f.cook();expect(f.receipt(cooked)?.outcome).toBe('cooked');await read();
    expect(agents.getGoal(record.goalId!)?.status).toBe('completed');
    expect(agents.getGoal('reserve')?.status).toBe('active');
},15000);

test('executor → real SDK socket → gateway adapter → packed gathering correlates one immutable receipt', async () => {
    const f = kitchen(); JavaRandom.setSeed(4096); f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
    expect(f.market.db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_delivery_schema'").get()).toBeNull();
    expect(foodSkillCheckpointPath(f.dir, 'fixture-world', { PLAYER_CHECKPOINT_DATABASE: f.path })).toBe(f.path);
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
        const executor = new SkillExecutor(runtime), runId = randomUUID(), skill = definition('gather');
        const first = await executor.execute(skill, { runId, allowDraft: true });
        expect(first.status).toBe('completed'); expect(f.inv.getItemCount(377)).toBe(1);
        const event = first.events.find(event => event.type === 'step.succeeded')!;
        expect(event.data).toMatchObject({ status: 'terminal', receipt: { outcome: 'raw-gained', action: { username: 'prodtest' } },
            context: { runId, stepId: 'gather' } });
        expect((await executor.execute(skill, { runId, allowDraft: true })).status).toBe('completed');
        expect(f.inv.getItemCount(377)).toBe(1);
        const file = join(f.dir, '.local/agent-skills/food-operations', `${event.data!.actionId}.json`);
        expect(JSON.parse(readFileSync(file, 'utf8')).request.context.parametersDigest).toBe(event.data!.parametersDigest);
    });
});
test('executor → SDK consumes once at full HP and returns a canonical consume receipt rather than HP evidence', async () => {
    const f = kitchen(); f.inv.add(379, 2); f.market.checkpoint('prodtest', f.player.save(false), true);
    const slot = f.inv.items.findIndex(item => item?.id === 379), hp = f.player.levels[PlayerStat.HITPOINTS];
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
        const executor = new SkillExecutor(runtime), runId = randomUUID(), skill = definition('consume');
        const result = await executor.execute(skill, { runId, allowDraft: true, parameters: { slot } });
        expect(result.status).toBe('completed'); expect(f.inv.getItemCount(379)).toBe(1);
        expect(f.player.levels[PlayerStat.HITPOINTS]).toBe(hp);
        expect(result.events.find(event => event.type === 'step.succeeded')!.data).toMatchObject({ receipt: { outcome: 'consumed', receipt: { hpBefore: hp, hpAfter: hp } } });
        expect((await executor.execute(skill, { runId, allowDraft: true, parameters: { slot } })).status).toBe('completed');
        expect(f.inv.getItemCount(379)).toBe(1);
    });
});
test('executor → SDK cooks exact WIP custody, settles Business once and refuses a second independent skill claim', async () => {
    const f = kitchen(); f.prepare(); JavaRandom.setSeed(4096);
    await sdkHarness(f, async sdk => {
        const bot = { walkTo: async () => ({ success: true, message: 'at the configured heat' }) } as unknown as BotActions;
        const runtime = new RsSdkSkillRuntime(bot, sdk, grant); runtime.test = async () => true;
        const runId = randomUUID(), executor = new SkillExecutor(runtime), skill = definition('cook');
        const parameters = { 'kitchen-run': f.intent.runId, 'batch-id': f.intent.batchId };
        const result = await executor.execute(skill, { runId, allowDraft: true, parameters });
        expect(result.status).toBe('completed'); expect(f.work.get(f.intent.runId)!.status).toBe('completed');
        expect(f.inv.getItemCount(377)).toBe(0); expect(f.inv.getItemCount(379)).toBe(0);
        expect(result.events.find(event => event.operation === 'food-cook' && event.type === 'step.succeeded')!.data)
            .toMatchObject({ receipt: { outcome: 'cooked', custody: { runId: f.intent.runId } }, batchId: f.intent.batchId });
        expect((await executor.execute(skill, { runId, allowDraft: true, parameters })).status).toBe('completed');
        const duplicate = await executor.execute(skill, { allowDraft: true, parameters });
        expect(duplicate.status).toBe('failed'); expect(duplicate.message).toContain('another skill run');
    });
});

for (const burnt of [false, true]) test(`SI-A08 packed cook shift ${burnt ? 'burns without earning a wage' : 'earns and pays exactly one source-backed wage'}`, async () => {
    // Gateway UI modules use the root TypeScript project; load that boundary at runtime in this isolated engine harness.
    const gatewayModule = '../../../gateway/admin/agent-state.js';
    const { createAdminAgent, createAdminBusinessWorkRequest, delegateBusinessPlayerAction, finishAdminPlayerActionRun,
        institutionTreasuryPathFor, settleAdminPlayerActionReward } = await import(gatewayModule);
    const f = kitchen('kitchenowner'), skill = definition('cook'), agentPath = join(f.dir, '.local/economy/agents.sqlite');
    const manager = new BusinessManagerStore(f.businessPath), old = manager.get('fish-kitchen')!.employments[0]!;
    manager.endEmployment('fish-kitchen', old.employmentId, old.revision);
    const employment = manager.hire('fish-kitchen', { workerAgentId: 'actor-prodtest', roleDefinitionId: 'business.cook.v1', title: 'Cook',
        wageGp: 25, requiredSkill: { id: skill.id, version: skill.version } });
    const policy = manager.proposePolicy('fish-kitchen', { proposalId: randomUUID(), proposerAgentId: 'kitchen-mind',
        objective: 'Cook one reserved lobster.', mode: 'balanced', maxRewardGp: 25, preferredSkills: [{ id: skill.id, version: skill.version }] });
    manager.resolvePolicy('fish-kitchen', policy.proposalId, policy.revision, 'approve', 'Fixture authority.'); manager.close();
    createAdminAgent({ agentId: 'kitchen-mind', displayName: 'Kitchen', background: 'Kitchen institution.', personalityTraits: ['prudent'],
        controlProfile: { role: 'institution', subjectKind: 'business', subjectId: 'fish-kitchen', decisionIntervalMs: 60000,
            maxDecisionsPerDay: 24, dailyLlmBudgetMicros: 100000, dailyOperationalBudgetGp: 1000 } }, agentPath);
    createAdminAgent({ agentId: 'actor-prodtest', playerUsername: 'prodtest', displayName: 'Cook', background: 'Cook worker.', personalityTraits: ['reliable'] }, agentPath);
    const agents = new AgentStateStore(agentPath); agents.setSkillKnowledge('actor-prodtest', skill, 'known', null); agents.close();
    // Isolated fixture capability only: the real shared procedure remains an unpublished draft.
    const roles = loadDefaultBusinessRoleCatalog(); roles.verifiedSkillKeys.push(`${skill.id}@${skill.version}`);
    const template = loadDefaultBusinessWorkPolicyCatalog().policies.find(p => p.roleDefinitionId === 'business.cook.v1')!;
    const catalog = validateBusinessWorkPolicyCatalog({ schemaVersion: 1, policies: [{ ...template, businessId: 'fish-kitchen' }] });
    const runRoot = join(f.dir, '.local/agent-skills/runs'); mkdirSync(runRoot, { recursive: true });
    const settings = { workspace: f.dir, worldId: 'fixture-world', checkpointPath: f.path, catalog, roles, runRoot,
        rewardPath: join(f.dir, 'wage-receipts.sqlite') };
    const start = new Date(Date.now() - 120000).toISOString(), end = new Date(Date.now() + 600000).toISOString();
    const shifts = new BusinessWorkStore(f.businessPath, catalog, roles);
    shifts.grantEntitlement({ entitlementId: 'cook-shift-heat', businessId: 'fish-kitchen', propertyId: 'karamja.fishing-hut',
        facilityCapability: 'cooking.heat-source', validFrom: start, validUntil: end });
    shifts.createWorkOrder('native-cook-shift', template.policyId, employment.employmentId, start, end); shifts.close();
    const treasury = new InstitutionTreasuryStore(institutionTreasuryPathFor(agentPath)); treasury.setBalance('business', 'fish-kitchen', 1, 25); treasury.close();
    f.prepare(); const originalClock = f.clock; f.clock = () => ({ ...originalClock(), wallTime: new Date().toISOString() });
    const parameters = { 'kitchen-run': f.intent.runId, 'batch-id': f.intent.batchId };
    const request = createAdminBusinessWorkRequest('native-cook-shift', 'kitchen-mind', parameters,
        { kind: 'cook', kitchenRunId: f.intent.runId, batchId: f.intent.batchId }, agentPath, settings, start);
    if (!burnt) {
        const duplicate = new BusinessWorkStore(f.businessPath, catalog, roles);
        duplicate.createWorkOrder('duplicate-cook-shift', template.policyId, employment.employmentId, start, end); duplicate.close();
        expect(() => createAdminBusinessWorkRequest('duplicate-cook-shift', 'kitchen-mind', parameters,
            { kind: 'cook', kitchenRunId: f.intent.runId, batchId: f.intent.batchId }, agentPath, settings, start)).toThrow('UNIQUE');
    }
    const runId = randomUUID(); delegateBusinessPlayerAction(request.requestId, runId, agentPath, start, settings);
    await sdkHarness(f, async sdk => {
        const bot = { walkTo: async () => ({ success: true, message: 'at configured heat' }) } as unknown as BotActions;
        const runtime = new RsSdkSkillRuntime(bot, sdk, grant); runtime.test = async () => true;
        JavaRandom.setSeed(burnt ? 1 : 4096);
        const result = await new SkillExecutor(runtime).execute(skill, { runId, allowDraft: true, parameters }); result.username = 'prodtest';
        writeFileSync(join(runRoot, `${runId}.json`), JSON.stringify(result));
        expect(result.status).toBe(burnt ? 'failed' : 'completed');
    });
    const terminal = finishAdminPlayerActionRun(runId, true, 'Exit code 0 is insufficient.', agentPath, null, settings)!;
    const earned = new BusinessWorkStore(f.businessPath, catalog, roles);
    expect(earned.get('native-cook-shift')!.wageStatus).toBe(burnt ? 'unearned' : 'earned'); earned.close();
    if (burnt) { expect(terminal.status).toBe('running'); return; }
    let balance = 0, credits = 0;
    const rewarder = async (username: string, amount: number, settlementId: string) => {
        const rewards = new PlayerRewardStore(settings.rewardPath, false);
        try { const receipt = rewards.credit(settlementId, username, amount, { balance: () => balance,
            credit: n => { balance += n; credits++; return n; }, remove: n => { balance -= n; return n; } });
            return { ok: true, commandId: randomUUID(), settlementId, username, amount,
                reward: { status: 'committed' as const, coinsBefore: receipt.coinsBefore!, coinsAfter: receipt.coinsAfter! } };
        } finally { rewards.close(); }
    };
    await settleAdminPlayerActionReward(terminal.settlementId!, agentPath, rewarder, settings);
    await settleAdminPlayerActionReward(terminal.settlementId!, agentPath, rewarder, settings);
    const paid = new BusinessWorkStore(f.businessPath, catalog, roles);
    expect(paid.get('native-cook-shift')!).toMatchObject({ wageStatus: 'paid', wageSettlementId: terminal.settlementId }); paid.close();
    expect(credits).toBe(1); expect(balance).toBe(25);
});
test('successful dispatch without a source receipt stays uncertain and replay never dispatches again', async () => {
    const f = kitchen(), opts = options(f), command = request('food-gather'); let calls = 0;
    opts.dispatch = async () => { calls++; return { ok: true, receipt: 'untrusted' }; };
    expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toMatchObject({ success: false, reason: 'food-uncertain' });
    expect(await executeFoodSkillRequest({ ...opts }, 'prodtest', command)).toMatchObject({ success: false, reason: 'food-uncertain' });
    expect(calls).toBe(1); expect(f.inv.getItemCount(377)).toBe(0);
    const rejected = request('food-gather'); let rejectedCalls = 0;
    const reject = { ...opts, dispatch: async () => { rejectedCalls++; throw new Error('Native worker is busy'); } };
    expect(await executeFoodSkillRequest(reject, 'prodtest', rejected)).toMatchObject({ success: false, reason: 'food-uncertain',
        data: { dispatchError: 'Native worker is busy', status: 'uncertain' } });
    expect(await executeFoodSkillRequest(reject, 'prodtest', rejected)).toMatchObject({ success: false, reason: 'food-uncertain' });
    expect(rejectedCalls).toBe(1); expect(f.inv.getItemCount(377)).toBe(0);
});
test('lost dispatch ack is recovered from the canonical source with the same action ID', async () => {
    const f = kitchen(), opts = options(f), command = request('food-gather'); JavaRandom.setSeed(4096);
    f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
    const dispatch = opts.dispatch; opts.dispatch = async command => { await dispatch(command); throw new Error('lost ack'); };
    expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toMatchObject({ success: true, reason: 'food-raw-gained' });
    expect(new NativeFoodProductionStore(f.market.db).get(foodSkillActionId(command))!.action.actionId).toBe(foodSkillActionId(command));
});
test('same-run parameter/slot changes and foreign source identity fail closed', async () => {
    const f = kitchen(), opts = options(f), command = request('food-consume'); f.inv.add(379, 1);
    await executeFoodSkillRequest(opts, 'prodtest', command);
    await expect(executeFoodSkillRequest(opts, 'prodtest', { ...command, args: { ...command.args, slot: 2 } })).rejects.toThrow('binding differs');
    await expect(executeFoodSkillRequest(opts, 'prodtest', { ...command, context: { ...command.context, parametersDigest: 'c'.repeat(64) } })).rejects.toThrow('binding differs');
    const prior = opts.binding; opts.binding = username => ({ ...prior(username), worldId: 'foreign' });
    await expect(executeFoodSkillRequest(opts, 'prodtest', request('food-consume'))).rejects.toThrow('identity differs');
});
test('wrong WIP batch or worker cannot issue Business material', async () => {
    const f = kitchen(), opts = options(f); f.prepare();
    await expect(executeFoodSkillRequest(opts, 'prodtest', request('food-cook', { batchId: 'other-batch' }))).rejects.toThrow('batch/worker');
    expect(f.command('issue').phase).toBe('issued'); expect(f.inv.getItemCount(377)).toBe(0);
});
test('gather checkpoint failure restores inventory and XP but preserves uncertain durable admission', async () => {
    const f = kitchen(), opts = options(f), command = request('food-gather'); JavaRandom.setSeed(4096);
    f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
    const stats = [...f.player.stats]; let checkpoints = 0;
    f.ports.checkpoint = save => { if (++checkpoints === 2) throw new Error('checkpoint fault after native XP'); f.market.checkpoint('prodtest', save, true); };
    expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toMatchObject({ success: false, reason: 'food-uncertain' });
    expect([...f.player.stats]).toEqual(stats); expect(f.inv.getItemCount(377)).toBe(0);
    expect(checkpoints).toBe(2); expect([...f.player.weakQueue.all()]).toHaveLength(0); expect(f.player.target).toBeNull();
    expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toMatchObject({ success: false, reason: 'food-uncertain' });
    expect(f.inv.getItemCount(377)).toBe(0);
});
test('native burn is a failed skill outcome and never a cooked Business output', async () => {
    const f = kitchen(), opts = options(f); f.prepare(); JavaRandom.setSeed(1);
    const command = request('food-cook'); let result = await executeFoodSkillRequest(opts, 'prodtest', command);
    if (result.data?.status === 'waiting') result = await executeFoodSkillRequest(opts, 'prodtest', command);
    expect(result).toMatchObject({ success: false, reason: 'food-burnt', data: { receipt: { outcome: 'burnt' } } });
    expect(f.work.get(f.intent.runId)!.status).toBe('running');
    const assets = new BusinessAssetStore(f.businessPath);
    try { expect(assets.listAssets('fish-kitchen', null).find(item => item.itemId === 379)?.count ?? 0).toBe(0); }
    finally { assets.close(); }
});
test('native food internal endpoint rejects missing tokens and extra receipt/worker fields', async () => {
    const url = new URL('http://localhost/api/internal/admin/native-food-skill'), prior = process.env.ENGINE_ADMIN_TOKEN;
    process.env.ENGINE_ADMIN_TOKEN = 'isolated-food-token';
    try {
        const command: NativeFoodSkillCommand = { operation: 'consume', actionId: randomUUID(), username: 'prodtest', slot: 1, sourceId: null };
        expect((await handleInternalAdminRequest(new Request(url, { method: 'POST', body: JSON.stringify({ commandId: randomUUID(), ...command }) }), url))!.status).toBe(401);
        expect((await handleInternalAdminRequest(new Request(url, { method: 'POST', headers: { 'X-Engine-Admin-Token': 'isolated-food-token' },
            body: JSON.stringify({ commandId: randomUUID(), ...command, receipt: {}, worker: 'other' }) }), url))!.status).toBe(400);
    } finally { if (prior === undefined) delete process.env.ENGINE_ADMIN_TOKEN; else process.env.ENGINE_ADMIN_TOKEN = prior; }
});

test('two independent source-backed fixture runs satisfy the verifier; missing or changed sources cannot publish', async () => {
    const f = kitchen(), evidence: import('../../../../agent-skills/types.js').SkillRunResult[] = [];
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
        for (let trial = 0; trial < 2; trial++) {
            JavaRandom.setSeed(4096); f.player.setVar(VarPlayerType.getId('action_delay'), World.currentTick);
            const run = await new SkillExecutor(runtime).execute(definition('gather'), { allowDraft: true }); run.username = 'prodtest';
            expect(run.status).toBe('completed'); evidence.push(run);
        }
    });
    const opts = options(f), verifyFoodEvidence = (run: typeof evidence[number]) => verifyFoodSkillRunSources(f.dir, run, opts);
    const report = verifyAndPromoteSkill(definition('gather'), evidence, { targetVersion: '1.0.0', verifyFoodEvidence });
    expect(report.passed).toBeTrue(); expect(report.evidenceRunIds).toHaveLength(2);
    expect(verifyAndPromoteSkill(definition('gather'), evidence, { targetVersion: '1.0.0' }).passed).toBeFalse();
    const changed = structuredClone(evidence); changed[0]!.events.find(event => event.type === 'step.succeeded')!.data!.receiptDigest = 'f'.repeat(64);
    expect(verifyAndPromoteSkill(definition('gather'), changed, { targetVersion: '1.0.0', verifyFoodEvidence }).passed).toBeFalse();
    const duplicated = structuredClone(evidence); const first = duplicated[0]!.events.find(event => event.type === 'step.succeeded')!.data!;
    duplicated[1]!.events.find(event => event.type === 'step.succeeded')!.data!.receipt = first.receipt;
    expect(verifyAndPromoteSkill(definition('gather'), duplicated, { targetVersion: '1.0.0', verifyFoodEvidence }).passed).toBeFalse();
    // This isolated fixture report is not copied to the live workspace, trial store or reviewed catalog.
});

test('two independent cooking trials bind different WIP inputs while retaining identical functional parameters', async () => {
    const f = kitchen(), evidence: import('../../../../agent-skills/types.js').SkillRunResult[] = [];
    f.prepare();
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({ walkTo: async () => ({ success: true, message: 'at heat' }) } as unknown as BotActions, sdk, grant);
        runtime.test = async () => true;
        for (let trial = 0; trial < 2; trial++) {
            let runId = f.intent.runId, batchId = f.intent.batchId;
            if (trial) {
                const manager = new BusinessManagerStore(f.businessPath);
                try { manager.creditGenesisInventory('second-independent-trial-input', 'fish-kitchen', 377, 1); } finally { manager.close(); }
                runId = 'cook-run-2'; batchId = 'cook-batch-2';
                f.work.reserveNativeKitchen({ ...f.reservation, operationId: 'reserve-cook-2', runId },
                    { ...f.intent, runId, batchId, actionId: randomUUID(), inputEscrowId: randomUUID(), outputEscrowId: randomUUID() },
                    f.facilities, f.clock().simulationTime, () => true);
            }
            World.currentTick += 10; JavaRandom.setSeed(4096);
            const run = await new SkillExecutor(runtime).execute(definition('cook'), { allowDraft: true,
                parameters: { 'kitchen-run': runId, 'batch-id': batchId } });
            run.username = 'prodtest'; expect(run.status).toBe('completed'); evidence.push(run);
        }
    });
    expect(verifyAndPromoteSkill(definition('cook'), evidence, { targetVersion: '1.0.0',
        parameters: evidence[0]!.parameters, verifyFoodEvidence: run => verifyFoodSkillRunSources(f.dir, run, options(f)) }).passed).toBeTrue();
    expect(evidence[0]!.parameters).not.toEqual(evidence[1]!.parameters);
});
test('two independent consumption trials require two physically spent native actions', async () => {
    const f = kitchen(), evidence: import('../../../../agent-skills/types.js').SkillRunResult[] = [];
    await sdkHarness(f, async sdk => {
        const runtime = new RsSdkSkillRuntime({} as BotActions, sdk, grant); runtime.test = async () => true;
        for (let trial = 0; trial < 2; trial++) {
            f.inv.add(379, 1); World.currentTick += 10; f.market.checkpoint('prodtest', f.player.save(false), true);
            const slot = f.inv.items.findIndex(item => item?.id === 379);
            const run = await new SkillExecutor(runtime).execute(definition('consume'), { allowDraft: true, parameters: { slot } });
            run.username = 'prodtest'; expect(run.status).toBe('completed'); evidence.push(run);
        }
    });
    expect(f.inv.getItemCount(379)).toBe(0);
    expect(verifyAndPromoteSkill(definition('consume'), evidence, { targetVersion: '1.0.0', parameters: evidence[0]!.parameters,
        verifyFoodEvidence: run => verifyFoodSkillRunSources(f.dir, run, options(f)) }).passed).toBeTrue();
});
test('cold native fishing preparation waits through real ticks, reopens safely and performs only one roll', async () => {
    const f = kitchen(), opts = options(f), command = request('food-gather'); JavaRandom.setSeed(4096);
    expect(f.player.getVar(VarPlayerType.getId('action_delay'))).toBe(0);
    const waiting = await executeFoodSkillRequest(opts, 'prodtest', command);
    expect(waiting).toMatchObject({ success: false, data: { status: 'waiting', attempt: { phase: 'waiting', wakeTick: 105 } } });
    expect(f.inv.getItemCount(377)).toBe(0); expect(f.player.target).toBeNull();
    World.currentTick = 105;
    const result = await executeFoodSkillRequest({ ...opts }, 'prodtest', command);
    expect(result).toMatchObject({ success: true, reason: 'food-raw-gained' });
    expect(f.inv.getItemCount(377)).toBe(1);
    expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toEqual(result);
    expect(f.inv.getItemCount(377)).toBe(1);
    f.market.db.run('DELETE FROM native_food_skill_attempt');
    await expect(executeFoodSkillRequest(opts, 'prodtest', { ...command, context: { ...command.context, runId: randomUUID() } })).rejects.toThrow('coverage');
});

test('a missed native preparation tick ends without output and cannot restart preparation or roll on replay', async () => {
    for (const resetPreparation of [false, true]) {
        const f = kitchen(), opts = options(f), command = request('food-gather'); JavaRandom.setSeed(4096);
        expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toMatchObject({ data: { status: 'waiting' } });
        World.currentTick = resetPreparation ? 101 : 106;
        if (resetPreparation) f.player.setVar(VarPlayerType.getId('action_delay'), 0);
        const ended = await executeFoodSkillRequest(opts, 'prodtest', command);
        expect(ended).toMatchObject({ success: false, reason: 'food-no-output', phase: 'completion', data: { status: 'terminal' } });
        expect(f.inv.getItemCount(377)).toBe(0);
        World.currentTick += 10;
        expect(await executeFoodSkillRequest(opts, 'prodtest', command)).toEqual(ended);
        expect(f.inv.getItemCount(377)).toBe(0);
    }
});
