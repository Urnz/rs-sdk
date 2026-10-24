import { join,dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loadSurvivalProfile } from '../needs/survival.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../needs/config.js';
import { loadHousingTierPolicyCatalog, loadHousingEffectPolicyCatalog } from '../housing/config.js';
import { loadFoodLoopCatalog } from '../food-loop/catalog.js';
import { loadItemLifecycleCatalog } from '../item-lifecycle/catalog.js';
import { loadProductionToolCycleCatalog } from '../item-lifecycle/production-cycle.js';
import { loadWorldGenesisProfileCatalog } from '../world-genesis/config.js';
import { loadPopulationLifecyclePolicyCatalog, loadPopulationWorldProfileBindingCatalog,
    resolvePopulationLifecyclePolicy } from '../population-lifecycle/config.js';
import { loadSimulationClockRuntimeConfig } from '../simulation-clock/config.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { loadExternalTradeCatalogs, resolveExternalTradePolicy } from '../external-trade/policy.js';
import { loadSocietyMinimumPolicy, validateSocietyMinimumPolicy, societyMinimumRequirements, societyMinimumDigest,
    type SocietyMinimumPolicy, type SocietyPolicyReference } from './policy.js';

function select<T extends SocietyPolicyReference>(values: T[], ref: SocietyPolicyReference): T {
    const policy = values.find(item => item.policyId === ref.policyId && item.version === ref.version);
    if (!policy) throw new Error(`Society minimum dependency is unavailable: ${ref.policyId}@${ref.version}`); return policy;
}

/** A definition snapshot. This function collects no run data and cannot certify a society. */
export function resolveSocietyMinimumContract(input: SocietyMinimumPolicy, configDirectory: string) {
    const { digest, ...definition } = input, policy = validateSocietyMinimumPolicy(definition);
    if (digest !== policy.digest) throw new Error('Society minimum policy digest is stale');
    const path = (name: string) => join(configDirectory, name);
    const refs = policy.references;
    const needs = select(loadNeedsPolicyCatalog(path('needs-policies.json')).policies, refs.needs);
    const dynamics = select(loadNeedsDynamicsPolicyCatalog(path('needs-dynamics-policies.json'), needs).policies, refs.dynamics);
    const hunger = dynamics.rules.find(rule => rule.needId === 'hunger'), fatigue = dynamics.rules.find(rule => rule.needId === 'fatigue');
    if (!hunger || !fatigue || [hunger.onlineAwakePerHour, hunger.offlineAwakePerHour,
        hunger.onlineSleepingPerHour, hunger.offlineSleepingPerHour, fatigue.onlineAwakePerHour, fatigue.offlineAwakePerHour].some(rate => rate <= 0)
        || fatigue.onlineSleepingPerHour >= 0 || fatigue.offlineSleepingPerHour >= 0)
        throw new Error('Society minimum requires real hunger/fatigue demand and sleep recovery');
    const hierarchy = select(loadHousingTierPolicyCatalog(path('housing-tier-policies.json')).policies, refs.housingHierarchy);
    const effects = select(loadHousingEffectPolicyCatalog(path('housing-effect-policies.json'), hierarchy).policies, refs.housingEffects);
    const tier = hierarchy.tiers.find(tier => tier.tierId === policy.housing.minimumTierId);
    const effect = effects.effects.find(effect => effect.tierId === policy.housing.minimumTierId);
    if (!tier || tier.rank < 1 || !effect || effect.fatigueRecoveryMultiplierBasisPoints <= 0)
        throw new Error('Society minimum requires a real shelter tier with sleep recovery');
    const food = loadFoodLoopCatalog(path('food-loops.json'));
    const chains = policy.food.chainIds.map(id => {
        const chain = food.chains.find(item => item.foodChainId === id);
        if (!chain) throw new Error(`Society minimum food chain is unavailable: ${id}`); return chain;
    });
    const lifecycle = loadItemLifecycleCatalog(path('item-lifecycle.json'));
    const production = loadProductionToolCycleCatalog(path('production-tool-cycles.json'), lifecycle);
    const cycles = policy.tools.cycleIds.map(id => {
        const cycle = production.cycles.find(item => item.cycleId === id);
        if (!cycle) throw new Error(`Society minimum tool cycle is unavailable: ${id}`);
        const item = lifecycle.items.find(item => item.lifecycleTypeId === cycle.lifecycleTypeId)!;
        if (item.wearPerUse <= 0) throw new Error('Society minimum cannot certify an unwearing tool');
        return { cycle, item };
    });
    const profiles = loadWorldGenesisProfileCatalog(path('world-genesis-profiles.json'));
    const policies = loadPopulationLifecyclePolicyCatalog(path('population-lifecycle-policies.json'));
    const bindings = loadPopulationWorldProfileBindingCatalog(path('population-world-profile-bindings.json'));
    const externalTrade = loadExternalTradeCatalogs(configDirectory);
    const worlds = refs.worldProfiles.map(ref => {
        const profile = profiles.profiles.find(item => item.profileId === ref.profileId && item.version === ref.version);
        if (!profile) throw new Error('Society minimum world profile is unavailable');
        if (resolveExternalTradePolicy(profile, externalTrade)) throw new Error('Closed society minimum cannot permit external trade');
        const finite = resolvePopulationLifecyclePolicy(profile, policies, bindings);
        if (!finite || finite.kind !== 'finite' || finite.respawn !== 'forbidden'
            || policy.population.minimumFounders > profile.population.maximumAgents)
            throw new Error('Society minimum requires a finite social world and a feasible founder population');
        return { profile, lifecyclePolicy: finite };
    });
    const clock = loadSimulationClockRuntimeConfig(path('simulation-clock.json'));
    const contract = { schemaVersion: 1 as const, artifactKind: 'society-minimum-measurement-contract' as const,
        measurementStatus: 'unmeasured' as const, policy,
        dependencies: { worlds, needs, dynamics, housingHierarchy: hierarchy, housingEffects: effects, externalTrade,
            food: { catalogDigest: food.digest, chains }, tools: { productionCatalogDigest: production.digest, lifecycleCatalogDigest: lifecycle.digest, cycles },
            simulationClock: { ...clock, profileDigest: simulationClockProfileDigest(clock.profile) } },
        requirements: societyMinimumRequirements(policy),
        assessmentProtocol: { qualifyingResult: 'all-integrity-gates-and-all-requirements-in-every-required-scope',
            missingOrUnsupportedEvidence: 'inconclusive', provenViolation: 'fail', zeroDemand: 'inconclusive',
            eventWindowBounds: '(start,end]', exposureIntervalBounds: '[start,end)',
            integrityWindow: 'genesis-apply-through-evaluation-end-including-warmup', cohort: 'fixed-founders-including-offline-members',
            evidenceAuthority: 'native-verified-ledgers-and-complete-time-coverage', divisionOfLabor: 'producer-to-distinct-consumer-final-use-lineage' },
        requiredRunBindings: ['contractDigest', 'genesisResultId', 'genesisResultDigest', 'genesisAppliedAtSimulationTime',
            'clockId', 'clockProfileDigest', 'worldBuild', 'activeWorldModsDigest', 'founderRosterDigest', 'attributeDistributionDigest',
            'runSeed', 'evaluationStartSimulationTime', 'evaluationEndSimulationTime', 'sourceWatermarksAndCoverage'] };
    return { ...contract, digest: societyMinimumDigest(contract) };
}
export type SocietyMinimumContract = ReturnType<typeof resolveSocietyMinimumContract> & {physiologyBinding?:{
    protocol:string;declaredPolicyDigest:string;effectivePolicyDigest:string;survivalSelectionDigest:string;requirementsDigest:string}};
