import { createHash } from 'node:crypto';
import { needsPolicyDigest, needsStateDigest } from '../needs/profile.js';
import type { NeedsPolicy, NeedsState, NeedsStateDefinition } from '../needs/types.js';
import { foodLoopCatalogDigest } from './catalog.js';
import type { ClosedFoodLoop, FoodInventoryReceipt, FoodLoopCatalog } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
export function foodLoopClosureDigest(value: Omit<ClosedFoodLoop, 'digest'>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function time(value: string, field: string): number { const parsed = Date.parse(value);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${field} must be canonical UTC ISO`);
    return parsed; }
function receipt(value: FoodInventoryReceipt, kind: FoodInventoryReceipt['kind']): FoodInventoryReceipt {
    if (!value || value.kind !== kind || !ID.test(value.receiptId) || !ID.test(value.actorAgentId)
        || !/^[0-9a-f]{64}$/.test(value.sourceDigest) || !Array.isArray(value.inputs) || !Array.isArray(value.outputs)) {
        throw new Error(`${kind} receipt is invalid`);
    }
    time(value.occurredAtSimulationTime, `${kind} receipt time`);
    for (const entry of [...value.inputs, ...value.outputs]) {
        if (!Number.isSafeInteger(entry.itemId) || entry.itemId < 0 || entry.itemId > 65_535
            || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 28) {
            throw new Error(`${kind} receipt item is invalid`);
        }
    }
    return value;
}
function exactItems(actual: FoodInventoryReceipt['inputs'], expected: Array<{ itemId: number; quantity: number }>,
    field: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${field} does not match the food chain`);
}
export function closeFoodLoop(input: { closureId: string; foodChainId: string; state: NeedsState;
    gathered: FoodInventoryReceipt; processed: FoodInventoryReceipt; consumed: FoodInventoryReceipt },
catalog: FoodLoopCatalog, policy: NeedsPolicy): ClosedFoodLoop {
    if (!ID.test(input.closureId)) throw new Error('Closure id is invalid');
    const { digest: catalogHash, ...catalogDefinition } = catalog;
    if (catalogHash !== foodLoopCatalogDigest(catalogDefinition)) throw new Error('Food loop catalog digest mismatch');
    const { digest: policyHash, ...policyDefinition } = policy;
    if (policyHash !== needsPolicyDigest(policyDefinition)) throw new Error('Needs policy digest mismatch');
    const { digest: stateHash, ...stateDefinition } = input.state;
    if (stateHash !== needsStateDigest(stateDefinition)) throw new Error('Needs state digest mismatch');
    if (input.state.policy.digest !== policy.digest) throw new Error('Needs state uses another policy');
    const chain = catalog.chains.find(item => item.foodChainId === input.foodChainId);
    if (!chain) throw new Error('Unknown food chain');
    const gathered = receipt(input.gathered, 'gathered'), processed = receipt(input.processed, 'processed');
    const consumed = receipt(input.consumed, 'consumed');
    if (new Set([gathered.receiptId, processed.receiptId, consumed.receiptId]).size !== 3) {
        throw new Error('Food receipts must be distinct');
    }
    if ([gathered, processed, consumed].some(item => item.actorAgentId !== input.state.characterAgentId)) {
        throw new Error('Food receipt actor does not own the needs state');
    }
    if (gathered.skill !== chain.rawItem.sourceSkill || processed.skill !== chain.processingSkill
        || consumed.skill !== null) throw new Error('Food receipt skill does not match the food chain');
    exactItems(gathered.inputs, [], 'Gather inputs');
    exactItems(gathered.outputs, [{ itemId: chain.rawItem.itemId, quantity: 1 }], 'Gather outputs');
    exactItems(processed.inputs, [{ itemId: chain.rawItem.itemId, quantity: 1 }], 'Processing inputs');
    exactItems(processed.outputs, [{ itemId: chain.cookedItem.itemId, quantity: 1 }], 'Processing outputs');
    exactItems(consumed.inputs, [{ itemId: chain.cookedItem.itemId, quantity: 1 }], 'Consumption inputs');
    exactItems(consumed.outputs, [], 'Consumption outputs');
    const times = [gathered, processed, consumed].map(item => time(item.occurredAtSimulationTime, 'Receipt time'));
    if (times[0]! > times[1]! || times[1]! > times[2]!
        || time(input.state.observedAtSimulationTime, 'Needs observation time') > times[2]!) {
        throw new Error('Food receipts are not in causal simulation-time order');
    }
    const hunger = input.state.values.find(item => item.needId === 'hunger');
    if (!hunger) throw new Error('Needs state has no hunger value');
    const hungerAfter = Math.max(0, hunger.value - chain.hungerRelief);
    const nextDefinition: NeedsStateDefinition = { ...stateDefinition,
        observedAtSimulationTime: consumed.occurredAtSimulationTime,
        values: input.state.values.map(item => item.needId === 'hunger' ? { ...item, value: hungerAfter } : { ...item }) };
    const state: NeedsState = { ...nextDefinition, digest: needsStateDigest(nextDefinition) };
    const definition = { schemaVersion: 1 as const, closureId: input.closureId, foodChainId: chain.foodChainId,
        actorAgentId: input.state.characterAgentId, catalogDigest: catalog.digest,
        previousNeedsStateDigest: input.state.digest,
        receiptIds: [gathered.receiptId, processed.receiptId, consumed.receiptId] as [string, string, string],
        receiptSourceDigests: [gathered.sourceDigest, processed.sourceDigest, consumed.sourceDigest] as
            [string, string, string],
        hungerBefore: hunger.value, hungerRelief: hunger.value - hungerAfter, hungerAfter,
        occurredAtSimulationTime: consumed.occurredAtSimulationTime, state };
    return { ...definition, digest: foodLoopClosureDigest(definition) };
}
