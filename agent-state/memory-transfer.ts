import { readFileSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { healthDigest, healthInteger, healthKey, healthObject, healthTime } from '../population-health/policy.js';
import { readPopulationMemoryArchive, appendMemoryAudit, verifyMemoryHistory, knowledgeImmutableDigest, type MemoryRow, type MemoryTransferReceipt } from './memory-archive.js';
import type { CreateAgentEpisode, CreateAgentKnowledge } from './types.js';

export interface MemoryTransferRule {
    ruleId:string; sourceAgentId:string; recipientAgentId:string; archiveDigest:string; mode:'inheritance'|'organization';
    organization:{kind:'business'|'faction';id:string} | null; knowledgeIds:string[]; maximumConfidence:number;
}
export interface MemoryTransferPolicy {schemaVersion:1;policyId:string;version:string;rules:MemoryTransferRule[];digest:string}
export interface MemoryTransferSelection {sourceAgentId:string;recipientAgentId:string;ruleId:string;reason:string}
export interface MemoryTransferRequest extends MemoryTransferSelection {transferId:string;previewDigest:string}
export interface MemoryTransferPreview extends MemoryTransferSelection {
    archiveDigest:string; policyDigest:string; recipientDigest:string; knowledgeIds:string[]; blockers:string[]; digest:string;
}
export function validateMemoryTransferPolicy(raw:unknown):MemoryTransferPolicy {
    const value=healthObject(raw,['schemaVersion','policyId','version','rules'],'Memory transfer policy');
    if (value.schemaVersion!==1 || typeof value.version!=='string' || !/^\d+\.\d+\.\d+$/.test(value.version)
        || !Array.isArray(value.rules) || value.rules.length>256) throw new Error('Memory transfer policy is invalid');
    const ids=new Set<string>();
    const rules=value.rules.map(raw=>{
        const rule=healthObject(raw,['ruleId','sourceAgentId','recipientAgentId','archiveDigest','mode','organization','knowledgeIds','maximumConfidence'],'Memory transfer rule');
        const ruleId=healthKey(rule.ruleId),sourceAgentId=healthKey(rule.sourceAgentId),recipientAgentId=healthKey(rule.recipientAgentId);
        if(ids.has(ruleId)||sourceAgentId===recipientAgentId||!['inheritance','organization'].includes(String(rule.mode))
            ||typeof rule.archiveDigest!=='string'||!/^[a-f0-9]{64}$/.test(rule.archiveDigest)
            ||!Array.isArray(rule.knowledgeIds)||!rule.knowledgeIds.length||rule.knowledgeIds.length>100) throw new Error('Memory transfer rule is invalid');
        ids.add(ruleId); const knowledgeIds=rule.knowledgeIds.map(healthKey);
        if(new Set(knowledgeIds).size!==knowledgeIds.length)throw new Error('Duplicate knowledge selection');
        let organization:MemoryTransferRule['organization']=null;
        if(rule.mode==='organization') {
            const org=healthObject(rule.organization,['kind','id'],'Memory organization');
            if(org.kind!=='business'&&org.kind!=='faction')throw new Error('Memory organization kind is invalid');
            organization={kind:org.kind,id:healthKey(org.id)};
        } else if(rule.organization!==null)throw new Error('Personal inheritance cannot imply an organization');
        return {ruleId,sourceAgentId,recipientAgentId,archiveDigest:rule.archiveDigest,mode:rule.mode as MemoryTransferRule['mode'],organization,
            knowledgeIds,maximumConfidence:healthInteger(rule.maximumConfidence,1,100)};
    });
    const definition={schemaVersion:1 as const,policyId:healthKey(value.policyId),version:value.version,rules};
    return {...definition,digest:healthDigest(definition)};
}
export function loadMemoryTransferPolicy(path:string):MemoryTransferPolicy {return validateMemoryTransferPolicy(JSON.parse(readFileSync(path,'utf8')));}
function checked(policy:MemoryTransferPolicy):MemoryTransferPolicy {
    const {digest,...definition}=policy,validated=validateMemoryTransferPolicy(definition);
    if(validated.digest!==digest)throw new Error('Memory transfer policy digest conflicts');return validated;
}
function selection(input:MemoryTransferSelection):MemoryTransferSelection {
    if(typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.length>1000)throw new Error('Memory transfer reason must contain 8–1000 characters');
    return {sourceAgentId:healthKey(input.sourceAgentId),recipientAgentId:healthKey(input.recipientAgentId),ruleId:healthKey(input.ruleId),reason:input.reason.trim()};
}
export function previewMemoryTransfer(db:Database,rawPolicy:MemoryTransferPolicy,input:MemoryTransferSelection,terminalUsernames:ReadonlySet<string>,now:string):MemoryTransferPreview {
    healthTime(now);const policy=checked(rawPolicy),chosen=selection(input),snapshot=readPopulationMemoryArchive(db,chosen.sourceAgentId);
    if(!snapshot)throw new Error('Verified population memory archive is unavailable');
    const {archive,digest:archiveDigest}=snapshot,rule=policy.rules.find(rule=>rule.ruleId===chosen.ruleId),blockers:string[]=[];
    const identity=db.query('SELECT * FROM agent_identity WHERE agent_id=?1').get(chosen.recipientAgentId) as MemoryRow|null;
    const profile=db.query('SELECT * FROM agent_control_profile WHERE agent_id=?1').get(chosen.recipientAgentId) as MemoryRow|null;
    const lifecycle=db.query('SELECT * FROM agent_character_lifecycle WHERE agent_id=?1').get(chosen.recipientAgentId) as MemoryRow|null;
    const membership=db.query('SELECT * FROM agent_population_member WHERE agent_id=?1').get(chosen.recipientAgentId) as MemoryRow|null;
    const existing=db.query('SELECT * FROM agent_semantic_memory WHERE agent_id=?1 ORDER BY knowledge_id').all(chosen.recipientAgentId) as MemoryRow[];
    if(!rule||rule.sourceAgentId!==chosen.sourceAgentId||rule.recipientAgentId!==chosen.recipientAgentId||rule.archiveDigest!==archiveDigest)
        blockers.push('No exact archive-bound knowledge transfer rule');
    if(chosen.sourceAgentId===chosen.recipientAgentId||!identity||!profile||lifecycle?.status==='deceased'||membership?.status==='reset'
        ||identity.player_username&&terminalUsernames.has(String(identity.player_username)))blockers.push('Recipient is unavailable or terminal');
    if(rule?.mode==='inheritance'&&(!identity?.player_username||profile?.role!=='player'||profile.subject_kind!=='player'
        ||profile.subject_id!==identity.player_username||lifecycle?.status!=='active'))blockers.push('Inheritance recipient must be an active player');
    if(rule?.mode==='organization') {
        const org=rule.organization!;
        if(archive.captureMode!=='death-admission')blockers.push('Late archive cannot prove organization affiliation at death');
        if(profile?.role!=='institution'||profile.subject_kind!==org.kind||profile.subject_id!==org.id)
            blockers.push('Recipient is not the exact organization controller');
        if(!archive.actorLinks.some(link=>link.actor_kind===org.kind&&link.actor_id===org.id&&['owner','manager','member'].includes(String(link.role))
            &&Date.parse(String(link.created_at))<=Date.parse(archive.deathRecordedAt)&&Date.parse(String(link.updated_at))<=Date.parse(archive.deathRecordedAt)))
            blockers.push('Source had no archived organization affiliation');
    }
    for(const id of rule?.knowledgeIds??[]) {
        const fact=archive.records.semantic.find(row=>row.knowledge_id===id);
        if(!fact||fact.status!=='active'||String(fact.valid_from)>now||fact.valid_until&&String(fact.valid_until)<=now)
            blockers.push(`Knowledge ${id} is absent, inactive or outside validity`);
        else if(existing.some(row=>row.status==='active'&&String(row.subject).toLowerCase()===String(fact.subject).toLowerCase()
            &&String(row.predicate).toLowerCase()===String(fact.predicate).toLowerCase()))blockers.push(`Recipient already has an active fact for ${id}`);
    }
    const definition={...chosen,archiveDigest,policyDigest:policy.digest,recipientDigest:healthDigest({identity,profile,lifecycle,membership,existing}),
        knowledgeIds:[...(rule?.knowledgeIds??[])],blockers:[...new Set(blockers)].sort()};
    return {...definition,digest:healthDigest(definition)};
}
export function executeMemoryTransfer(db:Database,rawPolicy:MemoryTransferPolicy,input:MemoryTransferRequest,terminalUsernames:ReadonlySet<string>,now:string,
    create:(agentId:string,episode:CreateAgentEpisode,knowledge:CreateAgentKnowledge)=>void):MemoryTransferReceipt {
    healthTime(now);const policy=checked(rawPolicy),chosen=selection(input),transferId=healthKey(input.transferId);
    if(!/^[a-f0-9]{64}$/.test(input.previewDigest))throw new Error('Memory transfer requires exact preview digest');
    const requestDigest=healthDigest({...chosen,transferId,previewDigest:input.previewDigest,policyDigest:policy.digest});
    verifyMemoryHistory(db);
    const previous=db.query('SELECT record_json FROM agent_memory_transfer WHERE transfer_id=?1').get(transferId) as MemoryRow|null;
    if(previous) {
        const receipt=JSON.parse(String(previous.record_json)) as MemoryTransferReceipt;
        if(receipt.requestDigest!==requestDigest)throw new Error('Memory transfer replay conflicts');
        for(const fact of receipt.facts) {
            const row=db.query('SELECT * FROM agent_semantic_memory WHERE knowledge_id=?1').get(fact.knowledgeId) as MemoryRow|null;
            const episode=db.query('SELECT * FROM agent_episode WHERE episode_id=?1').get(fact.episodeId);
            if(!row||knowledgeImmutableDigest(row)!==fact.immutableDigest||!episode||healthDigest(episode)!==fact.episodeDigest)throw new Error('Transferred knowledge provenance changed');
        }
        return receipt;
    }
    const preview=previewMemoryTransfer(db,policy,chosen,terminalUsernames,now);
    if(preview.blockers.length)throw new Error(`Memory transfer blocked: ${preview.blockers.join('; ')}`);
    if(preview.digest!==input.previewDigest)throw new Error('Memory transfer preview changed');
    const {archive}=readPopulationMemoryArchive(db,chosen.sourceAgentId)!,rule=policy.rules.find(rule=>rule.ruleId===chosen.ruleId)!;
    const facts:MemoryTransferReceipt['facts']=[];
    for(const id of rule.knowledgeIds) {
        const fact=archive.records.semantic.find(row=>row.knowledge_id===id)!;
        const key=healthDigest({transferId,archive:preview.archiveDigest,knowledgeId:id}),knowledgeId=`inherited-${key.slice(0,48)}`,episodeId=`learning-${key.slice(0,48)}`;
        create(chosen.recipientAgentId,{episodeId,kind:'discovery',summary:'Received explicitly authorized archived knowledge',details:JSON.stringify({transferId,archiveDigest:preview.archiveDigest,sourceKnowledgeId:id}),
            source:'system',trust:'untrusted',externalKey:`memory-learning:${key}`,occurredAt:now},
        {knowledgeId,kind:fact.kind as CreateAgentKnowledge['kind'],subject:String(fact.subject),predicate:String(fact.predicate),object:String(fact.object),summary:String(fact.summary),
            confidence:Math.min(Number(fact.confidence),rule.maximumConfidence),tags:['archived-knowledge'],evidenceEpisodeIds:[episodeId],source:'manual',
            externalKey:`memory-fact:${key}`,validFrom:now,validUntil:fact.valid_until as string|null});
        const row=db.query('SELECT * FROM agent_semantic_memory WHERE knowledge_id=?1').get(knowledgeId) as MemoryRow;
        const episode=db.query('SELECT * FROM agent_episode WHERE episode_id=?1').get(episodeId);
        facts.push({sourceKnowledgeId:id,sourceDigest:healthDigest(fact),knowledgeId,episodeId,episodeDigest:healthDigest(episode),immutableDigest:knowledgeImmutableDigest(row)});
    }
    const receipt:MemoryTransferReceipt={transferId,...chosen,archiveDigest:preview.archiveDigest,policyDigest:policy.digest,mode:rule.mode,
        previewDigest:input.previewDigest,requestDigest,facts,createdAt:now};
    const digest=healthDigest(receipt);
    const inserted=db.run('INSERT INTO agent_memory_transfer VALUES(?1,?2,?3,?4,?5)',[transferId,chosen.sourceAgentId,chosen.recipientAgentId,JSON.stringify(receipt),digest]);
    if(inserted.changes!==1)throw new Error('Memory transfer receipt write was ignored');
    appendMemoryAudit(db,'transfer',transferId,digest);verifyMemoryHistory(db);return receipt;
}
