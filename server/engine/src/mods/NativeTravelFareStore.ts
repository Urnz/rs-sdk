import type { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { foodDigest } from './NativeFoodConsumptionStore.js';

export interface NativeTravelFareReceipt {
    id: string; worldId: string; actorId: string; username: string; lifecycleId: string;
    route: 'port-sarim-to-karamja' | 'karamja-to-port-sarim';
    source: { script: string; npc: string; x: number; z: number; level: number };
    amountGp: 30; beforeGp: number; afterGp: number;
    clock: SimulationClockObservation; checkpointDigest: string;
}
export function validateNativeTravelFare(r: NativeTravelFareReceipt): void {
    const outgoing = r?.route === 'port-sarim-to-karamja', s = r?.source, c = r?.clock;
    if (!r || !/^[a-f0-9-]{36}$/.test(r.id) || !/^[a-z0-9][a-z0-9 _]{0,11}$/.test(r.username)
        || [r.worldId, r.actorId, r.lifecycleId].some(v => typeof v !== 'string' || !v.length || v.length > 256)
        || !['port-sarim-to-karamja', 'karamja-to-port-sarim'].includes(r.route)
        || !s || s.level !== 0 || ![s.x, s.z].every(Number.isSafeInteger)
        || (outgoing ? s.script !== '[label,karamja_sailor_dialogue]' || s.npc !== 'captain_tobias'
            || s.x < 3020 || s.x > 3035 || s.z < 3205 || s.z > 3225
            : s.script !== '[label,customs_pay]' || s.npc !== 'customs_officer'
            || s.x < 2945 || s.x > 2960 || s.z < 3140 || s.z > 3155)
        || r.amountGp !== 30 || !Number.isSafeInteger(r.beforeGp) || r.beforeGp < 30 || r.afterGp !== r.beforeGp - 30
        || !c || !c.clockId || !/^[a-f0-9]{64}$/.test(c.profileDigest) || !['running', 'paused'].includes(c.status)
        || !Number.isSafeInteger(c.engineTick) || c.engineTick! < 0 || !Number.isSafeInteger(c.revision) || c.revision < 0
        || ![c.wallTime, c.simulationTime].every(t => Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t)
        || !/^[a-f0-9]{64}$/.test(r.checkpointDigest)) throw new Error('Invalid native travel fare receipt');
}
interface Row { sequence: number; id: string; json: string; previous_hash: string | null; hash: string }
/** Read-only audit. An absent schema is handled by the caller, never silently initialized here. */
export function readNativeTravelFares(db: Database): NativeTravelFareReceipt[] {
    const versions = db.query('SELECT version FROM native_travel_fare_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native travel fare schema');
    const count = (db.query('SELECT COUNT(*) AS n FROM native_travel_fare').get() as { n: number }).n;
    if (count > 100000) throw new Error('Native travel fare history exceeds the bounded reader');
    const rows = db.query('SELECT * FROM native_travel_fare ORDER BY sequence').all() as Row[];
    let previous: string | null = null;
    const receipts = rows.map((row, index) => {
        const { hash, ...body } = row, receipt = JSON.parse(row.json) as NativeTravelFareReceipt;
        validateNativeTravelFare(receipt);
        if (row.sequence !== index + 1 || row.id !== receipt.id || row.previous_hash !== previous || hash !== foodDigest(body))
            throw new Error('Native travel fare audit differs');
        previous = hash; return receipt;
    });
    const heads = db.query('SELECT * FROM native_travel_fare_head').all() as { singleton: number; sequence: number; hash: string | null }[];
    if (heads.length !== 1 || heads[0]!.singleton !== 1 || heads[0]!.sequence !== rows.length || heads[0]!.hash !== previous)
        throw new Error('Native travel fare head differs');
    return receipts;
}
export class NativeTravelFareStore {
    constructor(readonly db: Database) {
        db.transaction(() => {
            const names = ['native_travel_fare_schema', 'native_travel_fare', 'native_travel_fare_head'];
            const found = names.filter(name => db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1").get(name));
            if (found.length && found.length !== names.length) throw new Error('Partial native travel fare schema');
            if (!found.length) {
                db.run('CREATE TABLE native_travel_fare_schema(version INTEGER PRIMARY KEY CHECK(version=1))');
                db.run('INSERT INTO native_travel_fare_schema VALUES(1)');
                db.run('CREATE TABLE native_travel_fare(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)');
                db.run('CREATE TABLE native_travel_fare_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL,hash TEXT)');
                db.run('INSERT INTO native_travel_fare_head VALUES(1,0,NULL)');
            }
            readNativeTravelFares(db);
        }).immediate();
    }
    append(receipt: NativeTravelFareReceipt): void {
        if (!this.db.inTransaction) throw new Error('Native travel fare requires its Player checkpoint transaction');
        validateNativeTravelFare(receipt);
        const prior = readNativeTravelFares(this.db);
        if (prior.some(r => r.id === receipt.id)) throw new Error('Native travel fare ID already committed');
        const head = this.db.query('SELECT * FROM native_travel_fare_head WHERE singleton=1').get() as { sequence: number; hash: string | null };
        const body = { sequence: head.sequence + 1, id: receipt.id, json: JSON.stringify(receipt), previous_hash: head.hash }, hash = foodDigest(body);
        this.db.run('INSERT INTO native_travel_fare VALUES(?1,?2,?3,?4,?5)', [body.sequence, body.id, body.json, body.previous_hash, hash]);
        this.db.run('UPDATE native_travel_fare_head SET sequence=?1,hash=?2 WHERE singleton=1', [body.sequence, hash]);
    }
}
