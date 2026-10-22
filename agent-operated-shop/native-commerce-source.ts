import { join } from 'node:path';
import { OwnedDatabase } from '../server/engine/src/io/OwnedDatabase.js';
import { assertNativeFoodDomainPath, assertNativeFoodPath } from '../food-loop/native-source.js';
import { readFoodCommerce, commerceIds, type FoodCommerceBinding, type FoodCommerceOrder } from './native-commerce.js';
import { foodDigest } from '../server/engine/src/mods/NativeFoodConsumptionStore.js';
import { loadBusinessStockPolicyCatalog, decideBusinessStock, authorizeStockMovement } from '../business-stock-policy/index.js';
import { loadSaleChannelPolicyCatalog, assertAcceptedBusinessAcquisition, assertAcceptedPlayerTrade } from '../sale-channel-policy/index.js';
import { loadNativeKitchenPolicy } from '../production-workflow/native-kitchen-policy.js';
import { authorizeFacilityCapability } from '../facility-capability/authorization.js';
import { loadFacilityCapabilityCatalog } from '../facility-capability/catalog.js';
import { businessRoleHasPermission, resolveBusinessRole, loadDefaultBusinessRoleCatalog } from '../business-roles/index.js';
import type { SimulationClockObservation } from '../simulation-clock/types.js';
import { readNativeCommerce, type NativeCommerceRecord } from '../server/engine/src/mods/NativeCommerceStore.js';
import { readNativeTradeLedger } from '../external-trade/source.js';

export interface FoodCommerceOptions { workspace: string; worldId: string; businessPath: string; treasuryPath: string;
    checkpointPath: string; tradePath: string; journalPath: string }
