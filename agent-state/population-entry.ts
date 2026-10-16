import type { Database } from 'bun:sqlite';
import { populationEntryDigest, type PopulationEntryReceipt } from '../population-lifecycle/entry.js';

export function installPopulationEntrySchema(db: Database): void {
    db.run(`CREATE TABLE agent_population_entry (
        entry_id TEXT PRIMARY KEY, clock_id TEXT NOT NULL, clock_profile_digest TEXT NOT NULL,
        entrant_count INTEGER NOT NULL CHECK(entrant_count>0), receipt_json TEXT NOT NULL, receipt_digest TEXT NOT NULL)`);
    for (const operation of ['UPDATE', 'DELETE']) db.run(`CREATE TRIGGER population_entry_no_${operation.toLowerCase()}
        BEFORE ${operation} ON agent_population_entry BEGIN SELECT RAISE(ABORT,'Population entry history is immutable'); END`);
}
export function readPopulationEntry(db: Database, entryId: string): PopulationEntryReceipt | null {
    const statement = db.prepare('SELECT * FROM agent_population_entry WHERE entry_id=?1');
    try {
        const row = statement.get(entryId) as { entry_id: string; clock_id: string; clock_profile_digest: string;
            entrant_count: number; receipt_json: string; receipt_digest: string } | null;
        if (!row) return null;
        const receipt = JSON.parse(row.receipt_json) as PopulationEntryReceipt;
        const { digest: planDigest, ...plan } = receipt.plan;
        const { digest, ...body } = receipt;
        if (populationEntryDigest(plan) !== planDigest || populationEntryDigest(body) !== digest || digest !== row.receipt_digest
            || receipt.plan.entryId !== row.entry_id || receipt.plan.simulationClock.clockId !== row.clock_id
            || receipt.plan.simulationClock.profileDigest !== row.clock_profile_digest || receipt.plan.entrants.length !== row.entrant_count)
            throw new Error('Population entry history digest mismatch');
        return receipt;
    } finally { statement.finalize(); }
}
export function verifyPopulationEntryHistory(db: Database): void {
    const statement = db.prepare('SELECT entry_id FROM agent_population_entry');
    const member = db.prepare(`SELECT m.source_result_id,m.source_result_digest,l.birth_at_simulation_time,i.player_username
        FROM agent_population_member m JOIN agent_character_lifecycle l ON l.agent_id=m.agent_id
        JOIN agent_identity i ON i.agent_id=m.agent_id WHERE m.agent_id=?1`);
    const orphan = db.prepare(`SELECT m.agent_id FROM agent_population_member m LEFT JOIN agent_population_entry e
        ON e.entry_id=m.source_result_id WHERE m.source_result_id LIKE 'entry-%' AND e.entry_id IS NULL`);
    try {
        if (orphan.get()) throw new Error('Population entry receipt source disappeared');
        for (const row of statement.all() as Array<{ entry_id: string }>) {
            const receipt = readPopulationEntry(db, row.entry_id)!;
            for (const entrant of receipt.plan.entrants) {
                const bound = member.get(entrant.identity.agentId) as { source_result_id: string; source_result_digest: string;
                    birth_at_simulation_time: string; player_username: string } | null;
                if (!bound || bound.source_result_id !== row.entry_id || bound.source_result_digest !== receipt.plan.digest
                    || bound.birth_at_simulation_time !== entrant.birthAtSimulationTime || bound.player_username !== entrant.identity.playerUsername)
                    throw new Error('Population entry persisted member binding is corrupt');
            }
        }
    } finally { statement.finalize(); member.finalize(); orphan.finalize(); }
}
