import { describe, expect, test } from 'bun:test';
import { ATTRIBUTE_KEYS, attributeProfileDigest, validateAttributeProfile } from '../index.js';

function definition(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        profileId: 'attribute:agent-ada:life-1',
        version: '1.0.0',
        characterAgentId: 'agent-ada',
        lifecycleCreatedAtSimulationTime: '2026-09-15T00:00:00.000Z',
        source: {
            origin: 'genesis-lottery',
            policyId: 'frontier-attributes',
            policyVersion: '1.0.0',
            seedDigest: 'a'.repeat(64)
        },
        scale: { minimum: 0, maximum: 5 },
        values: { intellect: 3, dexterity: 2, vigor: 1, endurance: 4, perception: 5, will: 2 }
    };
}

describe('immutable character attribute profile', () => {
    test('validates the six canonical aptitudes and derives stable evidence', () => {
        expect(ATTRIBUTE_KEYS).toEqual(['intellect', 'dexterity', 'vigor', 'endurance', 'perception', 'will']);
        const first = validateAttributeProfile(definition());
        const reordered = definition();
        reordered.values = { will: 2, perception: 5, endurance: 4, vigor: 1, dexterity: 2, intellect: 3 };
        const second = validateAttributeProfile(reordered);
        expect(first.totalPoints).toBe(17);
        expect(first.digest).toBe(second.digest);
        const { totalPoints: _total, digest: _digest, ...canonical } = first;
        expect(attributeProfileDigest(canonical)).toBe(first.digest);
        expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    });

    test('supports explicit human allocation and migration without inventing random evidence', () => {
        const human = definition();
        human.source = { origin: 'human-allocation', policyId: 'standard-player',
            policyVersion: '1.0.0', seedDigest: null };
        expect(validateAttributeProfile(human).source.origin).toBe('human-allocation');

        const migrated = definition();
        migrated.source = { origin: 'migration-default', policyId: 'legacy-equal',
            policyVersion: '1.0.0', seedDigest: null };
        expect(validateAttributeProfile(migrated).source.origin).toBe('migration-default');
    });

    test('rejects unknown concepts, incomplete values and scores outside the declared scale', () => {
        const mixed = definition();
        mixed.values = { ...(mixed.values as object), fishing: 5 };
        expect(() => validateAttributeProfile(mixed)).toThrow('values fields are invalid');

        const incomplete = definition();
        delete (incomplete.values as Record<string, unknown>).will;
        expect(() => validateAttributeProfile(incomplete)).toThrow('values fields are invalid');

        const outOfRange = definition();
        (outOfRange.values as Record<string, unknown>).vigor = 6;
        expect(() => validateAttributeProfile(outOfRange)).toThrow('values.vigor must be an integer');
    });

    test('requires exact version, lifecycle and seeded provenance contracts', () => {
        expect(() => validateAttributeProfile({ ...definition(), unexpected: true }))
            .toThrow('Attribute profile fields are invalid');
        expect(() => validateAttributeProfile({ ...definition(), version: 'latest' }))
            .toThrow('version must use semantic versioning');
        expect(() => validateAttributeProfile({ ...definition(), lifecycleCreatedAtSimulationTime: 'today' }))
            .toThrow('must be canonical UTC ISO');

        const missingSeed = definition();
        missingSeed.source = { ...(missingSeed.source as object), seedDigest: null };
        expect(() => validateAttributeProfile(missingSeed)).toThrow('requires a seed digest');

        const inventedSeed = definition();
        inventedSeed.source = { origin: 'human-allocation', policyId: 'standard-player',
            policyVersion: '1.0.0', seedDigest: 'b'.repeat(64) };
        expect(() => validateAttributeProfile(inventedSeed)).toThrow('Only a genesis-lottery');
    });
});
