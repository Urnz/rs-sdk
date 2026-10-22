import type { Database } from 'bun:sqlite';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { workUuid, workDigest } from '../business-work/binding.js';
import type { BusinessStockDecision, BusinessStockPolicyCatalog } from '../business-stock-policy/index.js';
import type { SaleChannelDecision, SaleChannelPolicyCatalog } from '../sale-channel-policy/index.js';
import type { FacilityAccessGrantEvidence } from '../facility-capability/types.js';

export interface CommerceActor { agentId: string; username: string; lifecycleId: string }
export interface NativeCommerceCommand { operation: 'execute' | 'cancel'; operationId: string }
export type NativeCommerceResponse = { ok: true; operationId: string; phase: 'admitted' | 'completed' | 'cancelled' } | { ok: false; error: string };
export interface FoodCommerceIntent {
    operationId: string; kind: 'sale' | 'procurement'; businessId: string; worker: CommerceActor; counterparty: CommerceActor;
    worldId: string; clockId: string; clockProfileDigest: string; itemId: 377 | 379; quantity: number; unitPriceGp: number;
    expiresAt: string; decision: BusinessStockDecision; channel: SaleChannelDecision;
    facilityPolicyDigest: string; grant: FacilityAccessGrantEvidence;
    catalogs: { stock: BusinessStockPolicyCatalog; channels: SaleChannelPolicyCatalog };
}
export interface FoodCommerceBinding { intent: FoodCommerceIntent; digest: string }
export interface FoodCommerceOrder { binding: FoodCommerceBinding; phase: 'prepared' | 'cancelled' | 'completed'; nativeDigest: string | null }
export const commerceIds = (id: string) => ({ tradeId: workUuid(`food-trade:${id}`), reservationId: `food.${foodDigest(id).slice(0, 48)}`,
    stockId: `food.${foodDigest(id).slice(0, 48)}`, businessOut: workUuid(`food-business-out:${id}`),
    counterpartyOut: workUuid(`food-counterparty-out:${id}`), businessIn: workUuid(`food-business-in:${id}`) });
export function validateCommerceIntent(i: FoodCommerceIntent): void {
    const validId = (v: string) => typeof v === 'string' && /^[a-z0-9][a-z0-9._:-]{1,119}$/.test(v);
    if (!validId(i.operationId) || !validId(i.businessId) || !['sale', 'procurement'].includes(i.kind)
        || i.itemId !== (i.kind === 'sale' ? 379 : 377) || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 28
        || !Number.isSafeInteger(i.unitPriceGp) || i.unitPriceGp < 1 || i.quantity * i.unitPriceGp > 2147483647
        || !Number.isFinite(Date.parse(i.expiresAt)) || !/^[a-f0-9]{64}$/.test(i.clockProfileDigest)
        || !i.worldId || !i.clockId || !/^[a-f0-9]{64}$/.test(i.facilityPolicyDigest)
        || i.worker.agentId === i.counterparty.agentId || i.worker.username === i.counterparty.username)
        throw new Error('Invalid finite food commerce intent');
    if (i.catalogs.stock.digest !== workDigest({ schemaVersion: i.catalogs.stock.schemaVersion, policies: i.catalogs.stock.policies })
        || i.catalogs.channels.digest !== workDigest({ schemaVersion: i.catalogs.channels.schemaVersion, channels: i.catalogs.channels.channels }))
        throw new Error('Food commerce pinned catalog digest differs');
    for (const a of [i.worker, i.counterparty]) if (!validId(a.agentId) || !/^[a-z0-9]{1,12}$/.test(a.username)
        || typeof a.lifecycleId !== 'string' || !a.lifecycleId.length) throw new Error('Invalid food commerce actor');
}
export function initializeFoodCommerce(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS business_food_commerce_schema(version INTEGER PRIMARY KEY)');
        const versions = db.query('SELECT version FROM business_food_commerce_schema').all() as { version: number }[];
        if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1)) throw new Error('Unsupported food commerce schema');
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='business_food_commerce_order'").get()) throw new Error('Incomplete food commerce schema');
            db.run(`CREATE TABLE business_food_commerce_order(operation_id TEXT PRIMARY KEY,trade_id TEXT NOT NULL UNIQUE,
                binding_digest TEXT NOT NULL UNIQUE,row_json TEXT NOT NULL)`);
            db.run('CREATE TABLE business_food_commerce_audit(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,row_json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)');
            db.run('CREATE TABLE business_food_commerce_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT)');
            db.run('INSERT INTO business_food_commerce_head VALUES(1,0,NULL)'); db.run('INSERT INTO business_food_commerce_schema VALUES(1)');
        }
        readFoodCommerce(db);
    }).immediate();
}
export function readFoodCommerce(db: Database): FoodCommerceOrder[] {
    const versions = db.query('SELECT version FROM business_food_commerce_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported food commerce schema');
    const audits = db.query('SELECT * FROM business_food_commerce_audit ORDER BY sequence').all() as {
        sequence: number; operation_id: string; row_json: string; previous_hash: string | null; hash: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, row] of audits.entries()) { const { hash, ...facts } = row;
        if (row.sequence !== index + 1 || row.previous_hash !== previous || foodDigest(facts) !== hash) throw new Error('Food commerce audit differs');
        latest.set(row.operation_id, row.row_json); previous = hash;
    }
    const head = db.query('SELECT * FROM business_food_commerce_head WHERE id=1').get() as { sequence: number; hash: string | null } | null;
    const rows = db.query('SELECT * FROM business_food_commerce_order').all() as {
        operation_id: string; trade_id: string; binding_digest: string; row_json: string }[];
    if (!head || head.sequence !== audits.length || head.hash !== previous || rows.length !== latest.size) throw new Error('Food commerce audit coverage differs');
    return rows.map(row => { const order = JSON.parse(row.row_json) as FoodCommerceOrder, { intent, digest } = order.binding;
        validateCommerceIntent(intent);
        if (foodDigest(intent) !== digest || row.binding_digest !== digest || row.operation_id !== intent.operationId
            || row.trade_id !== commerceIds(intent.operationId).tradeId || latest.get(row.operation_id) !== row.row_json)
            throw new Error('Food commerce projection differs');
        if (!['prepared', 'cancelled', 'completed'].includes(order.phase) || (order.phase === 'prepared' ? order.nativeDigest !== null
            : typeof order.nativeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(order.nativeDigest))) throw new Error('Food commerce phase proof differs');
        return order;
    });
}
/** Caller owns the Business transaction, including the reservation/stock mutation. */
export function writeFoodCommerce(db: Database, order: FoodCommerceOrder): void {
    const id = order.binding.intent.operationId, json = JSON.stringify(order);
    db.run(`INSERT INTO business_food_commerce_order VALUES(?1,?2,?3,?4)
        ON CONFLICT(operation_id) DO UPDATE SET row_json=excluded.row_json`, [id, commerceIds(id).tradeId, order.binding.digest, json]);
    const head = db.query('SELECT * FROM business_food_commerce_head WHERE id=1').get() as { sequence: number; hash: string | null };
    const facts = { sequence: head.sequence + 1, operation_id: id, row_json: json, previous_hash: head.hash }, hash = foodDigest(facts);
    db.run('INSERT INTO business_food_commerce_audit VALUES(?1,?2,?3,?4,?5)', [facts.sequence, id, json, head.hash, hash]);
    db.run('UPDATE business_food_commerce_head SET sequence=?1,hash=?2 WHERE id=1', [facts.sequence, hash]); readFoodCommerce(db);
}
