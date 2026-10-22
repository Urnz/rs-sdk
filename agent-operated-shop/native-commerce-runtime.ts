import { join } from 'node:path';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { InstitutionTreasuryStore } from '../server/gateway/admin/institution-treasury.js';
import { BusinessStockSettlementStore, decideBusinessStock } from '../business-stock-policy/index.js';
import { AgentOperatedShopLifecycle } from './lifecycle.js';
import { commerceIds, initializeFoodCommerce, readFoodCommerce, writeFoodCommerce, validateCommerceIntent,
    type FoodCommerceIntent, type FoodCommerceOrder } from './native-commerce.js';
import { authorizeCommerce, readCommerceResult, type FoodCommerceOptions } from './native-commerce-source.js';
import { assertNativeFoodDomainPath } from '../food-loop/native-source.js';
import { authorizeFacilityCapability, type FacilityGrantVerifier } from '../facility-capability/authorization.js';
import { loadFacilityCapabilityCatalog } from '../facility-capability/catalog.js';
import { loadNativeKitchenPolicy } from '../production-workflow/native-kitchen-policy.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';

export class FoodCommerceCoordinator {
    private readonly db: OwnedDatabase;
    private readonly stock: BusinessStockSettlementStore;
    constructor(readonly options: FoodCommerceOptions) {
        for (const path of [options.businessPath, options.treasuryPath, options.journalPath]) assertNativeFoodDomainPath({ ...options, checkpointPath: path });
        this.db = new OwnedDatabase(options.businessPath, { strict: true });
        try { this.db.run('PRAGMA busy_timeout=5000'); initializeFoodCommerce(this.db); this.stock = new BusinessStockSettlementStore(this.db); }
        catch (error) { this.db.close(true); throw error; }
    }
    close(): void { this.db.close(true); }
    get(id: string): FoodCommerceOrder | null { let result!: FoodCommerceOrder | null;
        this.db.transaction(() => { result = readFoodCommerce(this.db).find(o => o.binding.intent.operationId === id) ?? null; }).deferred(); return result; }
    prepare(intent: FoodCommerceIntent, clock: SimulationClockObservation, verifyGrant: FacilityGrantVerifier): FoodCommerceOrder {
        validateCommerceIntent(intent);
        const binding = { intent: structuredClone(intent), digest: foodDigest(intent) }, i = binding.intent, ids = commerceIds(i.operationId);
        this.db.transaction(() => {
            const prior = this.get(i.operationId);
            if (prior) {
                if (prior.binding.digest !== binding.digest) throw new Error('Food commerce operation id reused');
                if (prior.phase === 'prepared') {
                    authorizeCommerce(this.db, binding, clock, this.options.workspace);
                    const kitchen = loadNativeKitchenPolicy(this.options.workspace);
                    authorizeFacilityCapability(loadFacilityCapabilityCatalog(join(this.options.workspace, 'config/facility-capabilities.json')),
                        { subjectAgentId: i.worker.agentId, facilityId: kitchen.facilityId, capabilityId: 'storage.secure', at: clock.simulationTime }, [i.grant], verifyGrant);
                }
                return;
            }
            authorizeCommerce(this.db, binding, clock, this.options.workspace);
            if (i.worldId !== this.options.worldId || Date.parse(i.expiresAt) - Date.parse(clock.wallTime) > 600000)
                throw new Error('Food commerce world/deadline differs');
            const policy = i.catalogs.stock.policies.find(p => p.policyId === i.decision.policyId)!;
            const stock = (this.db.query('SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=?2').get(i.businessId, i.itemId) as { count: number } | null)?.count ?? 0;
            if (foodDigest(decideBusinessStock(policy, i.catalogs.stock, stock)) !== foodDigest(i.decision)) throw new Error('Food commerce stock observation is stale');
            const pending = readFoodCommerce(this.db).filter(o => o.phase === 'prepared' && o.binding.intent.kind === 'procurement'
                && o.binding.intent.businessId === i.businessId && o.binding.intent.itemId === i.itemId).reduce((n, o) => n + o.binding.intent.quantity, 0);
            if (i.kind === 'procurement' && stock + pending + i.quantity > policy.targetStock) throw new Error('Food procurement exceeds finite target stock');
            const kitchen = loadNativeKitchenPolicy(this.options.workspace);
            authorizeFacilityCapability(loadFacilityCapabilityCatalog(join(this.options.workspace, 'config/facility-capabilities.json')),
                { subjectAgentId: i.worker.agentId, facilityId: kitchen.facilityId, capabilityId: 'storage.secure', at: clock.simulationTime }, [i.grant], verifyGrant);
            if (i.kind === 'sale') this.stock.reserveNative(ids.stockId, i.businessId, i.itemId, i.quantity, binding.digest, clock.wallTime);
            writeFoodCommerce(this.db, { binding, phase: 'prepared', nativeDigest: null });
        }).immediate();
        const order = this.get(i.operationId)!;
        if (i.kind === 'procurement' && order.phase === 'prepared') {
            const treasury = new InstitutionTreasuryStore(this.options.treasuryPath);
            try { const held = treasury.reserve('business', i.businessId, ids.reservationId, i.quantity * i.unitPriceGp, clock.wallTime);
                if (held.reservation.status !== 'reserved') throw new Error('Food procurement funding is not available');
                treasury.bindSettlement(ids.reservationId, ids.tradeId, clock.wallTime);
            } finally { treasury.close(); }
        }
        return order;
    }
    finalize(id: string): FoodCommerceOrder {
        const order = this.get(id); if (!order) throw new Error('Food commerce order does not exist');
        const native = readCommerceResult(this.options, order.binding);
        if (!native || native.phase === 'admitted') throw new Error('Native commerce is pending or uncertain; reconciliation required');
        if (order.phase !== 'prepared') {
            if (order.nativeDigest !== native.digest) throw new Error('Food commerce terminal native digest differs'); return order;
        }
        const i = order.binding.intent, ids = commerceIds(id);
        if (native.phase === 'cancelled') {
            if (i.kind === 'sale') this.db.transaction(() => {
                readFoodCommerce(this.db); this.stock.cancelNative(ids.stockId, order.binding.digest, native.trade?.committedAt ?? new Date().toISOString());
                writeFoodCommerce(this.db, { ...order, phase: 'cancelled', nativeDigest: native.digest });
            }).immediate();
            else {
                // Native cancellation proves no exchange; the ordinary blind-release API remains locked.
                const treasury = new InstitutionTreasuryStore(this.options.treasuryPath);
                try { if (treasury.getReservation(ids.reservationId)) treasury.releaseCancelledFood(ids.reservationId, ids.tradeId,
                    () => readCommerceResult(this.options, order.binding)?.phase === 'cancelled'); }
                finally { treasury.close(); }
                this.db.transaction(() => { readFoodCommerce(this.db); writeFoodCommerce(this.db, { ...order, phase: 'cancelled', nativeDigest: native.digest }); }).immediate();
            }
        } else {
            const trade = native.trade!, occurredAt = trade.committedAt;
            const stockReceipt = this.db.query('SELECT 1 FROM business_stock_settlement WHERE settlement_id=?1').get(ids.stockId);
            if (i.kind === 'procurement' && !stockReceipt) {
                const policy = i.catalogs.stock.policies.find(p => p.policyId === i.decision.policyId)!;
                const current = (this.db.query('SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=?2').get(i.businessId, i.itemId) as { count: number } | null)?.count ?? 0;
                if (current + i.quantity > policy.maximumStock) throw new Error('Native incoming stock exceeds Business capacity; reconciliation required');
            }
            const lifecycle = new AgentOperatedShopLifecycle(this.options.journalPath, this.options.businessPath, this.options.treasuryPath, i.catalogs.stock, i.catalogs.channels);
            try { lifecycle.settleStock({ operationId: ids.stockId, kind: i.kind, policyId: i.decision.policyId, decision: i.decision,
                stockEvidence: { kind: 'trusted-settlement', evidenceId: ids.tradeId, status: 'committed', businessId: i.businessId,
                    itemId: i.itemId, quantity: i.quantity, unitPriceGp: i.unitPriceGp, direction: i.kind, occurredAt },
                stockSettlementId: ids.stockId, moneyEvidence: { settlementId: ids.tradeId, reservationId: i.kind === 'procurement' ? ids.reservationId : null,
                    amountGp: i.quantity * i.unitPriceGp, sourceRef: `trade:${ids.tradeId}`, status: 'committed', occurredAt },
                acquisitionDecision: i.kind === 'procurement' ? i.channel : null,
                ...(i.kind === 'sale' ? { nativeReservation: { id: ids.stockId, bindingDigest: order.binding.digest } } : {}) },
            () => true, () => true, occurredAt); } finally { lifecycle.close(); }
            this.db.transaction(() => { readFoodCommerce(this.db); writeFoodCommerce(this.db, { ...order, phase: 'completed', nativeDigest: native.digest }); }).immediate();
        }
        return this.get(id)!;
    }
    /** Bounded forward settlement only. Uncertain physical commands are never redispatched or refunded here. */
    recover(limit = 25): Array<{ operationId: string; phase: FoodCommerceOrder['phase']; error: string | null }> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid commerce recovery limit');
        let orders: FoodCommerceOrder[] = [];
        this.db.transaction(() => { orders = readFoodCommerce(this.db).filter(o => o.phase === 'prepared').slice(0, limit); }).deferred();
        return orders.map(order => {
            const operationId = order.binding.intent.operationId;
            try { return { operationId, phase: this.finalize(operationId).phase, error: null }; }
            catch (error) { return { operationId, phase: 'prepared', error: error instanceof Error ? error.message : String(error) }; }
        });
    }
}
