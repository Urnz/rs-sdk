import type { WorldGenesisProfileId } from '../world-genesis/types.js';

export const POPULATION_LIFECYCLE_SCHEMA_VERSION = 1 as const;

export type PopulationLifecyclePolicyKind = 'finite' | 'classic-respawn-compatibility';

export interface PopulationLifecyclePolicyDefinition {
    schemaVersion: typeof POPULATION_LIFECYCLE_SCHEMA_VERSION;
    policyId: string;
    version: string;
    kind: PopulationLifecyclePolicyKind;
    scope: 'social-simulation' | 'compatibility-experiment';
    deathTransition: 'terminal' | 'avatar-respawn';
    respawn: 'forbidden' | 'engine-classic';
}

export interface PopulationLifecyclePolicy extends PopulationLifecyclePolicyDefinition {
    digest: string;
}

export interface PopulationLifecyclePolicyCatalog {
    schemaVersion: typeof POPULATION_LIFECYCLE_SCHEMA_VERSION;
    policies: PopulationLifecyclePolicy[];
}

export interface PopulationWorldProfileBinding {
    worldProfileId: WorldGenesisProfileId;
    worldProfileVersion: string;
    worldProfileDigest: string;
    policyId: string;
    policyVersion: string;
    policyDigest: string;
}

export interface PopulationWorldProfileBindingCatalog {
    schemaVersion: typeof POPULATION_LIFECYCLE_SCHEMA_VERSION;
    bindings: PopulationWorldProfileBinding[];
}

export interface PopulationGenesisMember {
    agentId: string;
    playerUsername: string;
}
