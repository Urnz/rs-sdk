import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStateStore } from '../store.js';
import { buildDecisionContext } from '../context.js';
import { validateMemoryTransferPolicy } from '../memory-transfer.js';
import { SimulationClockStore } from '../../simulation-clock/store.js';
import { loadPopulationAgePolicy,loadPopulationMortalityPolicy,createPopulationDeathEvidence } from '../../population-lifecycle/index.js';
import { PlayerHealthEvidenceStore } from '../../server/engine/src/mods/PlayerHealthEvidenceStore.js';
import { assertLocalAvatarCanAct } from '../../server/gateway/admin/population-death-runtime.js';

const wall='2026-10-14T10:00:00.000Z',initial='2001-01-01T00:00:00.000Z',config=join(import.meta.dir,'../../config');
const age=loadPopulationAgePolicy(join(config,'population-age-policy.json')),mortality=loadPopulationMortalityPolicy(join(config,'population-mortality-policy.json'));
const directories:string[]=[],closers:Array<()=>void>=[];
afterEach(()=>{for(const close of closers.splice(0).reverse())close();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
function raw<T>(path:string,run:(db:Database)=>T):T {const db=new Database(path),statements=new Set<{finalize():void}>();
    db.query=new Proxy(db.query,{apply(target,receiver,args){const statement=Reflect.apply(target,receiver,args);statements.add(statement);return statement;}});
    try{return run(db);}finally{for(const statement of statements)statement.finalize();db.close(true);}}
function fixture(die=true) {
    const root=mkdtempSync(join(tmpdir(),'population-memory-'));directories.push(root);
    const statePath=join(root,'agents.sqlite'),enginePath=join(root,'engine.sqlite'),clock=new SimulationClockStore(join(root,'clock.sqlite'));closers.push(()=>clock.close());
    const state=clock.create({clockId:'world',profile:{schemaVersion:1,profileId:'memory-test',version:'1.0.0',seed:'memory-test',rate:{simulationMilliseconds:1,wallMilliseconds:1}},wallTime:wall,simulationTime:initial});
    const store=new AgentStateStore(statePath,{store:clock,clockId:'world'});closers.push(()=>store.close());
    for(const id of ['alice','bob'])store.createIdentity({agentId:id,playerUsername:id,displayName:id,background:'Memory test agent',personalityTraits:['careful']},wall);
    store.createIdentity({agentId:'forge-mind',displayName:'Forge',background:'Organization controller',personalityTraits:['careful'],controlProfile:{role:'institution',subjectKind:'business',subjectId:'forge',
        decisionIntervalMs:60000,maxDecisionsPerDay:20,dailyLlmBudgetMicros:1000,dailyOperationalBudgetGp:1000}},wall);
    store.setEconomicActorLink('alice',null,{actorKind:'business',actorId:'forge',role:'owner'},wall);
    store.createEpisode('alice',{episodeId:'alice-private',kind:'interaction',summary:'Private interaction',details:'Private episodic detail',source:'system',trust:'untrusted',occurredAt:wall,expiresAt:'2026-10-14T10:00:01.000Z'},wall);
    store.createKnowledge('alice',{knowledgeId:'alice-route',kind:'route',subject:'Workshop',predicate:'reachable-via',object:'North road',summary:'Reported route',confidence:88,
        source:'manual',tags:['private-source-tag'],evidenceEpisodeIds:['alice-private'],validFrom:wall},wall);
    store.setRelationship('alice',null,{actorKey:'bob',displayName:'Bob',trust:80,affinity:90,agentOwesGp:35,notes:'Private social notes',evidenceEpisodeIds:['alice-private']},wall);
    store.setCharacterBirth('alice',1,initial,'born',wall);
    store.bindPopulationMember({agentId:'alice',playerUsername:'alice',worldProfile:{profileId:'mature-society',version:'1.0.0',digest:'a'.repeat(64)},lifecyclePolicy:{...age.lifecyclePolicy,kind:'finite'},
        simulationClock:{clockId:'world',profileDigest:state.profileDigest},joinedAtSimulationTime:initial,sourceResultId:'genesis-'+'b'.repeat(24),sourceResultDigest:'c'.repeat(64)},wall);
    const engine=new PlayerHealthEvidenceStore(enginePath);closers.push(()=>engine.close());
    const death=()=>{const proof=createPopulationDeathEvidence(store.getPopulationMember('alice')!,clock.observe('world',wall,42),age,mortality,
        {damageEventId:'10000000-0000-4000-8000-000000000001',sessionId:'memory-session',engineTick:42});
        engine.record({username:'alice',sessionId:'memory-session',engineTick:42,occurredAt:wall,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},
            proof.cause.kind==='engine-hp-zero'?proof.cause.damageEventId:'',proof);
        const reader=new PlayerHealthEvidenceStore(enginePath,true);try{store.consumePopulationDeath(reader,proof.eventId,age,mortality);}finally{reader.close();}return proof;};
    if(die)death();
    const policy=(mode:'inheritance'|'organization'='inheritance')=>validateMemoryTransferPolicy({schemaVersion:1,policyId:'memory-test',version:'1.0.0',rules:[{
        ruleId:'explicit-transfer',sourceAgentId:'alice',recipientAgentId:mode==='inheritance'?'bob':'forge-mind',archiveDigest:store.getPopulationMemoryArchive('alice')!.digest,
        mode,organization:mode==='organization'?{kind:'business',id:'forge'}:null,knowledgeIds:['alice-route'],maximumConfidence:50}]});
    const selection=(mode:'inheritance'|'organization'='inheritance')=>({sourceAgentId:'alice',recipientAgentId:mode==='inheritance'?'bob':'forge-mind',ruleId:'explicit-transfer',reason:'Reviewed archived knowledge transfer'});
    const request=(mode:'inheritance'|'organization'='inheritance')=>({...selection(mode),transferId:`transfer-${mode}`,previewDigest:store.previewArchivedKnowledge(enginePath,policy(mode),selection(mode),wall).digest});
    return {root,statePath,enginePath,clock,store,engine,death,policy,selection,request};
}
describe('terminal population memory archive',()=>{
    test('archives complete personal memory atomically with verified death, without sharing it',()=>{
        const local=fixture(),snapshot=local.store.getPopulationMemoryArchive('alice')!;
        expect(snapshot.archive.captureMode).toBe('death-admission');expect(snapshot.archive.records.episodes[0]!.details).toBe('Private episodic detail');
        expect(snapshot.archive.records.social[0]!).toMatchObject({trust:80,agent_owes_gp:35,notes:'Private social notes'});
        expect(snapshot.archive.records.semantic[0]!.knowledge_id).toBe('alice-route');
        expect(local.store.listEpisodes('bob')).toEqual([]);expect(local.store.listRelationships('bob')).toEqual([]);expect(local.store.listKnowledge('bob')).toEqual([]);
        const restarted=new AgentStateStore(local.statePath);try{expect(restarted.getPopulationMemoryArchive('alice')).toEqual(snapshot);}finally{restarted.close();}
    });
    test('postmortem episode, relationship, semantic and skill writes are denied and prune retains all episodes',()=>{
        const local=fixture();
        expect(()=>local.store.createEpisode('alice',{episodeId:'postmortem',kind:'observation',summary:'New memory',source:'system',occurredAt:wall},wall)).toThrow('immutable');
        expect(()=>local.store.setRelationship('alice',1,{actorKey:'bob',displayName:'Bob',trust:100},wall)).toThrow('immutable');
        expect(()=>local.store.createKnowledge('alice',{knowledgeId:'new-fact',kind:'world',subject:'New',predicate:'is',object:'New',summary:'New',source:'manual',validFrom:wall},wall)).toThrow('immutable');
        expect(()=>local.store.setSkillKnowledge('alice',{id:'test.skill',version:'1.0.0'},'known',null,wall)).toThrow('immutable');
        const retention=local.store.pruneExpiredEpisodes('alice','2026-10-14T10:00:02.000Z');expect(retention.deletedEpisodeIds).toEqual([]);expect(retention.candidates[0]!.protectionReasons).toContain('population-archive');
    });
    test('failed archive persistence rolls back death projection while engine physical closure stays authoritative',()=>{
        const local=fixture(false);
        raw(local.statePath,db=>db.run("CREATE TRIGGER reject_memory BEFORE INSERT ON agent_population_memory_archive BEGIN SELECT RAISE(ABORT,'archive unavailable'); END"));
        expect(()=>local.death()).toThrow('archive unavailable');expect(local.store.getPopulationDeath('alice')).toBeNull();expect(local.store.getCharacterLifecycle('alice')!.status).toBe('active');
        expect(()=>assertLocalAvatarCanAct('alice',local.statePath,local.enginePath,wall)).toThrow();
        raw(local.statePath,db=>db.run('DROP TRIGGER reject_memory'));
        const source=new PlayerHealthEvidenceStore(local.enginePath,true);try{local.store.consumePopulationDeath(source,source.listDeaths()[0]!.eventId,age,mortality);}finally{source.close();}
        expect(local.store.getPopulationMemoryArchive('alice')).not.toBeNull();
    });
    test('a silently ignored archive insert cannot commit a death projection without its memory',()=>{
        const local=fixture(false);raw(local.statePath,db=>db.run("CREATE TRIGGER ignore_archive BEFORE INSERT ON agent_population_memory_archive BEGIN SELECT RAISE(IGNORE); END"));
        expect(()=>local.death()).toThrow('archive write was ignored');expect(local.store.getPopulationDeath('alice')).toBeNull();
        expect(local.store.getPopulationMemoryArchive('alice')).toBeNull();expect(local.store.getCharacterLifecycle('alice')!.status).toBe('active');
    });
    test('an archive includes more than the paginated 500-episode retrieval limit',()=>{
        const local=fixture(false);
        raw(local.statePath,db=>db.transaction(()=>{for(let i=0;i<510;i++)db.run(`INSERT INTO agent_episode SELECT ?1,agent_id,kind,summary,details,importance,goal_ids,actors,tags,source,trust,NULL,occurred_at,expires_at,created_at FROM agent_episode WHERE episode_id='alice-private'`,[`bulk-${i}`]);}).immediate());
        local.death();expect(local.store.listEpisodes('alice',{limit:500})).toHaveLength(500);expect(local.store.getPopulationMemoryArchive('alice')!.archive.records.episodes).toHaveLength(511);
    });
    test('removing the audit suffix or changing a frozen source cannot yield a valid archive',()=>{
        const local=fixture();raw(local.statePath,db=>{db.run('DROP TRIGGER memory_closed_agent_episode_update');db.run("UPDATE agent_episode SET details='forged' WHERE agent_id='alice'");});
        expect(()=>local.store.getPopulationMemoryArchive('alice')).toThrow('source changed');
        raw(local.statePath,db=>{db.run('DROP TRIGGER memory_immutable_agent_memory_audit_delete');db.run('DELETE FROM agent_memory_audit');});
        expect(()=>new AgentStateStore(local.statePath)).toThrow('truncated');
    });
    test('v23 migration adds empty archive history and later verified capture is explicitly late',()=>{
        const local=fixture();
        raw(local.statePath,db=>{
            for(const row of db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'memory_%'").all() as Array<{name:string}>)db.run(`DROP TRIGGER ${row.name}`);
            for(const table of ['agent_memory_transfer','agent_population_memory_archive','agent_memory_audit','agent_memory_audit_tail'])db.run(`DROP TABLE ${table}`);
            db.run('DROP TABLE agent_population_entry');
            db.run('PRAGMA user_version=23');
        });
        const upgraded=new AgentStateStore(local.statePath);try{
            expect(upgraded.getPopulationMemoryArchive('alice')).toBeNull();
            const source=new PlayerHealthEvidenceStore(local.enginePath,true);try{expect(upgraded.ensurePopulationMemoryArchive(source,'alice').archive.captureMode).toBe('late-reconciliation');}finally{source.close();}
            expect(upgraded.getPopulationMemoryArchive('bob')).toBeNull();
            expect(upgraded.previewArchivedKnowledge(local.enginePath,local.policy('organization'),local.selection('organization'),wall).blockers.join(' ')).toContain('Late archive');
        }finally{upgraded.close();}
    });
});
describe('explicit archived knowledge transfer',()=>{
    test('copies selected facts with untrusted acquisition provenance, without private memory or skills',()=>{
        const local=fixture(),receipt=local.store.transferArchivedKnowledge(local.enginePath,local.policy(),local.request(),wall);
        expect(receipt.facts).toHaveLength(1);const fact=local.store.getKnowledge(receipt.facts[0]!.knowledgeId)!;
        expect(fact).toMatchObject({subject:'Workshop',object:'North road',confidence:50,source:'manual',tags:['archived-knowledge'],goalIds:[]});
        expect(fact.evidenceEpisodeIds).toEqual([receipt.facts[0]!.episodeId]);
        expect(buildDecisionContext(local.store.getSnapshot('bob')!,{semanticMemories:[fact]})).toContain('archived report');
        expect(local.store.getEpisode(receipt.facts[0]!.episodeId)!).toMatchObject({trust:'untrusted',summary:'Received explicitly authorized archived knowledge'});
        expect(JSON.stringify(local.store.listEpisodes('bob'))).not.toContain('Private episodic detail');expect(local.store.listRelationships('bob')).toEqual([]);expect(local.store.listSkillKnowledge('bob')).toEqual([]);
    });
    test('organizational knowledge needs exact archived affiliation and organization controller',()=>{
        const local=fixture(),policy=local.policy('organization'),selection=local.selection('organization');
        expect(local.store.previewArchivedKnowledge(local.enginePath,policy,selection,wall).blockers).toEqual([]);
        expect(local.store.transferArchivedKnowledge(local.enginePath,policy,local.request('organization'),wall).recipientAgentId).toBe('forge-mind');
        const {digest,...definition}=policy,bad=validateMemoryTransferPolicy({...definition,rules:[{...definition.rules[0]!,organization:{kind:'business',id:'other'}}]});
        expect(local.store.previewArchivedKnowledge(local.enginePath,bad,selection,wall).blockers.join(' ')).toContain('affiliation');
    });
    test('a role changed after the engine death timestamp cannot prove historical affiliation',()=>{
        const local=fixture(false);raw(local.statePath,db=>db.run("UPDATE agent_economic_actor_link SET updated_at='2026-10-14T10:00:02.000Z' WHERE actor_kind='business'"));local.death();
        expect(local.store.previewArchivedKnowledge(local.enginePath,local.policy('organization'),local.selection('organization'),wall).blockers.join(' ')).toContain('affiliation');
    });
    test('empty, forged or mismatched policy cannot copy knowledge',()=>{
        const local=fixture(),policy=local.policy(),{digest,...definition}=policy,empty=validateMemoryTransferPolicy({...definition,rules:[]});
        expect(local.store.previewArchivedKnowledge(local.enginePath,empty,local.selection(),wall).blockers.join(' ')).toContain('No exact');
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,{...policy,digest:'0'.repeat(64)},local.request(),wall)).toThrow('digest');
        const mismatched=validateMemoryTransferPolicy({...definition,rules:[{...definition.rules[0]!,archiveDigest:'f'.repeat(64)}]});
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,mismatched,local.request(),wall)).toThrow('blocked');expect(local.store.listKnowledge('bob')).toEqual([]);
    });
    test('exact replay survives restart and conflicts fail closed',()=>{
        const local=fixture(),policy=local.policy(),request=local.request(),receipt=local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall);
        const restarted=new AgentStateStore(local.statePath);try{expect(restarted.transferArchivedKnowledge(local.enginePath,policy,request,wall)).toEqual(receipt);
            expect(()=>restarted.transferArchivedKnowledge(local.enginePath,policy,{...request,reason:'Different human decision'},wall)).toThrow('conflicts');
            expect(restarted.listEpisodes('bob')).toHaveLength(1);expect(restarted.listKnowledge('bob')).toHaveLength(1);
        }finally{restarted.close();}
    });
    test('a stale recipient preview cannot overwrite newly learned knowledge',()=>{
        const local=fixture(),request=local.request();
        local.store.createKnowledge('bob',{knowledgeId:'bob-current',kind:'route',subject:'Workshop',predicate:'reachable-via',object:'South road',summary:'Independent report',source:'manual',validFrom:wall},wall);
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,local.policy(),request,wall)).toThrow('blocked');
        expect(local.store.getKnowledge('bob-current')!.object).toBe('South road');expect(local.store.listEpisodes('bob')).toEqual([]);
    });
    test('a failure after fact creation rolls back fact, acquisition episode, receipt and audit',()=>{
        const local=fixture(),request=local.request();raw(local.statePath,db=>db.run("CREATE TRIGGER reject_transfer BEFORE INSERT ON agent_memory_transfer BEGIN SELECT RAISE(ABORT,'transfer receipt unavailable'); END"));
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,local.policy(),request,wall)).toThrow('receipt unavailable');
        expect(local.store.listKnowledge('bob')).toEqual([]);expect(local.store.listEpisodes('bob')).toEqual([]);
        raw(local.statePath,db=>db.run('DROP TRIGGER reject_transfer'));
        expect(local.store.transferArchivedKnowledge(local.enginePath,local.policy(),request,wall).facts).toHaveLength(1);
    });
    test('a silently ignored transfer receipt rolls back learned facts and acquisition evidence',()=>{
        const local=fixture(),request=local.request();raw(local.statePath,db=>db.run("CREATE TRIGGER ignore_transfer BEFORE INSERT ON agent_memory_transfer BEGIN SELECT RAISE(IGNORE); END"));
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,local.policy(),request,wall)).toThrow('receipt write was ignored');
        expect(local.store.listKnowledge('bob')).toEqual([]);expect(local.store.listEpisodes('bob')).toEqual([]);
        expect(local.store.getPopulationMemoryArchive('alice')).not.toBeNull();
    });
    test('tampered transfer indexes and acquisition evidence cannot pass historical replay',()=>{
        const local=fixture(),policy=local.policy(),request=local.request(),receipt=local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall);
        raw(local.statePath,db=>db.run("UPDATE agent_episode SET trust='trusted' WHERE agent_id='bob'"));
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall)).toThrow('provenance');
        raw(local.statePath,db=>{db.run('DROP TRIGGER memory_immutable_agent_memory_transfer_update');db.run("UPDATE agent_memory_transfer SET recipient_agent_id='alice'");});
        expect(()=>local.store.getPopulationMemoryArchive('alice')).toThrow('audit');expect(receipt.facts).toHaveLength(1);
    });
    test('semantic supersession after learning preserves historical replay',()=>{
        const local=fixture(),policy=local.policy(),request=local.request(),receipt=local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall);
        local.store.createKnowledge('bob',{knowledgeId:'bob-newer',kind:'route',subject:'Workshop',predicate:'reachable-via',object:'East road',summary:'Newer observation',source:'manual',
            supersedesId:receipt.facts[0]!.knowledgeId,validFrom:wall},wall);
        expect(local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall)).toEqual(receipt);expect(local.store.getKnowledge('bob-newer')!.object).toBe('East road');
    });
    test('a deceased recipient and a missing engine authority remain blocked',()=>{
        const local=fixture(),policy=local.policy(),request=local.request();raw(local.statePath,db=>db.run("UPDATE agent_character_lifecycle SET status='deceased' WHERE agent_id='bob'"));
        expect(()=>local.store.createEpisode('bob',{episodeId:'unverified-dead',kind:'observation',summary:'No postmortem mutation',source:'system',occurredAt:wall},wall)).toThrow('immutable');
        expect(local.store.getPopulationMemoryArchive('bob')).toBeNull();
        expect(()=>local.store.transferArchivedKnowledge(local.enginePath,policy,request,wall)).toThrow('blocked');
        expect(()=>local.store.previewArchivedKnowledge(join(local.root,'missing.sqlite'),policy,local.selection(),wall)).toThrow('unavailable');
    });
    test('engine terminal status blocks a recipient before AgentState catches up',()=>{
        const local=fixture(),member=local.store.getPopulationMember('alice')!;
        local.store.setCharacterBirth('bob',1,initial,'born',wall);
        local.store.bindPopulationMember({agentId:'bob',playerUsername:'bob',worldProfile:member.worldProfile,lifecyclePolicy:member.lifecyclePolicy,simulationClock:member.simulationClock,
            joinedAtSimulationTime:initial,sourceResultId:member.sourceResultId,sourceResultDigest:member.sourceResultDigest},wall);
        const proof=createPopulationDeathEvidence(local.store.getPopulationMember('bob')!,local.clock.observe('world',wall,43),age,mortality,
            {damageEventId:'10000000-0000-4000-8000-000000000002',sessionId:'bob-session',engineTick:43});
        local.engine.record({username:'bob',sessionId:'bob-session',engineTick:43,occurredAt:wall,hpBefore:10,hpAfter:0,maxHp:10,damageType:1},
            proof.cause.kind==='engine-hp-zero'?proof.cause.damageEventId:'',proof);
        expect(local.store.getCharacterLifecycle('bob')!.status).toBe('active');
        expect(local.store.previewArchivedKnowledge(local.enginePath,local.policy(),local.selection(),wall).blockers.join(' ')).toContain('terminal');
    });
    test('expired knowledge cannot be inherited as a current fact',()=>{
        const local=fixture(false);raw(local.statePath,db=>db.run("UPDATE agent_semantic_memory SET valid_until='2026-10-14T10:00:01.000Z'"));local.death();
        expect(local.store.previewArchivedKnowledge(local.enginePath,local.policy(),local.selection(),'2026-10-14T10:00:02.000Z').blockers.join(' ')).toContain('validity');
    });
    test('admin archive and transfer endpoints require authorization and exact human preview',async()=>{
        const local=fixture(),policy=local.policy(),{digest,...definition}=policy,policyPath=join(local.root,'memory-policy.json');writeFileSync(policyPath,JSON.stringify(definition));
        const {handleAdminRequest}=await import('../../server/gateway/admin/routes.js');
        const context={gatewayBots:()=>new Map(),supervisor:{} as import('../../server/gateway/admin/supervisor.js').BotSupervisor,
            agentStatePath:local.statePath,populationMemoryTransferPolicyPath:policyPath,populationMemoryEnginePath:local.enginePath};
        const base='http://localhost/api/admin/population-memory/alice',headers={'Content-Type':'application/json','x-admin-request':'rs-sdk-admin',
            ...(process.env.ADMIN_TOKEN?{'x-admin-token':process.env.ADMIN_TOKEN.trim()}:{})};
        const denied=new Request(`${base}/archive`);expect((await handleAdminRequest(denied,new URL(denied.url),context))!.status).toBe(401);
        const archive=new Request(`${base}/archive`,{headers});expect((await handleAdminRequest(archive,new URL(archive.url),context))!.status).toBe(200);
        const request=new Request(`${base}/transfer-preview`,{method:'POST',headers,body:JSON.stringify(local.selection())});
        const previewResponse=(await handleAdminRequest(request,new URL(request.url),context))!;expect(previewResponse.status).toBe(200);
        const preview=await previewResponse.json() as {digest:string;blockers:string[]};expect(preview.blockers).toEqual([]);
        const apply=new Request(`${base}/transfer`,{method:'POST',headers,body:JSON.stringify({...local.selection(),transferId:'http-memory-transfer',previewDigest:preview.digest})});
        const response=(await handleAdminRequest(apply,new URL(apply.url),context))!;expect(response.status).toBe(200);
        expect((await response.json() as {facts:unknown[]}).facts).toHaveLength(1);
    });
});
