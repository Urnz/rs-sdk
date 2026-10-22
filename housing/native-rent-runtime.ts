import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { HousingTenancyStore } from './tenancy-store.js';
import { nativeHousingCatalogs, validateRentIntent, initializeRentJournal, readRentJournal, writeRentJournal, rentIds,
    type NativeRentIntent, type NativeRentOrder, type HousingNativeOptions } from './native-rent.js';
import { assertRentAdmission, openNativeRentReceipt } from './native-rent-source.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
export class NativeRentCoordinator {
    private readonly db: OwnedDatabase;
    constructor(readonly options: HousingNativeOptions) {
        assertNativeFoodDomainPath({ ...options, checkpointPath: options.housingPath });
        mkdirSync(dirname(options.housingPath), { recursive: true });
        this.db = new OwnedDatabase(options.housingPath, { create: true, strict: true });
        try { this.db.run('PRAGMA busy_timeout=5000'); new HousingTenancyStore(this.db, nativeHousingCatalogs(options.workspace).units); initializeRentJournal(this.db, 'housing_native'); }
        catch (error) { this.db.close(true); throw error; }
    }
    close(): void { this.db.close(true); }
    get(id: string): NativeRentOrder | null { let result: NativeRentOrder | null = null;
        this.db.transaction(() => { result = readRentJournal<NativeRentOrder>(this.db, 'housing_native').find(o => o.binding.intent.operationId === id) ?? null; }).deferred(); return result; }
    reserve(intent: NativeRentIntent, clock: SimulationClockObservation): NativeRentOrder {
        validateRentIntent(intent); const binding = { intent: structuredClone(intent), digest: foodDigest(intent) };
        this.db.transaction(() => {
            const prior = this.get(intent.operationId);
            if (prior) { if (prior.binding.digest !== binding.digest) throw new Error('Rent operation id reused'); return; }
            assertRentAdmission(this.options, binding, clock);
            if (Date.parse(intent.expiresAt) - Date.parse(clock.wallTime) > 600000 || intent.startsAt !== clock.simulationTime) throw new Error('Invalid rent admission window');
            const tenancies = new HousingTenancyStore(this.db, intent.catalogs.units);
            for (const tenancy of tenancies.list()) if (tenancy.endsAtSimulationTime <= clock.simulationTime && tenancy.status !== 'ended') tenancies.assessRent(tenancy.tenancyId, clock.simulationTime);
            for (const order of readRentJournal<NativeRentOrder>(this.db, 'housing_native')) {
                if (order.phase === 'active' && order.binding.intent.endsAt <= clock.simulationTime) writeRentJournal(this.db, 'housing_native', { ...order, phase: 'closed' });
                else if (['reserved', 'active'].includes(order.phase) && (order.binding.intent.bedSlotId === intent.bedSlotId || order.binding.intent.tenant.agentId === intent.tenant.agentId))
                    throw new Error('Rent bed slot or tenant is already reserved');
            }
            if (tenancies.list().some(t => ['active', 'arrears'].includes(t.status) && (t.bedSlotId === intent.bedSlotId || t.tenantAgentId === intent.tenant.agentId))) throw new Error('Rent bed slot or tenant is occupied');
            writeRentJournal(this.db, 'housing_native', { binding, phase: 'reserved', nativeDigest: null });
        }).immediate(); return this.get(intent.operationId)!;
    }
    finalize(id: string): NativeRentOrder {
        const order = this.get(id); if (!order) throw new Error('Unknown rent order');
        const receipt = openNativeRentReceipt(this.options, order.binding);
        if (!receipt) throw new Error('Rent payment pending; transport ACK is not proof');
        if (order.phase !== 'reserved') { if (order.nativeDigest !== receipt.digest) throw new Error('Rent terminal proof differs'); return order; }
        this.db.transaction(() => {
            readRentJournal(this.db, 'housing_native'); const i = order.binding.intent, ids = rentIds(id);
            if (receipt.phase === 'paid') {
                const tenancies = new HousingTenancyStore(this.db, i.catalogs.units);
                tenancies.createPaidPeriod({ tenancyId: ids.tenancyId, housingUnitId: i.housingUnitId, bedSlotId: i.bedSlotId,
                    tenantAgentId: i.tenant.agentId, startsAtSimulationTime: i.startsAt }, { paymentId: ids.escrowId, amountGp: i.amountGp,
                    sourceDigest: receipt.digest, occurredAtSimulationTime: receipt.clock.simulationTime }, () => true);
            }
            writeRentJournal(this.db, 'housing_native', { ...order, phase: receipt.phase === 'paid' ? 'active' : 'cancelled', nativeDigest: receipt.digest });
        }).immediate(); return this.get(id)!;
    }
}
