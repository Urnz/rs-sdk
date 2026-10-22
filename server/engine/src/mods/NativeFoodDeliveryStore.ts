import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { SimulationClockObservation } from '../../../../simulation-clock/types.js';
import { foodDigest, readFoodResult, type FoodResult } from './NativeFoodConsumptionStore.js';

export interface FoodDelivery {
    sequence: number; actionId: string; resultDigest: string; clock: SimulationClockObservation | null;
    legacy: boolean; previousDigest: string | null; digest: string;
}
export interface FoodDeliveryWatermark { clock: SimulationClockObservation; sequence: number; digest: string | null }
export interface FoodDeliverySnapshot { sourceId: string; entries: FoodDelivery[]; watermark: FoodDeliveryWatermark | null }

function canonicalTime(value: string): boolean {
    return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function validateFoodClock(clock: SimulationClockObservation): void {
    if (!clock || !canonicalTime(clock.wallTime) || !canonicalTime(clock.simulationTime)
        || !/^[0-9a-f]{64}$/.test(clock.profileDigest) || !clock.clockId
        || !['running', 'paused'].includes(clock.status) || !Number.isSafeInteger(clock.revision) || clock.revision < 1
        || !Number.isSafeInteger(clock.engineTick) || clock.engineTick! < 0) throw new Error('Native food clock is invalid');
}
/** Additive outbox in the canonical checkpoint DB. Existing results are preserved as explicit legacy entries. */
export function initializeFoodDelivery(db: Database): void {
    db.run('CREATE TABLE IF NOT EXISTS native_food_delivery_schema(version INTEGER PRIMARY KEY)');
    const versions = db.query('SELECT version FROM native_food_delivery_schema').all() as { version: number }[];
    if (versions.length) {
        if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native food delivery schema');
        readFoodDeliveries(db); return;
    }
    if (db.query("SELECT 1 FROM sqlite_master WHERE name IN ('native_food_delivery','native_food_delivery_head')").get())
        throw new Error('Incomplete native food delivery schema');
    db.run(`CREATE TABLE native_food_delivery(sequence INTEGER PRIMARY KEY,action_id TEXT NOT NULL UNIQUE
        REFERENCES native_food_actions(action_id),entry_json TEXT NOT NULL)`);
    db.run(`CREATE TABLE native_food_delivery_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        source_id TEXT NOT NULL,sequence INTEGER NOT NULL,entry_digest TEXT,watermark_json TEXT,watermark_digest TEXT)`);
    db.run('INSERT INTO native_food_delivery_head VALUES(1,?1,0,NULL,NULL,NULL)', [randomUUID()]);
    db.run('INSERT INTO native_food_delivery_schema VALUES(1)');
    const rows = db.query('SELECT action_id FROM native_food_actions WHERE result_json IS NOT NULL ORDER BY action_id')
        .all() as { action_id: string }[];
    for (const row of rows) appendFoodDelivery(db, readFoodResult(db, row.action_id)!, null, true);
}
export function appendFoodDelivery(db: Database, result: FoodResult, clock: SimulationClockObservation | null,
    legacy = false): void {
    if (!db.inTransaction) throw new Error('Native food delivery requires the checkpoint transaction');
    if (!legacy) {
        validateFoodClock(clock!);
        if (clock!.clockId !== result.action.clockId || clock!.profileDigest !== result.action.clockProfileDigest
            || (result.receipt && foodDigest(result.receipt.clock) !== foodDigest(clock))) throw new Error('Food delivery clock mismatch');
    }
    const snapshot = readFoodDeliveries(db, false), previous = snapshot.entries.at(-1);
    if (snapshot.watermark && !legacy && clock!.simulationTime < snapshot.watermark.clock.simulationTime)
        throw new Error('Native food commit precedes closed tick');
    if (previous?.clock && clock && clock.simulationTime < previous.clock.simulationTime)
        throw new Error('Native food delivery time regressed');
    const body = { sequence: (previous?.sequence ?? 0) + 1, actionId: result.action.actionId,
        resultDigest: foodDigest(result), clock, legacy, previousDigest: previous?.digest ?? null };
    const entry: FoodDelivery = { ...body, digest: foodDigest(body) };
    db.run('INSERT INTO native_food_delivery VALUES(?1,?2,?3)', [entry.sequence, entry.actionId, JSON.stringify(entry)]);
    db.run('UPDATE native_food_delivery_head SET sequence=?1,entry_digest=?2 WHERE singleton=1', [entry.sequence, entry.digest]);
}
export function closeFoodDeliveryTick(db: Database, clock: SimulationClockObservation): void {
    validateFoodClock(clock);
    db.transaction(() => {
        const snapshot = readFoodDeliveries(db), tip = snapshot.entries.at(-1);
        if (snapshot.watermark && (clock.clockId !== snapshot.watermark.clock.clockId
            || clock.profileDigest !== snapshot.watermark.clock.profileDigest
            || clock.simulationTime < snapshot.watermark.clock.simulationTime)) throw new Error('Food tick watermark drift');
        if (tip?.clock && (clock.simulationTime < tip.clock.simulationTime || clock.clockId !== tip.clock.clockId
            || clock.profileDigest !== tip.clock.profileDigest)) throw new Error('Food tick is behind delivery');
        const watermark: FoodDeliveryWatermark = { clock, sequence: tip?.sequence ?? 0, digest: tip?.digest ?? null };
        db.run('UPDATE native_food_delivery_head SET watermark_json=?1,watermark_digest=?2 WHERE singleton=1',
            [JSON.stringify(watermark), foodDigest(watermark)]);
    }).immediate();
}
export function readFoodDeliveries(db: Database, requireCoverage = true): FoodDeliverySnapshot {
    const versions = db.query('SELECT version FROM native_food_delivery_schema').all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported native food delivery schema');
    const head = db.query('SELECT * FROM native_food_delivery_head WHERE singleton=1').get() as {
        source_id: string; sequence: number; entry_digest: string | null; watermark_json: string | null; watermark_digest: string | null } | null;
    if (!head || !/^[a-f0-9-]{36}$/.test(head.source_id)) throw new Error('Food delivery head is missing');
    let previous: FoodDelivery | undefined;
    const entries = (db.query('SELECT * FROM native_food_delivery ORDER BY sequence').all() as {
        sequence: number; action_id: string; entry_json: string }[]).map(row => {
        const entry = JSON.parse(row.entry_json) as FoodDelivery, { digest, ...body } = entry;
        if (entry.sequence !== (previous?.sequence ?? 0) + 1 || row.sequence !== entry.sequence || row.action_id !== entry.actionId
            || digest !== foodDigest(body) || entry.previousDigest !== (previous?.digest ?? null)
            || typeof entry.legacy !== 'boolean' || (!entry.legacy && !entry.clock)) throw new Error('Food delivery audit mismatch');
        if (entry.clock) validateFoodClock(entry.clock);
        const result = readFoodResult(db, entry.actionId);
        if (!result || foodDigest(result) !== entry.resultDigest
            || (entry.clock && (entry.clock.clockId !== result.action.clockId
                || entry.clock.profileDigest !== result.action.clockProfileDigest))
            || (result.receipt && entry.clock && foodDigest(result.receipt.clock) !== foodDigest(entry.clock)))
            throw new Error('Food delivery source result mismatch');
        previous = entry; return entry;
    });
    if (head.sequence !== entries.length || head.entry_digest !== (previous?.digest ?? null)) throw new Error('Food delivery tail was truncated');
    const completed = (db.query('SELECT COUNT(*) AS count FROM native_food_actions WHERE result_json IS NOT NULL').get() as { count: number }).count;
    if (requireCoverage && completed !== entries.length) throw new Error('Food result is missing its delivery');
    const watermark = head.watermark_json ? JSON.parse(head.watermark_json) as FoodDeliveryWatermark : null;
    if (watermark) {
        validateFoodClock(watermark.clock);
        if (head.watermark_digest !== foodDigest(watermark) || watermark.sequence < 0 || watermark.sequence > entries.length
            || watermark.digest !== (entries[watermark.sequence - 1]?.digest ?? null)) throw new Error('Food watermark audit mismatch');
    } else if (head.watermark_digest !== null) throw new Error('Food watermark is missing');
    return { sourceId: head.source_id, entries, watermark };
}
