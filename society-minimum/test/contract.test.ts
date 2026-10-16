import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSocietyMinimumContract, loadSocietyMinimumPolicy, resolveSocietyMinimumContract,
    validateSocietyMinimumPolicy, societyMinimumRequirements, assertSocietyMinimumContractBinding } from '../index.js';

const config = join(import.meta.dir, '../../config'), directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const raw = JSON.parse(readFileSync(join(config, 'society-minimum-policy.json'), 'utf8'));
function definition(patch: Record<string, unknown>) { return validateSocietyMinimumPolicy({ ...raw, ...patch }); }
function alteredConfig(file: string, mutate: (value: any) => void) {
    const directory = mkdtempSync(join(tmpdir(), 'society-contract-')); directories.push(directory);
    for (const name of ['society-minimum-policy.json', 'needs-policies.json', 'needs-dynamics-policies.json',
        'housing-tier-policies.json', 'housing-effect-policies.json', 'food-loops.json', 'item-lifecycle.json',
        'production-tool-cycles.json', 'world-genesis-profiles.json', 'population-lifecycle-policies.json',
        'population-world-profile-bindings.json', 'simulation-clock.json', 'external-trade-policies.json',
        'external-trade-world-profile-bindings.json']) cpSync(join(config, name), join(directory, name));
    const value = JSON.parse(readFileSync(join(directory, file), 'utf8')); mutate(value);
    writeFileSync(join(directory, file), JSON.stringify(value)); return directory;
}

