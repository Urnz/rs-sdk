import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { foodDigest, readFoodResult, type FoodResult, type NativeFoodContext } from './NativeFoodConsumptionStore.js';
import { readFoodProductionReceipt, type FoodBalances, type FoodProductionReceipt } from './NativeFoodProductionStore.js';
import type { EngineTradeEvidence } from './TradeEvidenceStore.js';
import type { FoodMutationOrigin, IntegrityMutation } from '../../../../society-integrity/store.js';

export interface FoodCustodian { worldId: string; actorId: string; username: string; lifecycleId: string }
export interface FoodTradeSide { custodian: FoodCustodian; before: FoodBalances; after: FoodBalances }
export type FoodLineageFact =
    | { kind: 'production'; receipt: FoodProductionReceipt }
    | { kind: 'consumption'; result: FoodResult }
    | { kind: 'transfer'; trade: EngineTradeEvidence; sides: [FoodTradeSide, FoodTradeSide] }
    | { kind: 'opening'; mutation: IntegrityMutation; proof: FoodMutationOrigin; custodian: FoodCustodian;
        before: FoodBalances; after: FoodBalances; checkpointDigest: string };
export interface FoodLineageEntry { sequence: number; sourceKey: string; fact: FoodLineageFact;
    previousDigest: string | null; digest: string }
export interface FoodLineageJournal { sourceId: string; entries: FoodLineageEntry[] }
export function foodCustodian(context: NativeFoodContext): FoodCustodian {
    const { worldId, actorId, username, lifecycleId } = context.action;
    return { worldId, actorId, username, lifecycleId };
}
export function lineageKey(fact: FoodLineageFact): string {
    return fact.kind === 'opening' ? `opening:${fact.mutation.operationId}` : fact.kind === 'production' ? `production:${fact.receipt.action.actionId}`
        : fact.kind === 'consumption' ? `consumption:${fact.result.action.actionId}` : `trade:${fact.trade.eventId}`;
}
/** Additive witness journal, never an inventory authority. No retrospective origin is invented. */
export function initializeFoodLineage(db: Database): void {
    const exists = db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_lineage_schema'").get();
    if (exists) { readFoodLineage(db); return; }
    if (db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_food_lineage','native_food_lineage_head')").get())
        throw new Error('Incomplete native food lineage schema');
    db.run('CREATE TABLE native_food_lineage_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
    db.run('INSERT INTO native_food_lineage_schema VALUES(1)');
    db.run(`CREATE TABLE native_food_lineage(sequence INTEGER PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,entry_json TEXT NOT NULL)`);
    db.run(`CREATE TABLE native_food_lineage_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),source_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,digest TEXT)`);
    db.run('INSERT INTO native_food_lineage_head VALUES(1,?1,0,NULL)', [randomUUID()]);
}
export function readFoodLineage(db: Database): FoodLineageJournal {
    const versions = db.query('SELECT version FROM native_food_lineage_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native food lineage schema');
    const head = db.query('SELECT * FROM native_food_lineage_head WHERE singleton=1').get() as
        { source_id: string; sequence: number; digest: string | null } | null;
    if (!head || !/^[a-f0-9-]{36}$/.test(head.source_id)) throw new Error('Native food lineage head missing');
    const rows = db.query('SELECT * FROM native_food_lineage ORDER BY sequence').all() as
        { sequence: number; source_key: string; entry_json: string }[];
    let previous: string | null = null;
    const entries = rows.map((row, i) => {
        const entry = JSON.parse(row.entry_json) as FoodLineageEntry, { digest, ...facts } = entry;
        if (row.sequence !== i + 1 || entry.sequence !== row.sequence || row.source_key !== entry.sourceKey
            || lineageKey(entry.fact) !== entry.sourceKey || entry.previousDigest !== previous || foodDigest(facts) !== digest)
            throw new Error('Native food lineage audit mismatch');
        if (entry.fact.kind === 'production' && foodDigest(readFoodProductionReceipt(db, entry.fact.receipt.action.actionId)) !== foodDigest(entry.fact.receipt)
            || entry.fact.kind === 'consumption' && foodDigest(readFoodResult(db, entry.fact.result.action.actionId)) !== foodDigest(entry.fact.result))
            throw new Error('Native food lineage source differs');
        previous = digest; return entry;
    });
    if (head.sequence !== entries.length || head.digest !== previous) throw new Error('Native food lineage tail differs');
    return { sourceId: head.source_id, entries };
}
export function appendFoodLineage(db: Database, fact: FoodLineageFact): void {
    if (!db.inTransaction) throw new Error('Native food lineage requires a checkpoint transaction');
    const journal = readFoodLineage(db), sourceKey = lineageKey(fact);
    const prior = journal.entries.find(entry => entry.sourceKey === sourceKey);
    if (prior) {
        if (foodDigest(prior.fact) !== foodDigest(fact)) throw new Error('Native food lineage source reused');
        return;
    }
    const facts = { sequence: journal.entries.length + 1, sourceKey, fact, previousDigest: journal.entries.at(-1)?.digest ?? null };
    const entry = { ...facts, digest: foodDigest(facts) };
    db.run('INSERT INTO native_food_lineage VALUES(?1,?2,?3)', [entry.sequence, sourceKey, JSON.stringify(entry)]);
    db.run('UPDATE native_food_lineage_head SET sequence=?1,digest=?2 WHERE singleton=1', [entry.sequence, entry.digest]);
}
