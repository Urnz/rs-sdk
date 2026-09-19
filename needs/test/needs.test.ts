import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createInitialNeedsState, loadNeedsPolicyCatalog, validateNeedsPolicy,
    validateNeedsState } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'needs-policies.json');

describe('character needs domain', () => {
    test('loads required hunger and fatigue definitions with stable policy evidence', () => {
        const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
        expect(policy.needs.map(need => need.needId)).toEqual(['hunger', 'fatigue']);
        expect(policy.needs.every(need => need.minimumValue === 0 && need.criticalThreshold === 8000)).toBeTrue();
        expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('creates a deterministic complete state bound to simulation time', () => {
        const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
        const input = { characterAgentId: 'ada', clockId: 'local-world',
            observedAtSimulationTime: '2026-09-19T00:00:00.000Z' };
        const first = createInitialNeedsState(policy, input);
        const second = createInitialNeedsState(policy, input);
        expect(first).toEqual(second);
        expect(first.values).toEqual([{ needId: 'hunger', value: 0 }, { needId: 'fatigue', value: 0 }]);
        const { digest: _digest, ...definition } = first;
        expect(validateNeedsState(definition, policy)).toEqual(first);
    });

    test('supports future needs through policy extension without changing the state schema', () => {
        const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
        const { digest: _digest, ...definition } = policy;
        definition.needs.push({ needId: 'thirst', label: 'Thirst', minimumValue: 0,
            maximumValue: 10000, initialValue: 500, criticalThreshold: 7000 });
        const extended = validateNeedsPolicy(definition);
        const state = createInitialNeedsState(extended, { characterAgentId: 'ada', clockId: 'local-world',
            observedAtSimulationTime: '2026-09-19T00:00:00.000Z' });
        expect(state.values.at(-1)).toEqual({ needId: 'thirst', value: 500 });
    });

    test('rejects missing core needs, duplicates and impossible thresholds', () => {
        const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
        const { digest: _digest, ...definition } = policy;
        expect(() => validateNeedsPolicy({ ...definition, needs: definition.needs.slice(0, 1) }))
            .toThrow('identity or collection is invalid');
        expect(() => validateNeedsPolicy({ ...definition, needs: [...definition.needs, definition.needs[0]!] }))
            .toThrow('identities must be unique');
        expect(() => validateNeedsPolicy({ ...definition, needs: definition.needs.map((need, index) => index === 0
            ? { ...need, criticalThreshold: 0 } : need) })).toThrow('between 1 and 10000');
    });

    test('rejects partial, unknown, duplicate and out-of-range state values', () => {
        const policy = loadNeedsPolicyCatalog(configPath).policies[0]!;
        const state = createInitialNeedsState(policy, { characterAgentId: 'ada', clockId: 'local-world',
            observedAtSimulationTime: '2026-09-19T00:00:00.000Z' });
        const { digest: _digest, ...definition } = state;
        expect(() => validateNeedsState({ ...definition, values: definition.values.slice(0, 1) }, policy))
            .toThrow('every configured need exactly once');
        expect(() => validateNeedsState({ ...definition, values: [
            { needId: 'hunger', value: 0 }, { needId: 'stress', value: 0 }
        ] }, policy)).toThrow('Unknown need value');
        expect(() => validateNeedsState({ ...definition, values: [
            { needId: 'hunger', value: 10001 }, definition.values[1]!
        ] }, policy)).toThrow('between 0 and 10000');
    });
});
