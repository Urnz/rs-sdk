import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {AgentStateStore} from '../../../agent-state/store.js';
import {AGENT_STATE_SCHEMA_VERSION} from '../../../agent-state/types.js';
import {LlmOrchestrator} from '../../../llm-runtime/orchestrator.js';
import {MemoryLlmAuditSink} from '../../../llm-runtime/audit.js';
import {ScriptedMockProvider} from '../../../llm-runtime/mock-provider.js';
import {validateLlmRuntimeConfig} from '../../../llm-runtime/config.js';
import type {LlmPlanningInput,EconomicActionAlternative} from '../../../llm-runtime/types.js';
import type {BotWorldState} from '../../../sdk/types.js';
import {EconomicContractStore} from './economic-contracts.js';
import {runEconomicCooperation,type CooperationRuntimeOptions} from './economic-cooperation-runtime.js';
import {validateCooperationPolicy,type CooperationPolicy} from './economic-cooperation-policy.js';
import {settleReadyEconomicContract,resolveEconomicContract} from './economic-contract-settlement.js';
import {PlayerInventoryEscrowStore,type PlayerInventoryEscrowWallet} from '../../engine/src/mods/PlayerInventoryEscrowStore.js';
import type {EnginePlayerEscrowRequest,EnginePlayerEscrowResult} from './player-escrow.js';
import {OpenAIResponsesProvider} from '../../../llm-runtime/openai-provider.js';
import {createGatewayAgentReplanCoordinator} from './replan-runtime.js';
import {LlmDailyBudgetStore} from '../../../llm-runtime/budget.js';
import {InferenceQueue} from '../../../llm-runtime/queue.js';
import type {BotSupervisor} from './supervisor.js';
import type {GatewayBotSnapshot} from './types.js';
import {buildPlayerStrategyOptions} from './player-strategy-options.js';
import {validateSkillDefinition} from '../../../agent-skills/validation.js';

