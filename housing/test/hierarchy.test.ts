import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { compareHousingTiers, CORE_HOUSING_TIER_IDS, loadHousingTierPolicyCatalog,
    resolveHousingTier, validateHousingTierPolicy, validateHousingTierPolicyCatalog } from '../index.js';

const configPath = join(import.meta.dir, '..', '..', 'config', 'housing-tier-policies.json');

describe('housing security and comfort hierarchy', () => {
    test('loads the required ordered hierarchy with stable evidence', () => {
        const policy = loadHousingTierPolicyCatalog(configPath).policies[0]!;
        expect(policy.tiers.map(tier => tier.tierId)).toEqual([...CORE_HOUSING_TIER_IDS]);
        expect(policy.tiers.map(tier => tier.rank)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(compareHousingTiers(policy, 'fortified-property', 'street')).toBe(5);
        expect(resolveHousingTier(policy, ' RENTED-ROOM ').tenure).toBe('rented');
    });

    test('keeps comfort and security non-decreasing through the hierarchy', () => {
        const tiers = loadHousingTierPolicyCatalog(configPath).policies[0]!.tiers;
        for (let index = 1; index < tiers.length; index++) {
            expect(tiers[index]!.comfortRating).toBeGreaterThanOrEqual(tiers[index - 1]!.comfortRating);
            expect(tiers[index]!.securityRating).toBeGreaterThanOrEqual(tiers[index - 1]!.securityRating);
        }
    });

    test('allows future higher tiers without changing the domain shape', () => {
        const policy = loadHousingTierPolicyCatalog(configPath).policies[0]!;
        const { digest: _digest, ...definition } = policy;
        const extended = validateHousingTierPolicy({ ...definition, tiers: [...definition.tiers, {
            tierId: 'guarded-estate', rank: 6, label: 'Guarded estate', tenure: 'owned',
            comfortRating: 95, securityRating: 100
        }] });
        expect(resolveHousingTier(extended, 'guarded-estate').rank).toBe(6);
    });

    test('rejects reordered core tiers, gaps and decreasing quality', () => {
        const policy = loadHousingTierPolicyCatalog(configPath).policies[0]!;
        const { digest: _digest, ...definition } = policy;
        expect(() => validateHousingTierPolicy({ ...definition, tiers: definition.tiers.map((tier, index) =>
            index === 0 ? { ...tier, tierId: 'temporary-shelter' }
                : index === 1 ? { ...tier, tierId: 'street' } : tier) })).toThrow('required hierarchy');
        expect(() => validateHousingTierPolicy({ ...definition, tiers: definition.tiers.map((tier, index) =>
            index === 5 ? { ...tier, rank: 6 } : tier) })).toThrow('contiguous');
        expect(() => validateHousingTierPolicy({ ...definition, tiers: definition.tiers.map((tier, index) =>
            index === 3 ? { ...tier, securityRating: 1 } : tier) })).toThrow('must not decrease');
    });

    test('rejects duplicate catalog identities and unknown tiers', () => {
        const catalog = loadHousingTierPolicyCatalog(configPath);
        const { digest: _digest, ...definition } = catalog.policies[0]!;
        expect(() => validateHousingTierPolicyCatalog({ schemaVersion: 1,
            policies: [definition, definition] })).toThrow('identities must be unique');
        expect(() => resolveHousingTier(catalog.policies[0]!, 'unknown')).toThrow('Unknown housing tier');
        expect(() => resolveHousingTier({ ...catalog.policies[0]!, digest: '0'.repeat(64) }, 'street'))
            .toThrow('digest does not match');
    });
});
