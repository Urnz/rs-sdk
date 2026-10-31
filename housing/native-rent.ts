import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { loadHousingTierPolicyCatalog, loadHousingEffectPolicyCatalog, loadHousingUnitCatalog } from './config.js';
import { resolveHousingEffects } from './effects.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { workUuid } from '../business-work/binding.js';
import type { CommerceActor } from '../agent-operated-shop/native-commerce.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
export interface HousingNativeOptions { workspace: string; worldId: string; housingPath: string; propertyPath: string; checkpointPath: string }
export interface NativeRentIntent {
    operationId: string; worldId: string; clockId: string; clockProfileDigest: string;
    tenant: CommerceActor; landlord: CommerceActor; housingUnitId: string; bedSlotId: string;
    startsAt: string; endsAt: string; expiresAt: string; amountGp: number; propertyVersion: number;
    catalogs: ReturnType<typeof nativeHousingCatalogs>;
}
export interface NativeRentBinding { intent: NativeRentIntent; digest: string }
export interface NativeRentOrder { binding: NativeRentBinding; phase: 'reserved' | 'active' | 'closed' | 'cancelled'; nativeDigest: string | null }
export interface NativeRentReceipt { binding: NativeRentBinding; phase: 'paid' | 'cancelled'; clock: SimulationClockObservation;
    before: { tenant: number; landlord: number }; after: { tenant: number; landlord: number }; checkpoints: { tenant: string; landlord: string } | null; digest: string }
