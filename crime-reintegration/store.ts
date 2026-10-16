import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

import { projectReintegrationAdjustment,validateReintegrationEvent,validateReintegrationKnowledge } from './policy.js';
import type { AppliedReintegrationAdjustment,ReintegrationAudience,ReintegrationEvent,ReintegrationEventVerifier,
    ReintegrationKnowledge,ReintegrationKnowledgeVerifier,ReintegrationPolicy,ReintegrationProjection,
    ReintegrationStanding } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/,ZERO='0'.repeat(64);
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,entry])=>[key,canonical(entry)]))}
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}
function id(value:string,field:string):string{if(typeof value!=='string'||!ID.test(value))throw new Error(`${field} is invalid`);return value}
function iso(value:string,field:string):string{if(typeof value!=='string'||Number.isNaN(Date.parse(value))
    ||new Date(value).toISOString()!==value)throw new Error(`${field} is invalid`);return value}
export function reintegrationAudienceKey(audience:ReintegrationAudience):string{
    if(audience.kind==='observer')return`observer:${id(audience.worldProfileId,'worldProfileId')}:${id(audience.observerAgentId,'observerAgentId')}`;
    if(audience.kind==='community')return`community:${id(audience.worldProfileId,'worldProfileId')}:${id(audience.communityId,'communityId')}`;
    if(audience.kind==='moral-standing')return`moral-standing:${id(audience.worldProfileId,'worldProfileId')}`;
    throw new Error('Reintegration audience is invalid')
}
function sameAudience(left:ReintegrationAudience,right:ReintegrationAudience):boolean{
    return reintegrationAudienceKey(left)===reintegrationAudienceKey(right)
}

type EvidenceRow={record_kind:'event'|'knowledge';record_id:string;record_json:string;record_digest:string;recorded_at:string};
type EvidenceAudit={sequence:number;record_kind:'event'|'knowledge';record_id:string;record_digest:string;
    recorded_at:string;previous_hash:string;entry_hash:string};

