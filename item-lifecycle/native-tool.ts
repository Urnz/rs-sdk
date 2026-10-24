import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import lifecycleDefinition from '../config/item-lifecycle.json';
import cycleDefinition from '../config/production-tool-cycles.json';
import { validateItemLifecycleCatalog } from './catalog.js';
import { validateProductionToolCycleCatalog, ProductionToolCycleService } from './production-cycle.js';
import { ItemLifecycleStore } from './store.js';

export const nativeToolDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const nativeToolCatalog = validateItemLifecycleCatalog(lifecycleDefinition);
export const nativeToolCycles = validateProductionToolCycleCatalog(cycleDefinition, nativeToolCatalog);
export const NATIVE_PICKAXE = 1265;
export interface NativeToolOwner {
    actorId: string; username: string; lifecycleId: string; worldId: string; clockId: string; clockProfileDigest: string;
}
export interface NativeToolBinding {
    schemaVersion: 1; itemInstanceId: string; owner: NativeToolOwner;
    position: { inventory: number; slot: number };
    status: 'bound' | 'quarantined'; reason: string | null;
    catalogDigest: string; cycleDigest: string; checkpointDigest: string;
}
export class NativeToolStore {
    readonly lifecycle: ItemLifecycleStore;
    readonly cycle: ProductionToolCycleService;
    constructor(readonly db: Database) {
        this.lifecycle = new ItemLifecycleStore(db, nativeToolCatalog);
        this.cycle = new ProductionToolCycleService(this.lifecycle, nativeToolCycles);
        db.exec(`CREATE TABLE IF NOT EXISTS native_tool_binding(instance_id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,
            actor_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS native_tool_event(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS native_tool_event_no_update BEFORE UPDATE ON native_tool_event
            BEGIN SELECT RAISE(ABORT,'Native tool events are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS native_tool_event_no_delete BEFORE DELETE ON native_tool_event
            BEGIN SELECT RAISE(ABORT,'Native tool events are immutable'); END;`);
    }
    static present(db: Database): boolean {
        return !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_tool_binding'").get();
    }
    binding(username: string): NativeToolBinding | null {
        const row = this.db.query<{ payload: string; digest: string }, [string]>(
            'SELECT payload,digest FROM native_tool_binding WHERE username=?').get(username);
        if (!row) return null;
        const result = JSON.parse(row.payload) as NativeToolBinding;
        if (result.schemaVersion !== 1 || nativeToolDigest(result) !== row.digest || result.owner.username !== username
            || result.catalogDigest !== nativeToolCatalog.digest || result.cycleDigest !== nativeToolCycles.digest)
            throw new Error('Native tool binding or policy is corrupt/stale');
        return result;
    }
    put(binding: NativeToolBinding): void {
        this.db.query(`INSERT INTO native_tool_binding VALUES(?,?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET
            username=excluded.username,actor_id=excluded.actor_id,payload=excluded.payload,digest=excluded.digest`)
            .run(binding.itemInstanceId, binding.owner.username, binding.owner.actorId, JSON.stringify(binding), nativeToolDigest(binding));
    }
    event(id: string): Record<string, any> | null {
        const row = this.db.query<{payload:string;digest:string},[string]>('SELECT payload,digest FROM native_tool_event WHERE event_id=?').get(id);
        if (!row) return null;
        const result = JSON.parse(row.payload);
        if (nativeToolDigest(result) !== row.digest) throw new Error('Native tool event digest mismatch');
        return result;
    }
    append(id: string, value: object): void {
        const prior = this.event(id);
        if (prior) { if (nativeToolDigest(prior) !== nativeToolDigest(value)) throw new Error('Native tool event conflict'); return; }
        this.db.query('INSERT INTO native_tool_event VALUES(?,?,?)').run(id, JSON.stringify(value), nativeToolDigest(value));
    }
}

/** Read the native checkpoint authority, not a model-uploaded tool receipt. Missing identity stays unknown. */
export function readNativeToolContext(path: string, actorId: string, username: string, expected?: Omit<NativeToolOwner,'actorId'|'username'>): string {
    const db = new Database(path, { readonly: true, strict: true });
    try {
        if (!NativeToolStore.present(db)) return 'Native mining tool: unbound; explicit instance migration required for bronze copper/tin mining.';
        const row = db.query<{payload:string;digest:string},[string,string]>(
            'SELECT payload,digest FROM native_tool_binding WHERE actor_id=? AND username=?').get(actorId, username);
        if (!row) return 'Native mining tool: unbound; no automatic fresh durability.';
        const binding = JSON.parse(row.payload) as NativeToolBinding;
        if (binding.schemaVersion !== 1 || nativeToolDigest(binding) !== row.digest || binding.owner.actorId !== actorId || binding.owner.username !== username
            || binding.catalogDigest !== nativeToolCatalog.digest || binding.cycleDigest !== nativeToolCycles.digest
            || (expected && Object.entries(expected).some(([key,value])=>binding.owner[key as keyof NativeToolOwner]!==value)))
            throw new Error('Native tool context identity mismatch');
        const item = db.query<{durability:number;max_durability:number;status:string;owner_actor_id:string},[string]>(
            'SELECT durability,max_durability,status,owner_actor_id FROM item_instance WHERE item_instance_id=?').get(binding.itemInstanceId);
        if (!item || item.owner_actor_id !== actorId) throw new Error('Native tool context custody mismatch');
        return `Native mining tool ${binding.itemInstanceId}: ${binding.status}/${item.status}; durability ${item.durability}/${item.max_durability}; `
            + `capability mining.copper-tin available=${binding.status==='bound' && item.status==='usable' && item.durability>0}; `
            + `${binding.reason ?? 'instance identity preserved across witnessed moves'}.`;
    } finally { (db as Database & {clearQueryCache():void}).clearQueryCache(); db.close(true); }
}
