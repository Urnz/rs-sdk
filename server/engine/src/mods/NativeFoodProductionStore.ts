import type { Database } from 'bun:sqlite';
import type { FoodAction } from './NativeFoodConsumptionStore.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { initializeFoodLineage, appendFoodLineage } from './NativeFoodLineageStore.js';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';

export const LOBSTER = { raw: 377, cooked: 379, burnt: 381, recipeId: 'food.cook-lobster', recipeVersion: '1.0.0' } as const;
export interface NativeFoodSource { kind: 'npc' | 'loc'; sourceId: string; typeId: number; x: number; z: number; level: number }
export interface FoodProductionAction extends Omit<FoodAction, 'itemId' | 'quantity' | 'slot'> {
    kind: 'gather' | 'cook'; runId: string; batchId: string; source: NativeFoodSource;
    recipeId: string; recipeVersion: string; catalogDigest: string;
}
export type FoodBalances = { raw: number; cooked: number; burnt: number };
export interface FoodProductionReceipt {
    schemaVersion: 1; action: FoodProductionAction; requestDigest: string;
    outcome: 'raw-gained' | 'cooked' | 'burnt'; inputs: Array<{ itemId: number; quantity: number }>;
    outputs: Array<{ itemId: number; quantity: number }>; before: FoodBalances; after: FoodBalances;
    quota: { before: number; after: number } | null; clock: SimulationClockObservation;
    checkpointId: string; checkpointDigest: string;
    custody?: { businessId: string; runId: string; inputEscrowId: string; outputEscrowId: string; bindingDigest: string };
}
export function validateFoodProductionAction(raw: FoodProductionAction): FoodProductionAction {
    if (!raw || !['gather', 'cook'].includes(raw.kind) || raw.recipeId !== LOBSTER.recipeId || raw.recipeVersion !== LOBSTER.recipeVersion
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw.actionId)
        || !/^[a-z0-9][a-z0-9 _]{0,11}$/.test(raw.username)
        || [raw.worldId, raw.actorId, raw.lifecycleId, raw.runId, raw.batchId, raw.clockId].some(id => typeof id !== 'string' || !id.length || id.length > 256)
        || [raw.policyDigest, raw.catalogDigest, raw.clockProfileDigest].some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
        || !raw.source || raw.source.kind !== (raw.kind === 'gather' ? 'npc' : 'loc') || !raw.source.sourceId
        || !Number.isInteger(raw.source.typeId) || raw.source.typeId < 0 || raw.source.typeId > 65535
        || ![raw.source.x, raw.source.z].every(coordinate => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 16383)
        || !Number.isInteger(raw.source.level) || raw.source.level < 0 || raw.source.level > 3
        || Object.keys(raw).sort().join(',') !== 'actionId,actorId,batchId,catalogDigest,clockId,clockProfileDigest,kind,lifecycleId,policyDigest,recipeId,recipeVersion,runId,source,username,worldId')
        throw new Error('Invalid native food production action');
    return { actionId: raw.actionId, worldId: raw.worldId, actorId: raw.actorId, username: raw.username, lifecycleId: raw.lifecycleId,
        kind: raw.kind, runId: raw.runId, batchId: raw.batchId, source: { kind: raw.source.kind, sourceId: raw.source.sourceId,
            typeId: raw.source.typeId, x: raw.source.x, z: raw.source.z, level: raw.source.level },
        recipeId: raw.recipeId, recipeVersion: raw.recipeVersion, catalogDigest: raw.catalogDigest,
        policyDigest: raw.policyDigest, clockId: raw.clockId, clockProfileDigest: raw.clockProfileDigest };
}
export function validateFoodProductionReceipt(receipt: FoodProductionReceipt): void {
    const action = validateFoodProductionAction(receipt.action), { before, after } = receipt;
    const output = receipt.outcome === 'raw-gained' ? LOBSTER.raw : receipt.outcome === 'cooked' ? LOBSTER.cooked : LOBSTER.burnt;
    const delta = { raw: action.kind === 'gather' ? 1 : -1, cooked: output === LOBSTER.cooked ? 1 : 0, burnt: output === LOBSTER.burnt ? 1 : 0 };
    if (receipt.schemaVersion !== 1 || receipt.requestDigest !== foodDigest(action)
        || !['raw-gained', 'cooked', 'burnt'].includes(receipt.outcome) || (action.kind === 'gather') !== (receipt.outcome === 'raw-gained')
        || !before || !after || !Object.keys(delta).every(key => {
            const k = key as keyof FoodBalances;
            return Number.isSafeInteger(before[k]) && before[k] >= 0 && Number.isSafeInteger(after[k]) && after[k] >= 0 && after[k] - before[k] === delta[k];
        }) || foodDigest(receipt.inputs) !== foodDigest(action.kind === 'gather' ? [] : [{ itemId: LOBSTER.raw, quantity: 1 }])
        || foodDigest(receipt.outputs) !== foodDigest([{ itemId: output, quantity: 1 }])
        || (action.kind === 'gather' ? !receipt.quota || !Number.isSafeInteger(receipt.quota.before) || receipt.quota.before < 1
            || receipt.quota.after !== receipt.quota.before - 1 : receipt.quota !== null)
        || receipt.clock.clockId !== action.clockId || receipt.clock.profileDigest !== action.clockProfileDigest
        || receipt.clock.status !== 'running' || receipt.clock.engineTick === null || !Number.isSafeInteger(receipt.clock.engineTick)
        || !Number.isFinite(Date.parse(receipt.clock.wallTime)) || !Number.isFinite(Date.parse(receipt.clock.simulationTime))
        || receipt.checkpointId !== `food-production:${action.actionId}` || !/^[0-9a-f]{64}$/.test(receipt.checkpointDigest))
        throw new Error('Invalid native food production receipt');
    if (receipt.custody && (action.kind !== 'cook' || receipt.custody.runId !== action.runId || !receipt.custody.businessId
        || !/^[0-9a-f]{64}$/.test(receipt.custody.bindingDigest)
        || ![receipt.custody.inputEscrowId, receipt.custody.outputEscrowId].every(id => /^[a-f0-9-]{36}$/.test(id))))
        throw new Error('Invalid native food custody receipt');
}
export function assertFoodProductionSchema(db: Database): void {
    const versions = db.query('SELECT version FROM native_food_production_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native food production schema');
}
export function readFoodProductionReceipt(db: Database, actionId: string): FoodProductionReceipt | null {
    if (!/^[0-9a-f-]{36}$/.test(actionId)) throw new Error('Invalid native food production ID');
    const row = db.query('SELECT * FROM native_food_production_actions WHERE action_id=?1').get(actionId) as {
        action_json: string; request_digest: string; receipt_json: string | null; receipt_digest: string | null } | null;
    if (!row) return null;
    const action = validateFoodProductionAction(JSON.parse(row.action_json));
    if (action.actionId !== actionId || foodDigest(action) !== row.request_digest) throw new Error('Native food production request audit mismatch');
    if (row.receipt_json === null) {
        if (row.receipt_digest !== null) throw new Error('Native food production pending audit mismatch');
        return null;
    }
    const receipt = JSON.parse(row.receipt_json) as FoodProductionReceipt;
    validateFoodProductionReceipt(receipt);
    if (foodDigest(receipt) !== row.receipt_digest || foodDigest(receipt.action) !== row.request_digest)
        throw new Error('Native food production receipt audit mismatch');
    return receipt;
}
/** Additive evidence and source quota, in the same connection as canonical Player checkpoints. */
export class NativeFoodProductionStore {
    constructor(readonly db: Database) {
        db.transaction(() => {
            db.run('CREATE TABLE IF NOT EXISTS native_food_production_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
            db.run('INSERT OR IGNORE INTO native_food_production_schema VALUES(1)');
            assertFoodProductionSchema(db);
            db.run(`CREATE TABLE IF NOT EXISTS native_food_production_actions(action_id TEXT PRIMARY KEY,action_json TEXT NOT NULL,
                request_digest TEXT NOT NULL,receipt_json TEXT,receipt_digest TEXT)`);
            db.run(`CREATE TABLE IF NOT EXISTS native_food_source_quota(world_id TEXT NOT NULL,run_id TEXT NOT NULL,source_id TEXT NOT NULL,
                policy_digest TEXT NOT NULL,initial_quantity INTEGER NOT NULL,remaining INTEGER NOT NULL CHECK(remaining>=0),
                PRIMARY KEY(world_id,run_id,source_id))`);
            initializeFoodLineage(db);
        }).immediate();
    }
    get(actionId: string): FoodProductionReceipt | null { return readFoodProductionReceipt(this.db, actionId); }
    admit(raw: FoodProductionAction): FoodProductionAction {
        const action = validateFoodProductionAction(raw), digest = foodDigest(action);
        this.db.transaction(() => {
            if (this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_food_actions'").get()
                && this.db.query('SELECT 1 FROM native_food_actions WHERE action_id=?1').get(action.actionId))
                throw new Error('Native food production action ID conflicts with consumption');
            const row = this.db.query('SELECT request_digest FROM native_food_production_actions WHERE action_id=?1').get(action.actionId) as { request_digest: string } | null;
            if (row && row.request_digest !== digest) throw new Error('Native food production action ID conflict');
            if (!row) this.db.run('INSERT INTO native_food_production_actions VALUES(?1,?2,?3,NULL,NULL)', [action.actionId, JSON.stringify(action), digest]);
        }).immediate();
        return action;
    }
    takeQuota(action: FoodProductionAction, limit: number): { before: number; after: number } {
        if (!this.db.inTransaction || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000)
            throw new Error('Native food quota requires a bounded checkpoint transaction');
        const keys = [action.worldId, action.runId, action.source.sourceId];
        this.db.run('INSERT OR IGNORE INTO native_food_source_quota VALUES(?1,?2,?3,?4,?5,?5)', [...keys, action.policyDigest, limit]);
        const row = this.db.query('SELECT * FROM native_food_source_quota WHERE world_id=?1 AND run_id=?2 AND source_id=?3').get(...keys) as {
            policy_digest: string; initial_quantity: number; remaining: number };
        if (row.policy_digest !== action.policyDigest || row.initial_quantity !== limit) throw new Error('Native food source quota policy changed');
        const committed = this.db.query(`SELECT COUNT(*) AS total FROM native_food_production_actions WHERE receipt_json IS NOT NULL
            AND json_extract(action_json,'$.kind')='gather' AND json_extract(action_json,'$.worldId')=?1
            AND json_extract(action_json,'$.runId')=?2 AND json_extract(action_json,'$.source.sourceId')=?3`).get(...keys) as { total: number };
        if (row.remaining !== limit - committed.total) throw new Error('Native food source quota audit mismatch');
        if (row.remaining < 1) throw new Error('Native food source quota exhausted');
        this.db.run('UPDATE native_food_source_quota SET remaining=remaining-1 WHERE world_id=?1 AND run_id=?2 AND source_id=?3', keys);
        return { before: row.remaining, after: row.remaining - 1 };
    }
    finish(receipt: FoodProductionReceipt): void {
        if (!this.db.inTransaction) throw new Error('Native food production requires a Player checkpoint transaction');
        validateFoodProductionReceipt(receipt);
        if (this.db.run('UPDATE native_food_production_actions SET receipt_json=?1,receipt_digest=?2 WHERE action_id=?3 AND receipt_json IS NULL',
            [JSON.stringify(receipt), foodDigest(receipt), receipt.action.actionId]).changes !== 1)
            throw new Error('Native food production intent is missing or already completed');
        appendFoodLineage(this.db, { kind: 'production', receipt });
    }
}
