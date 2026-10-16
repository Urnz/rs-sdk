import type { Database } from 'bun:sqlite';
import { healthDigest } from '../population-health/policy.js';
import type { InheritancePlan } from './inheritance-policy.js';
import type { EstateSourceReceipt } from './source.js';

type Row = Record<string,string | number | null>;
interface Transfer { planDigest: string; estateId: string; propertyId: string; beforeRowDigest: string; transfer: Row }
export function installInheritanceTransferSchema(db: Database): void {
    db.run(`CREATE TABLE IF NOT EXISTS population_estate_inheritance_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL)`);
    db.run('INSERT OR IGNORE INTO population_estate_inheritance_schema VALUES(1,1)');
    const version = db.query('SELECT version FROM population_estate_inheritance_schema WHERE singleton=1').get() as {version:number};
    if (version.version !== 1) throw new Error('Unsupported inheritance source schema');
    db.run(`CREATE TABLE IF NOT EXISTS population_estate_inheritance_transfer(estate_id TEXT NOT NULL,property_id TEXT NOT NULL,
        record_json TEXT NOT NULL,record_digest TEXT NOT NULL,PRIMARY KEY(estate_id,property_id))`);
}
/** Immutable native title receipts replace only the superseded Property seal, never unrelated custody evidence. */
export function verifyInheritanceTransfers(db: Database, custody: EstateSourceReceipt, plan?: InheritancePlan): Set<string> {
    const present = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='population_estate_inheritance_transfer'").get();
    if (present) {
        const schema = db.query('SELECT version FROM population_estate_inheritance_schema WHERE singleton=1').get() as {version:number} | null;
        if (schema?.version !== 1) throw new Error('Unsupported inheritance source schema');
    }
    const records = (present ? db.query('SELECT * FROM population_estate_inheritance_transfer WHERE estate_id=?1').all(custody.estateId) : []) as
        Array<{estate_id:string;property_id:string;record_json:string;record_digest:string}>;
    if (!records.length) return new Set();
    if (!plan || plan.estateId !== custody.estateId || plan.deathDigest !== custody.deathDigest
        || plan.custodyReceiptDigest !== healthDigest(custody) || plan.assets.length !== records.length)
        throw new Error('Inheritance transfer lacks its complete approved plan');
    const ids = new Set<string>();
    for (const row of records) {
        const receipt = JSON.parse(row.record_json) as Transfer;
        const asset = plan.assets.find(asset => asset.propertyId === row.property_id);
        const original = custody.claims.find(claim => claim.table === 'property_state' && claim.facts.property_id === row.property_id);
        const seal = custody.sealedRows.find(seal => seal.table === 'property_state' && seal.key.property_id === row.property_id);
        const native = db.query('SELECT * FROM property_transfer WHERE transfer_id=?1').get(receipt.transfer.transfer_id!) as Row | null;
        if (!asset || !original || original.facts.owner_kind !== 'player' || seal?.digest !== asset.beforeRowDigest
            || receipt.beforeRowDigest !== asset.beforeRowDigest || receipt.estateId !== row.estate_id || receipt.propertyId !== row.property_id
            || healthDigest(receipt) !== row.record_digest || receipt.planDigest !== healthDigest(plan)
            || !native || healthDigest(native) !== healthDigest(receipt.transfer) || native.property_id !== asset.propertyId
            || native.from_kind !== 'player' || native.from_id !== original.facts.owner_id
            || native.to_kind !== 'player' || native.to_id !== plan.heirUsername
            || native.transfer_id !== `inherit-${healthDigest({decision:plan.decisionId,estate:plan.estateId,property:asset.propertyId}).slice(0,48)}`
            || native.before_version !== asset.beforeVersion || native.version !== asset.beforeVersion + 1)
            throw new Error('Inheritance title receipt conflicts with custody or native history');
        ids.add(row.property_id);
    }
    return ids;
}
export function applyInheritanceTransfers(db: Database, custody: EstateSourceReceipt, plan: InheritancePlan, now: string): void {
    db.transaction(() => {
        installInheritanceTransferSchema(db);
        const done = verifyInheritanceTransfers(db,custody,plan);
        if (done.size) return;
        db.run('INSERT INTO population_estate_write_permit VALUES(1,?1)',[plan.estateId]);
        for (const asset of plan.assets) {
            const before = db.query('SELECT * FROM property_state WHERE property_id=?1').get(asset.propertyId) as Row | null;
            if (!before || before.owner_kind !== 'player' || before.status !== 'locked' || before.version !== asset.beforeVersion
                || healthDigest(before) !== asset.beforeRowDigest) throw new Error('Inheritance Property changed before transfer');
            const other = db.query("SELECT 1 FROM population_estate_hold WHERE scope='property' AND subject_key=?1 AND estate_id<>?2").get(asset.propertyId,plan.estateId);
            if (other) throw new Error('Inheritance Property has another custody claim');
            const transferId = `inherit-${healthDigest({decision:plan.decisionId,estate:plan.estateId,property:asset.propertyId}).slice(0,48)}`;
            const transfer: Row = {transfer_id:transferId,property_id:asset.propertyId,from_kind:'player',from_id:before.owner_id!,
                to_kind:'player',to_id:plan.heirUsername,before_version:asset.beforeVersion,version:asset.beforeVersion+1,created_at:now};
            const changed = db.run(`UPDATE property_state SET owner_kind='player',owner_id=?2,status='owned',acquired_at=?3,updated_at=?3,version=version+1
                WHERE property_id=?1 AND version=?4`,[asset.propertyId,plan.heirUsername,now,asset.beforeVersion]);
            const after = db.query('SELECT * FROM property_state WHERE property_id=?1').get(asset.propertyId);
            if (changed.changes !== 1 || healthDigest(after) !== healthDigest({...before,owner_kind:'player',owner_id:plan.heirUsername,
                status:'owned',acquired_at:now,updated_at:now,version:asset.beforeVersion+1})) throw new Error('Inheritance title effect did not commit exactly');
            db.run('INSERT INTO property_transfer VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',Object.values(transfer));
            const receipt: Transfer = {planDigest:healthDigest(plan),estateId:plan.estateId,propertyId:asset.propertyId,beforeRowDigest:asset.beforeRowDigest,transfer};
            db.run('INSERT INTO population_estate_inheritance_transfer VALUES(?1,?2,?3,?4)',
                [plan.estateId,asset.propertyId,JSON.stringify(receipt),healthDigest(receipt)]);
            db.run("DELETE FROM population_estate_hold WHERE scope='property' AND subject_key=?1 AND estate_id=?2",[asset.propertyId,plan.estateId]);
        }
        verifyInheritanceTransfers(db,custody,plan);
        db.run('DELETE FROM population_estate_write_permit');
    }).immediate();
}
