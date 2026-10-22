import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { readFoodProductionReceipt, type FoodProductionReceipt } from './NativeFoodProductionStore.js';
import type { NativeKitchenBinding } from '../../../../production-workflow/native-kitchen-wip.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';

export type NativeKitchenPhase = 'issued' | 'waiting' | 'processed' | 'returned-output' | 'returned-input';
export type NativeKitchenCommand = { operation: 'issue' | 'process' | 'return'; runId: string };
export type NativeKitchenResponse = { ok: true; record: NativeKitchenRecord } | { ok: false; error: string };
export interface NativeKitchenRecord { binding: NativeKitchenBinding; phase: NativeKitchenPhase; clock: SimulationClockObservation;
    wakeTick: number | null; receipt: FoodProductionReceipt | null; checkpointDigest: string; digest: string }
export function initializeNativeKitchen(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS native_kitchen_schema(version INTEGER PRIMARY KEY)');
        const versions = db.query('SELECT version FROM native_kitchen_schema').all() as { version: number }[];
        if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1)) throw new Error('Unsupported native kitchen schema');
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='native_kitchen_operation'").get()) throw new Error('Incomplete native kitchen schema');
            db.run('CREATE TABLE native_kitchen_operation(run_id TEXT PRIMARY KEY,binding_digest TEXT NOT NULL UNIQUE,record_json TEXT NOT NULL)');
            db.run('CREATE TABLE native_kitchen_audit(sequence INTEGER PRIMARY KEY,run_id TEXT NOT NULL,record_json TEXT NOT NULL,previous_digest TEXT,digest TEXT NOT NULL)');
            db.run('CREATE TABLE native_kitchen_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),source_id TEXT NOT NULL,sequence INTEGER NOT NULL,digest TEXT)');
            db.run('INSERT INTO native_kitchen_head VALUES(1,?1,0,NULL)', [randomUUID()]);
            db.run('INSERT INTO native_kitchen_schema VALUES(1)');
        }
        readNativeKitchen(db);
    }).immediate();
}
/** Engine checkpoint + protected escrow + exact native production receipt form one source capability. */
export function readNativeKitchen(db: Database): NativeKitchenRecord[] {
    const versions = db.query('SELECT version FROM native_kitchen_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native kitchen schema');
    const audits = db.query('SELECT * FROM native_kitchen_audit ORDER BY sequence').all() as
        { sequence: number; run_id: string; record_json: string; previous_digest: string | null; digest: string }[];
    let previous: string | null = null; const latest = new Map<string, string>();
    for (const [index, event] of audits.entries()) {
        const { digest, ...facts } = event;
        if (event.sequence !== index + 1 || event.previous_digest !== previous || foodDigest(facts) !== digest) throw new Error('Native kitchen audit differs');
        latest.set(event.run_id, event.record_json); previous = digest;
    }
    const head = db.query('SELECT * FROM native_kitchen_head WHERE singleton=1').get() as { source_id: string; sequence: number; digest: string | null } | null;
    if (!head || !/^[a-f0-9-]{36}$/.test(head.source_id) || head.sequence !== audits.length || head.digest !== previous) throw new Error('Native kitchen tail differs');
    const rows = db.query('SELECT * FROM native_kitchen_operation').all() as { run_id: string; binding_digest: string; record_json: string }[];
    if (rows.length !== latest.size) throw new Error('Native kitchen operation coverage differs');
    if (!rows.length) return [];
    const escrow = new PlayerInventoryEscrowStore({ db, checkpoint: () => { throw new Error('Readonly native kitchen source'); } }, true);
    return rows.map(row => {
        const result = JSON.parse(row.record_json) as NativeKitchenRecord, { digest, ...facts } = result;
        const { digest: bindingDigest, ...bindingFacts } = result.binding, intent = result.binding.intent;
        if (latest.get(row.run_id) !== row.record_json || foodDigest(facts) !== digest || foodDigest(bindingFacts) !== bindingDigest
            || row.binding_digest !== bindingDigest || row.run_id !== intent.runId) throw new Error('Native kitchen binding differs');
        const input = escrow.get(intent.inputEscrowId), output = escrow.get(intent.outputEscrowId);
        const inputSpent = ['processed', 'returned-output', 'returned-input'].includes(result.phase);
        if (!input || input.username !== intent.username || input.status !== (inputSpent ? 'committed' : 'held') || input.payeeUsername !== null
            || foodDigest(input.assets) !== foodDigest({ gp: 0, items: [{ id: 377, count: 1 }] })) throw new Error('Native kitchen input custody differs');
        if (result.receipt) {
            const receipt = result.receipt, action = receipt.action;
            if (foodDigest(readFoodProductionReceipt(db, intent.actionId)) !== foodDigest(receipt)
                || action.actionId !== intent.actionId || action.runId !== intent.runId || action.batchId !== intent.batchId
                || action.actorId !== intent.actorAgentId || action.username !== intent.username || action.worldId !== intent.worldId
                || action.lifecycleId !== intent.lifecycleId || action.clockId !== intent.clockId || action.clockProfileDigest !== intent.clockProfileDigest
                || action.catalogDigest !== intent.catalogDigest || action.recipeId !== intent.policy.recipeId || action.recipeVersion !== intent.policy.recipeVersion
                || foodDigest(receipt.custody) !== foodDigest({ businessId: intent.businessId, runId: intent.runId,
                    inputEscrowId: intent.inputEscrowId, outputEscrowId: intent.outputEscrowId, bindingDigest }))
                throw new Error('Native kitchen production receipt differs');
            if (!['processed', 'returned-output'].includes(result.phase) || !output || output.username !== intent.username
                || output.status !== (result.phase === 'processed' ? 'held' : 'committed') || output.payeeUsername !== null
                || foodDigest(output.assets) !== foodDigest({ gp: 0, items: [{ id: receipt.outcome === 'cooked' ? 379 : 381, count: 1 }] }))
                throw new Error('Native kitchen output custody differs');
        } else if (output || ['processed', 'returned-output'].includes(result.phase)) throw new Error('Native kitchen output receipt is absent');
        for (const id of [intent.inputEscrowId, ...(output ? [intent.outputEscrowId] : [])]) {
            const purpose = db.query('SELECT binding_digest FROM player_inventory_escrow_business_binding WHERE escrow_id=?1').get(id) as { binding_digest: string } | null;
            if (purpose?.binding_digest !== bindingDigest) throw new Error('Native kitchen escrow purpose differs');
        }
        return result;
    });
}
export function writeNativeKitchen(db: Database, raw: Omit<NativeKitchenRecord, 'digest'>): NativeKitchenRecord {
    if (!db.inTransaction) throw new Error('Native kitchen requires its Player checkpoint transaction');
    const prior = db.query('SELECT record_json FROM native_kitchen_operation WHERE run_id=?1').get(raw.binding.intent.runId) as { record_json: string } | null;
    if (prior) {
        const old = JSON.parse(prior.record_json) as NativeKitchenRecord;
        if (old.binding.digest !== raw.binding.digest || old.phase.startsWith('returned')) throw new Error('Native kitchen terminal/binding changed');
    }
    const result = { ...raw, digest: foodDigest(raw) }, json = JSON.stringify(result), runId = raw.binding.intent.runId;
    db.run(`INSERT INTO native_kitchen_operation VALUES(?1,?2,?3) ON CONFLICT(run_id) DO UPDATE SET record_json=excluded.record_json`, [runId, raw.binding.digest, json]);
    const head = db.query('SELECT sequence,digest FROM native_kitchen_head WHERE singleton=1').get() as { sequence: number; digest: string | null };
    const facts = { sequence: head.sequence + 1, run_id: runId, record_json: json, previous_digest: head.digest }, digest = foodDigest(facts);
    db.run('INSERT INTO native_kitchen_audit VALUES(?1,?2,?3,?4,?5)', [facts.sequence, runId, json, head.digest, digest]);
    db.run('UPDATE native_kitchen_head SET sequence=?1,digest=?2 WHERE singleton=1', [facts.sequence, digest]);
    readNativeKitchen(db); return result;
}
