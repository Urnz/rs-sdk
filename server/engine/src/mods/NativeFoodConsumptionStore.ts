import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { initializeFoodDelivery, appendFoodDelivery } from './NativeFoodDeliveryStore.js';
import { initializeFoodLineage, appendFoodLineage } from './NativeFoodLineageStore.js';

export const FOOD_ITEM = 379;
export const FOOD_POLICY = 'native-lobster-consume-v1';
export const foodDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface FoodAction {
    actionId: string; worldId: string; actorId: string; username: string; lifecycleId: string;
    itemId: number; quantity: number; slot: number; policyDigest: string;
    clockId: string; clockProfileDigest: string;
}
export interface FoodReceipt extends FoodAction {
    schemaVersion: 1; cause: 'content:consume_effect_stat'; before: number; after: number;
    hpBefore: number; hpAfter: number; clock: SimulationClockObservation;
    checkpointId: string; checkpointDigest: string; requestDigest: string;
}
export interface FoodResult { action: FoodAction; outcome: 'consumed' | 'no-use'; receipt: FoodReceipt | null }
export interface NativeFoodContext { action: FoodAction; clock: SimulationClockObservation }
interface Row { action_json: string; request_digest: string; result_json: string | null; result_digest: string | null }

export function validateFoodAction(value: FoodAction): FoodAction {
    if (!value || Object.keys(value).sort().join(',') !==
        'actionId,actorId,clockId,clockProfileDigest,itemId,lifecycleId,policyDigest,quantity,slot,username,worldId'
        || [value.actionId, value.username, value.policyDigest, value.clockProfileDigest].some(field => typeof field !== 'string')
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.actionId)
        || !/^[a-z0-9][a-z0-9 _]{0,11}$/.test(value.username)
        || [value.worldId, value.actorId, value.lifecycleId, value.clockId].some(id => typeof id !== 'string' || !id.length || id.length > 256)
        || value.itemId !== FOOD_ITEM || value.quantity !== 1 || !Number.isInteger(value.slot) || value.slot < 0 || value.slot >= 28
        || value.policyDigest !== foodDigest(FOOD_POLICY) || !/^[0-9a-f]{64}$/.test(value.clockProfileDigest))
        throw new Error('Invalid native food action');
    // Canonical order: caller property order cannot change the request digest.
    return { actionId: value.actionId, worldId: value.worldId, actorId: value.actorId, username: value.username,
        lifecycleId: value.lifecycleId, itemId: value.itemId, quantity: value.quantity, slot: value.slot,
        policyDigest: value.policyDigest, clockId: value.clockId, clockProfileDigest: value.clockProfileDigest };
}

/** Evidence lives in the canonical Player checkpoint connection, never in a second inventory ledger. */
export class NativeFoodConsumptionStore {
    readonly db: Database;
    constructor(readonly market: { db: Database }) {
        this.db = market.db;
        this.db.transaction(() => {
            this.db.run('CREATE TABLE IF NOT EXISTS native_food_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
            this.db.run('INSERT OR IGNORE INTO native_food_schema VALUES(1)');
            this.db.run(`CREATE TABLE IF NOT EXISTS native_food_actions(action_id TEXT PRIMARY KEY,
                action_json TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT, result_digest TEXT)`);
            assertFoodSchema(this.db);
            initializeFoodDelivery(this.db);
            initializeFoodLineage(this.db);
        }).immediate();
    }
    get(actionId: string): FoodResult | null { return readFoodResult(this.db, actionId); }
    /** Persist intent before running content. A pending intent is safe to resume from the canonical checkpoint. */
    admit(raw: FoodAction): FoodAction {
        const action = validateFoodAction(raw), digest = foodDigest(action);
        this.db.transaction(() => {
            if (this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_food_production_actions'").get()
                && this.db.query('SELECT 1 FROM native_food_production_actions WHERE action_id=?1').get(action.actionId))
                throw new Error('Native food action ID conflicts with production');
            const row = this.db.query('SELECT * FROM native_food_actions WHERE action_id=?1').get(action.actionId) as Row | null;
            if (row) {
                if (row.request_digest !== digest || row.action_json !== JSON.stringify(action)) throw new Error('Native food action ID conflict');
            } else this.db.run('INSERT INTO native_food_actions VALUES(?1,?2,?3,NULL,NULL)',
                [action.actionId, JSON.stringify(action), digest]);
        }).immediate();
        return action;
    }
    finish(result: FoodResult, clock: SimulationClockObservation): void {
        if (!this.db.inTransaction) throw new Error('Food result requires the Player checkpoint transaction');
        const action = validateFoodAction(result.action);
        this.db.run('UPDATE native_food_actions SET result_json=?1,result_digest=?2 WHERE action_id=?3 AND result_json IS NULL',
            [JSON.stringify(result), foodDigest(result), action.actionId]);
        if (!this.get(action.actionId)) throw new Error('Native food intent is missing');
        appendFoodDelivery(this.db, result, clock);
        appendFoodLineage(this.db, { kind: 'consumption', result });
    }
}

export function assertFoodSchema(db: Database): void {
    const rows = db.query('SELECT version FROM native_food_schema').all() as { version: number }[];
    if (rows.length !== 1 || rows[0]!.version !== 1) throw new Error('Unsupported native food schema');
}
export function readFoodResult(db: Database, actionId: string): FoodResult | null {
    if (!/^[0-9a-f-]{36}$/.test(actionId)) throw new Error('Invalid native food action ID');
    const row = db.query('SELECT * FROM native_food_actions WHERE action_id=?1').get(actionId) as Row | null;
    if (!row) return null;
    const action = validateFoodAction(JSON.parse(row.action_json));
    if (action.actionId !== actionId || foodDigest(action) !== row.request_digest) throw new Error('Native food request audit mismatch');
    if (row.result_json === null) {
        if (row.result_digest !== null) throw new Error('Native food pending audit mismatch');
        return null;
    }
    const result = JSON.parse(row.result_json) as FoodResult, receipt = result.receipt;
    if (foodDigest(result) !== row.result_digest || foodDigest(result.action) !== row.request_digest
        || !['consumed', 'no-use'].includes(result.outcome) || (result.outcome === 'consumed') !== !!receipt
        || (receipt && (foodDigest(validateFoodAction(Object.fromEntries(Object.keys(action).map(key =>
            [key, receipt[key as keyof FoodReceipt]])) as unknown as FoodAction)) !== row.request_digest
            || receipt.schemaVersion !== 1 || receipt.requestDigest !== row.request_digest
            || receipt.cause !== 'content:consume_effect_stat' || receipt.before - receipt.after !== 1
            || receipt.before < 1 || receipt.after < 0 || !Number.isSafeInteger(receipt.before) || !Number.isSafeInteger(receipt.after)
            || receipt.checkpointId !== `food:${actionId}` || !/^[0-9a-f]{64}$/.test(receipt.checkpointDigest)
            || receipt.clock.clockId !== action.clockId || receipt.clock.profileDigest !== action.clockProfileDigest
            || receipt.clock.status !== 'running' || !Number.isSafeInteger(receipt.hpBefore) || receipt.hpBefore < 1
            || !Number.isSafeInteger(receipt.hpAfter) || receipt.hpAfter < receipt.hpBefore)))
        throw new Error('Native food result audit mismatch');
    return result;
}
