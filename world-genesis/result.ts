import { createHash } from 'node:crypto';
import { validateWorldGenesisProfile } from './profile.js';
import { WORLD_GENESIS_PROFILE_SCHEMA_VERSION, type WorldGenesisJsonValue, type WorldGenesisProfile,
    type WorldGenesisProfileId, type WorldGenesisResult, type WorldGenesisRunConfiguration } from './types.js';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9.-]{0,95}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const PROFILE_IDS = new Set<WorldGenesisProfileId>(['blank-slate', 'frontier', 'seeded-economy',
    'mature-society', 'historical-burn-in']);

function hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonical(value: WorldGenesisJsonValue): WorldGenesisJsonValue {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

function json(value: unknown, field: string, depth = 0, counter = { value: 0 }): WorldGenesisJsonValue {
    if (depth > 12 || ++counter.value > 10_000) throw new Error(`${field} exceeds the bounded JSON limit`);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        if (typeof value === 'string' && value.length > 10_000) throw new Error(`${field} contains an oversized string`);
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error(`${field} numbers must be finite safe integers`);
        return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => json(entry, `${field}[${index}]`, depth + 1, counter));
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${field} must be JSON compatible`);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([key]) => !key || key.length > 120)) throw new Error(`${field} contains an invalid key`);
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, json(entry, `${field}.${key}`, depth + 1, counter)]));
}

export function validateWorldGenesisJsonValue(value: unknown,
    field = 'World genesis JSON value'): WorldGenesisJsonValue {
    return json(value, field);
}

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function object(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
        throw new Error(`${field} is invalid`);
    }
    return value as Record<string, unknown>;
}

function canonicalTimestamp(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error(`${field} must be a canonical UTC timestamp`);
    }
    return value;
}

export function buildWorldGenesisConfiguration(input: {
    seed: string;
    profile: WorldGenesisProfile;
    worldBuild: string;
    simulationClock: WorldGenesisRunConfiguration['simulationClock'];
    parameters?: Record<string, unknown>;
}): WorldGenesisRunConfiguration {
    if (typeof input.seed !== 'string' || !input.seed.trim() || input.seed !== input.seed.trim()
        || input.seed.length > 256) throw new Error('World genesis seed is invalid');
    const { digest, ...definition } = input.profile;
    const checked = validateWorldGenesisProfile(definition);
    if (digest !== checked.digest) throw new Error('World genesis profile digest does not match its definition');
    if (!VERSION.test(checked.version) || !DIGEST.test(digest)) throw new Error('World genesis profile reference is invalid');
    const clockId = identifier(input.simulationClock.clockId, 'Simulation clock id');
    if (!DIGEST.test(input.simulationClock.profileDigest)) throw new Error('Simulation clock profile digest is invalid');
    return validateWorldGenesisRunConfiguration({ schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, seed: input.seed,
        profile: { profileId: checked.profileId, version: checked.version, digest },
        worldBuild: identifier(input.worldBuild, 'World build'),
        simulationClock: { clockId, profileDigest: input.simulationClock.profileDigest,
            initialSimulationTime: canonicalTimestamp(input.simulationClock.initialSimulationTime,
                'Initial simulation time') },
        parameters: json(input.parameters ?? {}, 'parameters') as Record<string, WorldGenesisJsonValue> });
}

export function validateWorldGenesisRunConfiguration(value: unknown): WorldGenesisRunConfiguration {
    const configuration = object(value, 'World genesis configuration', ['schemaVersion', 'seed', 'profile',
        'worldBuild', 'simulationClock', 'parameters']);
    if (configuration.schemaVersion !== WORLD_GENESIS_PROFILE_SCHEMA_VERSION
        || typeof configuration.seed !== 'string' || !configuration.seed.trim()
        || configuration.seed !== configuration.seed.trim() || configuration.seed.length > 256) {
        throw new Error('World genesis configuration identity or seed is invalid');
    }
    const profile = object(configuration.profile, 'World genesis profile reference', ['profileId', 'version', 'digest']);
    if (!PROFILE_IDS.has(profile.profileId as WorldGenesisProfileId) || typeof profile.version !== 'string'
        || !VERSION.test(profile.version) || typeof profile.digest !== 'string' || !DIGEST.test(profile.digest)) {
        throw new Error('World genesis profile reference is invalid');
    }
    const clock = object(configuration.simulationClock, 'Simulation clock reference',
        ['clockId', 'profileDigest', 'initialSimulationTime']);
    if (typeof clock.profileDigest !== 'string' || !DIGEST.test(clock.profileDigest)) {
        throw new Error('Simulation clock profile digest is invalid');
    }
    const parameters = json(configuration.parameters, 'parameters');
    if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') {
        throw new Error('World genesis parameters must be an object');
    }
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, seed: configuration.seed,
        profile: { profileId: profile.profileId as WorldGenesisProfileId, version: profile.version,
            digest: profile.digest }, worldBuild: identifier(configuration.worldBuild, 'World build'),
        simulationClock: { clockId: identifier(clock.clockId, 'Simulation clock id'), profileDigest: clock.profileDigest,
            initialSimulationTime: canonicalTimestamp(clock.initialSimulationTime, 'Initial simulation time') },
        parameters: parameters as Record<string, WorldGenesisJsonValue> };
}

export function worldGenesisConfigurationDigest(configuration: WorldGenesisRunConfiguration): string {
    const checked = validateWorldGenesisRunConfiguration(configuration);
    return hash(canonical(checked as unknown as WorldGenesisJsonValue));
}

export function worldGenesisEntropy(configuration: WorldGenesisRunConfiguration,
    namespace: string, key: string, maximumExclusive: number): number {
    const boundedNamespace = identifier(namespace, 'Entropy namespace');
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Entropy key is invalid');
    if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive < 1) throw new Error('Entropy bound is invalid');
    const material = hash({ algorithm: 'sha256-v1', configurationDigest: worldGenesisConfigurationDigest(configuration),
        seed: configuration.seed, namespace: boundedNamespace, key });
    return Number(BigInt(`0x${material.slice(0, 16)}`) % BigInt(maximumExclusive));
}

export function buildWorldGenesisResult(configuration: WorldGenesisRunConfiguration, output: unknown,
    generatedAtAudit = new Date().toISOString()): WorldGenesisResult {
    configuration = validateWorldGenesisRunConfiguration(configuration);
    const normalizedOutput = json(output, 'output');
    const configurationDigest = worldGenesisConfigurationDigest(configuration);
    const outputDigest = hash(canonical(normalizedOutput));
    const resultDigest = hash({ schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, entropyAlgorithm: 'sha256-v1',
        configurationDigest, outputDigest });
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, resultId: `genesis-${resultDigest.slice(0, 24)}`,
        entropyAlgorithm: 'sha256-v1', seed: configuration.seed, profile: configuration.profile,
        worldBuild: configuration.worldBuild, simulationClock: configuration.simulationClock,
        parameters: configuration.parameters, configurationDigest, output: normalizedOutput, outputDigest,
        resultDigest, generatedAtAudit: canonicalTimestamp(generatedAtAudit, 'Genesis audit time') };
}

export function validateWorldGenesisResult(value: unknown): WorldGenesisResult {
    const result = object(value, 'World genesis result', ['schemaVersion', 'resultId', 'entropyAlgorithm', 'seed',
        'profile', 'worldBuild', 'simulationClock', 'parameters', 'configurationDigest', 'output', 'outputDigest',
        'resultDigest', 'generatedAtAudit']);
    if (result.schemaVersion !== WORLD_GENESIS_PROFILE_SCHEMA_VERSION || result.entropyAlgorithm !== 'sha256-v1'
        || typeof result.resultId !== 'string' || !/^genesis-[0-9a-f]{24}$/.test(result.resultId)
        || typeof result.configurationDigest !== 'string' || !DIGEST.test(result.configurationDigest)
        || typeof result.outputDigest !== 'string' || !DIGEST.test(result.outputDigest)
        || typeof result.resultDigest !== 'string' || !DIGEST.test(result.resultDigest)) {
        throw new Error('World genesis result identity or digest is invalid');
    }
    const configuration = validateWorldGenesisRunConfiguration({ schemaVersion: result.schemaVersion,
        seed: result.seed, profile: result.profile, worldBuild: result.worldBuild,
        simulationClock: result.simulationClock, parameters: result.parameters });
    const output = json(result.output, 'output');
    const configurationDigest = worldGenesisConfigurationDigest(configuration);
    const outputDigest = hash(canonical(output));
    const resultDigest = hash({ schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, entropyAlgorithm: 'sha256-v1',
        configurationDigest, outputDigest });
    if (configurationDigest !== result.configurationDigest || outputDigest !== result.outputDigest
        || resultDigest !== result.resultDigest || result.resultId !== `genesis-${resultDigest.slice(0, 24)}`) {
        throw new Error('World genesis result digest does not match its content');
    }
    return { schemaVersion: WORLD_GENESIS_PROFILE_SCHEMA_VERSION, resultId: result.resultId,
        entropyAlgorithm: 'sha256-v1', seed: configuration.seed, profile: configuration.profile,
        worldBuild: configuration.worldBuild, simulationClock: configuration.simulationClock,
        parameters: configuration.parameters, configurationDigest, output, outputDigest, resultDigest,
        generatedAtAudit: canonicalTimestamp(result.generatedAtAudit, 'Genesis audit time') };
}
