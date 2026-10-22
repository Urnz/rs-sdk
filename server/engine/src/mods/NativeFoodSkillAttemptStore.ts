import type { Database } from 'bun:sqlite';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { validateFoodProductionAction } from './NativeFoodProductionStore.js';

export interface NativeFoodSkillAttempt {
    actionId: string; requestDigest: string; phase: 'waiting' | 'attempted'; wakeTick: number | null; checkpointDigest: string;
}
export function initializeFoodSkillAttempts(db: Database): void {
    db.transaction(() => {
        const tables = ['native_food_skill_attempt', 'native_food_skill_audit', 'native_food_skill_head'];
        if (!db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_skill_schema'").get()) {
            if (tables.some(name => db.query('SELECT 1 FROM sqlite_master WHERE name=?1').get(name))) throw new Error('Incomplete food skill attempt schema');
            db.run('CREATE TABLE native_food_skill_schema(version INTEGER PRIMARY KEY)');
            db.run('INSERT INTO native_food_skill_schema VALUES(1)');
            db.run('CREATE TABLE native_food_skill_attempt(action_id TEXT PRIMARY KEY REFERENCES native_food_production_actions(action_id),record_json TEXT NOT NULL,digest TEXT NOT NULL)');
            db.run('CREATE TABLE native_food_skill_audit(sequence INTEGER PRIMARY KEY,record_json TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL)');
            db.run('CREATE TABLE native_food_skill_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,digest TEXT)');
            db.run('INSERT INTO native_food_skill_head VALUES(1,0,NULL)');
        }
        readFoodSkillAttempts(db);
    }).immediate();
}
export function readFoodSkillAttempts(db: Database): NativeFoodSkillAttempt[] {
    const versions = db.query('SELECT version FROM native_food_skill_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported food skill attempt schema');
    const events = db.query('SELECT * FROM native_food_skill_audit ORDER BY sequence').all() as
        { sequence: number; record_json: string; previous_digest: string | null; digest: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, event] of events.entries()) {
        const { digest, ...facts } = event, value = JSON.parse(event.record_json) as NativeFoodSkillAttempt;
        if (event.sequence !== index + 1 || event.previous_digest !== previous || foodDigest(facts) !== digest)
            throw new Error('Food skill attempt audit differs');
        latest.set(value.actionId, event.record_json); previous = digest;
    }
    const head = db.query('SELECT sequence,digest FROM native_food_skill_head WHERE singleton=1').get() as { sequence: number; digest: string | null } | null;
    if (!head || head.sequence !== events.length || head.digest !== previous) throw new Error('Food skill attempt history was truncated');
    const rows = db.query('SELECT * FROM native_food_skill_attempt').all() as { action_id: string; record_json: string; digest: string }[];
    if (rows.length !== latest.size) throw new Error('Food skill attempt coverage differs');
    return rows.map(row => {
        const value = JSON.parse(row.record_json) as NativeFoodSkillAttempt;
        const source = db.query('SELECT action_json,request_digest FROM native_food_production_actions WHERE action_id=?1').get(value.actionId) as
            { action_json: string; request_digest: string } | null;
        if (value.actionId !== row.action_id || latest.get(row.action_id) !== row.record_json || foodDigest(value) !== row.digest
            || !source || source.request_digest !== value.requestDigest || foodDigest(validateFoodProductionAction(JSON.parse(source.action_json))) !== value.requestDigest
            || !/^[a-f0-9]{64}$/.test(value.checkpointDigest) || !['waiting', 'attempted'].includes(value.phase)
            || (value.phase === 'waiting' ? !Number.isSafeInteger(value.wakeTick) || value.wakeTick! < 0 : value.wakeTick !== null))
            throw new Error('Food skill attempt binding differs');
        return value;
    });
}
export function writeFoodSkillAttempt(db: Database, record: NativeFoodSkillAttempt): void {
    if (!db.inTransaction) throw new Error('Food skill attempt requires its Player checkpoint transaction');
    const prior = readFoodSkillAttempts(db).find(row => row.actionId === record.actionId);
    if (prior?.phase === 'attempted' || (prior && prior.requestDigest !== record.requestDigest)) throw new Error('Food skill attempt is already terminal or differs');
    const json = JSON.stringify(record), head = db.query('SELECT sequence,digest FROM native_food_skill_head WHERE singleton=1').get() as { sequence: number; digest: string | null };
    const facts = { sequence: head.sequence + 1, record_json: json, previous_digest: head.digest }, digest = foodDigest(facts);
    db.run('INSERT INTO native_food_skill_attempt VALUES(?1,?2,?3) ON CONFLICT(action_id) DO UPDATE SET record_json=excluded.record_json,digest=excluded.digest',
        [record.actionId, json, foodDigest(record)]);
    db.run('INSERT INTO native_food_skill_audit VALUES(?1,?2,?3,?4)', [facts.sequence, json, facts.previous_digest, digest]);
    db.run('UPDATE native_food_skill_head SET sequence=?1,digest=?2 WHERE singleton=1', [facts.sequence, digest]);
    readFoodSkillAttempts(db);
}
