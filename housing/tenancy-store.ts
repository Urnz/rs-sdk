import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { housingUnitCatalogDigest } from './units.js';
import type { BedAccessEntitlement, HousingTenancy, HousingTenancyStatus,
    HousingUnitCatalog, RentPaymentEvidence } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const ZERO = '0'.repeat(64);
type Row = { tenancy_id: string; housing_unit_id: string; bed_slot_id: string; tenant_agent_id: string;
    status: HousingTenancyStatus; starts_at: string; ends_at: string; next_rent_due_at: string;
    rent_gp_per_period: number; rent_period_minutes: number; arrears_gp: number;
    unit_catalog_digest: string; revision: number };

function id(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!ID.test(normalized)) throw new Error(`${field} is invalid`);
    return normalized;
}
function time(value: string, field: string): { iso: string; milliseconds: number } {
    const milliseconds = Date.parse(value), iso = new Date(milliseconds).toISOString();
    if (!Number.isSafeInteger(milliseconds) || iso !== value) throw new Error(`${field} must be canonical UTC ISO`);
    return { iso, milliseconds };
}
function tenancy(row: Row): HousingTenancy {
    return { tenancyId: row.tenancy_id, housingUnitId: row.housing_unit_id, bedSlotId: row.bed_slot_id,
        tenantAgentId: row.tenant_agent_id, status: row.status, startsAtSimulationTime: row.starts_at,
        endsAtSimulationTime: row.ends_at, nextRentDueAtSimulationTime: row.next_rent_due_at,
        rentGpPerPeriod: row.rent_gp_per_period, rentPeriodSimulationMinutes: row.rent_period_minutes,
        arrearsGp: row.arrears_gp,
        unitCatalogDigest: row.unit_catalog_digest, revision: row.revision };
}
function digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class HousingTenancyStore {
    private readonly database: Database;
    constructor(path: string, private readonly catalog: HousingUnitCatalog) {
        const { digest: supplied, ...definition } = catalog;
        if (supplied !== housingUnitCatalogDigest(definition)) throw new Error('Housing unit catalog digest does not match');
        mkdirSync(dirname(path), { recursive: true });
        this.database = new Database(path, { create: true, strict: true });
        this.database.run('PRAGMA foreign_keys = ON');
        this.migrate();
        const persisted = this.database.query('SELECT catalog_digest FROM housing_tenancy_meta WHERE singleton=1')
            .get() as { catalog_digest: string };
        if (persisted.catalog_digest !== catalog.digest) this.database.run(
            'UPDATE housing_tenancy_meta SET catalog_digest=?1 WHERE singleton=1', [catalog.digest]);
    }
    close(): void { this.database.close(true); }
    get(tenancyId: string): HousingTenancy | null {
        const row = this.database.query('SELECT * FROM housing_tenancy WHERE tenancy_id=?1')
            .get(id(tenancyId, 'Tenancy id')) as Row | null;
        return row ? tenancy(row) : null;
    }
    list(): HousingTenancy[] {
        return (this.database.query('SELECT * FROM housing_tenancy ORDER BY tenancy_id').all() as Row[]).map(tenancy);
    }
    create(input: { tenancyId: string; housingUnitId: string; bedSlotId: string; tenantAgentId: string;
        startsAtSimulationTime: string; periodCount: number }): HousingTenancy {
        const tenancyId = id(input.tenancyId, 'Tenancy id'), unitId = id(input.housingUnitId, 'Housing unit id');
        const bedId = id(input.bedSlotId, 'Bed slot id'), tenantId = id(input.tenantAgentId, 'Tenant agent id');
        const start = time(input.startsAtSimulationTime, 'Tenancy start');
        if (!Number.isSafeInteger(input.periodCount) || input.periodCount < 1 || input.periodCount > 3_650) {
            throw new Error('Tenancy period count must be between 1 and 3650');
        }
        const unit = this.catalog.units.find(item => item.housingUnitId === unitId);
        if (!unit || !unit.enabled || !unit.bedSlots.some(bed => bed.bedSlotId === bedId)) {
            throw new Error('Unknown, disabled or invalid housing unit or bed slot');
        }
        const periodMs = unit.rentPeriodSimulationMinutes * 60_000;
        const end = new Date(start.milliseconds + periodMs * input.periodCount).toISOString();
        const nextDue = new Date(start.milliseconds + periodMs).toISOString();
        const existing = this.get(tenancyId);
        if (existing) {
            if (existing.housingUnitId !== unitId || existing.bedSlotId !== bedId
                || existing.tenantAgentId !== tenantId || existing.startsAtSimulationTime !== start.iso
                || existing.endsAtSimulationTime !== end) throw new Error('Tenancy id was reused with different terms');
            return existing;
        }
        const transaction = this.database.transaction(() => {
            const occupied = this.database.query(`SELECT tenancy_id FROM housing_tenancy
                WHERE (housing_unit_id=?1 AND bed_slot_id=?2 OR tenant_agent_id=?3)
                AND status IN ('active','arrears') LIMIT 1`).get(unitId, bedId, tenantId);
            if (occupied) throw new Error('Bed slot or tenant already has an active tenancy');
            this.database.run(`INSERT INTO housing_tenancy
                (tenancy_id,housing_unit_id,bed_slot_id,tenant_agent_id,status,starts_at,ends_at,
                next_rent_due_at,rent_gp_per_period,rent_period_minutes,arrears_gp,unit_catalog_digest,revision)
                VALUES(?1,?2,?3,?4,'active',?5,?6,?7,?8,?9,0,?10,1)`,
            [tenancyId, unitId, bedId, tenantId, start.iso, end, nextDue,
                unit.rentGpPerPeriod, unit.rentPeriodSimulationMinutes, this.catalog.digest]);
            this.audit('tenancy-created', tenancyId, start.iso, { unitId, bedId, tenantId, end });
        });
        transaction.immediate();
        return this.get(tenancyId)!;
    }
    assessRent(tenancyIdInput: string, throughSimulationTime: string): HousingTenancy {
        const current = this.require(tenancyIdInput), through = time(throughSimulationTime, 'Rent assessment time');
        if (through.milliseconds < Date.parse(current.startsAtSimulationTime)) throw new Error('Rent assessment predates tenancy');
        if (current.status === 'ended') return current;
        const periodMs = current.rentPeriodSimulationMinutes * 60_000;
        let due = Date.parse(current.nextRentDueAtSimulationTime), charges = 0;
        const end = Date.parse(current.endsAtSimulationTime), limit = Math.min(through.milliseconds, end);
        while (due <= limit) { charges++; due += periodMs; }
        const nextStatus: HousingTenancyStatus = through.milliseconds >= end ? 'expired'
            : current.arrearsGp + charges * current.rentGpPerPeriod > 0 ? 'arrears' : 'active';
        if (charges === 0 && nextStatus === current.status) return current;
        const transaction = this.database.transaction(() => {
            const changed = this.database.run(`UPDATE housing_tenancy SET next_rent_due_at=?3,
                arrears_gp=arrears_gp+?4,status=?5,revision=revision+1 WHERE tenancy_id=?1 AND revision=?2`,
            [current.tenancyId, current.revision, new Date(due).toISOString(),
                charges * current.rentGpPerPeriod, nextStatus]);
            if (changed.changes !== 1) throw new Error('Tenancy changed before rent assessment');
            this.audit('rent-assessed', current.tenancyId, through.iso, { charges, status: nextStatus });
        });
        transaction.immediate();
        return this.get(current.tenancyId)!;
    }
    recordPayment(tenancyIdInput: string, evidence: RentPaymentEvidence): HousingTenancy {
        const current = this.require(tenancyIdInput), paymentId = id(evidence.paymentId, 'Payment id');
        const occurred = time(evidence.occurredAtSimulationTime, 'Payment time');
        if (!Number.isSafeInteger(evidence.amountGp) || evidence.amountGp < 1) throw new Error('Rent payment is invalid');
        if (!/^[0-9a-f]{64}$/.test(evidence.sourceDigest)) throw new Error('Rent payment source digest is invalid');
        const existing = this.database.query(`SELECT tenancy_id,amount_gp,source_digest FROM housing_rent_payment
            WHERE payment_id=?1`).get(paymentId) as { tenancy_id: string; amount_gp: number; source_digest: string } | null;
        if (existing) {
            if (existing.tenancy_id !== current.tenancyId || existing.amount_gp !== evidence.amountGp
                || existing.source_digest !== evidence.sourceDigest) throw new Error('Rent payment id was reused');
            return current;
        }
        if (evidence.amountGp > current.arrearsGp) throw new Error('Rent payment exceeds arrears');
        const remaining = current.arrearsGp - evidence.amountGp;
        const status: HousingTenancyStatus = occurred.milliseconds >= Date.parse(current.endsAtSimulationTime)
            ? 'expired' : remaining === 0 ? 'active' : 'arrears';
        const transaction = this.database.transaction(() => {
            this.database.run(`INSERT INTO housing_rent_payment
                (payment_id,tenancy_id,amount_gp,source_digest,occurred_at) VALUES(?1,?2,?3,?4,?5)`,
            [paymentId, current.tenancyId, evidence.amountGp, evidence.sourceDigest, occurred.iso]);
            const changed = this.database.run(`UPDATE housing_tenancy SET arrears_gp=?3,status=?4,
                revision=revision+1 WHERE tenancy_id=?1 AND revision=?2`,
            [current.tenancyId, current.revision, remaining, status]);
            if (changed.changes !== 1) throw new Error('Tenancy changed before rent payment');
            this.audit('rent-paid', current.tenancyId, occurred.iso,
                { paymentId, amountGp: evidence.amountGp, sourceDigest: evidence.sourceDigest });
        });
        transaction.immediate();
        return this.get(current.tenancyId)!;
    }
    end(tenancyIdInput: string, expectedRevision: number, atSimulationTime: string): HousingTenancy {
        const current = this.require(tenancyIdInput), at = time(atSimulationTime, 'Tenancy end time');
        if (current.status === 'ended') return current;
        const transaction = this.database.transaction(() => {
            const changed = this.database.run(`UPDATE housing_tenancy SET status='ended',revision=revision+1
                WHERE tenancy_id=?1 AND revision=?2`, [current.tenancyId, expectedRevision]);
            if (changed.changes !== 1) throw new Error('Tenancy changed before end');
            this.audit('tenancy-ended', current.tenancyId, at.iso, {});
        });
        transaction.immediate();
        return this.get(current.tenancyId)!;
    }
    bedEntitlement(tenancyIdInput: string, atSimulationTime: string): BedAccessEntitlement | null {
        const current = this.require(tenancyIdInput), at = time(atSimulationTime, 'Entitlement time');
        if (current.status !== 'active' || current.arrearsGp !== 0
            || at.milliseconds >= Date.parse(current.endsAtSimulationTime)
            || at.milliseconds >= Date.parse(current.nextRentDueAtSimulationTime)) return null;
        const validUntil = Date.parse(current.endsAtSimulationTime) < Date.parse(current.nextRentDueAtSimulationTime)
            ? current.endsAtSimulationTime : current.nextRentDueAtSimulationTime;
        const sourceDigest = digest({ tenancyId: current.tenancyId, revision: current.revision,
            bedSlotId: current.bedSlotId, validUntil });
        return { kind: 'bed-entitlement', evidenceId: `tenancy:${current.tenancyId}:${current.revision}`,
            sourceDigest, sleepPlaceId: current.bedSlotId, validUntilSimulationTime: validUntil };
    }
    verifyAuditChain(): { valid: boolean; entries: number; headHash: string } {
        const rows = this.database.query(`SELECT previous_hash,entry_hash,payload_json FROM housing_tenancy_audit
            ORDER BY sequence`).all() as Array<{ previous_hash: string; entry_hash: string; payload_json: string }>;
        let head = ZERO;
        for (const row of rows) {
            if (row.previous_hash !== head || digest({ previousHash: head, payload: JSON.parse(row.payload_json) })
                !== row.entry_hash) return { valid: false, entries: rows.length, headHash: head };
            head = row.entry_hash;
        }
        return { valid: true, entries: rows.length, headHash: head };
    }
    private require(input: string): HousingTenancy {
        const found = this.get(input); if (!found) throw new Error('Unknown tenancy'); return found;
    }
    private audit(action: string, tenancyId: string, at: string, detail: unknown): void {
        const last = this.database.query(`SELECT entry_hash FROM housing_tenancy_audit
            ORDER BY sequence DESC LIMIT 1`).get() as { entry_hash: string } | null;
        const previousHash = last?.entry_hash ?? ZERO, payload = { action, tenancyId, at, detail };
        const entryHash = digest({ previousHash, payload });
        this.database.run(`INSERT INTO housing_tenancy_audit
            (action,tenancy_id,occurred_at,payload_json,previous_hash,entry_hash)
            VALUES(?1,?2,?3,?4,?5,?6)`,
        [action, tenancyId, at, JSON.stringify(payload), previousHash, entryHash]);
    }
    private migrate(): void {
        const version = Number((this.database.query('PRAGMA user_version').get() as { user_version: number }).user_version);
        if (version > 2) throw new Error(`Housing tenancy schema ${version} is newer than supported version 2`);
        if (version < 1) { const transaction = this.database.transaction(() => {
            this.database.run(`CREATE TABLE housing_tenancy_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                catalog_digest TEXT NOT NULL)`);
            this.database.run('INSERT INTO housing_tenancy_meta VALUES(1,?1)', [this.catalog.digest]);
            this.database.run(`CREATE TABLE housing_tenancy (tenancy_id TEXT PRIMARY KEY,housing_unit_id TEXT NOT NULL,
                bed_slot_id TEXT NOT NULL,tenant_agent_id TEXT NOT NULL,status TEXT NOT NULL
                CHECK(status IN ('active','arrears','expired','ended')),
                starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,next_rent_due_at TEXT NOT NULL,
                rent_gp_per_period INTEGER NOT NULL,rent_period_minutes INTEGER NOT NULL,
                arrears_gp INTEGER NOT NULL,unit_catalog_digest TEXT NOT NULL,
                revision INTEGER NOT NULL)`);
            this.database.run(`CREATE TABLE housing_rent_payment (payment_id TEXT PRIMARY KEY,
                tenancy_id TEXT NOT NULL REFERENCES housing_tenancy(tenancy_id),amount_gp INTEGER NOT NULL,
                source_digest TEXT NOT NULL,occurred_at TEXT NOT NULL)`);
            this.database.run(`CREATE TABLE housing_tenancy_audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,tenancy_id TEXT NOT NULL,occurred_at TEXT NOT NULL,payload_json TEXT NOT NULL,
                previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE)`);
            this.database.run(`CREATE UNIQUE INDEX housing_active_bed ON housing_tenancy(housing_unit_id,bed_slot_id)
                WHERE status IN ('active','arrears')`);
            this.database.run(`CREATE UNIQUE INDEX housing_active_tenant ON housing_tenancy(tenant_agent_id)
                WHERE status IN ('active','arrears')`);
            this.database.run('PRAGMA user_version = 2');
        });
        transaction.immediate(); return; }
        if (version < 2) {
            const migration = this.database.transaction(() => {
                this.database.run('ALTER TABLE housing_tenancy ADD COLUMN rent_period_minutes INTEGER');
                const rows = this.database.query('SELECT tenancy_id,housing_unit_id FROM housing_tenancy').all() as
                    Array<{ tenancy_id: string; housing_unit_id: string }>;
                for (const row of rows) {
                    const unit = this.catalog.units.find(item => item.housingUnitId === row.housing_unit_id);
                    if (!unit) throw new Error(`Cannot migrate tenancy for missing unit: ${row.housing_unit_id}`);
                    this.database.run('UPDATE housing_tenancy SET rent_period_minutes=?2 WHERE tenancy_id=?1',
                        [row.tenancy_id, unit.rentPeriodSimulationMinutes]);
                }
                this.database.run('PRAGMA user_version = 2');
            });
            migration.immediate();
        }
    }
}
