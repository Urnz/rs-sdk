import { createHash } from 'node:crypto';
import { WORLD_GENESIS_PROFILE_SCHEMA_VERSION, type GenesisInventoryPolicy,
    type GenesisOwnershipPolicy, type GenesisWealthDistribution, type WorldGenesisProfile,
    type WorldGenesisProfileDefinition, type WorldGenesisProfileId } from './types.js';

const IDS = new Set<WorldGenesisProfileId>([
    'blank-slate', 'frontier', 'seeded-economy', 'mature-society', 'historical-burn-in'
]);
const VERSIONS = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const WEALTH = new Set<GenesisWealthDistribution>(['minimal', 'small-stake', 'generated', 'stratified']);
const OWNERSHIP = new Set<GenesisOwnershipPolicy>(['unowned', 'shelter-only', 'generated', 'stratified']);
const INVENTORY = new Set<GenesisInventoryPolicy>(['empty', 'survival-kit', 'profession-kit', 'mature-stock']);

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
    const actual = Object.keys(value).sort().join(','), expected = [...keys].sort().join(',');
    if (actual !== expected) throw new Error(`${field} fields are invalid`);
}

function text(value: unknown, field: string, maximum: number): string {
    if (typeof value !== 'string') throw new Error(`${field} is required`);
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > maximum) throw new Error(`${field} must contain 1-${maximum} characters`);
    return normalized;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return Number(value);
}

function boolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`);
    return value;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
}

export function worldGenesisProfileDigest(profile: WorldGenesisProfileDefinition): string {
    return createHash('sha256').update(JSON.stringify(canonical(profile))).digest('hex');
}

export function validateWorldGenesisProfile(value: unknown): WorldGenesisProfile {
    const profile = record(value, 'World genesis profile');
    exact(profile, ['schemaVersion', 'profileId', 'version', 'label', 'description', 'population', 'assets',
        'economy', 'burnIn'], 'World genesis profile');
    if (profile.schemaVersion !== WORLD_GENESIS_PROFILE_SCHEMA_VERSION || !IDS.has(profile.profileId as WorldGenesisProfileId)) {
        throw new Error('World genesis profile identity is invalid');
    }
    const profileId = profile.profileId as WorldGenesisProfileId;
    const version = text(profile.version, 'version', 32);
    if (!VERSIONS.test(version)) throw new Error('World genesis profile version must use semantic versioning');

    const population = record(profile.population, 'population');
    exact(population, ['minimumAgents', 'maximumAgents', 'assignProfessions'], 'population');
    const minimumAgents = integer(population.minimumAgents, 'minimumAgents', 0, 10_000);
    const maximumAgents = integer(population.maximumAgents, 'maximumAgents', minimumAgents, 10_000);

    const assets = record(profile.assets, 'assets');
    exact(assets, ['wealthDistribution', 'ownership', 'inventory', 'starterFood', 'starterTools',
        'starterHousing'], 'assets');
    if (!WEALTH.has(assets.wealthDistribution as GenesisWealthDistribution)
        || !OWNERSHIP.has(assets.ownership as GenesisOwnershipPolicy)
        || !INVENTORY.has(assets.inventory as GenesisInventoryPolicy)) throw new Error('Genesis asset policy is invalid');

    const economy = record(profile.economy, 'economy');
    exact(economy, ['createBusinesses', 'createContracts', 'createLeases', 'createInstitutions',
        'seedBusinessInventory'], 'economy');
    const burnIn = profile.burnIn === null ? null : (() => {
        const input = record(profile.burnIn, 'burnIn');
        exact(input, ['sourceProfileId', 'durationSimulationMilliseconds', 'access'], 'burnIn');
        if (!IDS.has(input.sourceProfileId as WorldGenesisProfileId) || input.sourceProfileId === 'historical-burn-in'
            || input.access !== 'agent-only') throw new Error('Historical burn-in policy is invalid');
        return { sourceProfileId: input.sourceProfileId as Exclude<WorldGenesisProfileId, 'historical-burn-in'>,
            durationSimulationMilliseconds: integer(input.durationSimulationMilliseconds,
                'durationSimulationMilliseconds', 1, 31_536_000_000), access: 'agent-only' as const };
    })();
    if ((profileId === 'historical-burn-in') !== (burnIn !== null)) {
        throw new Error('Only historical-burn-in may define a burn-in policy');
    }

    const definition: WorldGenesisProfileDefinition = {
        schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, profileId, version,
        label: text(profile.label, 'label', 80), description: text(profile.description, 'description', 500),
        population: { minimumAgents, maximumAgents,
            assignProfessions: boolean(population.assignProfessions, 'assignProfessions') },
        assets: { wealthDistribution: assets.wealthDistribution as GenesisWealthDistribution,
            ownership: assets.ownership as GenesisOwnershipPolicy,
            inventory: assets.inventory as GenesisInventoryPolicy,
            starterFood: boolean(assets.starterFood, 'starterFood'),
            starterTools: boolean(assets.starterTools, 'starterTools'),
            starterHousing: boolean(assets.starterHousing, 'starterHousing') },
        economy: { createBusinesses: boolean(economy.createBusinesses, 'createBusinesses'),
            createContracts: boolean(economy.createContracts, 'createContracts'),
            createLeases: boolean(economy.createLeases, 'createLeases'),
            createInstitutions: boolean(economy.createInstitutions, 'createInstitutions'),
            seedBusinessInventory: boolean(economy.seedBusinessInventory, 'seedBusinessInventory') }, burnIn
    };
    return { ...definition, digest: worldGenesisProfileDigest(definition) };
}
