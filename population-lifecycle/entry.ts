import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AgentPopulationMember, CreateAgentIdentity } from '../agent-state/types.js';
import type { WorldGenesisProfileCatalog } from '../world-genesis/types.js';
import type { PopulationLifecyclePolicyCatalog, PopulationWorldProfileBindingCatalog } from './types.js';
import { resolvePopulationLifecyclePolicy } from './config.js';
import { validatePopulationAgePolicy, type PopulationAgePolicy } from './age.js';

type Reference = { policyId: string; version: string; digest: string };
export interface PopulationEntryPolicyDefinition {
    schemaVersion: 1;
    policyId: string;
    version: string;
    generator: 'seeded-arrival-v1';
    lifecyclePolicy: Reference;
    worldProfiles: AgentPopulationMember['worldProfile'][];
    maximumBatchSize: number;
    maximumActiveMembers: number;
    maximumAdmissionsPerClock: number;
    entryAgeYears: { minimum: number; maximum: number };
}
export interface PopulationEntryPolicy extends PopulationEntryPolicyDefinition { digest: string }
export interface PopulationEntryEnvironment {
    policy: PopulationEntryPolicy;
    age: PopulationAgePolicy;
    profiles: WorldGenesisProfileCatalog;
    lifecycles: PopulationLifecyclePolicyCatalog;
    bindings: PopulationWorldProfileBindingCatalog;
}
export interface PopulationEntryRequest {
    batchId: string;
    seed: string;
    count: number;
    anchorAgentId: string;
}
export interface PopulationEntryPlan {
    schemaVersion: 1;
    entryId: string;
    generator: 'seeded-arrival-v1';
    request: PopulationEntryRequest;
    policy: PopulationEntryPolicy;
    agePolicy: Reference;
    worldProfile: AgentPopulationMember['worldProfile'];
    lifecyclePolicy: AgentPopulationMember['lifecyclePolicy'];
    simulationClock: AgentPopulationMember['simulationClock'];
    genesis: { resultId: string; resultDigest: string };
    joinedAtSimulationTime: string;
    entrants: Array<{ identity: CreateAgentIdentity; birthAtSimulationTime: string }>;
    digest: string;
}
export interface PopulationEntryReceipt {
    plan: PopulationEntryPlan;
    reason: string;
    appliedAt: string;
    digest: string;
}

export function populationEntryDigest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function record(value: unknown, fields: string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== fields.sort().join(',')) throw new Error(`${label} fields are invalid`);
    return value as Record<string, unknown>;
}
function reference(value: unknown, profile = false): Reference | AgentPopulationMember['worldProfile'] {
    const key = profile ? 'profileId' : 'policyId';
    const raw = record(value, [key, 'version', 'digest'], 'Population entry reference');
    if (typeof raw[key] !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(raw[key])
        || typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version)
        || typeof raw.digest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.digest)) throw new Error('Population entry reference is invalid');
    return { [key]: raw[key], version: raw.version, digest: raw.digest } as Reference;
}
export function validatePopulationEntryPolicy(value: unknown): PopulationEntryPolicy {
    const raw = record(value, ['schemaVersion', 'policyId', 'version', 'generator', 'lifecyclePolicy', 'worldProfiles',
        'maximumBatchSize', 'maximumActiveMembers', 'maximumAdmissionsPerClock', 'entryAgeYears'], 'Population entry policy');
    const id = reference({ policyId: raw.policyId, version: raw.version, digest: '0'.repeat(64) }) as Reference;
    const age = record(raw.entryAgeYears, ['minimum', 'maximum'], 'Population entry age');
    for (const key of ['maximumBatchSize', 'maximumActiveMembers', 'maximumAdmissionsPerClock']) {
        if (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key]) || raw[key] < 1 || raw[key] > 10000)
            throw new Error('Population entry limits are invalid');
    }
    if (raw.schemaVersion !== 1 || raw.generator !== 'seeded-arrival-v1' || !Array.isArray(raw.worldProfiles)
        || raw.worldProfiles.length < 1 || raw.worldProfiles.length > 5
        || !Number.isSafeInteger(age.minimum) || !Number.isSafeInteger(age.maximum)
        || Number(age.minimum) < 0 || Number(age.maximum) < Number(age.minimum) || Number(age.maximum) > 100)
        throw new Error('Population entry generator, profiles or age range are invalid');
    const worldProfiles = raw.worldProfiles.map(item => reference(item, true) as AgentPopulationMember['worldProfile'])
        .sort((a, b) => a.profileId.localeCompare(b.profileId));
    if (new Set(worldProfiles.map(item => item.profileId)).size !== worldProfiles.length) throw new Error('Duplicate entry world profile');
    const definition: PopulationEntryPolicyDefinition = { schemaVersion: 1, policyId: id.policyId, version: id.version,
        generator: 'seeded-arrival-v1', lifecyclePolicy: reference(raw.lifecyclePolicy) as Reference, worldProfiles,
        maximumBatchSize: raw.maximumBatchSize as number, maximumActiveMembers: raw.maximumActiveMembers as number,
        maximumAdmissionsPerClock: raw.maximumAdmissionsPerClock as number,
        entryAgeYears: { minimum: age.minimum as number, maximum: age.maximum as number } };
    return { ...definition, digest: populationEntryDigest(definition) };
}
export function loadPopulationEntryPolicy(path: string): PopulationEntryPolicy {
    return validatePopulationEntryPolicy(JSON.parse(readFileSync(path, 'utf8')));
}
export function validatePopulationEntryRequest(value: unknown): PopulationEntryRequest {
    const raw = record(value, ['batchId', 'seed', 'count', 'anchorAgentId'], 'Population entry request');
    if (typeof raw.batchId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(raw.batchId)
        || typeof raw.anchorAgentId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(raw.anchorAgentId)
        || typeof raw.seed !== 'string' || raw.seed.length < 1 || raw.seed.length > 128 || raw.seed.trim() !== raw.seed
        || typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count) || raw.count < 1 || raw.count > 10000)
        throw new Error('Population entry request is invalid');
    return { batchId: raw.batchId, seed: raw.seed, count: raw.count, anchorAgentId: raw.anchorAgentId };
}

