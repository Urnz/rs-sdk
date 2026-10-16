import { foodLoopClosureDigest } from '../food-loop/closure.js';
import { needsStateDigest } from '../needs/profile.js';
import type { FoodLoopCatalog, ClosedFoodLoop } from '../food-loop/types.js';
import { integer, sum, timestamp } from './policy.js';
import { requireEvidence as check, same, type LedgerData } from './sources.js';

export function foodObservations(data: LedgerData, catalog: FoodLoopCatalog, clockId: string,
    needs: { policyId: string; version: string; digest: string }) {
    const tables = data.tables, closures = tables.food_loop_closure!, events = tables.food_consumption_event!,
        receipts = tables.food_receipt_use!, audits = tables.audit!;
    check(events.length === closures.length && receipts.length === closures.length * 3 && audits.length === closures.length,
        'Food ledger rows are incomplete');
    const observations = closures.map(row => {
        const closure = JSON.parse(row.closure_json) as ClosedFoodLoop, { digest, ...definition } = closure;
        const chain = catalog.chains.find(item => item.foodChainId === closure.foodChainId);
        check(digest === foodLoopClosureDigest(definition) && row.closure_digest === digest && chain
            && closure.catalogDigest === catalog.digest && row.catalog_digest === catalog.digest
            && row.actor_agent_id === closure.actorAgentId && row.food_chain_id === closure.foodChainId
            && row.occurred_at === closure.occurredAtSimulationTime && row.closure_id === closure.closureId, 'Invalid food closure');
        timestamp(closure.occurredAtSimulationTime);
        const { digest: stateDigest, ...state } = closure.state;
        check(needsStateDigest(state) === stateDigest && state.clockId === clockId
            && state.characterAgentId === closure.actorAgentId && state.observedAtSimulationTime === closure.occurredAtSimulationTime,
        'Food needs/clock binding differs');
        check(same(state.policy, { policyId: needs.policyId, version: needs.version, digest: needs.digest }), 'Food needs policy differs');
        const effectiveRelief = integer(closure.hungerBefore) - integer(closure.hungerAfter);
        check(effectiveRelief >= 0 && effectiveRelief <= chain.hungerRelief && closure.hungerRelief === effectiveRelief
            && closure.hungerAfter === Math.max(0, closure.hungerBefore - chain.hungerRelief)
            && state.values.find(item => item.needId === 'hunger')?.value === closure.hungerAfter, 'Food relief differs from effective delta');
        check(closure.receiptIds.length === 3 && new Set(closure.receiptIds).size === 3
            && closure.receiptSourceDigests.length === 3, 'Invalid food receipt references');
        for (let ordinal = 0; ordinal < 3; ordinal++) check(receipts.some(receipt => receipt.closure_id === closure.closureId
            && receipt.ordinal === ordinal && receipt.receipt_id === closure.receiptIds[ordinal]
            && /^[0-9a-f]{64}$/.test(receipt.source_digest) && receipt.source_digest === closure.receiptSourceDigests[ordinal]),
        'Food receipt binding differs');
        const event = events.find(item => item.closure_id === closure.closureId), audit = audits.find(item => item.closureId === closure.closureId);
        check(event && audit && same(event, { event_id: `${closure.closureId}:consumption`, closure_id: closure.closureId,
            closure_digest: digest, actor_agent_id: closure.actorAgentId, item_id: chain.cookedItem.itemId,
            item_name: chain.cookedItem.name, quantity: 1, hunger_relief: effectiveRelief, occurred_at: closure.occurredAtSimulationTime })
            && same(audit, { action: 'food-consumed', closureId: closure.closureId, at: closure.occurredAtSimulationTime,
                detail: { eventId: event.event_id, closureDigest: digest, actorAgentId: closure.actorAgentId,
                    itemId: chain.cookedItem.itemId, quantity: 1, hungerRelief: effectiveRelief } }), 'Food event/audit differs');
        return { actor: closure.actorAgentId, chainId: chain.foodChainId, at: timestamp(closure.occurredAtSimulationTime),
            effectiveRelief, closureId: closure.closureId, closureDigest: digest,
            rawItemId: chain.rawItem.itemId, receiptIds: closure.receiptIds };
    });
    check(new Set(observations.map(item => item.closureId)).size === observations.length, 'Duplicate food closures');
    // Touch sums here so overflow invalidates the source instead of returning rounded observations.
    sum(observations.map(item => item.effectiveRelief));
    return observations.sort((a, b) => a.at - b.at || a.closureId.localeCompare(b.closureId));
}