export function loadSocietyMinimumContract(configDirectory: string): SocietyMinimumContract {
    const declared=loadSocietyMinimumPolicy(join(configDirectory,'society-minimum-policy.json'));
    if(!existsSync(join(configDirectory,'survival-profile.json')))return resolveSocietyMinimumContract(declared,configDirectory);
    const survival=loadSurvivalProfile(dirname(configDirectory));
    if(!survival)throw new Error('Minimum survival binding requires a validated world selection');
    // Bind references to the already-verified effective physiology. Never alter acceptance numbers or rewrite policy files.
    const {digest:declaredDigest,...definition}=declared;
    const effective=validateSocietyMinimumPolicy({...definition,references:{...definition.references,
        needs:{policyId:survival.policy.policyId,version:survival.policy.version},dynamics:{policyId:survival.dynamics.policyId,version:survival.dynamics.version}}});
    if(societyMinimumDigest(societyMinimumRequirements(effective))!==societyMinimumDigest(societyMinimumRequirements(declared)))
        throw new Error('Survival reference binding changed minimum requirements');
    const {digest:_resolved,...resolved}=resolveSocietyMinimumContract(effective,configDirectory);
    const body={...resolved,physiologyBinding:{protocol:'verified-survival-minimum-references-v1',declaredPolicyDigest:declaredDigest,
        effectivePolicyDigest:effective.digest,survivalSelectionDigest:survival.selection.digest,requirementsDigest:societyMinimumDigest(resolved.requirements)}};
    return{...body,digest:societyMinimumDigest(body)};
}
export function assertSocietyMinimumContractBinding(expectedDigest: string, contract: SocietyMinimumContract): void {
    const { digest, ...definition } = contract;
    if (!/^[0-9a-f]{64}$/.test(expectedDigest) || digest !== expectedDigest || societyMinimumDigest(definition) !== digest)
        throw new Error('Society minimum contract binding changed or was tampered with');
}
