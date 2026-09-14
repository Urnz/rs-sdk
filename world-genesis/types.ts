export const WORLD_GENESIS_PROFILE_SCHEMA_VERSION = 1 as const;

export type WorldGenesisProfileId = 'blank-slate' | 'frontier' | 'seeded-economy'
    | 'mature-society' | 'historical-burn-in';

export type GenesisWealthDistribution = 'minimal' | 'small-stake' | 'generated' | 'stratified';
export type GenesisOwnershipPolicy = 'unowned' | 'shelter-only' | 'generated' | 'stratified';
export type GenesisInventoryPolicy = 'empty' | 'survival-kit' | 'profession-kit' | 'mature-stock';

export interface WorldGenesisPopulationPolicy {
    minimumAgents: number;
    maximumAgents: number;
    assignProfessions: boolean;
}

export interface WorldGenesisAssetPolicy {
    wealthDistribution: GenesisWealthDistribution;
    ownership: GenesisOwnershipPolicy;
    inventory: GenesisInventoryPolicy;
    starterFood: boolean;
    starterTools: boolean;
    starterHousing: boolean;
}

export interface WorldGenesisEconomyPolicy {
    createBusinesses: boolean;
    createContracts: boolean;
    createLeases: boolean;
    createInstitutions: boolean;
    seedBusinessInventory: boolean;
}

export interface WorldGenesisBurnInPolicy {
    sourceProfileId: Exclude<WorldGenesisProfileId, 'historical-burn-in'>;
    durationSimulationMilliseconds: number;
    access: 'agent-only';
}

export interface WorldGenesisProfileDefinition {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    profileId: WorldGenesisProfileId;
    version: string;
    label: string;
    description: string;
    population: WorldGenesisPopulationPolicy;
    assets: WorldGenesisAssetPolicy;
    economy: WorldGenesisEconomyPolicy;
    burnIn: WorldGenesisBurnInPolicy | null;
}

export interface WorldGenesisProfile extends WorldGenesisProfileDefinition {
    digest: string;
}

export interface WorldGenesisProfileCatalog {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    profiles: WorldGenesisProfile[];
}

export type WorldGenesisJsonPrimitive = string | number | boolean | null;
export type WorldGenesisJsonValue = WorldGenesisJsonPrimitive | WorldGenesisJsonValue[]
    | { [key: string]: WorldGenesisJsonValue };

export interface WorldGenesisRunConfiguration {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    seed: string;
    profile: { profileId: WorldGenesisProfileId; version: string; digest: string };
    worldBuild: string;
    simulationClock: { clockId: string; profileDigest: string; initialSimulationTime: string };
    parameters: { [key: string]: WorldGenesisJsonValue };
}

export interface WorldGenesisResult {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    resultId: string;
    entropyAlgorithm: 'sha256-v1';
    seed: string;
    profile: WorldGenesisRunConfiguration['profile'];
    worldBuild: string;
    simulationClock: WorldGenesisRunConfiguration['simulationClock'];
    parameters: WorldGenesisRunConfiguration['parameters'];
    configurationDigest: string;
    output: WorldGenesisJsonValue;
    outputDigest: string;
    resultDigest: string;
    generatedAtAudit: string;
}

export type GenesisAssetOwnerKind = 'player' | 'business' | 'faction' | 'world';
export interface GenesisAssetOwner { kind: GenesisAssetOwnerKind; id: string }

export type GenesisAssetAllocation =
    | { allocationId: string; kind: 'currency'; owner: GenesisAssetOwner; amountGp: number }
    | { allocationId: string; kind: 'item'; owner: GenesisAssetOwner;
        container: 'inventory' | 'equipment' | 'bank' | 'business-stock'; itemId: number; count: number;
        slot: number | null }
    | { allocationId: string; kind: 'property'; owner: GenesisAssetOwner; propertyId: string }
    | { allocationId: string; kind: 'business'; owner: GenesisAssetOwner; businessId: string;
        openingCapitalGp: number; openingInventoryDigest: string };

export interface GenesisAssetProvenance {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    provenanceId: string;
    source: 'world-genesis';
    resultId: string;
    resultDigest: string;
    configurationDigest: string;
    allocationId: string;
    kind: GenesisAssetAllocation['kind'];
    owner: GenesisAssetOwner;
    asset: GenesisAssetAllocation;
    assetDigest: string;
    createdAtSimulationTime: string;
    createdAtAudit: string;
}

export type WorldGenesisApplicationStatus = 'applying' | 'applied' | 'resetting' | 'reset'
    | 'rollback-required';

export interface WorldGenesisApplication {
    schemaVersion: typeof WORLD_GENESIS_PROFILE_SCHEMA_VERSION;
    resultId: string;
    resultDigest: string;
    status: WorldGenesisApplicationStatus;
    result: WorldGenesisResult;
    rollbackToken: WorldGenesisJsonValue;
    applyReceipt: WorldGenesisJsonValue | null;
    error: string | null;
    startedAtAudit: string;
    updatedAtAudit: string;
    completedAtAudit: string | null;
    revision: number;
}
