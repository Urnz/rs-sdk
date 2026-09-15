import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createHumanAttributeProfile, loadAttributeAllocationPolicyCatalog,
    loadAttributeBudgetPolicyCatalog, loadHumanAttributeCreationPolicyCatalog,
    validateHumanAttributeCreationPolicy, validateHumanAttributeCreationPolicyCatalog } from '../index.js';

const config = (name: string) => join(import.meta.dir, '..', '..', 'config', name);

function catalogs() {
    const human = loadHumanAttributeCreationPolicyCatalog(config('human-attribute-creation-policies.json'));
    return { choice: human.policies.find(policy => policy.mode === 'player-choice')!,
        lottery: human.policies.find(policy => policy.mode === 'genetic-lottery')!,
        budget: loadAttributeBudgetPolicyCatalog(config('attribute-budget-policies.json')).policies[0]!,
        allocation: loadAttributeAllocationPolicyCatalog(config('attribute-allocation-policies.json')).policies[0]! };
}

function definition(mode: 'player-choice' | 'genetic-lottery'): Record<string, unknown> {
    const policy = mode === 'player-choice' ? catalogs().choice : catalogs().lottery;
    const { digest: _digest, ...value } = policy;
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('human character attribute creation policy', () => {
    test('creates an immutable player-chosen profile only after the exact budget is spent', () => {
        const { choice } = catalogs();
        const input = { mode: 'player-choice' as const, characterAgentId: 'human-ada',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
            values: { intellect: 3, dexterity: 2, vigor: 1, endurance: 2, perception: 1, will: 1 } };
        const first = createHumanAttributeProfile(choice, input);
        const second = createHumanAttributeProfile(choice, input);
        expect(first).toEqual(second);
        expect(first.mode).toBe('player-choice');
        expect(first.profile.totalPoints).toBe(10);
        expect(first.profile.source).toEqual({ origin: 'human-allocation', policyId: 'standard-human-choice',
            policyVersion: '1.0.0', seedDigest: null });
        expect(first.lotteryEvidence).toBeNull();
    });

    test('rejects under-spending, over-spending and hidden extra attributes', () => {
        const { choice } = catalogs();
        const base = { mode: 'player-choice' as const, characterAgentId: 'human-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        expect(() => createHumanAttributeProfile(choice, { ...base,
            values: { intellect: 1, dexterity: 1, vigor: 1, endurance: 1, perception: 1, will: 1 } }))
            .toThrow('spend exactly 10 points');
        expect(() => createHumanAttributeProfile(choice, { ...base,
            values: { intellect: 2, dexterity: 2, vigor: 2, endurance: 2, perception: 2, will: 2 } }))
            .toThrow('spend exactly 10 points');
        expect(() => createHumanAttributeProfile(choice, { ...base, values: {
            intellect: 3, dexterity: 2, vigor: 1, endurance: 2, perception: 1, will: 1, fishing: 99
        } as never })).toThrow('values fields are invalid');
    });

    test('runs the exact NPC genetic lottery in hardcore mode and preserves its evidence', () => {
        const { lottery, budget, allocation } = catalogs();
        const input = { mode: 'genetic-lottery' as const, seed: 'hardcore-world', characterAgentId: 'human-grace',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        const first = createHumanAttributeProfile(lottery, input, { budget, allocation });
        const second = createHumanAttributeProfile(lottery, input, { budget, allocation });
        expect(first).toEqual(second);
        expect(first.profile.values).toEqual(first.lotteryEvidence!.values);
        expect(first.profile.totalPoints).toBe(first.lotteryEvidence!.budget.totalPoints);
        expect(first.profile.source.origin).toBe('genesis-lottery');
        expect(first.profile.source.policyId).toBe('hardcore-human-lottery');
        expect(JSON.stringify(first)).not.toContain(input.seed);
    });

    test('enforces mode and exact referenced lottery policies', () => {
        const { choice, lottery, budget, allocation } = catalogs();
        const choiceInput = { mode: 'player-choice' as const, characterAgentId: 'human-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
            values: { intellect: 3, dexterity: 2, vigor: 1, endurance: 2, perception: 1, will: 1 } };
        expect(() => createHumanAttributeProfile(lottery, choiceInput)).toThrow('Input mode does not match');
        const lotteryInput = { mode: 'genetic-lottery' as const, seed: 'world', characterAgentId: 'human-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        expect(() => createHumanAttributeProfile(lottery, lotteryInput)).toThrow('policies are required');
        expect(() => createHumanAttributeProfile(lottery, lotteryInput, {
            budget: { ...budget, policyId: 'wrong-budget' }, allocation
        })).toThrow('references do not match');
        expect(() => createHumanAttributeProfile(choice, { ...lotteryInput, mode: 'genetic-lottery' }))
            .toThrow('Input mode does not match');
    });

    test('rejects inconsistent world policies, duplicates and digest tampering', () => {
        const inconsistent = definition('player-choice');
        inconsistent.lottery = { budgetPolicy: { policyId: 'budget', version: '1.0.0' },
            allocationPolicy: { policyId: 'allocation', version: '1.0.0' } };
        expect(() => validateHumanAttributeCreationPolicy(inconsistent)).toThrow('mode configuration is inconsistent');

        const raw = definition('player-choice');
        expect(() => validateHumanAttributeCreationPolicyCatalog({ schemaVersion: 1, policies: [raw, raw] }))
            .toThrow('identities must be unique');
        const { choice } = catalogs();
        expect(() => createHumanAttributeProfile({ ...choice, digest: '0'.repeat(64) }, {
            mode: 'player-choice', characterAgentId: 'human-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
            values: { intellect: 3, dexterity: 2, vigor: 1, endurance: 2, perception: 1, will: 1 }
        })).toThrow('digest does not match');
    });
});
