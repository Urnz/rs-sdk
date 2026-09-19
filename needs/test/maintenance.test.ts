import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createInitialNeedsState, loadNeedsPolicyCatalog, planSelfMaintenance,
    validateNeedsState, type NeedsPolicy, type NeedsState } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'needs-policies.json');

function setup(values: { hunger: number; fatigue: number }): { policy: NeedsPolicy; state: NeedsState } {
    const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
    const initial = createInitialNeedsState(policy, { characterAgentId: 'ada', clockId: 'local-world',
        observedAtSimulationTime: '2026-09-19T00:00:00.000Z' });
    const { digest: _digest, ...definition } = initial;
    const state = validateNeedsState({ ...definition, values: definition.values.map(value => ({
        ...value, value: values[value.needId as keyof typeof values]
    })) }, policy);
    return { policy, state };
}

const foods = [
    { itemId: 315, inventorySlot: 4, quantity: 2, hungerRelief: 900 },
    { itemId: 333, inventorySlot: 2, quantity: 1, hungerRelief: 1200 },
    { itemId: 329, inventorySlot: 7, quantity: 3, hungerRelief: 1200 }
];

const sleepPlaces = [
    { sleepPlaceId: 'street-corner', available: true, accessAllowed: true,
        fatigueRecoveryPerHour: 300, safetyLevel: 0 },
    { sleepPlaceId: 'inn-bed-2', available: true, accessAllowed: true,
        fatigueRecoveryPerHour: 1000, safetyLevel: 4 },
    { sleepPlaceId: 'private-bed', available: true, accessAllowed: false,
        fatigueRecoveryPerHour: 2000, safetyLevel: 8 }
];

describe('deterministic self-maintenance routine', () => {
    test('does nothing without a critical need and never requests an LLM call', () => {
        const { policy, state } = setup({ hunger: 7999, fatigue: 7999 });
        expect(planSelfMaintenance(state, policy, { foods, sleepPlaces })).toMatchObject({
            kind: 'none', criticalNeedId: null, reasonCode: 'no-critical-need',
            action: null, llmCallRequired: false, decisionSource: 'deterministic-needs-routine'
        });
    });

    test('selects one strongest available food with stable tie-breakers', () => {
        const { policy, state } = setup({ hunger: 8000, fatigue: 0 });
        const first = planSelfMaintenance(state, policy, { foods, sleepPlaces });
        const reordered = planSelfMaintenance(state, policy, { foods: [...foods].reverse(), sleepPlaces });
        expect(first).toEqual(reordered);
        expect(first).toMatchObject({ kind: 'consume-food', criticalNeedId: 'hunger',
            llmCallRequired: false, action: { operation: 'consume-food', itemId: 329,
                inventorySlot: 7, quantity: 1, hungerRelief: 1200 } });
    });

    test('selects only an available accessible sleep place by recovery then safety', () => {
        const { policy, state } = setup({ hunger: 0, fatigue: 9000 });
        const decision = planSelfMaintenance(state, policy, { foods: [], sleepPlaces });
        expect(decision).toMatchObject({ kind: 'seek-sleep-place', criticalNeedId: 'fatigue',
            action: { operation: 'seek-sleep-place', sleepPlaceId: 'inn-bed-2',
                fatigueRecoveryPerHour: 1000 }, llmCallRequired: false });
    });

    test('prioritizes hunger when both core needs are critical', () => {
        const { policy, state } = setup({ hunger: 9000, fatigue: 9000 });
        expect(planSelfMaintenance(state, policy, { foods, sleepPlaces }).kind).toBe('consume-food');
    });

    test('returns a typed blocked decision rather than inventing an action or model call', () => {
        const { policy, state } = setup({ hunger: 8000, fatigue: 0 });
        expect(planSelfMaintenance(state, policy, { foods: [], sleepPlaces: [] })).toMatchObject({
            kind: 'blocked', criticalNeedId: 'hunger', reasonCode: 'critical-resource-unavailable',
            action: null, llmCallRequired: false
        });
    });

    test('rejects duplicate, unbounded and tampered observations', () => {
        const { policy, state } = setup({ hunger: 8000, fatigue: 0 });
        expect(() => planSelfMaintenance(state, policy, { foods: [foods[0]!, foods[0]!], sleepPlaces: [] }))
            .toThrow('inventory slots must be unique');
        expect(() => planSelfMaintenance(state, policy, { foods: [{ ...foods[0]!, inventorySlot: 28 }],
            sleepPlaces: [] })).toThrow('between 0 and 27');
        expect(() => planSelfMaintenance({ ...state, digest: '0'.repeat(64) }, policy,
            { foods, sleepPlaces })).toThrow('state digest does not match');
    });
});
