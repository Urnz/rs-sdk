import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { AgentSkillParameterBinding, AgentSkillReference } from './types.js';

export type LivelihoodAction =
    | { kind: 'skill'; skill: AgentSkillReference; binding: Omit<AgentSkillParameterBinding, 'digest'>; goalId?: string }
    | { kind: 'housing'; operation: 'pay' | 'sleep' | 'wake' | 'owner-sleep' | 'owner-wake'; operationId: string;
        bedSlotId?: string; landlordAgentId?: string; afterPlayerTimeRevision?: number }
    | { kind: 'commerce'; operationId: string; quote?: { businessId: string; workerAgentId: string;
        kind: 'sale' | 'procurement'; quantity: 1; unitPriceGp: number } }
    | { kind: 'stock'; businessId: string; policyId: string; employmentId: string };
export interface LivelihoodJournalEntry {
    actionId: string; agentId: string; eventId: string; policy: string; lifecycle: string;
    action: LivelihoodAction | null; phase: 'prepared' | 'submitted' | 'completed' | 'blocked';
    reason: string; receipt: string | null; createdAt: string; updatedAt: string; revision: number;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Additive extension of the existing agent DB, independent of its upstream user_version. */
export function installLivelihoodJournal(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS agent_livelihood_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
        const versions = db.query('SELECT version FROM agent_livelihood_schema').all();
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='agent_livelihood_action'").get())
                throw new Error('Incomplete livelihood journal migration');
            db.run(`CREATE TABLE agent_livelihood_action(action_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,
                phase TEXT NOT NULL,row_json TEXT NOT NULL)`);
            db.run(`CREATE UNIQUE INDEX agent_livelihood_pending ON agent_livelihood_action(agent_id)
                WHERE phase IN('prepared','submitted')`);
            db.run(`CREATE TABLE agent_livelihood_audit(sequence INTEGER PRIMARY KEY,action_id TEXT NOT NULL,
                row_json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)`);
            db.run('INSERT INTO agent_livelihood_schema VALUES(1)');
        } else if (versions.length !== 1 || (versions[0] as { version: number }).version !== 1)
            throw new Error('Unsupported livelihood journal schema');
    }).immediate();
}

export function readLivelihoodJournal(db: Database, agentId: string): LivelihoodJournalEntry[] {
    if (!db.query("SELECT 1 FROM sqlite_master WHERE name='agent_livelihood_schema'").get()) {
        if (['agent_livelihood_action', 'agent_livelihood_audit'].some(name => db.query('SELECT 1 FROM sqlite_master WHERE name=?1').get(name)))
            throw new Error('Incomplete livelihood journal migration');
        return [];
    }
    const versions = db.query('SELECT version FROM agent_livelihood_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported livelihood journal schema');
    // A digest chain detects a truncated/edited projection, including after a process restart.
    const audit = db.query('SELECT * FROM agent_livelihood_audit ORDER BY sequence').all() as {
        sequence: number; action_id: string; row_json: string; previous_hash: string | null; hash: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, row] of audit.entries()) {
        const { hash, ...body } = row;
        if (row.sequence !== index + 1 || row.previous_hash !== previous || digest(body) !== hash)
            throw new Error('Livelihood journal audit differs');
        latest.set(row.action_id, row.row_json); previous = hash;
    }
    const rows = db.query('SELECT * FROM agent_livelihood_action ORDER BY rowid').all() as {
        action_id: string; agent_id: string; phase: string; row_json: string }[];
    if (rows.length !== latest.size) throw new Error('Livelihood journal coverage differs');
    const entries = rows.map(row => {
        const entry = JSON.parse(row.row_json) as LivelihoodJournalEntry;
        if (latest.get(row.action_id) !== row.row_json || entry.actionId !== row.action_id
            || entry.agentId !== row.agent_id || entry.phase !== row.phase)
            throw new Error('Livelihood journal projection differs');
        return entry;
    });
    return entries.filter(entry => entry.agentId === agentId);
}

export function writeLivelihoodJournal(db: Database, entry: LivelihoodJournalEntry,
    expectedRevision: number | null): LivelihoodJournalEntry {
    if (!['prepared', 'submitted', 'completed', 'blocked'].includes(entry.phase)
        || (['prepared', 'submitted', 'completed'].includes(entry.phase) && !entry.action)
        || (entry.phase === 'completed' && !entry.receipt)
        || !Number.isSafeInteger(entry.revision) || entry.revision < 1
        || !entry.reason || !entry.lifecycle || entry.policy !== 'society-livelihood@1.0.0')
        throw new Error('Invalid livelihood journal entry or source proof');
    let result!: LivelihoodJournalEntry;
    db.transaction(() => {
        const all = readLivelihoodJournal(db, entry.agentId), prior = all.find(e => e.actionId === entry.actionId);
        if ((prior?.revision ?? null) !== expectedRevision) throw new Error('Livelihood journal revision changed');
        if (prior && (digest({ ...prior, phase: null, reason: null, receipt: null, updatedAt: null, revision: null })
            !== digest({ ...entry, phase: null, reason: null, receipt: null, updatedAt: null, revision: null })
            || !['prepared', 'submitted'].includes(prior.phase)
            || (prior.phase === 'submitted' && entry.phase === 'prepared')))
            throw new Error('Livelihood action binding or terminal state changed');
        if (entry.revision !== (expectedRevision ?? 0) + 1) throw new Error('Invalid livelihood journal revision');
        const row = JSON.stringify(entry);
        db.run(`INSERT INTO agent_livelihood_action VALUES(?1,?2,?3,?4) ON CONFLICT(action_id)
            DO UPDATE SET phase=excluded.phase,row_json=excluded.row_json`, [entry.actionId, entry.agentId, entry.phase, row]);
        const head = db.query('SELECT sequence,hash FROM agent_livelihood_audit ORDER BY sequence DESC LIMIT 1').get() as
            { sequence: number; hash: string } | null;
        const body = { sequence: (head?.sequence ?? 0) + 1, action_id: entry.actionId, row_json: row, previous_hash: head?.hash ?? null };
        db.run('INSERT INTO agent_livelihood_audit VALUES(?1,?2,?3,?4,?5)',
            [body.sequence, body.action_id, row, body.previous_hash, digest(body)]);
        result = structuredClone(entry);
    }).immediate();
    return result;
}
