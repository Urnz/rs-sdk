import { createHash } from 'node:crypto';
import { COMPETENCE_SNAPSHOT_SCHEMA_VERSION, type CompetenceRequirement, type CompetenceSnapshot,
    type CompetenceSnapshotDefinition, type LearnedVerifiedAgentSkill, type PersonalRuneScapeSkill,
    type ProvidedCapability } from './types.js';

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const CHECKSUM = /^[0-9a-f]{64}$/;

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], field: string): void {
    const actual = Object.keys(value).sort(), expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${field} fields are invalid`);
    }
}

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${field} is invalid`);
    return value;
}

function semanticVersion(value: unknown, field: string): string {
    if (typeof value !== 'string' || !VERSION.test(value)) throw new Error(`${field} must use semantic versioning`);
    return value;
}

function simulationTime(value: unknown, field: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new Error(`${field} must be canonical UTC ISO`);
    }
    return value;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
}

export function competenceSnapshotDigest(value: CompetenceSnapshotDefinition): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function personalSkill(value: unknown, characterAgentId: string, index: number): PersonalRuneScapeSkill {
    const field = `personalSkills[${index}]`, input = record(value, field);
    exact(input, ['kind', 'characterAgentId', 'skillId', 'level'], field);
    if (input.kind !== 'personal-rs-skill') throw new Error(`${field}.kind is invalid`);
    const owner = identifier(input.characterAgentId, `${field}.characterAgentId`);
    if (owner !== characterAgentId) throw new Error(`${field} belongs to another character`);
    if (!Number.isSafeInteger(input.level) || Number(input.level) < 1 || Number(input.level) > 99) {
        throw new Error(`${field}.level must be an integer between 1 and 99`);
    }
    return { kind: 'personal-rs-skill', characterAgentId: owner,
        skillId: identifier(input.skillId, `${field}.skillId`), level: Number(input.level) };
}

function learnedProcedure(value: unknown, characterAgentId: string, index: number): LearnedVerifiedAgentSkill {
    const field = `learnedProcedures[${index}]`, input = record(value, field);
    exact(input, ['kind', 'characterAgentId', 'skill', 'learnedAtSimulationTime', 'status', 'executable'], field);
    if (input.kind !== 'verified-agent-skill' || input.status !== 'verified' || input.executable !== true) {
        throw new Error(`${field} must be a verified executable agent skill`);
    }
    const owner = identifier(input.characterAgentId, `${field}.characterAgentId`);
    if (owner !== characterAgentId) throw new Error(`${field} belongs to another character`);
    const skill = record(input.skill, `${field}.skill`);
    exact(skill, ['id', 'version', 'checksum'], `${field}.skill`);
    if (typeof skill.checksum !== 'string' || !CHECKSUM.test(skill.checksum)) {
        throw new Error(`${field}.skill.checksum must be a lowercase SHA-256 digest`);
    }
    return { kind: 'verified-agent-skill', characterAgentId: owner,
        skill: { id: identifier(skill.id, `${field}.skill.id`),
            version: semanticVersion(skill.version, `${field}.skill.version`), checksum: skill.checksum },
        learnedAtSimulationTime: simulationTime(input.learnedAtSimulationTime, `${field}.learnedAtSimulationTime`),
        status: 'verified', executable: true };
}

function providedCapability(value: unknown, characterAgentId: string, index: number): ProvidedCapability {
    const field = `providedCapabilities[${index}]`, input = record(value, field);
    exact(input, ['kind', 'characterAgentId', 'capabilityId', 'provider', 'grantId'], field);
    if (input.kind !== 'provided-capability') throw new Error(`${field}.kind is invalid`);
    const owner = identifier(input.characterAgentId, `${field}.characterAgentId`);
    if (owner !== characterAgentId) throw new Error(`${field} belongs to another character`);
    const provider = record(input.provider, `${field}.provider`);
    exact(provider, ['kind', 'providerId'], `${field}.provider`);
    if (provider.kind !== 'facility' && provider.kind !== 'organization') {
        throw new Error(`${field}.provider.kind is invalid`);
    }
    return { kind: 'provided-capability', characterAgentId: owner,
        capabilityId: identifier(input.capabilityId, `${field}.capabilityId`),
        provider: { kind: provider.kind, providerId: identifier(provider.providerId, `${field}.provider.providerId`) },
        grantId: identifier(input.grantId, `${field}.grantId`) };
}

function unique(values: readonly string[], field: string): void {
    if (new Set(values).size !== values.length) throw new Error(`${field} identities must be unique`);
}

export function validateCompetenceSnapshot(value: unknown): CompetenceSnapshot {
    const input = record(value, 'Competence snapshot');
    exact(input, ['schemaVersion', 'snapshotId', 'characterAgentId', 'observedAtSimulationTime',
        'personalSkills', 'learnedProcedures', 'providedCapabilities'], 'Competence snapshot');
    if (input.schemaVersion !== COMPETENCE_SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(`Unsupported competence snapshot schema version: ${String(input.schemaVersion)}`);
    }
    if (!Array.isArray(input.personalSkills) || !Array.isArray(input.learnedProcedures)
        || !Array.isArray(input.providedCapabilities)) throw new Error('Competence collections must be arrays');
    const characterAgentId = identifier(input.characterAgentId, 'characterAgentId');
    const personalSkills = input.personalSkills.map((item, index) => personalSkill(item, characterAgentId, index));
    const learnedProcedures = input.learnedProcedures.map((item, index) => learnedProcedure(item,
        characterAgentId, index));
    const providedCapabilities = input.providedCapabilities.map((item, index) => providedCapability(item,
        characterAgentId, index));
    unique(personalSkills.map(item => item.skillId), 'Personal RuneScape skill');
    unique(learnedProcedures.map(item => `${item.skill.id}@${item.skill.version}`), 'Verified agent skill');
    unique(providedCapabilities.map(item => `${item.capabilityId}:${item.provider.kind}:${item.provider.providerId}`),
        'Provided capability');
    const definition: CompetenceSnapshotDefinition = {
        schemaVersion: COMPETENCE_SNAPSHOT_SCHEMA_VERSION,
        snapshotId: identifier(input.snapshotId, 'snapshotId'), characterAgentId,
        observedAtSimulationTime: simulationTime(input.observedAtSimulationTime, 'observedAtSimulationTime'),
        personalSkills, learnedProcedures, providedCapabilities
    };
    return { ...definition, digest: competenceSnapshotDigest(definition) };
}

/** Checks only the requested namespace; one competence kind can never impersonate another. */
export function satisfiesCompetence(snapshot: CompetenceSnapshot, requirement: CompetenceRequirement): boolean {
    if (requirement.kind === 'personal-rs-skill') {
        return Number.isSafeInteger(requirement.minimumLevel) && requirement.minimumLevel >= 1
            && requirement.minimumLevel <= 99
            && snapshot.personalSkills.some(item => item.skillId === requirement.skillId
                && item.level >= requirement.minimumLevel);
    }
    if (requirement.kind === 'verified-agent-skill') {
        return snapshot.learnedProcedures.some(item => item.skill.id === requirement.skill.id
            && item.skill.version === requirement.skill.version && item.skill.checksum === requirement.skill.checksum);
    }
    return snapshot.providedCapabilities.some(item => item.capabilityId === requirement.capabilityId
        && (requirement.provider === null || (item.provider.kind === requirement.provider.kind
            && item.provider.providerId === requirement.provider.providerId)));
}