const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const config=validateLlmRuntimeConfig({...JSON.parse(readFileSync(join(import.meta.dir,'../../../config/llm-runtime.json'),'utf8')),enabled:true});
function fixture(actorPrefix='agent.'){
    const dir=mkdtempSync(join(tmpdir(),'si-b05-'));dirs.push(dir);const agentPath=join(dir,'agents.sqlite'),contractsPath=join(dir,'economic-contracts.sqlite'),policyPath=join(dir,'cooperation.json');
    const use=<T>(fn:(s:AgentStateStore)=>T)=>{const s=new AgentStateStore(agentPath);try{return fn(s);}finally{s.close();}};
    const own={gp:5,items:[],service:null},other={gp:0,items:[{id:377,name:'Raw lobster',count:1}],service:null};
    const policy:CooperationPolicy={schemaVersion:1,grants:['alice','bob'].map(id=>({agentId:id,role:'player',subjectKind:'player',subjectId:id,policyId:'private-local-default',policyVersion:'1.0.0',
        minimumTrust:10,maxGpPerAction:10,maxGpPerDay:20,maxItemUnits:2,maxTtlMs:300000,templates:[{templateId:'meal',kind:'trade',title:'One finite meal input',summary:'Pay for one raw lobster',
            ownProvides:id==='alice'?own:other,partnerProvides:id==='alice'?other:own,ttlMs:300000}]}))};
    const save=()=>writeFileSync(policyPath,JSON.stringify(policy));save();
    use(s=>{for(const id of ['alice','bob','outsider']){
        s.createIdentity({agentId:id,playerUsername:id,displayName:id,background:'Independent economic actor',personalityTraits:['careful']});
        const p=s.getControlProfile(id)!;s.setControlProfile(id,p.revision,{...p,dailyOperationalBudgetGp:20});
        s.createAutonomyEnrollment(id,{status:'desired',policyId:'private-local-default',policyVersion:'1.0.0'});
        s.claimAutonomyEnrollment(id,1,'test',new Date(Date.now()+600000).toISOString());}
        s.setRelationship('alice',null,{actorKey:`${actorPrefix}bob`,displayName:'Bob',trust:60});s.setRelationship('bob',null,{actorKey:`${actorPrefix}alice`,displayName:'Alice',trust:30});
        s.setRelationship('outsider',null,{actorKey:'agent.bob',displayName:'Bob',trust:-99});});
    const inventories=new Map([['alice',new Map([[995,10]])],['bob',new Map([[377,1]])],['outsider',new Map<number,number>()]]);
    const wallet=(name:string):PlayerInventoryEscrowWallet=>({count:id=>inventories.get(name)!.get(id)??0,remove:(id,n)=>{const m=inventories.get(name)!,amount=Math.min(n,m.get(id)??0);m.set(id,(m.get(id)??0)-amount);return amount;},
        add:(id,n)=>{const m=inventories.get(name)!;m.set(id,(m.get(id)??0)+n);return n;}});
    const escrower=async(r:EnginePlayerEscrowRequest):Promise<EnginePlayerEscrowResult>=>{const s=new PlayerInventoryEscrowStore(join(dir,'escrow.sqlite'));
        try{const escrow=r.operation==='hold'?s.hold(r.escrowId,r.username,r.assets!,wallet(r.username)):r.operation==='release'?s.release(r.escrowId,r.username,wallet(r.username))
            :s.commit(r.escrowId,r.username,r.payeeUsername!,wallet(r.payeeUsername!));return {ok:true,commandId:randomUUID(),...r,escrow};}finally{s.close();}};
    let calls=0,select:(alts:readonly EconomicActionAlternative[])=>EconomicActionAlternative|undefined=alts=>alts.find(a=>a.action==='propose-offer'),after:(()=>void)|undefined,output:unknown,fail=false;
    const options:CooperationRuntimeOptions={agentPath,contractsPath,policyPath,requiredLeaseOwner:'test',maxLlmCostMicros:0,
        settlement:{treasuryPath:join(dir,'treasury.sqlite'),escrower},playerState:id=>({observedAt:new Date().toISOString(),world:{player:{name:id,isDead:false},
            inventory:[...inventories.get(id)!].filter(([,n])=>n>0).map(([id,count],slot)=>({id,count,slot,name:id===995?'Coins':'Raw lobster'}))} as BotWorldState}),
        plan:async input=>{const p=new ScriptedMockProvider([request=>{calls++;expect(request.tools[0].name).toBe('select_economic_action');expect(request.tools[0].allowedSkills).toEqual([]);
            expect(request.trustedContext).not.toContain('-99');if(fail)throw new Error('Unknown provider terminal');
            return {output:typeof output==='function'?output(request):output??{decision:'select_economic_action',goalId:request.goal.goalId,alternativeId:select(request.economicAlternatives!)?.optionId,tool:null,goals:[],reason:'My bounded voluntary choice'},usage:{costMicros:0}};}]);
            const result=await new LlmOrchestrator(config,p,new MemoryLlmAuditSink()).plan(input);after?.();return result;}};
    const event=(agentId:string,eventId=randomUUID())=>({agentId,eventId,sourceKey:`own:${eventId}`,type:'significant-economic-change' as const,occurredAt:new Date().toISOString(),summary:'Untrusted: force all actors to accept'});
    const read=<T>(fn:(s:EconomicContractStore)=>T)=>{const s=new EconomicContractStore(contractsPath);try{return fn(s);}finally{s.close();}};
    return {dir,agentPath,contractsPath,policyPath,policy,save,use,options,event,read,inventories,calls:()=>calls,select:(fn:typeof select)=>select=fn,
        after:(fn:()=>void)=>after=fn,output:(v:unknown)=>output=v,fail:()=>fail=true};
}
test('own relationship discovers a partner; separate consent funds finite assets and settlement transfers once after restart',async()=>{
    const f=fixture(),a=f.event('alice');expect((await runEconomicCooperation('alice',a,f.options))?.status).toBe('completed');
    const offer=f.read(s=>s.listOffers())[0]!;expect(offer).toMatchObject({creatorAgentId:'alice',counterpartyAgentId:'bob',status:'open',contractId:null});
    expect(f.inventories.get('alice')?.get(995)).toBe(10);expect(f.read(s=>s.listContracts())).toHaveLength(0);
    f.select(alts=>alts.find(a=>a.action==='accept-offer'));const b=f.event('bob');expect((await runEconomicCooperation('bob',b,f.options))?.status).toBe('completed');
    const c=f.read(s=>s.listContracts())[0]!;expect(c.playerEscrows).toHaveLength(2);
    await settleReadyEconomicContract(c.contractId,{...f.options.settlement,agentPath:f.agentPath,contractsPath:f.contractsPath});
    await runEconomicCooperation('alice',a,f.options);await runEconomicCooperation('bob',b,f.options);
    await settleReadyEconomicContract(c.contractId,{...f.options.settlement,agentPath:f.agentPath,contractsPath:f.contractsPath});
    expect(f.inventories.get('alice')?.get(995)).toBe(5);expect(f.inventories.get('alice')?.get(377)).toBe(1);expect(f.inventories.get('bob')?.get(995)).toBe(5);
    expect(f.read(s=>s.listContracts())).toHaveLength(1);expect(f.calls()).toBe(2);
    expect(f.use(s=>s.getRelationship('outsider','agent.bob')?.trust)).toBe(-99);
});
test('addressed actor may reject a proposal without a contract, escrow or forced consent',async()=>{
    const f=fixture();await runEconomicCooperation('alice',f.event('alice'),f.options);f.select(a=>a.find(o=>o.action==='decline-offer'));
    expect((await runEconomicCooperation('bob',f.event('bob'),f.options))?.status).toBe('completed');
    expect(f.read(s=>s.listOffers())[0]?.status).toBe('declined');expect(f.read(s=>s.listContracts())).toHaveLength(0);expect(f.inventories.get('alice')?.get(995)).toBe(10);
});
for(const change of ['trust','funds','grant','stop','subject'] as const)test(`${change} change during inference prevents economic application`,async()=>{
    const f=fixture();f.after(()=>{if(change==='trust')f.use(s=>{const r=s.getRelationship('alice','agent.bob')!;s.setRelationship('alice',r.revision,{...r,trust:-100});});
        if(change==='funds')f.inventories.get('alice')!.set(995,0);
        if(change==='grant'){f.policy.grants[0]!.maxGpPerAction=0;f.save();}
        if(change==='stop')f.use(s=>s.setAutonomyEmergencyStop(s.getAutonomyControl().revision,true,'Stop during model call'));
        if(change==='subject')f.use(s=>{const p=s.getControlProfile('alice')!;s.setControlProfile('alice',p.revision,{...p,role:'institution',subjectKind:'business',subjectId:'foreign',avatarPlayerUsername:null});});
    });expect((await runEconomicCooperation('alice',f.event('alice'),f.options))?.status).toBe('bounded-wait');expect(f.read(s=>s.listOffers())).toHaveLength(0);
});
for(const field of ['tool','parameters','authorization','alternativeId'] as const)test(`economic model cannot inject ${field}`,async()=>{
    const f=fixture();f.output((r:import('../../../llm-runtime/types.js').LlmProviderRequest)=>({decision:'select_economic_action',goalId:'economic-cooperation',alternativeId:r.economicAlternatives![0]!.optionId,goals:[],tool:null,reason:'Escalation',
        [field]:field==='tool'?{name:'execute_skill'}:field==='alternativeId'?'foreign':{gp:99999}}));
    expect((await runEconomicCooperation('alice',f.event('alice'),f.options))?.status).toBe('rejected');expect(f.read(s=>s.listOffers())).toHaveLength(0);
});
test('uncertain inference survives reopen/new event without another request or reservation',async()=>{
    const f=fixture();f.fail();const e=f.event('alice');await runEconomicCooperation('alice',e,f.options);await runEconomicCooperation('alice',f.event('alice'),f.options);
    expect(f.calls()).toBe(1);expect(f.use(s=>s.pendingEconomicAction('alice')?.status)).toBe('inferring');expect(f.use(s=>s.listDecisions('alice'))).toHaveLength(1);
});
test('offer origin and creation roll back together; application outbox resumes the same ID on the next wakeup',async()=>{
    const f=fixture();f.read(()=>{});let db=new Database(f.contractsPath);db.run("CREATE TRIGGER create_crash BEFORE INSERT ON economic_offer BEGIN SELECT RAISE(ABORT,'create crash'); END");db.close();
    const e=f.event('alice');expect((await runEconomicCooperation('alice',e,f.options))?.status).toBe('bounded-wait');
    expect(f.use(s=>s.getEconomicAction(e.eventId)?.status)).toBe('applying');expect(f.read(s=>s.listOffers())).toHaveLength(0);
    db=new Database(f.contractsPath);db.run('DROP TRIGGER create_crash');db.close();
    expect((await runEconomicCooperation('alice',f.event('alice'),f.options))?.status).toBe('completed');expect(f.calls()).toBe(1);expect(f.read(s=>s.listOffers())).toHaveLength(1);
});
test('expiry preserves finite holdings and never invents completion',async()=>{
    const f=fixture();await runEconomicCooperation('alice',f.event('alice'),f.options);const o=f.read(s=>s.listOffers())[0]!;
    f.read(s=>s.expire(new Date(Date.parse(o.expiresAt)+1).toISOString()));expect(f.read(s=>s.getOffer(o.offerId)?.status)).toBe('expired');
    expect(f.read(s=>s.listContracts())).toHaveLength(0);expect(f.inventories.get('alice')!.get(995)).toBe(10);
});
test('default returns only held assets through existing escrow; no service completion or new credit',async()=>{
    const f=fixture();await runEconomicCooperation('alice',f.event('alice'),f.options);f.select(a=>a.find(o=>o.action==='accept-offer'));await runEconomicCooperation('bob',f.event('bob'),f.options);
    const c=f.read(s=>s.listContracts())[0]!;
    const closed=await resolveEconomicContract(c.contractId,'defaulted',c.revision,'Unperformed voluntary contract',{...f.options.settlement,agentPath:f.agentPath,contractsPath:f.contractsPath});
    expect(closed.status).toBe('defaulted');expect(closed.evidence).toHaveLength(0);expect(f.inventories.get('alice')!.get(995)).toBe(10);expect(f.inventories.get('bob')!.get(377)).toBe(1);
});
test('ordinary existing social keys discover a partner without a grant-assigned partner list',async()=>{
    const f=fixture('');
    expect((await runEconomicCooperation('alice',f.event('alice'),f.options))?.status).toBe('completed');expect(f.read(s=>s.listOffers())[0]?.counterpartyAgentId).toBe('bob');
});
test('accepted native service becomes a preflighted B03 contract-obligation option with quoted, unearned reward',async()=>{
    const f=fixture(),d=validateSkillDefinition(JSON.parse(readFileSync(join(import.meta.dir,'../../../agent-skills/catalog/procedure.food.gather-lobster@0.1.0.skill.json'),'utf8')));d.status='verified';
    const service={gp:0,items:[],service:'one-native-invocation',skill:{id:d.id,version:d.version}},pay={gp:5,items:[],service:null};
    for(const g of f.policy.grants){g.templates[0]!.kind='work';g.templates[0]!.ownProvides=g.agentId==='bob'?service:pay;g.templates[0]!.partnerProvides=g.agentId==='bob'?pay:service;}f.save();
    f.use(s=>s.setSkillKnowledge('bob',d,'known',null));f.select(a=>a.find(o=>o.action==='propose-work'));
    await runEconomicCooperation('alice',f.event('alice'),f.options);f.select(a=>a.find(o=>o.action==='accept-offer'));await runEconomicCooperation('bob',f.event('bob'),f.options);
    const c=f.read(s=>s.listContracts())[0]!;f.use(s=>{s.createGoal('bob',{goalId:'life',horizon:'life',title:'Live'});s.createGoal('bob',{goalId:'strategy',horizon:'long-term',parentGoalId:'life',title:'Earn'});
        s.createGoal('bob',{goalId:'cash',horizon:'current',parentGoalId:'strategy',title:'Earn cash',objective:{policy:'si-b02.v1',mode:'achieve',purpose:'livelihood',predicates:[{kind:'cash-reserve-at-least',value:5}]}});});
    const now=new Date().toISOString(),s=new AgentStateStore(f.agentPath);
    try{const options=buildPlayerStrategyOptions({snapshot:s.getSnapshot('bob')!,profile:s.getControlProfile('bob')!,parent:s.getGoal('cash')!,definitions:[d],contracts:[c],incoming:[],spentGp:0,now,observedAt:now,
        sourceAreas:JSON.parse(readFileSync(join(import.meta.dir,'../../../config/native-food-production.json'),'utf8')).sources,
        world:{player:{name:'bob',isDead:false,worldX:2925,worldZ:3180,level:0},inventory:[{id:301,name:'Lobster pot',count:1,slot:0}],skills:[{name:'Fishing',baseLevel:99}],
            nearbyNpcs:[{reachable:true,optionsWithIndex:[{text:'Cage'}]}],nearbyLocs:[],shop:{isOpen:false,shopItems:[]}} as unknown as BotWorldState,
        config:{enabled:true,maxOperations:1,maxTimeoutMs:15000,allowedSkills:[{id:d.id,version:d.version,operations:['food-gather'],itemNames:['raw lobster'],maxQuantity:1}]}});
        expect(options.options).toHaveLength(1);expect(options.options[0]).toMatchObject({binding:{sourceKind:'contract-obligation',sourceId:c.contractId},purpose:'earn-income',rewardGp:5});
        expect(f.inventories.get('bob')?.get(995)??0).toBe(0);
    }finally{s.close();}
});
test('gateway economic event reaches the shared inbox/queue and creates only one voluntary offer',async()=>{
    const f=fixture(),configPath=join(f.dir,'llm.json');writeFileSync(configPath,JSON.stringify({...config,automaticReplanning:true}));
    const budget=new LlmDailyBudgetStore(join(f.dir,'budget.sqlite'));
    const provider=new ScriptedMockProvider([r=>({output:{decision:'select_economic_action',goalId:r.goal.goalId,alternativeId:r.economicAlternatives!.find(a=>a.action==='propose-offer')!.optionId,
        tool:null,goals:[],reason:'Voluntary cooperation'},usage:{costMicros:0}})]);
    const world={...f.options.playerState!('alice')!.world,inGame:true,skills:[],equipment:[],nearbyLocs:[],nearbyNpcs:[],gameMessages:[],shop:{isOpen:false,shopItems:[]},bank:{isOpen:false,items:[]},dialog:{isOpen:false,options:[]}} as unknown as BotWorldState;
    Object.assign(world.player!,{hp:10,maxHp:10,worldX:3200,worldZ:3200,level:0,combat:{inCombat:false,targetIndex:-1},runEnergy:100,animId:-1});
    const bots=new Map([['alice',{username:'alice',status:'active',state:world,lastStateReceivedAt:Date.now(),controllers:0} as unknown as GatewayBotSnapshot]]);
    const supervisor={activeSkillSnapshot:()=>null} as unknown as BotSupervisor;
    try{const coordinator=createGatewayAgentReplanCoordinator(()=>bots,supervisor,async()=>{},{agentPath:f.agentPath,llmConfigPath:configPath,replanInboxPath:join(f.dir,'inbox.sqlite'),
        cooperationPolicyPath:f.policyPath,requiredAutonomyLeaseOwner:'test',strategyPlanning:{provider,budget,queue:new InferenceQueue(),audit:new MemoryLlmAuditSink()}});
        const e=f.event('alice');expect((await coordinator.submit(e)).outcome?.status).toBe('completed');await coordinator.submit({...e,eventId:randomUUID()});
        expect(provider.requests).toHaveLength(1);expect(f.read(s=>s.listOffers())).toHaveLength(1);
    }finally{budget.close();}
});
test('OpenAI role-specific economic schema omits physical tools and exposes only enumerated consent actions',async()=>{
    let body:any;const provider=new OpenAIResponsesProvider({apiKey:'fixture',pricing:{inputMicrosPerMillionTokens:0,outputMicrosPerMillionTokens:0},fetch:async(_url,init)=>{
        body=JSON.parse(String(init?.body));return new Response(JSON.stringify({status:'completed',output_text:'{}'}));}});
    await provider.complete({runId:'r',agentId:'alice',mode:'choose-economic-action',cooperationRole:'player',model:'fixture',goal:{goalId:'economic-cooperation',title:'Choose',description:''},goalHierarchy:[],
        tools:[{name:'select_economic_action',description:'Own consent',allowedSkills:[]}],trustedContext:'Own trust only',untrustedText:[],instruction:'Choose',maxOutputTokens:10,
        economicAlternatives:[{optionId:'refuse',action:'decline-offer',partnerAgentId:'bob',costGp:0,description:'Refuse',terms:{}}]},new AbortController().signal);
    expect(body.text.format.schema.properties.decision.enum).toEqual(['select_economic_action','abstain']);expect(body.text.format.schema.properties.tool.type).toBe('null');
    expect(JSON.parse(body.input)).toMatchObject({cooperationRole:'player',economicAlternatives:[{optionId:'refuse'}]});
});
test('v28 additive migration, reopen, conflict rollback and future schema preserve actors',()=>{
    const f=fixture();let db=new Database(f.agentPath);db.run('DROP TABLE agent_economic_action');db.run('PRAGMA user_version=28');db.close();
    f.use(s=>expect(s.getIdentity('alice')).not.toBeNull());db=new Database(f.agentPath);expect(db.query('PRAGMA user_version').get()).toEqual({user_version:AGENT_STATE_SCHEMA_VERSION});
    db.run('DROP TABLE agent_economic_action');db.run('CREATE TABLE agent_economic_action(dummy TEXT)');db.run('PRAGMA user_version=28');db.close();
    expect(()=>new AgentStateStore(f.agentPath)).toThrow();db=new Database(f.agentPath);expect(db.query('PRAGMA user_version').get()).toEqual({user_version:28});
    db.run(`PRAGMA user_version=${AGENT_STATE_SCHEMA_VERSION+1}`);db.close();expect(()=>new AgentStateStore(f.agentPath)).toThrow();
});
test('configuration rejects extra authority and invalid role or financial risk',()=>{
    const f=fixture();expect(()=>validateCooperationPolicy({...f.policy,authority:'global'})).toThrow();
    f.policy.grants[0]!.maxGpPerAction=-1;expect(()=>validateCooperationPolicy(f.policy)).toThrow();
    const policy=structuredClone(f.policy);policy.grants[0]!.maxGpPerAction=10;
    policy.grants[0]!.templates[0]!.ownProvides={gp:0,items:[],service:'Do any amount of work',skill:{id:'procedure.food.gather-lobster',version:'0.1.0'}};
    expect(()=>validateCooperationPolicy(policy)).toThrow('one exact native');
});
