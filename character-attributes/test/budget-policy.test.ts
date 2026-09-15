import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { generateAttributeBudget, loadAttributeBudgetPolicyCatalog,
    validateAttributeBudgetPolicy, validateAttributeBudgetPolicyCatalog } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'attribute-budget-policies.json');

function definition(): Record<string, unknown> {
    const policy = loadAttributeBudgetPolicyCatalog(configPath).policies[0]!;
    const { digest: _digest, ...value } = policy;
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('seeded bounded NPC attribute budget', () => {
    test('loads a versioned complete distribution with stable policy evidence', () => {
        const first = loadAttributeBudgetPolicyCatalog(configPath);
        const second = loadAttributeBudgetPolicyCatalog(configPath);
        expect(first.policies).toHaveLength(1);
        expect(first.policies[0]).toMatchObject({ policyId: 'default-npc-attributes', version: '1.0.0',
            characterKind: 'npc', scale: { minimum: 0, maximum: 5 },
            distribution: { minimumTotalPoints: 5, maximumTotalPoints: 15 } });
        expect(first.policies[0]!.digest).toBe(second.policies[0]!.digest);
    });

    test('replays exactly for the same world seed and character lifecycle without storing the seed', () => {
        const policy = loadAttributeBudgetPolicyCatalog(configPath).policies[0]!;
        const input = { seed: 'world-seed-17', characterAgentId: 'npc-ada',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' };
        const first = generateAttributeBudget(policy, input), second = generateAttributeBudget(policy, input);
        expect(first).toEqual(second);
        expect(first.totalPoints).toBeGreaterThanOrEqual(5);
        expect(first.totalPoints).toBeLessThanOrEqual(15);
        expect(first.source.seedDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(first)).not.toContain(input.seed);
        expect(first.digest).toMatch(/^[0-9a-f]{64}$/);

        const another = generateAttributeBudget(policy, { ...input, characterAgentId: 'npc-grace' });
        expect(another.entropyDigest).not.toBe(first.entropyDigest);
        expect(another.digest).not.toBe(first.digest);
    });

    test('produces a bounded non-uniform population around the configured center', () => {
        const policy = loadAttributeBudgetPolicyCatalog(configPath).policies[0]!;
        const totals = Array.from({ length: 2_000 }, (_, index) => generateAttributeBudget(policy, {
            seed: 'population-seed', characterAgentId: `npc-${index}`,
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z'
        }).totalPoints);
        expect(Math.min(...totals)).toBeGreaterThanOrEqual(5);
        expect(Math.max(...totals)).toBeLessThanOrEqual(15);
        expect(new Set(totals).size).toBeGreaterThanOrEqual(9);
        const mean = totals.reduce((sum, total) => sum + total, 0) / totals.length;
        expect(mean).toBeGreaterThan(9.8);
        expect(mean).toBeLessThan(10.2);
        expect(totals.filter(total => total === 10).length).toBeGreaterThan(totals.filter(total => total === 5).length);
    });

    test('rejects gaps, duplicates, impossible budgets and unbounded weights', () => {
        const missing = definition();
        (missing.distribution as Record<string, unknown>).weights =
            ((missing.distribution as Record<string, unknown>).weights as unknown[]).slice(1);
        expect(() => validateAttributeBudgetPolicy(missing)).toThrow('cover every bounded total exactly once');

        const duplicate = definition();
        const duplicateWeights = (duplicate.distribution as Record<string, unknown>).weights as Record<string, unknown>[];
        duplicateWeights[1]!.points = 5;
        expect(() => validateAttributeBudgetPolicy(duplicate)).toThrow('cover every bounded total exactly once');

        const impossible = definition();
        (impossible.distribution as Record<string, unknown>).maximumTotalPoints = 31;
        expect(() => validateAttributeBudgetPolicy(impossible)).toThrow('maximumTotalPoints must be an integer');

        const unbounded = definition();
        const unboundedWeights = (unbounded.distribution as Record<string, unknown>).weights as Record<string, unknown>[];
        unboundedWeights[0]!.weight = 1_000_001;
        expect(() => validateAttributeBudgetPolicy(unbounded)).toThrow('weight must be an integer');
    });

    test('rejects duplicate policy versions and malformed generation inputs', () => {
        const policy = definition();
        expect(() => validateAttributeBudgetPolicyCatalog({ schemaVersion: 1, policies: [policy, policy] }))
            .toThrow('identities must be unique');
        const validated = validateAttributeBudgetPolicy(policy);
        expect(() => generateAttributeBudget(validated, { seed: ' ', characterAgentId: 'npc-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z' })).toThrow('seed must contain');
        expect(() => generateAttributeBudget(validated, { seed: 'valid', characterAgentId: 'npc-1',
            lifecycleCreatedAtSimulationTime: 'today' })).toThrow('must be canonical UTC ISO');

        expect(() => generateAttributeBudget({ ...validated, digest: '0'.repeat(64) }, {
            seed: 'valid', characterAgentId: 'npc-1',
            lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z'
        })).toThrow('digest does not match');
    });
});