/** Durable attestations. A digest-shaped request is never accepted without its authoritative verifier. */
export class ReintegrationEvidenceStore{
    private readonly database:Database;
    constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        try{this.migrate()}catch(error){this.database.close(true);throw error}}
    close():void{this.database.close(true)}
    recordEvent(event:ReintegrationEvent,verify:ReintegrationEventVerifier|undefined,recordedAt=event.occurredAt):ReintegrationEvent{
        validateReintegrationEvent(event);const timestamp=iso(recordedAt,'recordedAt');
        if(timestamp<event.occurredAt)throw new Error('Reintegration event cannot be recorded before it occurred');
        if(!verify?.(Object.freeze(structuredClone(event))))throw new Error('Reintegration event source is not trusted');
        return this.insert('event',event.eventId,event,timestamp) as ReintegrationEvent
    }
    recordKnowledge(knowledge:ReintegrationKnowledge,verify:ReintegrationKnowledgeVerifier|undefined,
        recordedAt=knowledge.learnedAt):ReintegrationKnowledge{
        validateReintegrationKnowledge(knowledge);const timestamp=iso(recordedAt,'recordedAt'),event=this.getEvent(knowledge.eventId);
        if(!event)throw new Error('Reintegration knowledge event is absent');
        if(timestamp<knowledge.learnedAt||knowledge.learnedAt<event.occurredAt)
            throw new Error('Reintegration knowledge time is invalid');
        if(!verify?.(Object.freeze(structuredClone(knowledge)),Object.freeze(structuredClone(event))))
            throw new Error('Reintegration knowledge source is not trusted');
        return this.insert('knowledge',knowledge.knowledgeId,knowledge,timestamp) as ReintegrationKnowledge
    }
    getEvent(eventId:string):ReintegrationEvent|null{return this.read('event',eventId) as ReintegrationEvent|null}
    getKnowledge(knowledgeId:string):ReintegrationKnowledge|null{return this.read('knowledge',knowledgeId) as ReintegrationKnowledge|null}
    verifyEvent=(event:Readonly<ReintegrationEvent>):boolean=>{try{const stored=this.getEvent(event.eventId);
        return stored!==null&&hash(stored)===hash(event)}catch{return false}};
    verifyKnowledge=(knowledge:Readonly<ReintegrationKnowledge>,event:Readonly<ReintegrationEvent>):boolean=>{try{
        const stored=this.getKnowledge(knowledge.knowledgeId);return stored!==null&&stored.eventId===event.eventId
            &&hash(stored)===hash(knowledge)&&this.verifyEvent(event)}catch{return false}};
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM reintegration_evidence ORDER BY rowid').all()as EvidenceRow[],
        audits=this.database.query('SELECT * FROM reintegration_evidence_audit ORDER BY sequence').all()as EvidenceAudit[];
        if(rows.length!==audits.length)return false;const byKey=new Map(rows.map(row=>[`${row.record_kind}:${row.record_id}`,row]));let previous=ZERO;
        for(const audit of audits){const row=byKey.get(`${audit.record_kind}:${audit.record_id}`);if(!row)return false;
            const value=JSON.parse(row.record_json)as ReintegrationEvent|ReintegrationKnowledge;
            if(row.record_kind==='event'){validateReintegrationEvent(value as ReintegrationEvent);
                if((value as ReintegrationEvent).eventId!==row.record_id)return false}
            else{validateReintegrationKnowledge(value as ReintegrationKnowledge);
                if((value as ReintegrationKnowledge).knowledgeId!==row.record_id
                    ||!byKey.has(`event:${(value as ReintegrationKnowledge).eventId}`))return false}
            if(row.record_digest!==hash(value)||audit.record_digest!==row.record_digest||audit.recorded_at!==row.recorded_at
                ||audit.previous_hash!==previous)return false;const payload={recordKind:row.record_kind,recordId:row.record_id,
                    recordDigest:row.record_digest,recordedAt:row.recorded_at};
            if(audit.entry_hash!==hash({previousHash:previous,payload}))return false;previous=audit.entry_hash}return true}catch{return false}}
    private read(kind:'event'|'knowledge',recordId:string):ReintegrationEvent|ReintegrationKnowledge|null{
        if(!this.verifyAuditChain())throw new Error('Reintegration evidence audit chain is invalid');const row=this.database.query(
            'SELECT * FROM reintegration_evidence WHERE record_kind=?1 AND record_id=?2').get(kind,id(recordId,'recordId'))as EvidenceRow|null;
        return row?JSON.parse(row.record_json)as ReintegrationEvent|ReintegrationKnowledge:null
    }
    private insert(kind:'event'|'knowledge',recordIdInput:string,value:ReintegrationEvent|ReintegrationKnowledge,recordedAt:string){
        const recordId=id(recordIdInput,'recordId'),recordDigest=hash(value);if(!this.verifyAuditChain())
            throw new Error('Reintegration evidence audit chain is invalid');const existing=this.database.query(
                'SELECT * FROM reintegration_evidence WHERE record_kind=?1 AND record_id=?2').get(kind,recordId)as EvidenceRow|null;
        if(existing){if(existing.record_digest!==recordDigest)throw new Error('Reintegration evidence id was reused');
            return JSON.parse(existing.record_json)as ReintegrationEvent|ReintegrationKnowledge}
        this.database.transaction(()=>{const recordJson=JSON.stringify(canonical(value));this.database.run(
            'INSERT INTO reintegration_evidence VALUES(?1,?2,?3,?4,?5)',[kind,recordId,recordJson,recordDigest,recordedAt]);
            const previous=(this.database.query('SELECT entry_hash FROM reintegration_evidence_audit ORDER BY sequence DESC LIMIT 1')
                .get()as{entry_hash:string}|null)?.entry_hash??ZERO,payload={recordKind:kind,recordId,recordDigest,recordedAt};
            this.database.run(`INSERT INTO reintegration_evidence_audit(record_kind,record_id,record_digest,recorded_at,
                previous_hash,entry_hash)VALUES(?1,?2,?3,?4,?5,?6)`,[kind,recordId,recordDigest,recordedAt,previous,
                hash({previousHash:previous,payload})])}).immediate();return structuredClone(value)
    }
    private migrate():void{const version=(this.database.query('PRAGMA user_version').get()as{user_version:number}).user_version;
        if(version>1)throw new Error(`Reintegration evidence schema ${version} is newer than supported version 1`);if(version===1)return;
        this.database.transaction(()=>{this.database.run(`CREATE TABLE reintegration_evidence(record_kind TEXT NOT NULL
            CHECK(record_kind IN('event','knowledge')),record_id TEXT NOT NULL,record_json TEXT NOT NULL,
            record_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(record_kind,record_id),UNIQUE(record_kind,record_digest))`);
            this.database.run(`CREATE TABLE reintegration_evidence_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                record_kind TEXT NOT NULL,record_id TEXT NOT NULL,record_digest TEXT NOT NULL,recorded_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,UNIQUE(record_kind,record_id))`);
            this.database.run('PRAGMA user_version=1')}).immediate()}
}

