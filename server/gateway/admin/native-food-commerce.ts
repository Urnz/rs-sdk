import { randomUUID } from 'node:crypto';
import type { AgentPopulationMember } from '../../../agent-state/types.js';
import type { SimulationClockObservation } from '../../../simulation-clock/types.js';
import type { FacilityAccessGrantEvidence } from '../../../facility-capability/types.js';
import type { FacilityGrantVerifier } from '../../../facility-capability/authorization.js';
import { populationNeedsBinding } from './needs-runtime.js';
import { FoodCommerceCoordinator } from '../../../agent-operated-shop/native-commerce-runtime.js';
import { commerceCatalogs, type FoodCommerceOptions } from '../../../agent-operated-shop/native-commerce-source.js';
import { commerceIds, type FoodCommerceIntent, type NativeCommerceCommand, type NativeCommerceResponse } from '../../../agent-operated-shop/native-commerce.js';
import { decideBusinessStock } from '../../../business-stock-policy/index.js';
import { decideSaleChannel } from '../../../sale-channel-policy/index.js';
import { loadNativeKitchenPolicy } from '../../../production-workflow/native-kitchen-policy.js';
import { foodDigest } from '../../engine/src/mods/NativeFoodConsumptionStore.js';
import { OwnedDatabase } from '../../engine/src/io/OwnedDatabase.js';

/** Trusted backend members supply identity. Model/HTTP callers cannot post inventory observations or receipts. */
export function reservePopulationFoodCommerce(options: FoodCommerceOptions, worker: AgentPopulationMember, counterparty: AgentPopulationMember,
    clock: SimulationClockObservation, request: { operationId: string; kind: 'sale' | 'procurement'; businessId: string; quantity: number; unitPriceGp: number; expiresAt: string },
    grant: FacilityAccessGrantEvidence, verify: FacilityGrantVerifier) {
    const actor = (member: AgentPopulationMember) => {
        const binding = populationNeedsBinding(options.worldId, member);
        if (member.status !== 'active' || member.characterLifecycle.status !== 'active' || binding.clockId !== clock.clockId
            || binding.clockProfileDigest !== clock.profileDigest) throw new Error('Food commerce population lifecycle/clock differs');
        return { agentId: member.agentId, username: member.playerUsername, lifecycleId: binding.lifecycleId };
    };
    const coordinator = new FoodCommerceCoordinator(options);
    try {
        const w = actor(worker), c = actor(counterparty), prior = coordinator.get(request.operationId);
        if (prior) {
            const i = prior.binding.intent;
            if (Object.entries(request).some(([key, value]) => i[key as keyof FoodCommerceIntent] !== value)
                || foodDigest(i.worker) !== foodDigest(w) || foodDigest(i.counterparty) !== foodDigest(c) || foodDigest(grant) !== foodDigest(i.grant))
                throw new Error('Food commerce operation id reused');
            return coordinator.prepare(i, clock, verify);
        }
        const catalogs = commerceCatalogs(options.workspace), itemId = request.kind === 'sale' ? 379 : 377;
        const policy = catalogs.stock.policies.find(p => p.businessId === request.businessId && p.itemId === itemId);
        if (!policy) throw new Error('Food commerce stock policy unavailable');
        const db = new OwnedDatabase(options.businessPath, { readonly: true, strict: true });
        let stock: number;
        try { stock = (db.query('SELECT count FROM business_inventory WHERE business_id=?1 AND item_id=?2').get(request.businessId, itemId) as { count: number } | null)?.count ?? 0; }
        finally { db.close(true); }
        return coordinator.prepare({ ...request, worker: w, counterparty: c, worldId: options.worldId, clockId: clock.clockId, clockProfileDigest: clock.profileDigest,
            itemId, decision: decideBusinessStock(policy, catalogs.stock, stock), catalogs, grant,
            facilityPolicyDigest: foodDigest(loadNativeKitchenPolicy(options.workspace)),
            channel: decideSaleChannel(catalogs.channels, { offerId: commerceIds(request.operationId).tradeId,
                channel: request.kind === 'sale' ? 'player-trade' : 'business-shop', sellerAgentId: request.kind === 'sale' ? w.agentId : c.agentId,
                acquirer: { kind: request.kind === 'sale' ? 'agent' : 'business', id: request.kind === 'sale' ? c.agentId : request.businessId },
                itemId, quantity: request.quantity, assetId: null, provenanceDigest: null }, []) }, clock, verify);
    } finally { coordinator.close(); }
}
export async function requestNativeFoodCommerce(command: NativeCommerceCommand): Promise<NativeCommerceResponse> {
    const token = process.env.ENGINE_ADMIN_TOKEN?.trim(); if (!token) throw new Error('Native commerce engine channel unavailable');
    const url = new URL('/api/internal/admin/native-food-commerce', process.env.ENGINE_ADMIN_URL?.trim() ?? 'http://localhost:8888');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Native commerce requires a local/private engine');
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engine-Admin-Token': token },
        body: JSON.stringify({ commandId: randomUUID(), operation: command.operation, operationId: command.operationId }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as NativeCommerceResponse;
    if (!response.ok || !result.ok) throw new Error(result.ok ? 'Native commerce request failed' : result.error);
    return result;
}
/** Timeout/ACK is never settlement evidence; this reopens canonical native checkpoints and audited trade evidence. */
export function finalizePopulationFoodCommerce(options: FoodCommerceOptions, operationId: string) {
    const coordinator = new FoodCommerceCoordinator(options); try { return coordinator.finalize(operationId); } finally { coordinator.close(); }
}

/** Forward-only closure through the engine's serialized cancel/execute journal.
 * The terminal canonical record, never its transport ACK, authorizes settlement. */
export async function reconcilePopulationFoodCommerce(options: FoodCommerceOptions, operationId: string,
    cancelPending = false, request = requestNativeFoodCommerce) {
    try { return finalizePopulationFoodCommerce(options, operationId); }
    catch (error) {
        if (!cancelPending || !(error instanceof Error)
            || error.message !== 'Native commerce is pending or uncertain; reconciliation required') throw error;
        await request({ operation: 'cancel', operationId });
        return finalizePopulationFoodCommerce(options, operationId);
    }
}
