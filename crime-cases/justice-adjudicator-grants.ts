import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

const ID=/^[a-z0-9][a-z0-9._:-]{1,127}$/i,DIGEST=/^[0-9a-f]{64}$/,ZERO='0'.repeat(64);
export type JusticeCapability='adjudication'|'custody'|'restitution';
export interface IssueJusticeAdjudicatorGrant { grantId:string;jurisdictionId:string;adjudicatorAgentId:string;
    capabilities:JusticeCapability[];issuedByAgentId:string;authorityEvidenceDigest:string;occurredAt:string }
export interface RevokeJusticeAdjudicatorGrant { grantId:string;revokedByAgentId:string;
    authorityEvidenceDigest:string;occurredAt:string }
export interface JusticeAdjudicatorGrant extends IssueJusticeAdjudicatorGrant { grantDigest:string;
    status:'active'|'revoked';revokedAt:string|null;revokedByAgentId:string|null;revocationEvidenceDigest:string|null }
export type JusticeGrantVerifier=(command:Readonly<IssueJusticeAdjudicatorGrant|RevokeJusticeAdjudicatorGrant>)=>string|null;
type Row={grant_id:string;jurisdiction_id:string;adjudicator_agent_id:string;capabilities_json:string;
    issued_by_agent_id:string;authority_evidence_digest:string;occurred_at:string;grant_digest:string;
    status:'active'|'revoked';revoked_at:string|null;revoked_by_agent_id:string|null;revocation_evidence_digest:string|null};
type Audit={sequence:number;grant_id:string;action:'issued'|'revoked';actor_agent_id:string;evidence_digest:string;
    occurred_at:string;record_digest:string;previous_hash:string;entry_hash:string};
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function time(value:unknown):value is string{return typeof value==='string'&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value}
function caps(value:unknown):JusticeCapability[]{if(!Array.isArray(value)||value.length<1||value.length>3
    ||value.some(entry=>!['adjudication','custody','restitution'].includes(String(entry))))throw new Error('Justice grant capabilities are invalid');
    const normalized=[...new Set(value as JusticeCapability[])].sort();if(normalized.length!==value.length)return normalized;return normalized}
function grant(row:Row):JusticeAdjudicatorGrant{return{grantId:row.grant_id,jurisdictionId:row.jurisdiction_id,
    adjudicatorAgentId:row.adjudicator_agent_id,capabilities:JSON.parse(row.capabilities_json),issuedByAgentId:row.issued_by_agent_id,
    authorityEvidenceDigest:row.authority_evidence_digest,occurredAt:row.occurred_at,grantDigest:row.grant_digest,
    status:row.status,revokedAt:row.revoked_at,revokedByAgentId:row.revoked_by_agent_id,
    revocationEvidenceDigest:row.revocation_evidence_digest}}
function issueFacts(value:JusticeAdjudicatorGrant):IssueJusticeAdjudicatorGrant{return{grantId:value.grantId,
    jurisdictionId:value.jurisdictionId,adjudicatorAgentId:value.adjudicatorAgentId,capabilities:value.capabilities,
    issuedByAgentId:value.issuedByAgentId,authorityEvidenceDigest:value.authorityEvidenceDigest,occurredAt:value.occurredAt}}