export const commerceCatalogs = (workspace: string) => ({
    stock: loadBusinessStockPolicyCatalog(join(workspace, 'config/business-stock-policies.json')),
    channels: loadSaleChannelPolicyCatalog(join(workspace, 'config/sale-channel-policies.json'))
});
export function authorizeCommerce(db: OwnedDatabase, binding: FoodCommerceBinding, clock: SimulationClockObservation, workspace: string): void {
    const i = binding.intent, catalogs = commerceCatalogs(workspace), policy = catalogs.stock.policies.find(p => p.policyId === i.decision.policyId);
    if (!policy || i.decision.policyDigest !== catalogs.stock.digest || i.catalogs.stock.digest !== catalogs.stock.digest
        || i.catalogs.channels.digest !== catalogs.channels.digest
        || foodDigest(decideBusinessStock(policy, catalogs.stock, i.decision.observedStock)) !== foodDigest(i.decision)
        || policy.businessId !== i.businessId || policy.itemId !== i.itemId) throw new Error('Food commerce stock price/policy is stale');
    authorizeStockMovement(policy, i.decision, { kind: 'trusted-settlement', evidenceId: commerceIds(i.operationId).tradeId,
        status: 'committed', businessId: i.businessId, itemId: i.itemId, quantity: i.quantity, unitPriceGp: i.unitPriceGp,
        direction: i.kind, occurredAt: clock.wallTime }, () => true); // Admission only; finalization separately requires the native source.
    const expected = { offerId: commerceIds(i.operationId).tradeId, itemId: i.itemId, quantity: i.quantity, policyDigest: catalogs.channels.digest };
    if (i.kind === 'procurement') {
        assertAcceptedBusinessAcquisition(i.channel, { ...expected, businessId: i.businessId });
        if (i.channel.offer.sellerAgentId !== i.counterparty.agentId) throw new Error('Food procurement seller differs');
    } else assertAcceptedPlayerTrade(i.channel, { ...expected, buyerAgentId: i.counterparty.agentId, sellerAgentId: i.worker.agentId,
        assetId: null, provenanceDigest: null });
    const business = db.query("SELECT * FROM business WHERE business_id=?1 AND status='active'").get(i.businessId) as { owner_agent_id: string } | null;
    if (!business) throw new Error('Food commerce Business is inactive');
    if (business.owner_agent_id !== i.worker.agentId) {
        const employment = db.query("SELECT role_definition_id FROM business_employment WHERE business_id=?1 AND worker_agent_id=?2 AND status='active'")
            .get(i.businessId, i.worker.agentId) as { role_definition_id: string } | null;
        const role = employment && resolveBusinessRole(loadDefaultBusinessRoleCatalog(), employment.role_definition_id);
        if (!role || !businessRoleHasPermission(role, 'inventory', i.kind === 'sale' ? 'issue' : 'receive')
            || !businessRoleHasPermission(role, 'logistics', 'operate')) throw new Error('Food commerce worker role is not entitled');
    }
    const kitchen = loadNativeKitchenPolicy(workspace);
    if (i.facilityPolicyDigest !== foodDigest(kitchen) || clock.clockId !== i.clockId || clock.profileDigest !== i.clockProfileDigest
        || clock.status !== 'running' || !Number.isFinite(Date.parse(clock.wallTime))
        || Date.parse(clock.wallTime) >= Date.parse(i.expiresAt)) throw new Error('Food commerce grant/clock expired or changed');
    const access = authorizeFacilityCapability(loadFacilityCapabilityCatalog(join(workspace, 'config/facility-capabilities.json')),
        { subjectAgentId: i.worker.agentId, facilityId: kitchen.facilityId, capabilityId: 'storage.secure', at: clock.simulationTime },
        [i.grant], grant => foodDigest(grant) === foodDigest(i.grant));
    if (access.businessId !== null && access.businessId !== i.businessId) throw new Error('Food commerce facility Business differs');
}
export class FoodCommerceSource {
    readonly db: OwnedDatabase;
    constructor(readonly options: FoodCommerceOptions) {
        assertNativeFoodDomainPath({ ...options, checkpointPath: options.businessPath });
        this.db = new OwnedDatabase(options.businessPath, { readonly: true, strict: true });
    }
    close(): void { this.db.close(true); }
    order(id: string, clock?: SimulationClockObservation): FoodCommerceOrder {
        let result!: FoodCommerceOrder;
        this.db.transaction(() => {
            const order = readFoodCommerce(this.db).find(row => row.binding.intent.operationId === id);
            if (!order || order.binding.intent.worldId !== this.options.worldId) throw new Error('Food commerce binding/world unavailable');
            if (clock) {
                if (order.phase !== 'prepared') throw new Error('Food commerce order is closed');
                authorizeCommerce(this.db, order.binding, clock, this.options.workspace);
                const i = order.binding.intent, ids = commerceIds(i.operationId);
                if (i.kind === 'sale') {
                    const row = this.db.query('SELECT * FROM business_stock_native_reservation WHERE reservation_id=?1').get(ids.stockId) as Record<string, unknown> | null;
                    if (!row || row.status !== 'held' || row.binding_digest !== order.binding.digest || row.business_id !== i.businessId
                        || row.item_id !== i.itemId || row.quantity !== i.quantity) throw new Error('Food commerce stock reservation differs');
                } else {
                    assertNativeFoodDomainPath({ ...this.options, checkpointPath: this.options.treasuryPath });
                    const treasury = new OwnedDatabase(this.options.treasuryPath, { readonly: true, strict: true });
                    try { const r = treasury.query('SELECT * FROM institution_treasury_reservation WHERE reservation_id=?1').get(ids.reservationId) as Record<string, unknown> | null;
                        if (!r || r.status !== 'reserved' || r.settlement_id !== ids.tradeId || r.actor_kind !== 'business'
                            || r.actor_id !== i.businessId || r.amount_gp !== i.quantity * i.unitPriceGp) throw new Error('Food commerce treasury funding differs');
                    } finally { treasury.close(true); }
                }
            }
            result = structuredClone(order);
        }).deferred(); return result;
    }
}
/** A native trade ledger row alone cannot substitute for both checkpoint/custody receipts. */
export function readCommerceResult(options: FoodCommerceOptions, binding: FoodCommerceBinding): NativeCommerceRecord | null {
    assertNativeFoodPath(options); assertNativeFoodPath({ ...options, checkpointPath: options.tradePath });
    const db = new OwnedDatabase(options.checkpointPath, { readonly: true, strict: true });
    try { let result: NativeCommerceRecord | null = null;
        db.transaction(() => {
            const record = readNativeCommerce(db).find(row => row.binding.digest === binding.digest);
            if (!record) return;
            if (record.binding.intent.worldId !== options.worldId) throw new Error('Commerce native world differs');
            const trade = readNativeTradeLedger(options.tradePath).find(t => t.event.eventId === commerceIds(binding.intent.operationId).tradeId);
            if (record.phase === 'completed' && (!trade || foodDigest(trade.event) !== foodDigest(record.trade))) throw new Error('Commerce native trade source gap');
            if (record.phase === 'cancelled' && trade) throw new Error('Committed native trade cannot be refunded');
            result = record;
        }).deferred(); return result;
    } finally { db.close(true); }
}