describe('versioned society minimum measurement contract', () => {
    test('defines a seven-day post-bootstrap minimum and pins the real configured dependencies without claiming a measured result', () => {
        const contract = loadSocietyMinimumContract(config);
        expect(contract).toMatchObject({ artifactKind: 'society-minimum-measurement-contract', measurementStatus: 'unmeasured',
            policy: { window: { warmupSimulationMilliseconds: 86400000, evaluationSimulationMilliseconds: 604800000, bucketSimulationMilliseconds: 86400000 },
                population: { minimumFounders: 4, minimumLivingFounders: 4, minimumFounderSurvivalBasisPoints: 9000 } } });
        expect(contract.dependencies.worlds.map(world => world.profile.profileId).sort()).toEqual(['historical-burn-in', 'mature-society']);
        expect(contract.dependencies.worlds.every(world => world.lifecyclePolicy.kind === 'finite' && world.lifecyclePolicy.respawn === 'forbidden')).toBe(true);
        expect(contract.dependencies.food.chains[0]!.foodChainId).toBe('lobster');
        expect(contract.dependencies.tools.cycles[0]!.cycle.lifecycleTypeId).toBe('bronze-pickaxe');
        expect(contract.dependencies.needs.needs.map(need => need.needId).sort()).toEqual(['fatigue', 'hunger']);
        expect(contract).not.toHaveProperty('verdict'); expect(contract.digest).toMatch(/^[0-9a-f]{64}$/);
        expect(contract.requirements).toHaveLength(17); expect(contract.requiredRunBindings).toContain('sourceWatermarksAndCoverage');
    });
    test('normalization is deterministic across reordered profile/stage/gate lists and object fields', () => {
        const reordered = { ...raw, references: { ...raw.references, worldProfiles: [...raw.references.worldProfiles].reverse() },
            integrityGates: [...raw.integrityGates].reverse(), labor: { ...raw.labor, requiredStageKinds: [...raw.labor.requiredStageKinds].reverse() } };
        expect(validateSocietyMinimumPolicy(reordered)).toEqual(validateSocietyMinimumPolicy(raw));
        expect(loadSocietyMinimumContract(config)).toEqual(loadSocietyMinimumContract(config));
    });
    test('all minimum requirements have explicit units, scopes and non-vacuous demand semantics', () => {
        const rules = societyMinimumRequirements(loadSocietyMinimumPolicy(join(config, 'society-minimum-policy.json')));
        expect(new Set(rules.map(rule => rule.requirementId)).size).toBe(17);
        expect(rules.every(rule => rule.zeroDemand === 'inconclusive')).toBe(true);
        expect(rules.find(rule => rule.requirementId === 'hunger-satisfied-time')).toMatchObject({ threshold: 9500, unit: 'basis-points', scope: 'every-member-every-bucket' });
        expect(rules.find(rule => rule.requirementId === 'food-reserve-coverage')).toMatchObject({ threshold: 86400000, unit: 'simulation-milliseconds' });
        expect(rules.find(rule => rule.requirementId === 'tool-maintenance-cycles')).toMatchObject({ threshold: 1, scope: 'every-tool-type-whole-window' });
    });
    test('the assessment protocol requires every gate, continuous coverage and exact run bindings', () => {
        const contract = loadSocietyMinimumContract(config);
        expect(contract.assessmentProtocol).toMatchObject({ missingOrUnsupportedEvidence: 'inconclusive', zeroDemand: 'inconclusive', provenViolation: 'fail',
            eventWindowBounds: '(start,end]', exposureIntervalBounds: '[start,end)', integrityWindow: 'genesis-apply-through-evaluation-end-including-warmup' });
        expect(contract.requiredRunBindings).toEqual(expect.arrayContaining(['genesisResultDigest', 'activeWorldModsDigest', 'founderRosterDigest', 'attributeDistributionDigest', 'clockProfileDigest']));
    });
    test('omitting a gate, duplicate references or unknown fields cannot weaken the definition', () => {
        expect(() => definition({ integrityGates: raw.integrityGates.slice(1) })).toThrow('mandatory');
        expect(() => definition({ references: { ...raw.references, worldProfiles: [raw.references.worldProfiles[0], raw.references.worldProfiles[0]] } })).toThrow('Duplicate');
        expect(() => definition({ acceptUnknown: true })).toThrow('fields');
        expect(() => definition({ window: { ...raw.window, wallDurationSeconds: 60 } })).toThrow('fields');
    });
    test('incomplete buckets, zero warmup, overlong trace gaps and zero maintenance/demand thresholds are rejected', () => {
        for (const window of [{ ...raw.window, evaluationSimulationMilliseconds: 86400001 }, { ...raw.window, warmupSimulationMilliseconds: 0 },
            { ...raw.window, maximumTraceGapSimulationMilliseconds: 86400001 }]) expect(() => definition({ window })).toThrow();
        expect(() => definition({ tools: { ...raw.tools, minimumMaintenanceCyclesPerType: 0 } })).toThrow();
        expect(() => definition({ needs: { ...raw.needs, minimumSatisfiedPersonTimeBasisPoints: 0 } })).toThrow();
        expect(() => definition({ labor: { ...raw.labor, minimumActiveProducersPerBucket: 1 } })).toThrow();
    });
    test('internal self-sustenance cannot be redefined as imports or running down seed stock', () => {
        expect(() => definition({ food: { ...raw.food, minimumInternalReliefShareBasisPoints: 9000 } })).toThrow('imported');
        expect(() => definition({ food: { ...raw.food, minimumStockRetentionBasisPoints: 9000 } })).toThrow('depletion');
        expect(() => definition({ tools: { ...raw.tools, minimumServiceCapacityRetentionBasisPoints: 0 } })).toThrow('depletion');
    });
    test('a founder-survival percentage never replaces the fixed minimum population and division-of-labor stages', () => {
        expect(() => definition({ population: { ...raw.population, minimumLivingFounders: 5 } })).toThrow();
        expect(() => definition({ population: { ...raw.population, minimumFounderSurvivalBasisPoints: 10001 } })).toThrow();
        expect(() => definition({ labor: { ...raw.labor, minimumActiveProducersPerBucket: 5 } })).toThrow();
        expect(() => definition({ labor: { ...raw.labor, requiredStageKinds: ['food-gathering', 'food-processing'] } })).toThrow('mandatory');
    });
    test('profile/capability/binding absence fails closed instead of inventing a dependency', () => {
        for (const patch of [{ housing: { minimumTierId: 'street' } }, { housing: { minimumTierId: 'absent' } },
            { food: { ...raw.food, chainIds: ['absent'] } }, { tools: { ...raw.tools, cycleIds: ['absent'] } },
            { references: { ...raw.references, needs: { policyId: 'absent', version: '1.0.0' } } },
            { references: { ...raw.references, worldProfiles: [{ profileId: 'blank-slate', version: '1.0.0' }] } }])
            expect(() => resolveSocietyMinimumContract(definition(patch), config)).toThrow();
    });
    test('profile versions and finite lifecycle bindings must resolve exactly', () => {
        expect(() => resolveSocietyMinimumContract(definition({ references: { ...raw.references, worldProfiles: [{ profileId: 'mature-society', version: '9.0.0' }] } }), config)).toThrow('unavailable');
        const directory = alteredConfig('population-world-profile-bindings.json', value => value.bindings[0].policyDigest = 'f'.repeat(64));
        expect(() => loadSocietyMinimumContract(directory)).toThrow('stale');
    });
    test('changing dependency contents with the same version invalidates the previously bound contract', () => {
        const old = loadSocietyMinimumContract(config), directory = alteredConfig('needs-dynamics-policies.json', value => value.policies[0].rules[0].onlineAwakePerHour = 301);
        const changed = loadSocietyMinimumContract(directory); expect(changed.digest).not.toBe(old.digest);
        expect(() => assertSocietyMinimumContractBinding(old.digest, changed)).toThrow('changed');
        expect(() => assertSocietyMinimumContractBinding(old.digest, old)).not.toThrow();
    });
    test('free food relief or absent fatigue growth/recovery cannot qualify as a needs economy', () => {
        for (const mutate of [(value: any) => value.policies[0].rules[0].offlineAwakePerHour = 0,
            (value: any) => value.policies[0].rules[1].onlineAwakePerHour = 0,
            (value: any) => value.policies[0].rules[1].offlineSleepingPerHour = 0]) {
            const directory = alteredConfig('needs-dynamics-policies.json', mutate);
            expect(() => loadSocietyMinimumContract(directory)).toThrow('demand');
        }
    });
    test('threshold tampering or rewriting resolved requirements is rejected by exact digests', () => {
        const policy = loadSocietyMinimumPolicy(join(config, 'society-minimum-policy.json'));
        expect(() => societyMinimumRequirements({ ...policy, needs: { ...policy.needs, minimumSatisfiedPersonTimeBasisPoints: 9000 } })).toThrow('stale');
        const contract = loadSocietyMinimumContract(config); const altered = { ...contract, requirements: contract.requirements.slice(1) };
        expect(() => assertSocietyMinimumContractBinding(contract.digest, altered)).toThrow('tampered');
        expect(() => assertSocietyMinimumContractBinding('bad-digest', contract)).toThrow();
    });
});
