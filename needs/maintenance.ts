import { createHash } from 'node:crypto';
import { validateNeedsState } from './profile.js';
import type { AvailableFoodCandidate, AvailableSleepPlaceCandidate, NeedsPolicy,
    NeedsPolicyDefinition, NeedsState, SelfMaintenanceDecision, SelfMaintenanceDecisionDefinition,
    SelfMaintenanceObservation } from './types.js';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

function decision(definition: SelfMaintenanceDecisionDefinition): SelfMaintenanceDecision {
    const digest = createHash('sha256').update(JSON.stringify(canonical(definition))).digest('hex');
    return { ...definition, digest };
}

function validateFood(value: unknown, index: number): AvailableFoodCandidate {
    const field = `foods[${index}]`, input = record(value, field);
    exact(input, ['itemId', 'inventorySlot', 'quantity', 'hungerRelief'], field);
    return { itemId: integer(input.itemId, `${field}.itemId`, 0, 2_147_483_647),
        inventorySlot: integer(input.inventorySlot, `${field}.inventorySlot`, 0, 27),
        quantity: integer(input.quantity, `${field}.quantity`, 1, 2_147_483_647),
        hungerRelief: integer(input.hungerRelief, `${field}.hungerRelief`, 1, 1_000_000) };
}

function validateSleepPlace(value: unknown, index: number): AvailableSleepPlaceCandidate {
    const field = `sleepPlaces[${index}]`, input = record(value, field);
    exact(input, ['sleepPlaceId', 'available', 'accessAllowed', 'fatigueRecoveryPerHour', 'safetyLevel'], field);
    if (typeof input.sleepPlaceId !== 'string' || !ID.test(input.sleepPlaceId)
        || typeof input.available !== 'boolean' || typeof input.accessAllowed !== 'boolean') {
        throw new Error(`${field} identity or availability is invalid`);
    }
    return { sleepPlaceId: input.sleepPlaceId, available: input.available,
        accessAllowed: input.accessAllowed,
        fatigueRecoveryPerHour: integer(input.fatigueRecoveryPerHour,
            `${field}.fatigueRecoveryPerHour`, 1, 100_000),
        safetyLevel: integer(input.safetyLevel, `${field}.safetyLevel`, 0, 10) };
}

function validateObservation(value: unknown): SelfMaintenanceObservation {
    const input = record(value, 'Self-maintenance observation');
    exact(input, ['foods', 'sleepPlaces'], 'Self-maintenance observation');
    if (!Array.isArray(input.foods) || !Array.isArray(input.sleepPlaces)
        || input.foods.length > 28 || input.sleepPlaces.length > 128) {
        throw new Error('Self-maintenance candidate collections are invalid');
    }
    const foods = input.foods.map(validateFood), sleepPlaces = input.sleepPlaces.map(validateSleepPlace);
    if (new Set(foods.map(item => item.inventorySlot)).size !== foods.length) {
        throw new Error('Food inventory slots must be unique');
    }
    if (new Set(sleepPlaces.map(item => item.sleepPlaceId)).size !== sleepPlaces.length) {
        throw new Error('Sleep place identities must be unique');
    }
    return { foods, sleepPlaces };
}

export function planSelfMaintenance(stateValue: NeedsState,
    policy: NeedsPolicyDefinition | NeedsPolicy, observationValue: SelfMaintenanceObservation): SelfMaintenanceDecision {
    const { digest: supplied, ...stateDefinition } = stateValue;
    const state = validateNeedsState(stateDefinition, policy);
    if (supplied !== state.digest) throw new Error('Validated needs state digest does not match');
    const observation = validateObservation(observationValue);
    const critical = (['hunger', 'fatigue'] as const).find(needId => {
        const threshold = policy.needs.find(need => need.needId === needId)?.criticalThreshold;
        const value = state.values.find(item => item.needId === needId)?.value;
        return threshold !== undefined && value !== undefined && value >= threshold;
    });
    const base = { decisionSource: 'deterministic-needs-routine' as const, llmCallRequired: false as const,
        stateDigest: state.digest };
    if (!critical) return decision({ ...base, kind: 'none', criticalNeedId: null,
        reasonCode: 'no-critical-need', action: null });
    if (critical === 'hunger') {
        const food = observation.foods.sort((left, right) => right.hungerRelief - left.hungerRelief
            || left.itemId - right.itemId || left.inventorySlot - right.inventorySlot)[0];
        if (food) return decision({ ...base, kind: 'consume-food', criticalNeedId: 'hunger',
            reasonCode: 'food-selected', action: { operation: 'consume-food', itemId: food.itemId,
                inventorySlot: food.inventorySlot, quantity: 1, hungerRelief: food.hungerRelief } });
    } else {
        const place = observation.sleepPlaces.filter(item => item.available && item.accessAllowed)
            .sort((left, right) => right.fatigueRecoveryPerHour - left.fatigueRecoveryPerHour
                || right.safetyLevel - left.safetyLevel || left.sleepPlaceId.localeCompare(right.sleepPlaceId))[0];
        if (place) return decision({ ...base, kind: 'seek-sleep-place', criticalNeedId: 'fatigue',
            reasonCode: 'sleep-place-selected', action: { operation: 'seek-sleep-place',
                sleepPlaceId: place.sleepPlaceId, fatigueRecoveryPerHour: place.fatigueRecoveryPerHour } });
    }
    return decision({ ...base, kind: 'blocked', criticalNeedId: critical,
        reasonCode: 'critical-resource-unavailable', action: null });
}