type AdjustmentRow={adjustment_id:string;projection:ReintegrationProjection;subject_agent_id:string;audience_key:string;
    adjustment_json:string;adjustment_digest:string;applied_at:string};
type AdjustmentAudit={sequence:number;adjustment_id:string;adjustment_digest:string;applied_at:string;
    previous_hash:string;entry_hash:string};
function parseAdjustment(row:AdjustmentRow):AppliedReintegrationAdjustment{return JSON.parse(row.adjustment_json)as AppliedReintegrationAdjustment}

/** Audience-scoped improvement ledger. It has no legal-record, title, custody, trait or global-score write path. */
export class ReintegrationStateStore{
    private readonly database:Database;
    constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        try{this.migrate()}catch(error){this.database.close(true);throw error}}
    close():void{this.database.close(true)}
    apply(adjustmentIdInput:string,policy:ReintegrationPolicy,eventId:string,audience:ReintegrationAudience,
        knowledgeId:string|null,evidence:ReintegrationEvidenceStore,appliedAt=new Date().toISOString()):AppliedReintegrationAdjustment{
        const adjustmentId=id(adjustmentIdInput,'adjustmentId'),timestamp=iso(appliedAt,'appliedAt'),event=evidence.getEvent(eventId);
        if(!event)throw new Error('Reintegration event is absent');const knowledge=knowledgeId===null?null:evidence.getKnowledge(knowledgeId);
        const projected=projectReintegrationAdjustment(policy,event,audience,knowledge,evidence.verifyEvent,evidence.verifyKnowledge);
        if(!projected.applied)throw new Error('Reintegration adjustment is not authorized');
        const existing=this.get(adjustmentId);if(existing){if(existing.eventId!==event.eventId||!sameAudience(existing.audience,audience)
            ||existing.knowledgeId!==projected.knowledgeId||existing.policyDigest!==projected.policyDigest)
            throw new Error('Reintegration adjustment id was reused');return existing}
        if(timestamp<event.occurredAt)throw new Error('Reintegration adjustment predates its event');
        const projection:ReintegrationProjection=audience.kind==='moral-standing'?'moral-standing':'reputation',key=reintegrationAudienceKey(audience);
        const duplicate=this.database.query(`SELECT adjustment_id FROM reintegration_adjustment WHERE subject_agent_id=?1
            AND audience_key=?2 AND projection=?3 AND json_extract(adjustment_json,'$.eventId')=?4`).get(
                event.subjectAgentId,key,projection,event.eventId)as{adjustment_id:string}|null;
        if(duplicate)throw new Error('Reintegration event was already applied to this audience');
        const before=this.value(event.subjectAgentId,audience,projection),base={adjustmentId,projection,subjectAgentId:event.subjectAgentId,
            audience:structuredClone(audience),eventId:event.eventId,eventKind:event.kind,sourceEvidenceDigest:event.sourceEvidenceDigest,
            knowledgeId:projected.knowledgeId,delta:projected.delta,valueBefore:before,valueAfter:before+projected.delta,
            policyDigest:projected.policyDigest,appliedAt:timestamp},adjustmentDigest=hash(base),value={...base,adjustmentDigest};
        this.database.transaction(()=>{this.database.run('INSERT INTO reintegration_adjustment VALUES(?1,?2,?3,?4,?5,?6,?7)',
            [adjustmentId,projection,event.subjectAgentId,key,JSON.stringify(canonical(value)),adjustmentDigest,timestamp]);
            const previous=(this.database.query('SELECT entry_hash FROM reintegration_adjustment_audit ORDER BY sequence DESC LIMIT 1')
                .get()as{entry_hash:string}|null)?.entry_hash??ZERO,payload={adjustmentId,adjustmentDigest,appliedAt:timestamp};
            this.database.run(`INSERT INTO reintegration_adjustment_audit(adjustment_id,adjustment_digest,applied_at,previous_hash,
                entry_hash)VALUES(?1,?2,?3,?4,?5)`,[adjustmentId,adjustmentDigest,timestamp,previous,
                hash({previousHash:previous,payload})])}).immediate();return this.get(adjustmentId)!
    }
    get(adjustmentId:string):AppliedReintegrationAdjustment|null{if(!this.verifyAuditChain())
        throw new Error('Reintegration state audit chain is invalid');const row=this.database.query(
            'SELECT * FROM reintegration_adjustment WHERE adjustment_id=?1').get(id(adjustmentId,'adjustmentId'))as AdjustmentRow|null;
        return row?parseAdjustment(row):null}
    listForAudience(audience:ReintegrationAudience):AppliedReintegrationAdjustment[]{if(!this.verifyAuditChain())
        throw new Error('Reintegration state audit chain is invalid');const rows=this.database.query(
            'SELECT * FROM reintegration_adjustment WHERE audience_key=?1 ORDER BY rowid').all(
                reintegrationAudienceKey(audience))as AdjustmentRow[];return rows.map(parseAdjustment)}
    getStanding(subjectAgentId:string,audience:ReintegrationAudience):ReintegrationStanding{
        const subject=id(subjectAgentId,'subjectAgentId'),projection:ReintegrationProjection=
            audience.kind==='moral-standing'?'moral-standing':'reputation',items=this.listForAudience(audience)
                .filter(item=>item.subjectAgentId===subject&&item.projection===projection);
        return{projection,subjectAgentId:subject,audience:structuredClone(audience),value:items.reduce((sum,item)=>sum+item.delta,0),
            adjustmentIds:items.map(item=>item.adjustmentId),sourceEventIds:items.map(item=>item.eventId)}
    }
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM reintegration_adjustment ORDER BY rowid').all()as AdjustmentRow[],
        audits=this.database.query('SELECT * FROM reintegration_adjustment_audit ORDER BY sequence').all()as AdjustmentAudit[];
        if(rows.length!==audits.length)return false;const byId=new Map(rows.map(row=>[row.adjustment_id,row])),values=new Map<string,number>(),
            events=new Set<string>();let previous=ZERO;
        for(const audit of audits){const row=byId.get(audit.adjustment_id);if(!row)return false;const value=parseAdjustment(row),
            {adjustmentDigest:_digest,...facts}=value;void _digest;const key=`${value.subjectAgentId}\0${row.audience_key}\0${value.projection}`,
            eventKey=`${key}\0${value.eventId}`,before=values.get(key)??0;
            if(value.adjustmentId!==row.adjustment_id||value.subjectAgentId!==row.subject_agent_id
                ||reintegrationAudienceKey(value.audience)!==row.audience_key||value.projection!==row.projection
                ||value.valueBefore!==before||value.valueAfter!==before+value.delta||value.delta<1||events.has(eventKey)
                ||value.adjustmentDigest!==hash(facts)||row.adjustment_digest!==value.adjustmentDigest
                ||audit.adjustment_digest!==value.adjustmentDigest||audit.applied_at!==row.applied_at
                ||audit.previous_hash!==previous)return false;const payload={adjustmentId:value.adjustmentId,
                    adjustmentDigest:value.adjustmentDigest,appliedAt:value.appliedAt};
            if(audit.entry_hash!==hash({previousHash:previous,payload}))return false;previous=audit.entry_hash;
            values.set(key,value.valueAfter);events.add(eventKey)}return true}catch{return false}}
    private value(subjectAgentId:string,audience:ReintegrationAudience,projection:ReintegrationProjection):number{
        return this.listForAudience(audience).filter(item=>item.subjectAgentId===subjectAgentId&&item.projection===projection)
            .reduce((sum,item)=>sum+item.delta,0)}
    private migrate():void{const version=(this.database.query('PRAGMA user_version').get()as{user_version:number}).user_version;
        if(version>1)throw new Error(`Reintegration state schema ${version} is newer than supported version 1`);if(version===1)return;
        this.database.transaction(()=>{this.database.run(`CREATE TABLE reintegration_adjustment(adjustment_id TEXT PRIMARY KEY,
            projection TEXT NOT NULL CHECK(projection IN('reputation','moral-standing')),subject_agent_id TEXT NOT NULL,
            audience_key TEXT NOT NULL,adjustment_json TEXT NOT NULL,adjustment_digest TEXT NOT NULL UNIQUE,applied_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE reintegration_adjustment_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                adjustment_id TEXT NOT NULL UNIQUE REFERENCES reintegration_adjustment(adjustment_id),adjustment_digest TEXT NOT NULL,
                applied_at TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version=1')}).immediate()}
}
