import { describe, expect, test } from 'bun:test';
import { advanceEconomicObserver, buildEconomicContext, ECONOMIC_OBSERVER_POLICY,
    type EconomicObservation } from '../economic-context.js';

const start = '2026-10-22T10:00:00.000Z';
function observation(value: number | string | null, key = 'hunger', offset = 0): EconomicObservation {
    const now = new Date(Date.parse(start) + offset).toISOString();
    return { agentId: 'worker', binding: 'local-lifecycle-clock', observedAt: now, simulationTime: now,
        facts: [{ key, value, source: 'native', cursor: String(offset), observedAt: now, freshness: value === null ? 'unknown' : 'fresh', trust: 'native' }] };
}

describe('economic observer thresholds', () => {
    test('hysteresis survives unknown and jitter; recovered source re-arms after cooldown', () => {
        let result = advanceEconomicObserver(observation(7000), null);
        expect(result.reasons).toEqual(['hunger']);
        result = advanceEconomicObserver(observation(null, 'hunger', 1000), result.state);
        expect(result.state.active.hunger).toBe(true);
        result = advanceEconomicObserver(observation(6000, 'hunger', 2000), result.state);
        expect(result.reasons).toEqual([]);
        result = advanceEconomicObserver(observation(4000, 'hunger', 3000), result.state);
        result = advanceEconomicObserver(observation(8000, 'hunger', 4000), result.state);
        expect(result.reasons).toEqual([]);
        expect(result.state.pending).toEqual(['hunger']);
        result = advanceEconomicObserver(observation(8000, 'hunger', ECONOMIC_OBSERVER_POLICY.cooldownMs), result.state);
        expect(result.reasons).toEqual(['hunger']);
    });
    test('stale/future observations are unknown and cannot wake or be promoted to a fact', () => {
        const value = observation('ended', 'income:job');
        value.facts[0]!.observedAt = '2026-10-22T09:00:00.000Z';
        expect(advanceEconomicObserver(value, null).reasons).toEqual([]);
        expect(buildEconomicContext(value, start)).toContain('income:job: unknown (stale;');
        value.facts[0]!.observedAt = '2026-10-22T11:00:00.000Z';
        expect(advanceEconomicObserver(value, null).reasons).toEqual([]);
    });
    test('stock and cash thresholds re-arm only beyond the recovery boundary', () => {
        let result = advanceEconomicObserver(observation(0, 'stock:379'), null);
        expect(result.reasons).toEqual(['stock:379']);
        result = advanceEconomicObserver(observation(1, 'stock:379', 1000), result.state);
        expect(result.state.active['stock:379']).toBe(true);
        result = advanceEconomicObserver(observation(2, 'stock:379', 2000), result.state);
        expect(result.state.active['stock:379']).toBe(false);
        expect(advanceEconomicObserver(observation(1, 'cash-runway-periods'), null).reasons).toEqual(['cash-runway-periods']);
        expect(advanceEconomicObserver(observation(3, 'cash-runway-periods'), null).reasons).toEqual([]);
    });
    test('binding drift and out of order observations fail closed', () => {
        const previous = advanceEconomicObserver(observation(1000, 'hunger', 1000), null).state;
        expect(() => advanceEconomicObserver(observation(2000), previous)).toThrow('regressed');
        expect(() => advanceEconomicObserver({ ...observation(2000, 'hunger', 2000), binding: 'other-world' }, previous)).toThrow('binding');
    });
    test('source cursor reuse/regression fails closed; existing offer/work events are not admitted twice', () => {
        const initial = observation('active', 'income:job', 1000);
        const previous = advanceEconomicObserver(initial, null).state;
        const changed = observation('ended', 'income:job', 2000);
        changed.facts[0]!.cursor = '1000';
        expect(() => advanceEconomicObserver(changed, previous)).toThrow('different content');
        changed.facts[0]!.cursor = '0';
        expect(() => advanceEconomicObserver(changed, previous)).toThrow('cursor regressed');
        expect(advanceEconomicObserver(observation('open', 'offer:known'), null).reasons).toEqual([]);
        expect(advanceEconomicObserver(observation('completed', 'work:known'), null).reasons).toEqual([]);
    });
});