/** Audited, capability-specific appointment ledger; grants no inventory or engine access by itself. */
export class JusticeAdjudicatorGrantStore {
    private readonly database:Database;
    constructor(path:string,private readonly verifyAuthority:JusticeGrantVerifier){mkdirSync(dirname(path),{recursive:true});
        this.database=new Database(path,{create:true,strict:true});this.migrate()}
    close(){this.database.close(true)}
    get(grantId:string):JusticeAdjudicatorGrant|null{if(!ID.test(grantId))throw new Error('Justice grant id is invalid');
        if(!this.verifyAuditChain())throw new Error('Justice grant audit chain is invalid');
        const row=this.database.query('SELECT * FROM justice_adjudicator_grant WHERE grant_id=?1').get(grantId) as Row|null;
        return row?grant(row):null}
    issue(input:IssueJusticeAdjudicatorGrant):JusticeAdjudicatorGrant{
        const value:IssueJusticeAdjudicatorGrant={...input,capabilities:caps(input.capabilities)};
        if(!ID.test(value.grantId)||!ID.test(value.jurisdictionId)||!ID.test(value.adjudicatorAgentId)
            ||!ID.test(value.issuedByAgentId)||value.adjudicatorAgentId===value.issuedByAgentId
            ||!DIGEST.test(value.authorityEvidenceDigest)||!time(value.occurredAt))throw new Error('Justice grant is invalid');
        if(this.verifyAuthority(Object.freeze(structuredClone(value)))!==value.authorityEvidenceDigest)
            throw new Error('Justice grant authority is not trusted');
        const grantDigest=hash(value),existing=this.get(value.grantId);if(existing){if(existing.grantDigest!==grantDigest)
            throw new Error('Justice grant id was reused');return existing}
        this.database.transaction(()=>{this.database.run(`INSERT INTO justice_adjudicator_grant VALUES(
            ?1,?2,?3,?4,?5,?6,?7,?8,'active',NULL,NULL,NULL)`,[value.grantId,value.jurisdictionId,value.adjudicatorAgentId,
            JSON.stringify(value.capabilities),value.issuedByAgentId,value.authorityEvidenceDigest,value.occurredAt,grantDigest]);
            this.audit(value.grantId,'issued',value.issuedByAgentId,value.authorityEvidenceDigest,value.occurredAt,
                hash({...value,grantDigest,status:'active',revokedAt:null,revokedByAgentId:null,revocationEvidenceDigest:null}))}).immediate();
        return this.get(value.grantId)!}
    revoke(input:RevokeJusticeAdjudicatorGrant):JusticeAdjudicatorGrant{
        if(!input||!ID.test(input.grantId)||!ID.test(input.revokedByAgentId)||!DIGEST.test(input.authorityEvidenceDigest)
            ||!time(input.occurredAt))throw new Error('Justice grant revocation is invalid');
        const current=this.get(input.grantId);if(!current)throw new Error('Justice grant is absent');
        if(current.status==='revoked'){if(current.revokedAt!==input.occurredAt||current.revokedByAgentId!==input.revokedByAgentId
            ||current.revocationEvidenceDigest!==input.authorityEvidenceDigest)throw new Error('Justice grant revocation changed');return current}
        if(input.occurredAt<current.occurredAt||this.verifyAuthority(Object.freeze({...input}))!==input.authorityEvidenceDigest)
            throw new Error('Justice grant revocation authority is not trusted');
        this.database.transaction(()=>{this.database.run(`UPDATE justice_adjudicator_grant SET status='revoked',revoked_at=?2,
            revoked_by_agent_id=?3,revocation_evidence_digest=?4 WHERE grant_id=?1 AND status='active'`,
        [input.grantId,input.occurredAt,input.revokedByAgentId,input.authorityEvidenceDigest]);const changed=this.getRaw(input.grantId)!;
            this.audit(input.grantId,'revoked',input.revokedByAgentId,input.authorityEvidenceDigest,input.occurredAt,hash(grant(changed)))}).immediate();
        return this.get(input.grantId)!}
    isAuthorizedAt(jurisdictionId:string,adjudicatorAgentId:string,required:JusticeCapability[],at:string):boolean{
        if(!this.verifyAuditChain()||!time(at))return false;const rows=this.database.query(`SELECT * FROM justice_adjudicator_grant
            WHERE jurisdiction_id=?1 AND adjudicator_agent_id=?2 AND occurred_at<=?3 AND (revoked_at IS NULL OR revoked_at>?3)`)
            .all(jurisdictionId,adjudicatorAgentId,at) as Row[];const needed=new Set(required);
        return rows.some(row=>{const available=new Set(grant(row).capabilities);return [...needed].every(value=>available.has(value))})}
    verifyAuditChain():boolean{try{const rows=this.database.query('SELECT * FROM justice_adjudicator_grant').all() as Row[];
        const audits=this.database.query('SELECT * FROM justice_adjudicator_grant_audit ORDER BY sequence').all() as Audit[];
        const byId=new Map(rows.map(row=>[row.grant_id,row])),events=new Map<string,Audit[]>();let previous=ZERO;
        for(const entry of audits){const row=byId.get(entry.grant_id);if(!row||entry.previous_hash!==previous)return false;
            const payload={grantId:entry.grant_id,action:entry.action,actorAgentId:entry.actor_agent_id,
                evidenceDigest:entry.evidence_digest,occurredAt:entry.occurred_at,recordDigest:entry.record_digest};
            if(entry.entry_hash!==hash({previousHash:previous,payload}))return false;previous=entry.entry_hash;
            const list=events.get(entry.grant_id)??[];list.push(entry);events.set(entry.grant_id,list)}
        for(const row of rows){const value=grant(row),list=events.get(value.grantId)??[];
            if(value.grantDigest!==hash(issueFacts(value))||list.length!==(value.status==='active'?1:2)||list[0]?.action!=='issued'
                ||list[0].record_digest!==hash({...issueFacts(value),grantDigest:value.grantDigest,status:'active',revokedAt:null,
                    revokedByAgentId:null,revocationEvidenceDigest:null})||(value.status==='revoked'&&(list[1]?.action!=='revoked'
                    ||list[1].record_digest!==hash(value))))return false}return rows.length===events.size}catch{return false}}
    private getRaw(id:string){return this.database.query('SELECT * FROM justice_adjudicator_grant WHERE grant_id=?1').get(id) as Row|null}
    private audit(grantId:string,action:Audit['action'],actorAgentId:string,evidenceDigest:string,occurredAt:string,recordDigest:string){
        const previous=(this.database.query('SELECT entry_hash FROM justice_adjudicator_grant_audit ORDER BY sequence DESC LIMIT 1')
            .get() as {entry_hash:string}|null)?.entry_hash??ZERO;const payload={grantId,action,actorAgentId,evidenceDigest,occurredAt,recordDigest};
        this.database.run(`INSERT INTO justice_adjudicator_grant_audit(grant_id,action,actor_agent_id,evidence_digest,
            occurred_at,record_digest,previous_hash,entry_hash)VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
        [grantId,action,actorAgentId,evidenceDigest,occurredAt,recordDigest,previous,hash({previousHash:previous,payload})])}
    private migrate(){const version=(this.database.query('PRAGMA user_version').get() as {user_version:number}).user_version;
        if(version>1)throw new Error(`Justice grant schema ${version} is newer than supported version 1`);if(version===1)return;
        this.database.transaction(()=>{this.database.run(`CREATE TABLE justice_adjudicator_grant(grant_id TEXT PRIMARY KEY,
            jurisdiction_id TEXT NOT NULL,adjudicator_agent_id TEXT NOT NULL,capabilities_json TEXT NOT NULL,
            issued_by_agent_id TEXT NOT NULL,authority_evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
            grant_digest TEXT NOT NULL UNIQUE,status TEXT NOT NULL,revoked_at TEXT,revoked_by_agent_id TEXT,
            revocation_evidence_digest TEXT)`);this.database.run(`CREATE TABLE justice_adjudicator_grant_audit(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,grant_id TEXT NOT NULL REFERENCES justice_adjudicator_grant(grant_id),
            action TEXT NOT NULL,actor_agent_id TEXT NOT NULL,evidence_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,
            record_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,UNIQUE(grant_id,action))`);
            this.database.run('PRAGMA user_version=1')}).immediate()}
}
