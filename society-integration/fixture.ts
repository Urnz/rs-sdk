import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { societyMinimumDigest as digest } from '../society-minimum/policy.js';
import { SkillRegistry } from '../agent-skills/registry.js';
import type { SkillDefinition } from '../agent-skills/types.js';
import { simulationClockProfileDigest } from '../simulation-clock/profile.js';
import { loadWorldGenesisProfileCatalog, buildWorldGenesisConfiguration, buildWorldGenesisResult,
    businessGenesisInventoryDigest, type GenesisAssetAllocation } from '../world-genesis/index.js';
import { loadNativeKitchenPolicy } from '../production-workflow/native-kitchen-policy.js';
import { nativeHousingCatalogs } from '../housing/native-rent.js';
import { loadNeedsPolicyCatalog, loadNeedsDynamicsPolicyCatalog } from '../needs/config.js';
import { loadBusinessStockPolicyCatalog } from '../business-stock-policy/policy.js';
import { compileSurvivalProfile, loadSurvivalProfile, survivalRulesV1, type SurvivalMode } from '../needs/survival.js';
import { healthDigest } from '../population-health/policy.js';
import { withIntegrationSites } from './native-sites.js';

export interface IntegrationSkill { id: string; version: string; definitionDigest: string }
export interface IntegrationAvatar {
    agentId: string; username: string; capabilities: string[]; coinsGp: number; cookedReserve: number;
    position: { x: number; z: number; level: number }; personalSkills: { Fishing: number; Cooking: number };
    tools: { itemId: number; count: number }[]; knownSkills: string[];
}
export interface IntegrationFixture {
    schemaVersion: 1; fixtureId: 'society-lobster-four'; version: '1.0.0' | '1.0.1' | '1.1.0' | '1.2.0' | '1.3.0'; seed: string; worldBuild: 'lostcity-local-v1';
    nativeSiteProfile?: { profileId: 'society-native-sites-v1'; digest: string };
    survival?: { mode: SurvivalMode; rulesDigest: string };
    clock: { clockId: string; initialSimulationTime: string; profile: { schemaVersion: 1; profileId: string; version: string; seed: string;
        rate: { simulationMilliseconds: number; wallMilliseconds: number } } };
    protocol: { maximumWallMinutes: number; llmCalls: 0; externalImports: 'forbidden-after-bootstrap'; nativeHarvest: number; regeneration: 'none'; minimumInternalFood: number };
    skills: IntegrationSkill[]; avatars: IntegrationAvatar[];
    kitchen: { businessId: 'karamja-kitchen'; institutionAgentId: string; propertyId: 'karamja.fishing-hut'; treasuryGp: number;
        rawOpening: number; cookedOpening: number; rawUnitPriceGp: number; cookedUnitPriceGp: number; cookWageGp: number; deliveryWageGp: number;
        cookAgentId: string; courierAgentId: string; ownerAgentId: string };
    housing: { propertyId: 'falador.south-house'; landlordAgentId: string; maximumConcurrentTenants: number; rentGp: number };
    digest: string;
}
export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function fixtureDefinitionDigest(value: Omit<IntegrationFixture, 'digest'> | IntegrationFixture) {
    const { digest: _ignored, ...body } = value as IntegrationFixture; return digest(body);
}
/** Publication status and audit provenance may change during the existing review flow. Runtime pins retain the full checksum. */
export function operationalSkillDigest(input: unknown) {
    const { definition } = new SkillRegistry().register(input, { trusted: true });
    const { status: _status, provenance: _provenance, ...body } = definition; return digest(body);
}
export function validateIntegrationFixture(input: unknown): IntegrationFixture {
    const f = structuredClone(input) as IntegrationFixture;
    check(f && f.schemaVersion === 1 && f.fixtureId === 'society-lobster-four' && ['1.0.0', '1.0.1', '1.1.0', '1.2.0', '1.3.0'].includes(f.version)
        && f.worldBuild === 'lostcity-local-v1' && typeof f.seed === 'string' && f.seed.length > 0 && f.seed.length <= 128, 'Invalid integration fixture identity');
    check(f.digest === fixtureDefinitionDigest(f), 'Integration fixture digest differs');
    check(['1.2.0', '1.3.0'].includes(f.version) ? f.nativeSiteProfile?.profileId === 'society-native-sites-v1' && /^[a-f0-9]{64}$/.test(f.nativeSiteProfile.digest)
        : !f.nativeSiteProfile, 'Native site profile requires a new versioned fixture');
    if (['1.1.0', '1.2.0', '1.3.0'].includes(f.version)) {
        check(f.survival && f.survival.rulesDigest === healthDigest(survivalRulesV1()), 'Survival fixture rules binding differs');
        const expected = compileSurvivalProfile(survivalRulesV1(), f.survival.mode, f.clock.profile.seed);
        check(healthDigest(expected.clock) === healthDigest(f.clock), 'Survival fixture clock/mode differs');
    } else check(!f.survival && f.clock?.profile?.rate?.simulationMilliseconds === 1 && f.clock.profile.rate.wallMilliseconds === 1,
        'Integration fixture requires the normal 1:1 clock');
    check(/^[a-z0-9][a-z0-9.-]{0,95}$/.test(f.clock.clockId) && new Date(f.clock.initialSimulationTime).toISOString() === f.clock.initialSimulationTime, 'Invalid fixture clock');
    check(f.protocol?.maximumWallMinutes >= 60 && f.protocol.maximumWallMinutes <= 90 && Number.isSafeInteger(f.protocol.maximumWallMinutes)
        && f.protocol.llmCalls === 0 && f.protocol.externalImports === 'forbidden-after-bootstrap' && f.protocol.regeneration === 'none'
        && Number.isSafeInteger(f.protocol.nativeHarvest) && f.protocol.nativeHarvest >= 8 && f.protocol.nativeHarvest <= 100000
        && Number.isSafeInteger(f.protocol.minimumInternalFood) && f.protocol.minimumInternalFood >= 4 && f.protocol.minimumInternalFood <= f.protocol.nativeHarvest,
        'Invalid bounded integration protocol');
    check(Array.isArray(f.avatars) && f.avatars.length === 4 && new Set(f.avatars.map(a => a.agentId)).size === 4
        && new Set(f.avatars.map(a => a.username)).size === 4, 'Fixture requires four distinct avatar/actor bindings');
    const amount = (n: number, minimum = 0) => Number.isSafeInteger(n) && n >= minimum && n <= 2147483647;
    const ids = new Set(f.avatars.map(a => a.agentId));
    const skillCount = f.version === '1.3.0' ? 5 : 4;
    check(Array.isArray(f.skills) && f.skills.length === skillCount && new Set(f.skills.map(s => s.id)).size === skillCount
        && f.skills.every(s => /^[a-f0-9]{64}$/.test(s.definitionDigest)), 'Fixture requires its exact versioned skill pins');
    if (f.version === '1.3.0') check(f.skills.some(s => s.id === 'procedure.travel.native-sites'), 'Travel fixture requires its route skill pin');
    for (const a of f.avatars) {
        check(/^[a-z0-9]{1,12}$/.test(a.username) && a.agentId === a.username, 'Invalid exact actor/avatar identity');
        check(amount(a.coinsGp) && amount(a.cookedReserve) && a.cookedReserve <= 2 && Array.isArray(a.tools) && a.tools.length <= 4
            && a.tools.every(t => amount(t.itemId) && t.itemId <= 65534 && ![377, 379, 381, 995].includes(t.itemId) && amount(t.count, 1)), 'Invalid finite bootstrap inventory');
        check(a.tools.reduce((n, t) => n + t.count, 0) + a.cookedReserve + Number(a.coinsGp > 0) <= 28, 'Fixture inventory exceeds physical slots');
        check(a.position && amount(a.position.x) && a.position.x <= 16383 && amount(a.position.z) && a.position.z <= 16383
            && amount(a.position.level) && a.position.level <= 3, 'Invalid fixture position');
        check(a.personalSkills && [a.personalSkills.Fishing, a.personalSkills.Cooking].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 99), 'Invalid personal skill baseline');
        check(Array.isArray(a.knownSkills) && a.knownSkills.every(id => f.skills.some(s => s.id === id))
            && a.knownSkills.includes('procedure.food.consume-lobster'), 'Every actor requires the exact consumption skill');
        if (f.version === '1.3.0') check(a.knownSkills.includes('procedure.travel.native-sites'), 'Every travel-fixture actor requires route knowledge');
    }
    const k = f.kitchen, h = f.housing;
    check(k?.businessId === 'karamja-kitchen' && k.propertyId === 'karamja.fishing-hut' && !ids.has(k.institutionAgentId)
        && /^[a-z0-9][a-z0-9.-]{1,95}$/.test(k.institutionAgentId) && ids.has(k.cookAgentId) && ids.has(k.courierAgentId)
        && k.cookAgentId !== k.courierAgentId && ids.has(k.ownerAgentId), 'Invalid avatarless Business composition');
    check([k.treasuryGp, k.rawOpening, k.cookedOpening, k.rawUnitPriceGp, k.cookedUnitPriceGp, k.cookWageGp, k.deliveryWageGp].every(n => amount(n))
        && k.rawOpening <= 8 && k.cookedOpening === 0 && k.rawUnitPriceGp > 0 && k.cookedUnitPriceGp > 0
        && k.treasuryGp >= f.protocol.minimumInternalFood * k.rawUnitPriceGp + k.cookWageGp + k.deliveryWageGp, 'Insufficient finite kitchen procurement/wage runway');
    check(f.version === '1.0.0' || k.rawOpening === 0, 'Native procurement fixtures start with an empty raw stock');
    check(h?.propertyId === 'falador.south-house' && ids.has(h.landlordAgentId) && amount(h.maximumConcurrentTenants, 1) && h.maximumConcurrentTenants <= 2
        && amount(h.rentGp, 1), 'Invalid rental capacity');
    check(f.avatars.filter(a => a.agentId !== h.landlordAgentId).some(a => a.coinsGp >= h.rentGp + k.cookedUnitPriceGp), 'No tenant can fund rent plus food');
    check(f.avatars.find(a => a.agentId === k.cookAgentId)!.personalSkills.Cooking >= 40, 'Cook lacks level 40');
    check(f.avatars.some(a => a.capabilities.includes('gather') && a.personalSkills.Fishing >= 40 && a.tools.some(t => t.itemId === 301)), 'Gatherer requires level 40 and a lobster pot');
    return f;
}
export function loadIntegrationFixture(path: string) { return validateIntegrationFixture(JSON.parse(readFileSync(path, 'utf8'))); }
export function buildSurvivalIntegrationFixture(base: IntegrationFixture, mode: SurvivalMode): IntegrationFixture {
    validateIntegrationFixture(base);
    const profile = compileSurvivalProfile(survivalRulesV1(), mode, base.seed);
    const body = { ...structuredClone(base), version: '1.1.0' as const, clock: profile.clock,
        survival: { mode, rulesDigest: profile.rulesDigest } };
    return validateIntegrationFixture({ ...body, digest: fixtureDefinitionDigest(body) });
}
export function buildNativeSiteIntegrationFixture(root: string, base: IntegrationFixture, skills: IntegrationSkill[]): IntegrationFixture {
    validateIntegrationFixture(base); check(base.survival, 'Native sites require the day-survival rules');
    const profile = JSON.parse(readFileSync(join(root, 'config/society-native-sites.json'), 'utf8'));
    check(profile.schemaVersion === 1 && profile.profileId === 'society-native-sites-v1', 'Native site profile unavailable');
    const body = { ...structuredClone(base), version: '1.2.0' as const, skills: structuredClone(skills),
        nativeSiteProfile: { profileId: 'society-native-sites-v1' as const, digest: digest(profile) } };
    body.avatars.find(a => a.agentId === body.housing.landlordAgentId)!.position = structuredClone(profile.housing.landlordPosition);
    return validateIntegrationFixture({ ...body, digest: fixtureDefinitionDigest(body) });
}
/** New world only. Food, physiology, geography and opening wealth remain unchanged. */
export function buildTravelIntegrationFixture(base: IntegrationFixture, travel: IntegrationSkill): IntegrationFixture {
    validateIntegrationFixture(base);
    check(base.version === '1.2.0' && travel.id === 'procedure.travel.native-sites', 'Travel extends the exact native-site fixture');
    const body = { ...structuredClone(base), version: '1.3.0' as const, skills: [...structuredClone(base.skills), structuredClone(travel)],
        avatars: base.avatars.map(a => ({ ...structuredClone(a), knownSkills: [...a.knownSkills, travel.id] })) };
    return validateIntegrationFixture({ ...body, digest: fixtureDefinitionDigest(body) });
}
export function integrationWorldId(f: IntegrationFixture) {
    const h = f.digest; return `srv-${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function inspectIntegrationReferences(root: string, f: IntegrationFixture) {
    return withIntegrationSites(root, f, effective => inspectEffectiveIntegrationReferences(effective, f));
}
function inspectEffectiveIntegrationReferences(root: string, f: IntegrationFixture) {
    validateIntegrationFixture(f);
    const read = (name: string) => JSON.parse(readFileSync(join(root, 'config', name), 'utf8'));
    const harvest = read('native-food-production.json'), kitchen = loadNativeKitchenPolicy(root), housing = nativeHousingCatalogs(root);
    check(read('society-integrity-policy.json').invalidateOnInjection === true, 'Integration requires runtime value-injection invalidation');
    const survival = f.survival ? loadSurvivalProfile(root) ?? compileSurvivalProfile(read('survival-rules.json'), f.survival.mode, f.clock.profile.seed) : null;
    if (f.survival) check(survival?.rulesDigest === f.survival.rulesDigest && healthDigest(survival.clock) === healthDigest(f.clock), 'Survival source configuration differs');
    const policy = survival?.policy ?? loadNeedsPolicyCatalog(join(root, 'config/needs-policies.json')).policies[0]!;
    const dynamics = survival?.dynamics ?? loadNeedsDynamicsPolicyCatalog(join(root, 'config/needs-dynamics-policies.json'), policy).policies[0]!;
    check(harvest.foodChainId === 'lobster' && harvest.sources.length === 1 && harvest.sources[0].quantity === f.protocol.nativeHarvest,
        'Finite harvest policy differs from fixture');
    check(kitchen.recipeId === 'food.cook-lobster' && kitchen.facilityId === 'karamja.fishing-hut.utility', 'Native kitchen recipe/facility differs');
    const unit = housing.units.units.find(u => u.housingUnitId === housing.native.housingUnitId)!;
    check(unit.propertyId === f.housing.propertyId && unit.capacity >= f.housing.maximumConcurrentTenants && unit.rentGpPerPeriod === f.housing.rentGp,
        'Native housing capacity or fixed rent differs');
    const stock = loadBusinessStockPolicyCatalog(join(root, 'config/business-stock-policies.json'));
    const raw = stock.policies.find(p => p.businessId === f.kitchen.businessId && p.itemId === 377)!;
    const cooked = stock.policies.find(p => p.businessId === f.kitchen.businessId && p.itemId === 379)!;
    check(raw?.procurement.maxUnitPriceGp === f.kitchen.rawUnitPriceGp && cooked?.pricing.saleUnitPriceGp === f.kitchen.cookedUnitPriceGp,
        'Fixture price exceeds or differs from native fixed price policy');
    const definitions = f.skills.map(ref => {
        const definition = JSON.parse(readFileSync(join(root, 'agent-skills/catalog', `${ref.id}@${ref.version}.skill.json`), 'utf8')) as SkillDefinition;
        check(operationalSkillDigest(definition) === ref.definitionDigest, `Pinned skill content differs: ${ref.id}`); return definition;
    });
    if (f.nativeSiteProfile) {
        const cook = definitions.find(s => s.id === 'procedure.food.cook-lobster')!;
        const step = cook.steps.find(s => s.kind === 'operation' && s.operation === 'food-cook');
        check(step?.kind === 'operation' && step.arguments.heatX === kitchen.heat.x && step.arguments.heatZ === kitchen.heat.z,
            'Pinned cooking procedure does not use the actual configured native heat');
    }
    const delivery = definitions.find(s => s.id === 'trade.lumbridge.give-item')!;
    const meeting = delivery.steps.find(s => s.kind === 'operation' && s.operation === 'walk-to');
    return { kitchenDigest: kitchen.digest, housingDigest: digest(housing), needsPolicyDigest: policy.digest, dynamicsDigest: dynamics.digest,
        finiteHarvest: harvest, initialNeeds: policy.needs.map(n => ({ needId: n.needId, value: n.initialValue, remainderNumerator: 0 })),
        deliveryMeeting: meeting?.kind === 'operation' ? meeting.arguments : null,
        limitations: ['The existing delivery skill meets in Lumbridge; no boat or free relocation is inferred from a straight-line path.',
            'Two native bed slots are a concurrent capacity limit, not four simultaneous entitlements.',
            'Bootstrap food is survival reserve and never satisfies internal final-use acceptance.'] };
}
export function integrationGenesis(root: string, f: IntegrationFixture) {
    const profile = loadWorldGenesisProfileCatalog(join(root, 'config/world-genesis-profiles.json')).profiles.find(p => p.profileId === 'mature-society')!;
    const assets: GenesisAssetAllocation[] = [];
    for (const a of f.avatars) {
        if (a.coinsGp) assets.push({ allocationId: `${a.agentId}-gp`, kind: 'currency', owner: { kind: 'player', id: a.username }, amountGp: a.coinsGp });
        for (const [index, item] of [...a.tools, ...(a.cookedReserve ? [{ itemId: 379, count: a.cookedReserve }] : [])].entries())
            assets.push({ allocationId: `${a.agentId}-item-${index}`, kind: 'item', owner: { kind: 'player', id: a.username }, container: 'inventory', ...item, slot: null });
    }
    if (f.kitchen.rawOpening) assets.push({ allocationId: 'kitchen-raw', kind: 'item', owner: { kind: 'business', id: f.kitchen.businessId },
        container: 'business-stock', itemId: 377, count: f.kitchen.rawOpening, slot: null });
    assets.push({ allocationId: 'kitchen', kind: 'business', owner: { kind: 'player', id: f.kitchen.ownerAgentId }, businessId: f.kitchen.businessId,
        openingCapitalGp: f.kitchen.treasuryGp, openingInventoryDigest: businessGenesisInventoryDigest(assets, f.kitchen.businessId) },
    { allocationId: 'kitchen-title', kind: 'property', owner: { kind: 'business', id: f.kitchen.businessId }, propertyId: f.kitchen.propertyId },
    { allocationId: 'housing-title', kind: 'property', owner: { kind: 'player', id: f.housing.landlordAgentId }, propertyId: f.housing.propertyId });
    const configuration = buildWorldGenesisConfiguration({ seed: f.seed, profile, worldBuild: f.worldBuild,
        simulationClock: { clockId: f.clock.clockId, profileDigest: simulationClockProfileDigest(f.clock.profile), initialSimulationTime: f.clock.initialSimulationTime },
        parameters: { integrationFixtureDigest: f.digest } });
    return buildWorldGenesisResult(configuration, { assets, populationMembers: f.avatars.map(a => ({ agentId: a.agentId, playerUsername: a.username })) },
        '2026-10-19T00:00:00.000Z');
}
