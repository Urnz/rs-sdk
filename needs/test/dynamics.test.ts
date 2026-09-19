import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { SimulationClockObservation } from '../../simulation-clock/index.js';
import { advanceNeedsFromClock, createInitialNeedsState, loadNeedsDynamicsPolicyCatalog,
    loadNeedsPolicyCatalog, validateNeedsDynamicsPolicy, validateNeedsState } from '../index.js';

const needsPath = join(import.meta.dir, '..', '..', 'config', 'needs-policies.json');
const dynamicsPath = join(import.meta.dir, '..', '..', 'config', 'needs-dynamics-policies.json');

function observation(simulationTime: string, clockId = 'local-world'): SimulationClockObservation {
    return { clockId, wallTime: '2026-09-19T12:00:00.000Z', simulationTime,
        engineTick: null, status: 'running', profileDigest: 'a'.repeat(64), revision: 1 };
}

function setup() {
    const needs = loadNeedsPolicyCatalog(needsPath).policies[0]!;
    const dynamics = loadNeedsDynamicsPolicyCatalog(dynamicsPath, needs).policies[0]!;
    const state = createInitialNeedsState(needs, { characterAgentId: 'ada', clockId: 'local-world',
        observedAtSimulationTime: '2026-09-19T00:00:00.000Z' });
    return { needs, dynamics, state };
}

describe('SimulationClock-driven needs dynamics', () => {
    test('advances online awake needs by elapsed simulation time', () => {
        const { needs, dynamics, state } = setup();
        const transition = advanceNeedsFromClock(state, observation('2026-09-19T02:00:00.000Z'),
            'online', 'awake', needs, dynamics);
        expect(transition.elapsedSimulationMilliseconds).toBe(7_200_000);
        expect(transition.state.values).toEqual([
            { needId: 'hunger', value: 600, remainderNumerator: 0 },
            { needId: 'fatigue', value: 800, remainderNumerator: 0 }
        ]);
        expect(transition.deltas.map(delta => delta.ratePerSimulationHour)).toEqual([300, 400]);
        expect(transition.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('uses distinct offline sleeping rates and regenerates fatigue', () => {
        const { needs, dynamics, state } = setup();
        const { digest: _digest, ...definition } = state;
        const populated = validateNeedsState({ ...definition, values: definition.values.map(value => ({
            ...value, value: 3000
        })) }, needs);
        const transition = advanceNeedsFromClock(populated, observation('2026-09-19T01:00:00.000Z'),
            'offline', 'sleeping', needs, dynamics);
        expect(transition.state.values.map(value => value.value)).toEqual([3100, 2000]);
    });

    test('carries fractions so incremental and single-step advancement agree', () => {
        const { needs, dynamics, state } = setup();
        const { digest: _digest, ...definition } = dynamics;
        const fractional = validateNeedsDynamicsPolicy({ ...definition,
            rules: definition.rules.map(rule => ({ ...rule, onlineAwakePerHour: 333 })) }, needs);
        const halfway = advanceNeedsFromClock(state, observation('2026-09-19T00:30:00.000Z'),
            'online', 'awake', needs, fractional);
        expect(halfway.state.values[0]).toEqual({ needId: 'hunger', value: 166,
            remainderNumerator: 1_800_000 });
        const incremental = advanceNeedsFromClock(halfway.state, observation('2026-09-19T01:00:00.000Z'),
            'online', 'awake', needs, fractional);
        const single = advanceNeedsFromClock(state, observation('2026-09-19T01:00:00.000Z'),
            'online', 'awake', needs, fractional);
        expect(incremental.state.values).toEqual(single.state.values);
        expect(single.state.values[0]).toEqual({ needId: 'hunger', value: 333, remainderNumerator: 0 });
    });

    test('clamps at bounds and discards unusable fractional carry', () => {
        const { needs, dynamics, state } = setup();
        const { digest: _digest, ...definition } = state;
        const bounded = validateNeedsState({ ...definition, values: [
            { needId: 'hunger', value: 9950, remainderNumerator: 1 },
            { needId: 'fatigue', value: 50, remainderNumerator: -1 }
        ] }, needs);
        const awake = advanceNeedsFromClock(bounded, observation('2026-09-19T01:00:00.000Z'),
            'online', 'awake', needs, dynamics);
        expect(awake.state.values[0]).toEqual({ needId: 'hunger', value: 10000, remainderNumerator: 0 });
        const sleeping = advanceNeedsFromClock(bounded, observation('2026-09-19T01:00:00.000Z'),
            'online', 'sleeping', needs, dynamics);
        expect(sleeping.state.values[1]).toEqual({ needId: 'fatigue', value: 0, remainderNumerator: 0 });
    });

    test('rejects mismatched clocks, backwards time and tampered evidence', () => {
        const { needs, dynamics, state } = setup();
        expect(() => advanceNeedsFromClock(state, observation('2026-09-19T01:00:00.000Z', 'other'),
            'online', 'awake', needs, dynamics)).toThrow('clock does not match');
        expect(() => advanceNeedsFromClock(state, observation('2026-09-18T23:59:59.999Z'),
            'online', 'awake', needs, dynamics)).toThrow('must be monotonic');
        expect(() => advanceNeedsFromClock({ ...state, digest: '0'.repeat(64) },
            observation('2026-09-19T01:00:00.000Z'), 'online', 'awake', needs, dynamics))
            .toThrow('state digest does not match');
        expect(() => advanceNeedsFromClock(state, observation('2026-09-19T01:00:00.000Z'),
            'online', 'awake', needs, { ...dynamics, digest: '0'.repeat(64) }))
            .toThrow('dynamics policy digest does not match');
    });
});
