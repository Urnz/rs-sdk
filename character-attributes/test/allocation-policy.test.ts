import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ATTRIBUTE_KEYS, generateNpcAttributeProfile, loadAttributeAllocationPolicyCatalog,
    loadAttributeBudgetPolicyCatalog, validateAttributeAllocationPolicy,
    validateAttributeAllocationPolicyCatalog } from '../index.js';

const budgetPath = join(import.meta.dir, '..', '..', 'config', 'attribute-budget-policies.json');
const allocationPath = join(import.meta.dir, '..', '..', 'config', 'attribute-allocation-policies.json');

function policies() {
    return { budget: loadAttributeBudgetPolicyCatalog(budgetPath).policies[0]!,
        allocation: loadAttributeAllocationPolicyCatalog(allocationPath).policies[0]! };
}

function definition(): Record<string, unknown> {
    const { allocation } = policies(), { digest: _digest, ...value } = allocation;
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('seeded NPC attribute allocation', () => {
    test('loads all three weighted strategies and binds the exact budget policy', () => {
        const { allocation } = policies();
        expect(allocation).toMatchObject({ policyId: 'default-npc-allocation', version: '1.0.0',
            budgetPolicy: { policyId: 'default-npc-attributes', version: '1.0.0' },
            specialistFocusCount: 2 });
        expect(allocation.strategies.map(entry => entry.strategy))
            .toEqual(['generalist', 'specialist', 'unoptimized']);
        expect(allocation.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('replays a complete profile exactly and spends every generated point', () => {
        const { budget, allocation } = policies();
        const input = { seed: 'phase-17-allocation', characterAgentId: 'npc-ada',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        const first = generateNpcAttributeProfile(budget, allocation, input);
        const second = generateNpcAttributeProfile(budget, allocation, input);
        expect(first).toEqual(second);
        expect(first.profile.totalPoints).toBe(first.budget.totalPoints);
        expect(first.profile.values).toEqual(first.allocation.values);
        expect(Object.keys(first.profile.values).sort()).toEqual([...ATTRIBUTE_KEYS].sort());
        expect(first.allocation.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(first.profile.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(first)).not.toContain(input.seed);
    });

    test('creates generalists, strong specialists and unoptimized combinations across a population', () => {
        const { budget, allocation } = policies();
        const population = Array.from({ length: 1_000 }, (_, index) => generateNpcAttributeProfile(
            budget, allocation, { seed: 'allocation-population', characterAgentId: `npc-${index}`,
                lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' }));
        const groups = new Map(allocation.strategies.map(entry => [entry.strategy,
            population.filter(result => result.allocation.strategy === entry.strategy)]));
        for (const strategy of allocation.strategies) expect(groups.get(strategy.strategy)!.length).toBeGreaterThan(150);

        for (const result of groups.get('generalist')!) {
            const values = Object.values(result.profile.values);
            expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        }
        for (const result of groups.get('specialist')!) {
            const descending = Object.values(result.profile.values).sort((left, right) => right - left);
            expect(descending[0]! + descending[1]!).toBe(Math.min(result.budget.totalPoints, 10));
        }
        expect(groups.get('unoptimized')!.some(result => {
            const values = Object.values(result.profile.values);
            return Math.max(...values) - Math.min(...values) >= 2;
        })).toBe(true);
    });

    test('keeps lifecycle identity in entropy and rejects a mismatched budget policy', () => {
        const { budget, allocation } = policies();
        const input = { seed: 'same-world', characterAgentId: 'npc-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        const first = generateNpcAttributeProfile(budget, allocation, input);
        const laterLife = generateNpcAttributeProfile(budget, allocation, {
            ...input, lifecycleCreatedAtSimulationTime: '2027-09-15T00:00:00.000Z'
        });
        expect(laterLife.allocation.entropyDigest).not.toBe(first.allocation.entropyDigest);

        const wrongReference = definition();
        wrongReference.budgetPolicy = { policyId: 'another-budget', version: '1.0.0' };
        expect(() => generateNpcAttributeProfile(budget, validateAttributeAllocationPolicy(wrongReference), input))
            .toThrow('does not reference the supplied budget policy');
    });

    test('rejects incomplete strategies, duplicate policy identities and changed validated digests', () => {
        const incomplete = definition();
        incomplete.strategies = (incomplete.strategies as unknown[]).slice(0, 2);
        expect(() => validateAttributeAllocationPolicy(incomplete)).toThrow('must define generalist');

        const raw = definition();
        expect(() => validateAttributeAllocationPolicyCatalog({ schemaVersion: 1, policies: [raw, raw] }))
            .toThrow('identities must be unique');

        const { budget, allocation } = policies();
        expect(() => generateNpcAttributeProfile(budget, { ...allocation, digest: '0'.repeat(64) }, {
            seed: 'valid', characterAgentId: 'npc-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z'
        })).toThrow('digest does not match');
    });
});
