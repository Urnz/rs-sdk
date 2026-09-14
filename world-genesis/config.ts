import { readFileSync } from 'node:fs';
import { validateWorldGenesisProfile } from './profile.js';
import { WORLD_GENESIS_PROFILE_SCHEMA_VERSION, type WorldGenesisProfileCatalog,
    type WorldGenesisProfileId } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateWorldGenesisProfileCatalog(value: unknown): WorldGenesisProfileCatalog {
    if (!record(value) || value.schemaVersion !== WORLD_GENESIS_PROFILE_SCHEMA_VERSION
        || Object.keys(value).sort().join(',') !== 'profiles,schemaVersion' || !Array.isArray(value.profiles)) {
        throw new Error('World genesis profile catalog is invalid');
    }
    const profiles = value.profiles.map(validateWorldGenesisProfile);
    const ids = new Set(profiles.map(profile => profile.profileId));
    const required: WorldGenesisProfileId[] = ['blank-slate', 'frontier', 'seeded-economy',
        'mature-society', 'historical-burn-in'];
    if (profiles.length !== required.length || required.some(id => !ids.has(id))) {
        throw new Error('World genesis catalog must define each built-in profile exactly once');
    }
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, profiles };
}

export function loadWorldGenesisProfileCatalog(path: string): WorldGenesisProfileCatalog {
    return validateWorldGenesisProfileCatalog(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
