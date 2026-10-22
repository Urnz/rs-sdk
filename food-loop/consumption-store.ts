import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { foodLoopCatalogDigest } from './catalog.js';
import { foodLoopClosureDigest } from './closure.js';
import type { ClosedFoodLoop, FoodConsumptionEconomicEvent, FoodConsumptionSummary,
    FoodLoopCatalog } from './types.js';

const ZERO = '0'.repeat(64);
type EventRow = { event_id: string; closure_id: string; closure_digest: string; actor_agent_id: string;
    item_id: number; item_name: string; quantity: number; hunger_relief: number; occurred_at: string };
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function event(row: EventRow): FoodConsumptionEconomicEvent { return { eventId: row.event_id,
    closureId: row.closure_id, closureDigest: row.closure_digest, actorAgentId: row.actor_agent_id,
    kind: 'food-consumption', itemId: row.item_id, itemName: row.item_name, quantity: 1,
    hungerRelief: row.hunger_relief, occurredAtSimulationTime: row.occurred_at }; }

export class FoodConsumptionStore {
    private readonly database: Database;
    private readonly ownsDatabase: boolean;
    constructor(path: string | Database, private readonly catalog: FoodLoopCatalog) {
        const { digest, ...definition } = catalog;
        if (digest !== foodLoopCatalogDigest(definition)) throw new Error('Food loop catalog digest mismatch');
        this.ownsDatabase = typeof path === 'string';
        if (typeof path === 'string') mkdirSync(dirname(path), { recursive: true });
        this.database = typeof path === 'string' ? new Database(path, { create: true, strict: true }) : path;
        this.database.run('PRAGMA foreign_keys = ON');
        this.migrate();
    }
    close(): void { if (this.ownsDatabase) this.database.close(true); }
    record(closure: ClosedFoodLoop): FoodConsumptionEconomicEvent {
        const { digest, ...definition } = closure;
        if (!/^[0-9a-f]{64}$/.test(digest) || digest !== foodLoopClosureDigest(definition)) {
            throw new Error('Food loop closure digest mismatch');
        }
        if (closure.catalogDigest !== this.catalog.digest) throw new Error('Food loop closure uses another catalog');
        const chain = this.catalog.chains.find(item => item.foodChainId === closure.foodChainId);
        if (!chain) throw new Error('Food loop closure references an unknown chain');
        if (this.database.query("SELECT 1 FROM sqlite_master WHERE name='native_food_receipt_use'").get()
            && closure.receiptIds.some(id => this.database.query('SELECT 1 FROM native_food_receipt_use WHERE action_id=?1')
                .get(id.replace(/^native:/, '')))) throw new Error('Native consumption receipt already applied; lineage needs its own projection');
        const existing = this.database.query('SELECT * FROM food_consumption_event WHERE closure_id=?1')
            .get(closure.closureId) as EventRow | null;
        if (existing) {
            if (existing.closure_digest !== closure.digest) throw new Error('Closure id was reused with different evidence');
            return event(existing);
        }
        const economicEvent: FoodConsumptionEconomicEvent = { eventId: `${closure.closureId}:consumption`,
            closureId: closure.closureId, closureDigest: closure.digest, actorAgentId: closure.actorAgentId,
            kind: 'food-consumption', itemId: chain.cookedItem.itemId, itemName: chain.cookedItem.name,
            quantity: 1, hungerRelief: closure.hungerRelief,
            occurredAtSimulationTime: closure.occurredAtSimulationTime };
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO food_loop_closure
                (closure_id,closure_digest,actor_agent_id,food_chain_id,catalog_digest,closure_json,occurred_at)
                VALUES(?1,?2,?3,?4,?5,?6,?7)`, [closure.closureId, closure.digest, closure.actorAgentId,
                closure.foodChainId, closure.catalogDigest, JSON.stringify(closure), closure.occurredAtSimulationTime]);
            closure.receiptIds.forEach((receiptId, index) => this.database.run(`INSERT INTO food_receipt_use
                (receipt_id,source_digest,closure_id,ordinal) VALUES(?1,?2,?3,?4)`,
            [receiptId, closure.receiptSourceDigests[index]!, closure.closureId, index]));
            this.database.run(`INSERT INTO food_consumption_event
                (event_id,closure_id,closure_digest,actor_agent_id,item_id,item_name,quantity,hunger_relief,occurred_at)
                VALUES(?1,?2,?3,?4,?5,?6,1,?7,?8)`, [economicEvent.eventId, closure.closureId,
                closure.digest, closure.actorAgentId, economicEvent.itemId, economicEvent.itemName,
                economicEvent.hungerRelief, economicEvent.occurredAtSimulationTime]);
            this.audit(closure.closureId, closure.occurredAtSimulationTime, { eventId: economicEvent.eventId,
                closureDigest: closure.digest, actorAgentId: closure.actorAgentId, itemId: economicEvent.itemId,
                quantity: 1, hungerRelief: closure.hungerRelief });
        });
        transaction.immediate();
        return economicEvent;
    }
    list(actorAgentId?: string): FoodConsumptionEconomicEvent[] {
        const rows = actorAgentId
            ? this.database.query(`SELECT * FROM food_consumption_event
                WHERE actor_agent_id=?1 ORDER BY occurred_at,event_id`).all(actorAgentId)
            : this.database.query('SELECT * FROM food_consumption_event ORDER BY occurred_at,event_id').all();
        return (rows as EventRow[]).map(event);
    }
    summary(actorAgentId?: string): FoodConsumptionSummary {
        const events = this.list(actorAgentId);
        return { events: events.length, foodUnitsConsumed: events.reduce((sum, item) => sum + item.quantity, 0),
            hungerRelief: events.reduce((sum, item) => sum + item.hungerRelief, 0) };
    }
    summaryWindow(fromSimulationTime:string,toSimulationTime:string,actorAgentId?:string):FoodConsumptionSummary{
        const from=Date.parse(fromSimulationTime),to=Date.parse(toSimulationTime);
        if(Number.isNaN(from)||new Date(from).toISOString()!==fromSimulationTime||Number.isNaN(to)
            ||new Date(to).toISOString()!==toSimulationTime||from>to)throw new Error('Consumption metric window is invalid');
        const events=this.list(actorAgentId).filter(item=>{const at=Date.parse(item.occurredAtSimulationTime);return at>=from&&at<=to;});
        return{events:events.length,foodUnitsConsumed:events.reduce((sum,item)=>sum+item.quantity,0),
            hungerRelief:events.reduce((sum,item)=>sum+item.hungerRelief,0)};
    }
    verifyAuditChain(): boolean {
        const rows = this.database.query(`SELECT previous_hash,entry_hash,payload_json FROM food_consumption_audit
            ORDER BY sequence`).all() as Array<{ previous_hash: string; entry_hash: string; payload_json: string }>;
        let head = ZERO;
        for (const row of rows) { if (row.previous_hash !== head
            || hash({ previousHash: head, payload: JSON.parse(row.payload_json) }) !== row.entry_hash) return false;
        head = row.entry_hash; }
        return true;
    }
    private audit(closureId: string, at: string, detail: unknown): void {
        const last = this.database.query('SELECT entry_hash FROM food_consumption_audit ORDER BY sequence DESC LIMIT 1')
            .get() as { entry_hash: string } | null;
        const previousHash = last?.entry_hash ?? ZERO, payload = { action: 'food-consumed', closureId, at, detail };
        this.database.run(`INSERT INTO food_consumption_audit
            (closure_id,occurred_at,payload_json,previous_hash,entry_hash) VALUES(?1,?2,?3,?4,?5)`,
        [closureId, at, JSON.stringify(payload), previousHash, hash({ previousHash, payload })]);
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 1) throw new Error(`Food consumption schema ${version} is newer than supported version 1`);
        if (version === 1) return;
        const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE food_loop_closure (closure_id TEXT PRIMARY KEY,closure_digest TEXT NOT NULL,
                actor_agent_id TEXT NOT NULL,food_chain_id TEXT NOT NULL,catalog_digest TEXT NOT NULL,
                closure_json TEXT NOT NULL,occurred_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE food_receipt_use (receipt_id TEXT PRIMARY KEY,source_digest TEXT NOT NULL,
                closure_id TEXT NOT NULL REFERENCES food_loop_closure(closure_id),ordinal INTEGER NOT NULL)`);
            this.database.run(`CREATE TABLE food_consumption_event (event_id TEXT PRIMARY KEY,
                closure_id TEXT NOT NULL UNIQUE REFERENCES food_loop_closure(closure_id),closure_digest TEXT NOT NULL,
                actor_agent_id TEXT NOT NULL,item_id INTEGER NOT NULL,item_name TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK(quantity=1),hunger_relief INTEGER NOT NULL,occurred_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE food_consumption_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                closure_id TEXT NOT NULL,occurred_at TEXT NOT NULL,payload_json TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run('PRAGMA user_version = 1');
        }); transaction.immediate();
    }
}
