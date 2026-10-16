import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SOCIETY_MINIMUM_INTEGRITY_GATES = [
    'applied-genesis-baseline', 'complete-source-coverage', 'unchanged-clock-and-world-policy',
    'finite-lifecycle-no-respawn', 'no-post-genesis-admin-or-fallback-value',
    'no-external-shop-or-import-value', 'frozen-founder-roster', 'verified-internal-lineage-and-final-use'
] as const;
export const SOCIETY_PRODUCTIVE_STAGES = ['food-gathering', 'food-processing', 'tool-maintenance'] as const;
export interface SocietyPolicyReference { policyId: string; version: string }
export interface SocietyMinimumPolicyDefinition {
    schemaVersion: 1; policyId: string; version: string; scope: 'closed-economy-finite-society';
    window: { warmupSimulationMilliseconds: number; evaluationSimulationMilliseconds: number;
        bucketSimulationMilliseconds: number; maximumTraceGapSimulationMilliseconds: number };
    population: { minimumFounders: number; minimumLivingFounders: number; minimumFounderSurvivalBasisPoints: number };
    needs: { minimumSatisfiedPersonTimeBasisPoints: number; maximumContinuousCriticalSimulationMilliseconds: number };
    food: { chainIds: string[]; minimumInternalReliefShareBasisPoints: 10000;
        minimumReserveSimulationMilliseconds: number; minimumStockRetentionBasisPoints: 10000 };
    housing: { minimumTierId: string };
    tools: { cycleIds: string[]; minimumMaintenanceCyclesPerType: number;
        maximumUnusableDemandSimulationMilliseconds: number; minimumServiceCapacityRetentionBasisPoints: 10000 };
    labor: { minimumActiveProducersPerBucket: number; minimumInterActorFinalUseChainsPerBucket: number;
        requiredStageKinds: Array<typeof SOCIETY_PRODUCTIVE_STAGES[number]> };
    references: { worldProfiles: Array<{ profileId: string; version: string }>; needs: SocietyPolicyReference;
        dynamics: SocietyPolicyReference; housingHierarchy: SocietyPolicyReference; housingEffects: SocietyPolicyReference };
    integrityGates: Array<typeof SOCIETY_MINIMUM_INTEGRITY_GATES[number]>;
}
export interface SocietyMinimumPolicy extends SocietyMinimumPolicyDefinition { digest: string }
export interface SocietyMinimumRequirement {
    requirementId: string; comparison: 'at-least' | 'at-most'; threshold: number;
    unit: 'count' | 'basis-points' | 'simulation-milliseconds';
    scope: 'opening-boundary' | 'closing-boundary' | 'every-member-every-bucket' | 'every-bucket'
        | 'all-observation-boundaries' | 'every-member-whole-window' | 'every-tool-type-whole-window' | 'whole-window';
    zeroDemand: 'inconclusive';
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
}
export function societyMinimumDigest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error(`${label} fields are invalid`);
    return value as Record<string, unknown>;
}
function key(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(value)) throw new Error('Society minimum identifier is invalid'); return value;
}
function version(value: unknown): string {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Society minimum version is invalid'); return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Society minimum threshold is invalid'); return value;
}
function list(value: unknown, required?: readonly string[]): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64) throw new Error('Society minimum list is invalid');
    const values = value.map(key).sort();
    if (new Set(values).size !== values.length || required && values.join(',') !== [...required].sort().join(','))
        throw new Error('Society minimum list is duplicate or omits mandatory requirements');
    return values;
}
function reference(value: unknown): SocietyPolicyReference {
    const raw = object(value, ['policyId', 'version'], 'Society dependency'); return { policyId: key(raw.policyId), version: version(raw.version) };
}
export function validateSocietyMinimumPolicy(input: unknown): SocietyMinimumPolicy {
    const value = object(input, ['schemaVersion', 'policyId', 'version', 'scope', 'window', 'population', 'needs',
        'food', 'housing', 'tools', 'labor', 'references', 'integrityGates'], 'Society minimum policy');
    if (value.schemaVersion !== 1 || value.scope !== 'closed-economy-finite-society') throw new Error('Unsupported society minimum scope/schema');
    const window = object(value.window, ['warmupSimulationMilliseconds', 'evaluationSimulationMilliseconds',
        'bucketSimulationMilliseconds', 'maximumTraceGapSimulationMilliseconds'], 'Minimum observation window');
    const duration = integer(window.evaluationSimulationMilliseconds, 1, 31_536_000_000);
    const bucket = integer(window.bucketSimulationMilliseconds, 1, duration);
    if (duration % bucket !== 0) throw new Error('Society minimum must cover complete consecutive buckets');
    const warmup = integer(window.warmupSimulationMilliseconds, 1, 31_536_000_000);
    const gap = integer(window.maximumTraceGapSimulationMilliseconds, 1, bucket);
    const population = object(value.population, ['minimumFounders', 'minimumLivingFounders', 'minimumFounderSurvivalBasisPoints'], 'Minimum population');
    const founders = integer(population.minimumFounders, 2, 10000), living = integer(population.minimumLivingFounders, 2, founders);
    const needs = object(value.needs, ['minimumSatisfiedPersonTimeBasisPoints', 'maximumContinuousCriticalSimulationMilliseconds'], 'Minimum needs');
    const food = object(value.food, ['chainIds', 'minimumInternalReliefShareBasisPoints', 'minimumReserveSimulationMilliseconds', 'minimumStockRetentionBasisPoints'], 'Minimum food');
    const housing = object(value.housing, ['minimumTierId'], 'Minimum housing');
    const tools = object(value.tools, ['cycleIds', 'minimumMaintenanceCyclesPerType', 'maximumUnusableDemandSimulationMilliseconds', 'minimumServiceCapacityRetentionBasisPoints'], 'Minimum tools');
    const labor = object(value.labor, ['minimumActiveProducersPerBucket', 'minimumInterActorFinalUseChainsPerBucket', 'requiredStageKinds'], 'Minimum division of labor');
    if (food.minimumInternalReliefShareBasisPoints !== 10000 || food.minimumStockRetentionBasisPoints !== 10000
        || tools.minimumServiceCapacityRetentionBasisPoints !== 10000) throw new Error('Closed society minimum cannot qualify imported supply or depletion');
    const refs = object(value.references, ['worldProfiles', 'needs', 'dynamics', 'housingHierarchy', 'housingEffects'], 'Society references');
    if (!Array.isArray(refs.worldProfiles) || refs.worldProfiles.length < 1 || refs.worldProfiles.length > 5) throw new Error('Society world profile references are invalid');
    const profiles = refs.worldProfiles.map(raw => { const item = object(raw, ['profileId', 'version'], 'World profile reference');
        return { profileId: key(item.profileId), version: version(item.version) }; }).sort((a, b) => a.profileId.localeCompare(b.profileId));
    if (new Set(profiles.map(item => item.profileId)).size !== profiles.length) throw new Error('Duplicate society world profile reference');
    const definition: SocietyMinimumPolicyDefinition = { schemaVersion: 1, policyId: key(value.policyId), version: version(value.version),
        scope: 'closed-economy-finite-society', window: { warmupSimulationMilliseconds: warmup, evaluationSimulationMilliseconds: duration,
            bucketSimulationMilliseconds: bucket, maximumTraceGapSimulationMilliseconds: gap },
        population: { minimumFounders: founders, minimumLivingFounders: living,
            minimumFounderSurvivalBasisPoints: integer(population.minimumFounderSurvivalBasisPoints, 1, 10000) },
        needs: { minimumSatisfiedPersonTimeBasisPoints: integer(needs.minimumSatisfiedPersonTimeBasisPoints, 1, 10000),
            maximumContinuousCriticalSimulationMilliseconds: integer(needs.maximumContinuousCriticalSimulationMilliseconds, 1, bucket) },
        food: { chainIds: list(food.chainIds), minimumInternalReliefShareBasisPoints: 10000,
            minimumReserveSimulationMilliseconds: integer(food.minimumReserveSimulationMilliseconds, 1, duration), minimumStockRetentionBasisPoints: 10000 },
        housing: { minimumTierId: key(housing.minimumTierId) },
        tools: { cycleIds: list(tools.cycleIds), minimumMaintenanceCyclesPerType: integer(tools.minimumMaintenanceCyclesPerType, 1, 10000),
            maximumUnusableDemandSimulationMilliseconds: integer(tools.maximumUnusableDemandSimulationMilliseconds, 1, bucket), minimumServiceCapacityRetentionBasisPoints: 10000 },
        labor: { minimumActiveProducersPerBucket: integer(labor.minimumActiveProducersPerBucket, 2, founders),
            minimumInterActorFinalUseChainsPerBucket: integer(labor.minimumInterActorFinalUseChainsPerBucket, 1, 10000),
            requiredStageKinds: list(labor.requiredStageKinds, SOCIETY_PRODUCTIVE_STAGES) as SocietyMinimumPolicyDefinition['labor']['requiredStageKinds'] },
        references: { worldProfiles: profiles, needs: reference(refs.needs), dynamics: reference(refs.dynamics),
            housingHierarchy: reference(refs.housingHierarchy), housingEffects: reference(refs.housingEffects) },
        integrityGates: list(value.integrityGates, SOCIETY_MINIMUM_INTEGRITY_GATES) as SocietyMinimumPolicyDefinition['integrityGates'] };
    return { ...definition, digest: societyMinimumDigest(definition) };
}
export function loadSocietyMinimumPolicy(path: string): SocietyMinimumPolicy { return validateSocietyMinimumPolicy(JSON.parse(readFileSync(path, 'utf8'))); }
export function societyMinimumRequirements(input: SocietyMinimumPolicy): SocietyMinimumRequirement[] {
    const { digest, ...definition } = input, policy = validateSocietyMinimumPolicy(definition);
    if (digest !== policy.digest) throw new Error('Society minimum policy digest is stale');
    const rules: SocietyMinimumRequirement[] = [];
    const add = (requirementId: string, comparison: SocietyMinimumRequirement['comparison'], threshold: number,
        unit: SocietyMinimumRequirement['unit'], scope: SocietyMinimumRequirement['scope']) => rules.push({ requirementId, comparison, threshold, unit, scope, zeroDemand: 'inconclusive' });
    add('founders-at-start', 'at-least', policy.population.minimumFounders, 'count', 'opening-boundary');
    add('minimum-living-founders', 'at-least', policy.population.minimumLivingFounders, 'count', 'all-observation-boundaries');
    add('founder-survival', 'at-least', policy.population.minimumFounderSurvivalBasisPoints, 'basis-points', 'closing-boundary');
    for (const need of ['hunger', 'fatigue']) {
        add(`${need}-satisfied-time`, 'at-least', policy.needs.minimumSatisfiedPersonTimeBasisPoints, 'basis-points', 'every-member-every-bucket');
        add(`${need}-continuous-critical-time`, 'at-most', policy.needs.maximumContinuousCriticalSimulationMilliseconds, 'simulation-milliseconds', 'every-member-whole-window');
    }
    add('internal-food-relief-share', 'at-least', policy.food.minimumInternalReliefShareBasisPoints, 'basis-points', 'every-bucket');
    add('food-reserve-coverage', 'at-least', policy.food.minimumReserveSimulationMilliseconds, 'simulation-milliseconds', 'all-observation-boundaries');
    add('food-stock-retention', 'at-least', policy.food.minimumStockRetentionBasisPoints, 'basis-points', 'closing-boundary');
    add('legal-housing-access-time', 'at-least', policy.needs.minimumSatisfiedPersonTimeBasisPoints, 'basis-points', 'every-member-every-bucket');
    add('tool-maintenance-cycles', 'at-least', policy.tools.minimumMaintenanceCyclesPerType, 'count', 'every-tool-type-whole-window');
    add('tool-unusable-demand-time', 'at-most', policy.tools.maximumUnusableDemandSimulationMilliseconds, 'simulation-milliseconds', 'every-tool-type-whole-window');
    add('tool-service-capacity-retention', 'at-least', policy.tools.minimumServiceCapacityRetentionBasisPoints, 'basis-points', 'closing-boundary');
    add('productive-participants', 'at-least', policy.labor.minimumActiveProducersPerBucket, 'count', 'every-bucket');
    add('productive-stage-kinds', 'at-least', policy.labor.requiredStageKinds.length, 'count', 'whole-window');
    add('inter-actor-final-use-chains', 'at-least', policy.labor.minimumInterActorFinalUseChainsPerBucket, 'count', 'every-bucket');
    return rules;
}