export type NativeHousingCommand = { operation: 'pay' | 'cancel' | 'sleep' | 'wake' | 'owner-sleep' | 'owner-wake'; operationId: string };
export type NativeHousingResponse = { ok: true; operationId: string; phase: string } | { ok: false; error: string };
export const rentIds = (id: string) => ({ escrowId: workUuid(`rent:${id}`), tenancyId: `rent.${foodDigest(id).slice(0, 48)}` });
export function nativeHousingCatalogs(root: string) {
    const config = (name: string) => join(root, 'config', name), hierarchy = loadHousingTierPolicyCatalog(config('housing-tier-policies.json')).policies[0]!;
    const properties = JSON.parse(readFileSync(config('properties.json'), 'utf8')) as { properties: { propertyId: string }[] };
    const units = loadHousingUnitCatalog(config('housing-units.json'), hierarchy, new Set(properties.properties.map(p => p.propertyId)));
    const effects = loadHousingEffectPolicyCatalog(config('housing-effect-policies.json'), hierarchy).policies[0]!;
    const native = JSON.parse(readFileSync(config('native-housing.json'), 'utf8')) as { schemaVersion: number; housingUnitId: string; beds: { bedSlotId: string; x: number; z: number; level: number }[] };
    const unit = units.units.find(u => u.housingUnitId === native.housingUnitId);
    if (native.schemaVersion !== 1 || !unit?.enabled || native.beds.length !== unit.capacity || new Set(native.beds.map(b => b.bedSlotId)).size !== unit.capacity
        || new Set(native.beds.map(b=>`${b.x},${b.z},${b.level}`)).size!==unit.capacity
        || native.beds.some(b => !unit.bedSlots.some(s => s.bedSlotId === b.bedSlotId) || ![b.x, b.z, b.level].every(Number.isSafeInteger)
            || b.x < 0 || b.x > 16383 || b.z < 0 || b.z > 16383 || b.level < 0 || b.level > 3)) throw new Error('Invalid native housing bed mapping');
    return { units, hierarchy, effects, native, recovery: resolveHousingEffects(effects, hierarchy, unit.tierId) };
}
export function validateRentIntent(i: NativeRentIntent): void {
    const id = (v: string) => typeof v === 'string' && /^[a-z0-9][a-z0-9._:-]{1,119}$/.test(v);
    const unit = i.catalogs.units.units.find(u => u.housingUnitId === i.housingUnitId);
    if (!id(i.operationId) || !unit?.enabled || i.housingUnitId !== i.catalogs.native.housingUnitId || !unit.bedSlots.some(b => b.bedSlotId === i.bedSlotId)
        || !Number.isSafeInteger(i.amountGp) || i.amountGp < 1 || i.amountGp !== unit.rentGpPerPeriod || !Number.isSafeInteger(i.propertyVersion) || i.propertyVersion < 1
        || Date.parse(i.endsAt) !== Date.parse(i.startsAt) + unit.rentPeriodSimulationMinutes * 60000 || !Number.isFinite(Date.parse(i.expiresAt))
        || !i.worldId || !i.clockId || !/^[a-f0-9]{64}$/.test(i.clockProfileDigest) || i.tenant.agentId === i.landlord.agentId || i.tenant.username === i.landlord.username)
        throw new Error('Invalid native rent intent');
    for (const actor of [i.tenant, i.landlord]) if (!id(actor.agentId) || !/^[a-z0-9]{1,12}$/.test(actor.username) || !actor.lifecycleId) throw new Error('Invalid rental actor');
    for (const at of [i.startsAt, i.endsAt, i.expiresAt]) if (new Date(at).toISOString() !== at) throw new Error('Rent timestamp must be canonical UTC');
}
/** Hash-chained projections shared by the domain reservation and native payment, each in its owning DB. */
export function initializeRentJournal(db: Database, prefix: 'housing_native' | 'native_rent'): void {
    db.transaction(() => {
        db.run(`CREATE TABLE IF NOT EXISTS ${prefix}_schema(version INTEGER PRIMARY KEY)`);
        const versions = db.query(`SELECT version FROM ${prefix}_schema`).all() as { version: number }[];
        if (versions.length && (versions.length !== 1 || versions[0]!.version !== 1)) throw new Error('Unsupported rent schema');
        if (!versions.length) {
            if (db.query("SELECT 1 FROM sqlite_master WHERE name=?1").get(`${prefix}_operation`)) throw new Error('Incomplete rent schema');
            db.run(`CREATE TABLE ${prefix}_operation(operation_id TEXT PRIMARY KEY,binding_digest TEXT NOT NULL UNIQUE,row_json TEXT NOT NULL)`);
            db.run(`CREATE TABLE ${prefix}_audit(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,row_json TEXT NOT NULL,previous_hash TEXT,hash TEXT NOT NULL)`);
            db.run(`CREATE TABLE ${prefix}_head(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,hash TEXT)`);
            db.run(`INSERT INTO ${prefix}_head VALUES(1,0,NULL)`); db.run(`INSERT INTO ${prefix}_schema VALUES(1)`);
        }
        readRentJournal(db, prefix);
    }).immediate();
}
export function readRentJournal<T extends NativeRentOrder | NativeRentReceipt>(db: Database, prefix: 'housing_native' | 'native_rent'): T[] {
    const versions = db.query(`SELECT version FROM ${prefix}_schema`).all() as { version: number }[];
    if (versions.length !== 1 || versions[0]!.version !== 1) throw new Error('Unsupported rent schema');
    const audits = db.query(`SELECT * FROM ${prefix}_audit ORDER BY sequence`).all() as { sequence: number; operation_id: string; row_json: string; previous_hash: string | null; hash: string }[];
    const latest = new Map<string, string>(); let previous: string | null = null;
    for (const [index, row] of audits.entries()) { const { hash, ...facts } = row;
        if (row.sequence !== index + 1 || row.previous_hash !== previous || foodDigest(facts) !== hash) throw new Error('Rent audit differs');
        previous = hash; latest.set(row.operation_id, row.row_json);
    }
    const rows = db.query(`SELECT * FROM ${prefix}_operation`).all() as { operation_id: string; binding_digest: string; row_json: string }[];
    const head = db.query(`SELECT * FROM ${prefix}_head WHERE id=1`).get() as { sequence: number; hash: string | null } | null;
    if (!head || head.sequence !== audits.length || head.hash !== previous || rows.length !== latest.size) throw new Error('Rent audit coverage differs');
    return rows.map(row => { const record = JSON.parse(row.row_json) as T; validateRentIntent(record.binding.intent);
        if (record.binding.intent.operationId !== row.operation_id || row.binding_digest !== record.binding.digest || foodDigest(record.binding.intent) !== record.binding.digest
            || latest.get(row.operation_id) !== row.row_json) throw new Error('Rent projection differs');
        if (prefix === 'native_rent') { const { digest, ...facts } = record as NativeRentReceipt;
            if (foodDigest(facts) !== digest || !['paid', 'cancelled'].includes(record.phase)) throw new Error('Native rent proof differs');
        } else if (!['reserved', 'active', 'closed', 'cancelled'].includes(record.phase)) throw new Error('Invalid rent order phase');
        return record;
    });
}
export function writeRentJournal(db: Database, prefix: 'housing_native' | 'native_rent', record: NativeRentOrder | NativeRentReceipt): void {
    if (!db.inTransaction) throw new Error('Rent journal requires transaction');
    const id = record.binding.intent.operationId, json = JSON.stringify(record);
    db.run(`INSERT INTO ${prefix}_operation VALUES(?1,?2,?3) ON CONFLICT(operation_id) DO UPDATE SET row_json=excluded.row_json`, [id, record.binding.digest, json]);
    const head = db.query(`SELECT * FROM ${prefix}_head WHERE id=1`).get() as { sequence: number; hash: string | null };
    const event = { sequence: head.sequence + 1, operation_id: id, row_json: json, previous_hash: head.hash }, hash = foodDigest(event);
    db.run(`INSERT INTO ${prefix}_audit VALUES(?1,?2,?3,?4,?5)`, [event.sequence, id, json, head.hash, hash]);
    db.run(`UPDATE ${prefix}_head SET sequence=?1,hash=?2 WHERE id=1`, [event.sequence, hash]); readRentJournal(db, prefix);
}
