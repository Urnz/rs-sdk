import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadFoodLoopCatalog, closeFoodLoop } from '../index.js';
import { createInitialNeedsState, loadNeedsPolicyCatalog, needsStateDigest } from '../../needs/index.js';
import type { FoodInventoryReceipt } from '../types.js';

const policy = () => loadNeedsPolicyCatalog(join(import.meta.dir, '..', '..', 'config', 'needs-policies.json')).policies[0]!;
const catalog = () => loadFoodLoopCatalog(join(import.meta.dir, '..', '..', 'config', 'food-loops.json'));
function state() { const value = createInitialNeedsState(policy(), { characterAgentId: 'ada', clockId: 'world',
    observedAtSimulationTime: '2030-01-01T00:00:00.000Z' });
    const definition = { ...value, values: value.values.map(item => item.needId === 'hunger'
        ? { ...item, value: 4000 } : item) }; delete (definition as Partial<typeof value>).digest;
    return { ...definition, digest: needsStateDigest(definition) }; }
function receipt(kind: FoodInventoryReceipt['kind'], ordinal: number, inputs: FoodInventoryReceipt['inputs'],
    outputs: FoodInventoryReceipt['outputs'], skill: FoodInventoryReceipt['skill']): FoodInventoryReceipt {
    return { receiptId: `${kind}-${ordinal}`, actorAgentId: 'ada', kind,
        occurredAtSimulationTime: `2030-01-01T0${ordinal}:00:00.000Z`, skill, inputs, outputs,
        sourceDigest: String(ordinal).repeat(64) };
}
function evidence() { return {
    gathered: receipt('gathered', 1, [], [{ itemId: 377, quantity: 1 }], 'Fishing'),
    processed: receipt('processed', 2, [{ itemId: 377, quantity: 1 }], [{ itemId: 379, quantity: 1 }], 'Cooking'),
    consumed: receipt('consumed', 3, [{ itemId: 379, quantity: 1 }], [], null) }; }

describe('closed food economy loop', () => {
    test('binds Fishing, Cooking and actual consumption to hunger relief', () => {
        const result = closeFoodLoop({ closureId: 'closure-1', foodChainId: 'lobster', state: state(), ...evidence() },
            catalog(), policy());
        expect(result).toMatchObject({ foodChainId: 'lobster', actorAgentId: 'ada', hungerBefore: 4000,
            hungerRelief: 1800, hungerAfter: 2200, receiptIds: ['gathered-1', 'processed-2', 'consumed-3'] });
        expect(result.receiptSourceDigests).toEqual(['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)]);
        expect(result.state.values.find(item => item.needId === 'hunger')?.value).toBe(2200);
        expect(result.state.observedAtSimulationTime).toBe('2030-01-01T03:00:00.000Z');
        expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('clamps relief at zero without changing unrelated needs', () => {
        const initial = state(), beforeFatigue = initial.values.find(item => item.needId === 'fatigue')!;
        const definition = { ...initial, values: initial.values.map(item => item.needId === 'hunger'
            ? { ...item, value: 1000 } : item) }; delete (definition as Partial<typeof initial>).digest;
        const low = { ...definition, digest: needsStateDigest(definition) };
        const result = closeFoodLoop({ closureId: 'closure-2', foodChainId: 'lobster', state: low, ...evidence() },
            catalog(), policy());
        expect(result).toMatchObject({ hungerBefore: 1000, hungerRelief: 1000, hungerAfter: 0 });
        expect(result.state.values.find(item => item.needId === 'fatigue')).toEqual(beforeFatigue);
    });

    test('rejects invented outputs, wrong skills and another actor receipts', () => {
        const valid = evidence();
        expect(() => closeFoodLoop({ closureId: 'closure-3', foodChainId: 'lobster', state: state(), ...valid,
            processed: { ...valid.processed, outputs: [{ itemId: 315, quantity: 1 }] } }, catalog(), policy()))
            .toThrow('Processing outputs');
        expect(() => closeFoodLoop({ closureId: 'closure-3', foodChainId: 'lobster', state: state(), ...valid,
            processed: { ...valid.processed, skill: 'Fishing' } }, catalog(), policy())).toThrow('skill');
        expect(() => closeFoodLoop({ closureId: 'closure-3', foodChainId: 'lobster', state: state(), ...valid,
            consumed: { ...valid.consumed, actorAgentId: 'bob' } }, catalog(), policy())).toThrow('does not own');
    });

    test('rejects receipt reuse, reversed time and changed trusted state evidence', () => {
        const valid = evidence();
        expect(() => closeFoodLoop({ closureId: 'closure-4', foodChainId: 'lobster', state: state(), ...valid,
            consumed: { ...valid.consumed, receiptId: valid.processed.receiptId } }, catalog(), policy()))
            .toThrow('distinct');
        expect(() => closeFoodLoop({ closureId: 'closure-4', foodChainId: 'lobster', state: state(), ...valid,
            processed: { ...valid.processed, occurredAtSimulationTime: '2030-01-01T04:00:00.000Z' } },
        catalog(), policy())).toThrow('causal');
        expect(() => closeFoodLoop({ closureId: 'closure-4', foodChainId: 'lobster',
            state: { ...state(), digest: '0'.repeat(64) }, ...valid }, catalog(), policy())).toThrow('state digest');
    });
});
