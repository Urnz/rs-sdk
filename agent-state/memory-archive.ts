import type { Database } from 'bun:sqlite';
import { healthDigest } from '../population-health/policy.js';
import type { PopulationDeathRecord } from '../population-lifecycle/death.js';

export type MemoryRow = Record<string,string | number | null>;
export const MEMORY_TABLES = {
    episodes:['agent_episode','episode_id'],social:['agent_relationship','actor_key'],
    semantic:['agent_semantic_memory','knowledge_id'],skills:['agent_skill_knowledge','skill_id,skill_version'],
    consolidation:['agent_consolidation_evidence','rule_key,evidence_key']
} as const;
export interface PopulationMemoryArchive {
    schemaVersion:1; agentId:string; deathEventId:string; deathDigest:string; deathRecordDigest:string;
    deathAtSimulationTime:string; deathRecordedAt:string; capturedAt:string; captureMode:'death-admission'|'late-reconciliation';
    records:Record<keyof typeof MEMORY_TABLES,MemoryRow[]>; actorLinks:MemoryRow[]; controlProfile:MemoryRow | null;
}
export interface MemoryTransferReceipt {
    transferId:string; sourceAgentId:string; recipientAgentId:string; archiveDigest:string; policyDigest:string;
    ruleId:string; mode:'inheritance'|'organization'; reason:string; previewDigest:string; requestDigest:string;
    facts:Array<{sourceKnowledgeId:string;sourceDigest:string;knowledgeId:string;episodeId:string;episodeDigest:string;immutableDigest:string}>; createdAt:string;
}
export function installMemoryArchiveSchema(db: Database): void {
    db.run(`CREATE TABLE agent_population_memory_archive(agent_id TEXT PRIMARY KEY REFERENCES agent_identity(agent_id),
        death_event_id TEXT NOT NULL UNIQUE,record_json TEXT NOT NULL,record_digest TEXT NOT NULL)`);
    db.run(`CREATE TABLE agent_memory_transfer(transfer_id TEXT PRIMARY KEY,source_agent_id TEXT NOT NULL REFERENCES agent_population_memory_archive(agent_id),
        recipient_agent_id TEXT NOT NULL REFERENCES agent_identity(agent_id),record_json TEXT NOT NULL,record_digest TEXT NOT NULL)`);
    db.run(`CREATE TABLE agent_memory_audit(sequence INTEGER PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,
        record_digest TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL)`);
    db.run('CREATE TABLE agent_memory_audit_tail(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,entry_hash TEXT NOT NULL)');
    db.run('INSERT INTO agent_memory_audit_tail VALUES(1,0,?1)',['0'.repeat(64)]);
    for (const [table] of Object.values(MEMORY_TABLES)) for (const operation of ['INSERT','UPDATE','DELETE']) {
        const held = (prefix:string) => `(EXISTS(SELECT 1 FROM agent_population_death WHERE agent_id=${prefix}.agent_id)
            OR EXISTS(SELECT 1 FROM agent_character_lifecycle WHERE agent_id=${prefix}.agent_id AND status='deceased'))`;
        const condition = operation==='UPDATE' ? `${held('OLD')} OR ${held('NEW')}` : held(operation==='INSERT'?'NEW':'OLD');
        db.run(`CREATE TRIGGER memory_closed_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
            WHEN ${condition} BEGIN SELECT RAISE(ABORT,'Terminal population memory is immutable; archive authority required'); END`);
    }
    for (const table of ['agent_population_memory_archive','agent_memory_transfer','agent_memory_audit']) for (const operation of ['UPDATE','DELETE'])
        db.run(`CREATE TRIGGER memory_immutable_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
            BEGIN SELECT RAISE(ABORT,'Population memory history is immutable'); END`);
}
export function appendMemoryAudit(db: Database, kind:'archive'|'transfer', id:string, digest:string): void {
    const tail = db.query('SELECT sequence,entry_hash FROM agent_memory_audit_tail WHERE singleton=1').get() as {sequence:number;entry_hash:string};
    if (!tail) throw new Error('Population memory audit tail missing');
    const sequence=tail.sequence+1, entry=healthDigest({sequence,kind,id,digest,previous:tail.entry_hash});
    const appended=db.run('INSERT INTO agent_memory_audit VALUES(?1,?2,?3,?4,?5,?6)',[sequence,kind,id,digest,tail.entry_hash,entry]);
    const anchored=db.run('UPDATE agent_memory_audit_tail SET sequence=?1,entry_hash=?2 WHERE singleton=1',[sequence,entry]);
    if(appended.changes!==1||anchored.changes!==1)throw new Error('Population memory audit write was ignored');
}
export function verifyMemoryHistory(db: Database): void {
    let previous='0'.repeat(64), sequence=0; const records=new Map<string,string>();
    for (const row of db.query('SELECT * FROM agent_memory_audit ORDER BY sequence').all() as MemoryRow[]) {
        const key=`${row.kind}:${row.record_id}`;
        if (row.sequence!==++sequence || !['archive','transfer'].includes(String(row.kind)) || records.has(key) || row.previous_hash!==previous
            || row.entry_hash!==healthDigest({sequence,kind:row.kind,id:row.record_id,digest:row.record_digest,previous}))
            throw new Error('Population memory audit is invalid');
        previous=String(row.entry_hash); records.set(key,String(row.record_digest));
    }
    const tail=db.query('SELECT sequence,entry_hash FROM agent_memory_audit_tail WHERE singleton=1').get() as MemoryRow | null;
    if (!tail || tail.sequence!==sequence || tail.entry_hash!==previous) throw new Error('Population memory audit was truncated');
    let count=0;
    for (const [table,kind,id] of [['agent_population_memory_archive','archive','agent_id'],['agent_memory_transfer','transfer','transfer_id']]) {
        for (const row of db.query(`SELECT * FROM ${table}`).all() as MemoryRow[]) {
            count++;
            const record=JSON.parse(String(row.record_json));
            if (healthDigest(record)!==row.record_digest || records.get(`${kind}:${row[id!]}`)!==row.record_digest
                ||kind==='archive'&&(record.agentId!==row.agent_id||record.deathEventId!==row.death_event_id)
                ||kind==='transfer'&&(record.transferId!==row.transfer_id||record.sourceAgentId!==row.source_agent_id||record.recipientAgentId!==row.recipient_agent_id))
                throw new Error('Population memory record conflicts with its audit');
        }
    }
    if (count!==records.size) throw new Error('Population memory history is incomplete');
}
function currentRecords(db: Database, agentId:string): PopulationMemoryArchive['records'] {
    return Object.fromEntries(Object.entries(MEMORY_TABLES).map(([kind,[table,order]])=>[kind,
        db.query(`SELECT * FROM ${table} WHERE agent_id=?1 ORDER BY ${order}`).all(agentId)])) as PopulationMemoryArchive['records'];
}
export function readPopulationMemoryArchive(db:Database,agentId:string): {archive:PopulationMemoryArchive;digest:string} | null {
    verifyMemoryHistory(db);
    const row=db.query('SELECT record_json,record_digest FROM agent_population_memory_archive WHERE agent_id=?1').get(agentId) as MemoryRow | null;
    if (!row) return null;
    const archive=JSON.parse(String(row.record_json)) as PopulationMemoryArchive;
    const death=db.query('SELECT event_id,event_digest FROM agent_population_death WHERE agent_id=?1').get(agentId) as MemoryRow | null;
    if (archive.agentId!==agentId || death?.event_id!==archive.deathEventId || death.event_digest!==archive.deathRecordDigest
        || healthDigest(currentRecords(db,agentId))!==healthDigest(archive.records)) throw new Error('Archived population memory source changed');
    return {archive,digest:String(row.record_digest)};
}
export function archivePopulationMemory(db:Database,death:PopulationDeathRecord,capturedAt:string,captureMode:PopulationMemoryArchive['captureMode']): void {
    const existing=readPopulationMemoryArchive(db,death.agentId);
    if (existing) { if (existing.archive.deathDigest!==death.eventDigest) throw new Error('Memory archive death conflicts'); return; }
    const archive:PopulationMemoryArchive={schemaVersion:1,agentId:death.agentId,deathEventId:death.eventId,deathDigest:death.eventDigest,
        deathRecordDigest:healthDigest(death),deathAtSimulationTime:death.atSimulationTime,deathRecordedAt:death.recordedAt,capturedAt,captureMode,records:currentRecords(db,death.agentId),
        actorLinks:db.query('SELECT * FROM agent_economic_actor_link WHERE agent_id=?1 ORDER BY actor_kind,actor_id').all(death.agentId) as MemoryRow[],
        controlProfile:db.query('SELECT * FROM agent_control_profile WHERE agent_id=?1').get(death.agentId) as MemoryRow | null};
    const digest=healthDigest(archive);
    const inserted=db.run('INSERT INTO agent_population_memory_archive VALUES(?1,?2,?3,?4)',[death.agentId,death.eventId,JSON.stringify(archive),digest]);
    if(inserted.changes!==1)throw new Error('Population memory archive write was ignored');
    appendMemoryAudit(db,'archive',death.agentId,digest);
    verifyMemoryHistory(db);
}
export function knowledgeImmutableDigest(row:MemoryRow):string {
    const {status:_status,updated_at:_updated,revision:_revision,...immutable}=row; return healthDigest(immutable);
}
