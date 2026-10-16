import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { RecordRightsViolation, RightsResourceKind, RightsViolationAction,
    RightsViolationEvent, RightsViolationEvidence } from './types.js';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/,DIGEST=/^[0-9a-f]{64}$/,ZERO='0'.repeat(64);
const SOURCE:Record<RightsResourceKind,RightsViolationEvidence['sourceDomain']>={
    'item-ownership':'item-lifecycle','storage-ownership':'business-assets','property-ownership':'property',
    'entry-entitlement':'property-access'};
const ACTIONS:Record<RightsResourceKind,ReadonlySet<RightsViolationAction>>={
    'item-ownership':new Set(['take','use','transfer']),
    'storage-ownership':new Set(['open','withdraw','deposit']),
    'property-ownership':new Set(['occupy','alter','transfer']),
    'entry-entitlement':new Set(['enter','remain'])};
export type RightsViolationVerifier=(evidence:RightsViolationEvidence)=>boolean;
type Row={event_id:string;evidence_id:string;resource_kind:RightsResourceKind;resource_id:string;owner_kind:'agent'|'business'|'faction';
    owner_id:string;actor_agent_id:string;action:RightsViolationAction;source_domain:RightsViolationEvidence['sourceDomain'];
    source_state_version:number;source_evidence_digest:string;occurred_at:string;event_digest:string;recorded_at:string};
function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function id(value:string,field:string):string{if(!ID.test(value))throw new Error(`${field} is invalid`);return value}
function time(value:string,field:string):string{const parsed=Date.parse(value);if(Number.isNaN(parsed)||new Date(parsed).toISOString()!==value)
    throw new Error(`${field} is invalid`);return value}
function event(row:Row):RightsViolationEvent{return{eventId:row.event_id,evidenceId:row.evidence_id,resourceKind:row.resource_kind,
    resourceId:row.resource_id,owner:{kind:row.owner_kind,id:row.owner_id},actorAgentId:row.actor_agent_id,action:row.action,
    authorizationDecision:'denied',sourceDomain:row.source_domain,sourceStateVersion:row.source_state_version,
    sourceEvidenceDigest:row.source_evidence_digest,occurredAt:row.occurred_at,eventDigest:row.event_digest,recordedAt:row.recorded_at}}

