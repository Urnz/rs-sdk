import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import type { Database } from 'bun:sqlite';
import { PlayerInventoryEscrowStore } from '../server/engine/src/mods/PlayerInventoryEscrowStore.js';
import { assertNativeFoodDomainPath, assertNativeFoodPath } from '../food-loop/native-source.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { nativeHousingCatalogs, readRentJournal, rentIds, type HousingNativeOptions, type NativeRentBinding, type NativeRentOrder, type NativeRentReceipt } from './native-rent.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export function assertRentProperty(options: HousingNativeOptions, binding: NativeRentBinding): void {
    assertNativeFoodDomainPath({ ...options, checkpointPath: options.propertyPath });
    const db = new OwnedDatabase(options.propertyPath, { readonly: true, strict: true });
    try {
        const i = binding.intent, unit = i.catalogs.units.units.find(u => u.housingUnitId === i.housingUnitId)!;
        const p = db.query('SELECT * FROM property_state WHERE property_id=?1').get(unit.propertyId) as Record<string, unknown> | null;
        if (!p || p.status !== 'owned' || p.owner_kind !== 'player' || p.owner_id !== i.landlord.username || p.version !== i.propertyVersion)
            throw new Error('Rent landlord Property authority changed');
    } finally { db.close(true); }
}
export function assertRentAdmission(options: HousingNativeOptions, binding: NativeRentBinding, clock: SimulationClockObservation): void {
    const i = binding.intent;
    if (foodDigest(nativeHousingCatalogs(options.workspace)) !== foodDigest(i.catalogs) || i.worldId !== options.worldId || clock.clockId !== i.clockId
        || clock.profileDigest !== i.clockProfileDigest || clock.status !== 'running' || clock.wallTime >= i.expiresAt || clock.simulationTime >= i.endsAt
        || clock.simulationTime < i.startsAt) throw new Error('Rent catalog/clock/quote expired or changed');
    assertRentProperty(options, binding);
}
export class NativeRentSource {
    private readonly db: OwnedDatabase;
    constructor(readonly options: HousingNativeOptions) {
        assertNativeFoodDomainPath({ ...options, checkpointPath: options.housingPath });
        this.db = new OwnedDatabase(options.housingPath, { readonly: true, strict: true });
    }
    close(): void { this.db.close(true); }
    active(): NativeRentOrder[] { return readRentJournal<NativeRentOrder>(this.db, 'housing_native').filter(o => o.phase === 'active'); }
    order(operationId: string, clock?: SimulationClockObservation): NativeRentOrder {
        let result!: NativeRentOrder;
        this.db.transaction(() => {
            const order = readRentJournal<NativeRentOrder>(this.db, 'housing_native').find(o => o.binding.intent.operationId === operationId);
            if (!order || order.binding.intent.worldId !== this.options.worldId) throw new Error('Rent binding unavailable in this world');
            if (clock) { if (order.phase !== 'reserved') throw new Error('Rent reservation is closed'); assertRentAdmission(this.options, order.binding, clock); }
            result = structuredClone(order);
        }).deferred(); return result;
    }
    entitlement(operationId: string, clock: SimulationClockObservation) {
        let result!: ReturnType<NativeRentSource['readEntitlement']>;
        this.db.transaction(() => { result = this.readEntitlement(operationId, clock); }).deferred(); return result;
    }
    private readEntitlement(operationId: string, clock: SimulationClockObservation) {
        const order = this.order(operationId), i = order.binding.intent;
        if (order.phase !== 'active' || clock.clockId !== i.clockId || clock.profileDigest !== i.clockProfileDigest || !['running', 'paused'].includes(clock.status)
            || clock.simulationTime < i.startsAt || clock.simulationTime >= i.endsAt) throw new Error('Rent entitlement is inactive or expired');
        const receipt = openNativeRentReceipt(this.options, order.binding);
        if (!receipt || receipt.phase !== 'paid' || receipt.digest !== order.nativeDigest) throw new Error('Rent entitlement native payment source missing');
        if (foodDigest(nativeHousingCatalogs(this.options.workspace)) !== foodDigest(i.catalogs)) throw new Error('Rent sleep policy changed');
        assertRentProperty(this.options, order.binding);
        let previous = '0'.repeat(64);
        const audit = this.db.query('SELECT previous_hash,entry_hash,payload_json FROM housing_tenancy_audit ORDER BY sequence').all() as { previous_hash: string; entry_hash: string; payload_json: string }[];
        for (const a of audit) {
            if (a.previous_hash !== previous || foodDigest({ previousHash: previous, payload: JSON.parse(a.payload_json) }) !== a.entry_hash) throw new Error('Tenancy audit differs'); previous = a.entry_hash;
        }
        const head = this.db.query('SELECT sequence,hash FROM housing_tenancy_audit_head WHERE id=1').get() as { sequence: number; hash: string } | null;
        if (!head || head.sequence !== audit.length || head.hash !== previous) throw new Error('Tenancy audit coverage differs');
        const id = rentIds(operationId), t = this.db.query('SELECT * FROM housing_tenancy WHERE tenancy_id=?1').get(id.tenancyId) as Record<string, unknown> | null;
        const prepaid = this.db.query('SELECT * FROM housing_prepaid_period WHERE tenancy_id=?1').get(id.tenancyId) as Record<string, unknown> | null;
        const payment = this.db.query('SELECT * FROM housing_rent_payment WHERE payment_id=?1').get(id.escrowId) as Record<string, unknown> | null;
        if (!t || t.status !== 'active' || t.tenant_agent_id !== i.tenant.agentId || t.bed_slot_id !== i.bedSlotId || t.housing_unit_id !== i.housingUnitId
            || t.starts_at !== i.startsAt || t.ends_at !== i.endsAt || t.arrears_gp !== 0 || prepaid?.source_digest !== order.nativeDigest
            || prepaid.payment_id !== id.escrowId || payment?.source_digest !== order.nativeDigest || payment.amount_gp !== i.amountGp)
            throw new Error('Paid rent entitlement projection differs');
        return { order, access: { kind: 'bed-entitlement' as const, evidenceId: `rent:${id.tenancyId}`, sourceDigest: order.nativeDigest!, validUntilSimulationTime: i.endsAt } };
    }
}
export function readNativeRentReceipt(db: Database, binding: NativeRentBinding): NativeRentReceipt | null {
    const record = readRentJournal<NativeRentReceipt>(db, 'native_rent').find(r => r.binding.intent.operationId === binding.intent.operationId);
    if (!record) return null;
    if (foodDigest(record.binding) !== foodDigest(binding)) throw new Error('Native rent binding differs');
    const escrowId = rentIds(binding.intent.operationId).escrowId, escrow = new PlayerInventoryEscrowStore({ db, checkpoint: () => { throw new Error('Readonly rent'); } }, true);
    const e = escrow.get(escrowId), i = binding.intent;
    if (record.phase === 'paid') {
        const purpose = db.query('SELECT binding_digest FROM player_inventory_escrow_business_binding WHERE escrow_id=?1').get(escrowId) as { binding_digest: string } | null;
        if (!e || e.status !== 'committed' || e.username !== i.tenant.username || e.payeeUsername !== i.landlord.username
            || e.assets.gp !== i.amountGp || e.assets.items.length || purpose?.binding_digest !== binding.digest || !record.checkpoints
            || record.after.tenant !== record.before.tenant - i.amountGp || record.after.landlord !== record.before.landlord + i.amountGp
            || record.clock.clockId !== i.clockId || record.clock.profileDigest !== i.clockProfileDigest || record.clock.status !== 'running'
            || record.clock.simulationTime < i.startsAt || record.clock.simulationTime >= i.endsAt || record.clock.wallTime >= i.expiresAt
            || !/^[a-f0-9]{64}$/.test(record.checkpoints.tenant) || !/^[a-f0-9]{64}$/.test(record.checkpoints.landlord))
            throw new Error('Native rent bilateral payment/custody differs');
    } else if (e || record.checkpoints) throw new Error('Rent cancellation contains a payment');
    return record;
}
export function openNativeRentReceipt(options: HousingNativeOptions, binding: NativeRentBinding): NativeRentReceipt | null {
    assertNativeFoodPath(options); const db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
    try { let receipt: NativeRentReceipt | null = null; db.transaction(() => { receipt = readNativeRentReceipt(db, binding); }).deferred(); return receipt; }
    finally { db.close(true); }
}