/** The idempotency key deliberately excludes seed/count/policy: changing them must conflict. */
export function populationEntryId(request: PopulationEntryRequest, clock: AgentPopulationMember['simulationClock']): string {
    return `entry-${populationEntryDigest({ clockId: clock.clockId, profileDigest: clock.profileDigest,
        batchId: request.batchId }).slice(0, 24)}`;
}

/** A replaceable generator boundary; admission/persistence does not know family or reproduction. */
export function generatePopulationEntry(request: PopulationEntryRequest, anchor: AgentPopulationMember,
    at: string, environment: PopulationEntryEnvironment): PopulationEntryPlan {
    request = validatePopulationEntryRequest(request);
    const { digest, ...definition } = environment.policy, policy = validatePopulationEntryPolicy(definition);
    if (digest !== policy.digest) throw new Error('Population entry policy digest is stale');
    if (request.count > policy.maximumBatchSize) throw new Error('Population entry batch limit exceeded');
    if (anchor.agentId !== request.anchorAgentId || anchor.status !== 'active' || !/^genesis-[0-9a-f]{24}$/.test(anchor.sourceResultId))
        throw new Error('Population entry requires an unreset genesis anchor');
    const profile = environment.profiles.profiles.find(item => item.profileId === anchor.worldProfile.profileId);
    if (!profile || profile.version !== anchor.worldProfile.version || profile.digest !== anchor.worldProfile.digest
        || !policy.worldProfiles.some(item => JSON.stringify(item) === JSON.stringify(anchor.worldProfile)))
        throw new Error('Population entry world profile binding is stale');
    const lifecycle = resolvePopulationLifecyclePolicy(profile, environment.lifecycles, environment.bindings);
    const { kind, ...lifecycleRef } = anchor.lifecyclePolicy;
    if (!lifecycle || lifecycle.kind !== kind || JSON.stringify(lifecycleRef) !== JSON.stringify(policy.lifecyclePolicy)
        || lifecycle.policyId !== lifecycleRef.policyId || lifecycle.version !== lifecycleRef.version || lifecycle.digest !== lifecycleRef.digest)
        throw new Error('Population entry lifecycle policy binding is stale');
    const { digest: ageDigest, ...ageDefinition } = environment.age, age = validatePopulationAgePolicy(ageDefinition);
    if (ageDigest !== age.digest || JSON.stringify(age.lifecyclePolicy) !== JSON.stringify(policy.lifecyclePolicy))
        throw new Error('Population entry age policy binding is stale');
    if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || at < anchor.joinedAtSimulationTime)
        throw new Error('Population entry simulation time is invalid');
    const entryId = populationEntryId(request, anchor.simulationClock);
    const traits = ['patient', 'curious', 'careful', 'sociable', 'independent', 'practical'];
    const entrants = Array.from({ length: request.count }, (_, index) => {
        const entropy = populationEntryDigest({ generator: policy.generator, entryId, seed: request.seed,
            policyDigest: policy.digest, index });
        const ageYears = policy.entryAgeYears.minimum + Number.parseInt(entropy.slice(0, 8), 16)
            % (policy.entryAgeYears.maximum - policy.entryAgeYears.minimum + 1);
        const birth = Date.parse(at) - ageYears * age.simulationMillisecondsPerYear;
        if (!Number.isSafeInteger(birth) || !Number.isFinite(new Date(birth).getTime())) throw new Error('Population entry birth exceeds time range');
        const username = `p${entropy.slice(8, 19)}`;
        return { identity: { agentId: `arrival-${entropy.slice(0, 24)}`, playerUsername: username,
            displayName: `Arrival ${entropy.slice(8, 19)}`, background: 'Seeded population arrival; no inherited knowledge or assets.',
            personalityTraits: [traits[Number.parseInt(entropy.slice(19, 21), 16) % traits.length]!], values: [] },
        birthAtSimulationTime: new Date(birth).toISOString() };
    });
    if (new Set(entrants.map(item => item.identity.playerUsername)).size !== entrants.length) throw new Error('Generated entry identity collision');
    const plan: Omit<PopulationEntryPlan, 'digest'> = { schemaVersion: 1, entryId, generator: policy.generator,
        request, policy, agePolicy: { policyId: age.policyId, version: age.version, digest: age.digest },
        worldProfile: anchor.worldProfile, lifecyclePolicy: anchor.lifecyclePolicy, simulationClock: anchor.simulationClock,
        genesis: { resultId: anchor.sourceResultId, resultDigest: anchor.sourceResultDigest }, joinedAtSimulationTime: at, entrants };
    return { ...plan, digest: populationEntryDigest(plan) };
}
