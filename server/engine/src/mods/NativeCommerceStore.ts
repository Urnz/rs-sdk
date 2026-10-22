import type { Database } from 'bun:sqlite';
import { foodDigest } from './NativeFoodConsumptionStore.js';
import { commerceIds, validateCommerceIntent, type FoodCommerceBinding } from '../../../../agent-operated-shop/native-commerce.js';
import { PlayerInventoryEscrowStore } from './PlayerInventoryEscrowStore.js';
import type { EngineTradeEvidence } from './TradeEvidenceStore.js';
export interface CommerceBalances { gp: number; item: number }
export interface NativeCommerceRecord {
    binding: FoodCommerceBinding; phase: 'admitted' | 'completed' | 'cancelled';
    before: { worker: CommerceBalances; counterparty: CommerceBalances };
    after: { worker: CommerceBalances; counterparty: CommerceBalances } | null;
    checkpoints: { worker: string; counterparty: string }; trade: EngineTradeEvidence | null; digest: string;
}
export function initializeNativeCommerce(db: Database): void {
    db.transaction(() => {
        db.run('CREATE TABLE IF NOT EXISTS native_food_commerce_schema(version INTEGER PRIMARY KEY)');
        const versions = db.query('SELECT version FROM native_food_commerce_schema').all() as { version: number }[];
        if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1)) throw new Error('Unsupported native commerce schema');
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='native_food_commerce_operation'").get()) throw new Error('Incomplete native commerce schema');
            db.run('CREATE TABLE native_food_commerce_operation(operation_id TEXT PRIMARY KEY,binding_digest TEXT NOT NULL UNIQUE,record_json TEXT NOT NULL)');
            db.run('CREATE TABLE native_food_commerce_audit(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,record_json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)');
            db.run('CREATE TABLE native_food_commerce_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT)');
            db.run('INSERT INTO native_food_commerce_head VALUES(1,0,NULL)'); db.run('INSERT INTO native_food_commerce_schema VALUES(1)');
        }
        readNativeCommerce(db);
    }).immediate();
}
export function readNativeCommerce(db: Database): NativeCommerceRecord[] {
    const versions = db.query('SELECT version FROM native_food_commerce_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native commerce schema');
    const audits = db.query('SELECT * FROM native_food_commerce_audit ORDER BY sequence').all() as {
        sequence: number; operation_id: string; record_json: string; previous_hash: string | null; hash: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, row] of audits.entries()) { const { hash, ...facts } = row;
        if (row.sequence !== index + 1 || row.previous_hash !== previous || foodDigest(facts) !== hash) throw new Error('Native commerce audit differs');
        latest.set(row.operation_id, row.record_json); previous = hash;
    }
    const head = db.query('SELECT * FROM native_food_commerce_head WHERE id=1').get() as { sequence: number; hash: string | null } | null;
    const rows = db.query('SELECT * FROM native_food_commerce_operation').all() as { operation_id: string; binding_digest: string; record_json: string }[];
    if (!head || head.sequence !== audits.length || head.hash !== previous || rows.length !== latest.size) throw new Error('Native commerce coverage differs');
    return rows.map(row => { const record = JSON.parse(row.record_json) as NativeCommerceRecord, { digest, ...facts } = record;
        validateCommerceIntent(record.binding.intent);
        const i = record.binding.intent, ids = commerceIds(i.operationId);
        if (row.operation_id !== i.operationId || row.binding_digest !== record.binding.digest || foodDigest(i) !== record.binding.digest
            || latest.get(row.operation_id) !== row.record_json || digest !== foodDigest(facts)) throw new Error('Native commerce projection differs');
        if (!['admitted', 'completed', 'cancelled'].includes(record.phase)) throw new Error('Invalid native commerce phase');
        if (record.phase === 'completed') {
            const amount = i.quantity * i.unitPriceGp, sign = i.kind === 'sale' ? 1 : -1, t = record.trade;
            const businessOut = i.kind === 'sale' ? { id: i.itemId, count: i.quantity } : { id: 995, count: amount };
            const externalOut = i.kind === 'sale' ? { id: 995, count: amount } : { id: i.itemId, count: i.quantity };
            const items = (rows: EngineTradeEvidence['fromItems']) => rows.map(({ id, count }) => ({ id, count }));
            if (!record.after || !t || t.eventId !== ids.tradeId || t.fromUsername !== i.worker.username || t.toUsername !== i.counterparty.username
                || foodDigest(items(t.fromItems)) !== foodDigest([businessOut]) || foodDigest(items(t.toItems)) !== foodDigest([externalOut])
                || foodDigest(record.after.worker) !== foodDigest(record.before.worker)
                || record.after.counterparty.gp !== record.before.counterparty.gp - sign * amount
                || record.after.counterparty.item !== record.before.counterparty.item + sign * i.quantity)
                throw new Error('Native commerce quantities do not reconcile');
            const escrow = new PlayerInventoryEscrowStore({ db, checkpoint: () => { throw new Error('Readonly commerce source'); } }, true);
            for (const [id, owner, assets] of [[ids.businessOut, i.worker.username, businessOut], [ids.counterpartyOut, i.counterparty.username, externalOut],
                [ids.businessIn, i.worker.username, externalOut]] as const) {
                const e = escrow.get(id), expected = assets.id === 995 ? { gp: assets.count, items: [] } : { gp: 0, items: [assets] };
                const purpose = db.query('SELECT binding_digest FROM player_inventory_escrow_business_binding WHERE escrow_id=?1').get(id) as { binding_digest: string } | null;
                if (!e || e.status !== 'committed' || e.username !== owner || e.payeeUsername !== null || foodDigest(e.assets) !== foodDigest(expected)
                    || purpose?.binding_digest !== record.binding.digest) throw new Error('Native commerce protected custody differs');
            }
        } else {
            if (record.trade || record.after) throw new Error('Uncompleted commerce cannot contain a trade receipt');
            if (db.query("SELECT 1 FROM sqlite_master WHERE name='player_inventory_escrow'").get()) {
                for (const id of [ids.businessOut, ids.counterpartyOut, ids.businessIn]) {
                    if (db.query('SELECT 1 FROM player_inventory_escrow WHERE escrow_id=?1').get(id)) throw new Error('Uncompleted commerce contains custody effects');
                }
            }
        }
        return record;
    });
}
export function writeNativeCommerce(db: Database, facts: Omit<NativeCommerceRecord, 'digest'>): NativeCommerceRecord {
    const record = { ...facts, digest: foodDigest(facts) }, json = JSON.stringify(record), id = record.binding.intent.operationId;
    db.run(`INSERT INTO native_food_commerce_operation VALUES(?1,?2,?3) ON CONFLICT(operation_id) DO UPDATE SET record_json=excluded.record_json`, [id, record.binding.digest, json]);
    const head = db.query('SELECT * FROM native_food_commerce_head WHERE id=1').get() as { sequence: number; hash: string | null };
    const event = { sequence: head.sequence + 1, operation_id: id, record_json: json, previous_hash: head.hash }, hash = foodDigest(event);
    db.run('INSERT INTO native_food_commerce_audit VALUES(?1,?2,?3,?4,?5)', [event.sequence, id, json, head.hash, hash]);
    db.run('UPDATE native_food_commerce_head SET sequence=?1,hash=?2 WHERE id=1', [event.sequence, hash]); readNativeCommerce(db); return record;
}