export class RightsViolationStore {
    private readonly database:Database;
    constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.database=new Database(path,{create:true,strict:true});
        this.database.run('PRAGMA foreign_keys = ON');this.migrate()}
    close():void{this.database.close(true)}
    get(eventIdInput:string):RightsViolationEvent|null{const row=this.database.query('SELECT * FROM rights_violation_event WHERE event_id=?1')
        .get(id(eventIdInput,'eventId')) as Row|null;return row?event(row):null}
    list(actorAgentIdInput?:string):RightsViolationEvent[]{const actor=actorAgentIdInput===undefined?null:id(actorAgentIdInput,'actorAgentId');
        return(this.database.query(`SELECT * FROM rights_violation_event WHERE ?1 IS NULL OR actor_agent_id=?1
            ORDER BY occurred_at,event_id`).all(actor) as Row[]).map(event)}
    record(input:RecordRightsViolation,verify?:RightsViolationVerifier,recordedAtInput=new Date().toISOString()):RightsViolationEvent{
        const eventId=id(input.eventId,'eventId'),evidence=this.validate(input.evidence),recordedAt=time(recordedAtInput,'recordedAt');
        if(!verify?.(evidence))throw new Error('Rights violation evidence is not trusted');
        const eventDigest=hash({eventId,evidence}),existing=this.get(eventId);if(existing){if(existing.eventDigest!==eventDigest)
            throw new Error('Rights violation event id was reused');return existing}
        const evidenceUse=this.database.query('SELECT event_id FROM rights_violation_event WHERE evidence_id=?1').get(evidence.evidenceId) as
            {event_id:string}|null;if(evidenceUse)throw new Error('Rights violation evidence was already recorded');
        const transaction=this.database.transaction(()=>{this.database.run(`INSERT INTO rights_violation_event VALUES(
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,[eventId,evidence.evidenceId,evidence.resourceKind,
                evidence.resourceId,evidence.owner.kind,evidence.owner.id,evidence.actorAgentId,evidence.action,evidence.sourceDomain,
                evidence.sourceStateVersion,evidence.sourceEvidenceDigest,evidence.occurredAt,eventDigest,recordedAt]);
            const previous=(this.database.query('SELECT entry_hash FROM rights_violation_audit ORDER BY sequence DESC LIMIT 1').get() as
                {entry_hash:string}|null)?.entry_hash??ZERO,payload={eventId,eventDigest,recordedAt};this.database.run(
                `INSERT INTO rights_violation_audit(event_id,payload_json,previous_hash,entry_hash) VALUES(?1,?2,?3,?4)`,
                [eventId,JSON.stringify(payload),previous,hash({previousHash:previous,payload})])});
        transaction.immediate();return this.get(eventId)!}
    verifyAuditChain():boolean{const rows=this.database.query(`SELECT event_id,previous_hash,entry_hash,payload_json FROM rights_violation_audit
        ORDER BY sequence`).all() as Array<{event_id:string;previous_hash:string;entry_hash:string;payload_json:string}>;let previous=ZERO;
        const count=this.database.query('SELECT COUNT(*) AS count FROM rights_violation_event').get() as{count:number};
        if(count.count!==rows.length)return false;
        for(const row of rows){const source=this.database.query('SELECT * FROM rights_violation_event WHERE event_id=?1').get(row.event_id) as Row|null;
            if(!source)return false;const persisted=event(source),{eventId,eventDigest,recordedAt:unused,...evidence}=persisted,
                payload=JSON.parse(row.payload_json) as{eventId?:unknown;eventDigest?:unknown};void unused;
            if(hash({eventId,evidence})!==eventDigest||payload.eventId!==eventId||payload.eventDigest!==eventDigest
                ||row.previous_hash!==previous||hash({previousHash:previous,payload})!==row.entry_hash)return false;previous=row.entry_hash}return true}
    private validate(value:RightsViolationEvidence):RightsViolationEvidence{if(!value||typeof value!=='object'
            ||Object.keys(value).sort().join(',')!==['action','actorAgentId','authorizationDecision','evidenceId','occurredAt','owner',
                'resourceId','resourceKind','sourceDomain','sourceEvidenceDigest','sourceStateVersion'].sort().join(',')
            ||!value.owner||typeof value.owner!=='object'||Object.keys(value.owner).sort().join(',')!=='id,kind'
            ||!Object.hasOwn(SOURCE,value.resourceKind)||SOURCE[value.resourceKind]!==value.sourceDomain
            ||!ACTIONS[value.resourceKind]?.has(value.action)||value.authorizationDecision!=='denied')
            throw new Error('Rights violation evidence is invalid');
        const evidence={evidenceId:id(value.evidenceId,'evidenceId'),resourceKind:value.resourceKind,
            resourceId:id(value.resourceId,'resourceId'),owner:{kind:value.owner?.kind,id:id(value.owner?.id,'owner.id')},
            actorAgentId:id(value.actorAgentId,'actorAgentId'),action:value.action,authorizationDecision:'denied' as const,
            sourceDomain:value.sourceDomain,sourceStateVersion:value.sourceStateVersion,
            sourceEvidenceDigest:value.sourceEvidenceDigest,occurredAt:time(value.occurredAt,'occurredAt')};
        if(!['agent','business','faction'].includes(evidence.owner.kind)||!Number.isSafeInteger(evidence.sourceStateVersion)
            ||evidence.sourceStateVersion<1||evidence.sourceStateVersion>2_147_483_647||!DIGEST.test(evidence.sourceEvidenceDigest)
            ||(evidence.owner.kind==='agent'&&evidence.owner.id===evidence.actorAgentId))throw new Error('Rights violation evidence is invalid');
        return evidence}
    private migrate():void{const version=Number((this.database.query('PRAGMA user_version').get() as{user_version:number}).user_version);
        if(version>1)throw new Error(`Rights violation schema ${version} is newer than supported version 1`);
        if(version===0){const transaction=this.database.transaction(()=>{this.database.run(`CREATE TABLE rights_violation_event(
            event_id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL UNIQUE,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,
            owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,actor_agent_id TEXT NOT NULL,action TEXT NOT NULL,source_domain TEXT NOT NULL,
            source_state_version INTEGER NOT NULL,source_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,event_digest TEXT NOT NULL,
            recorded_at TEXT NOT NULL)`);this.database.run(`CREATE TABLE rights_violation_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL UNIQUE REFERENCES rights_violation_event(event_id),payload_json TEXT NOT NULL,previous_hash TEXT NOT NULL,
            entry_hash TEXT NOT NULL UNIQUE)`);this.database.run('PRAGMA user_version = 1')});transaction.immediate()}}
}
