import type { AgentEpisodeKind, AgentEpisodeSource, AgentEpisodeTrust, AgentSkillKnowledgeStatus,
    AgentKnowledgeKind, AgentKnowledgeSource, AgentSkillReference, CreateAgentEpisode, CreateAgentGoal,
    CreateAgentIdentity, CreateAgentKnowledge,
    GoalHorizon, SetAgentWorkingMemory, UpdateAgentIdentity } from './types.js';

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PLAYER_PATTERN = /^[a-z0-9 _-]+$/;
const HORIZONS = new Set<GoalHorizon>(['life', 'long-term', 'current', 'immediate']);
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const EPISODE_KINDS = new Set<AgentEpisodeKind>(['observation', 'action', 'outcome', 'interaction', 'discovery', 'economic']);
const EPISODE_SOURCES = new Set<AgentEpisodeSource>(['manual', 'system', 'skill', 'planner']);
const EPISODE_TRUST = new Set<AgentEpisodeTrust>(['trusted', 'untrusted']);
const KNOWLEDGE_KINDS = new Set<AgentKnowledgeKind>(['world', 'economic', 'route', 'procedure']);
const KNOWLEDGE_SOURCES = new Set<AgentKnowledgeSource>(['manual', 'system', 'consolidation']);

export class AgentStateValidationError extends Error {
    constructor(public readonly issues: string[]) {
        super(`Invalid agent state:\n- ${issues.join('\n- ')}`);
        this.name = 'AgentStateValidationError';
    }
}

function text(value: unknown, path: string, issues: string[], max: number, allowEmpty = false): string {
    if (typeof value !== 'string') {
        issues.push(`${path} must be a string`);
        return '';
    }
    const normalized = value.trim();
    if ((!allowEmpty && normalized.length === 0) || normalized.length > max) {
        issues.push(`${path} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${max} characters`);
    }
    return normalized;
}

function id(value: unknown, path: string, issues: string[]): string {
    const normalized = text(value, path, issues, 64).toLowerCase();
    if (normalized && !ID_PATTERN.test(normalized)) issues.push(`${path} must be a lowercase dotted or dashed identifier`);
    return normalized;
}

function stringList(value: unknown, path: string, issues: string[], required: boolean): string[] {
    if (!Array.isArray(value)) {
        issues.push(`${path} must be an array`);
        return [];
    }
    if ((required && value.length === 0) || value.length > 12) {
        issues.push(`${path} must contain ${required ? '1-12' : 'at most 12'} entries`);
    }
    const entries = value.map((entry, index) => text(entry, `${path}[${index}]`, issues, 100));
    const keys = entries.map(entry => entry.toLocaleLowerCase('en-US'));
    if (new Set(keys).size !== keys.length) issues.push(`${path} must not contain duplicates`);
    return entries;
}

function boundedStringList(value: unknown, path: string, issues: string[], maximum: number): string[] {
    if (!Array.isArray(value)) {
        issues.push(`${path} must be an array`);
        return [];
    }
    if (value.length > maximum) issues.push(`${path} must contain at most ${maximum} entries`);
    const entries = value.map((entry, index) => text(entry, `${path}[${index}]`, issues, 100));
    const keys = entries.map(entry => entry.toLocaleLowerCase('en-US'));
    if (new Set(keys).size !== keys.length) issues.push(`${path} must not contain duplicates`);
    return entries;
}

export function normalizeAgentId(value: unknown, path = 'agentId'): string {
    const issues: string[] = [];
    const normalized = id(value, path, issues);
    if (issues.length) throw new AgentStateValidationError(issues);
    return normalized;
}

export function validateCreateIdentity(value: CreateAgentIdentity): CreateAgentIdentity {
    const issues: string[] = [];
    const agentId = id(value.agentId, 'agentId', issues);
    const playerUsername = text(value.playerUsername, 'playerUsername', issues, 12).toLowerCase();
    if (playerUsername && !PLAYER_PATTERN.test(playerUsername)) issues.push('playerUsername contains unsupported characters');
    const result: CreateAgentIdentity = {
        agentId,
        playerUsername,
        displayName: text(value.displayName, 'displayName', issues, 100),
        background: text(value.background, 'background', issues, 4000),
        personalityTraits: stringList(value.personalityTraits, 'personalityTraits', issues, true),
        values: stringList(value.values ?? [], 'values', issues, false)
    };
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}

export function validateIdentityPatch(value: UpdateAgentIdentity): UpdateAgentIdentity {
    const issues: string[] = [];
    const result: UpdateAgentIdentity = {};
    if (value.playerUsername !== undefined) {
        result.playerUsername = text(value.playerUsername, 'playerUsername', issues, 12).toLowerCase();
        if (result.playerUsername && !PLAYER_PATTERN.test(result.playerUsername)) issues.push('playerUsername contains unsupported characters');
    }
    if (value.displayName !== undefined) result.displayName = text(value.displayName, 'displayName', issues, 100);
    if (value.background !== undefined) result.background = text(value.background, 'background', issues, 4000);
    if (value.personalityTraits !== undefined) result.personalityTraits = stringList(value.personalityTraits, 'personalityTraits', issues, true);
    if (value.values !== undefined) result.values = stringList(value.values, 'values', issues, false);
    if (Object.keys(result).length === 0) issues.push('identity update must contain at least one field');
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}

export function validateCreateGoal(value: CreateAgentGoal): Required<CreateAgentGoal> {
    const issues: string[] = [];
    const horizon = value.horizon;
    if (!HORIZONS.has(horizon)) issues.push('horizon is invalid');
    const priority = value.priority ?? 50;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) issues.push('priority must be an integer from 0 to 100');
    const result: Required<CreateAgentGoal> = {
        goalId: id(value.goalId, 'goalId', issues),
        parentGoalId: value.parentGoalId === null || value.parentGoalId === undefined
            ? null : id(value.parentGoalId, 'parentGoalId', issues),
        horizon,
        title: text(value.title, 'title', issues, 200),
        description: text(value.description ?? '', 'description', issues, 2000, true),
        priority,
        skill: value.skill === null || value.skill === undefined ? null : validateSkillReference(value.skill, 'skill', issues)
    };
    if (horizon === 'life' && result.parentGoalId !== null) issues.push('a life goal cannot have a parent');
    if (horizon !== 'life' && result.parentGoalId === null) issues.push(`${horizon} goals require a parent`);
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}

function validateSkillReference(value: AgentSkillReference, path: string, issues: string[]): AgentSkillReference {
    const skillId = id(value?.id, `${path}.id`, issues);
    const version = text(value?.version, `${path}.version`, issues, 32);
    if (version && !VERSION_PATTERN.test(version)) issues.push(`${path}.version must use MAJOR.MINOR.PATCH`);
    return { id: skillId, version };
}

export function normalizeSkillReference(value: AgentSkillReference): AgentSkillReference {
    const issues: string[] = [];
    const normalized = validateSkillReference(value, 'skill', issues);
    if (issues.length) throw new AgentStateValidationError(issues);
    return normalized;
}

export function validateSkillKnowledgeStatus(value: unknown): AgentSkillKnowledgeStatus {
    if (value !== 'known' && value !== 'preferred' && value !== 'blocked') {
        throw new AgentStateValidationError(['skill knowledge status must be known, preferred or blocked']);
    }
    return value;
}

export function expectedParentHorizon(horizon: GoalHorizon): GoalHorizon | null {
    switch (horizon) {
        case 'life': return null;
        case 'long-term': return 'life';
        case 'current': return 'long-term';
        case 'immediate': return 'current';
    }
}

export function validateWorkingMemory(value: SetAgentWorkingMemory): Required<SetAgentWorkingMemory> {
    const issues: string[] = [];
    const observedAt = text(value.observedAt, 'observedAt', issues, 40);
    if (observedAt && Number.isNaN(Date.parse(observedAt))) issues.push('observedAt must be an ISO timestamp');
    const currentActivity = value.currentActivity === null || value.currentActivity === undefined
        ? null : text(value.currentActivity, 'currentActivity', issues, 200);
    let location = value.location ?? null;
    if (location) {
        if (!Number.isInteger(location.x) || location.x < 0 || location.x > 16383) issues.push('location.x must be an integer from 0 to 16383');
        if (!Number.isInteger(location.z) || location.z < 0 || location.z > 16383) issues.push('location.z must be an integer from 0 to 16383');
        if (!Number.isInteger(location.level) || location.level < 0 || location.level > 3) issues.push('location.level must be an integer from 0 to 3');
        const region = location.region === undefined ? undefined : text(location.region, 'location.region', issues, 100);
        location = { x: location.x, z: location.z, level: location.level, ...(region ? { region } : {}) };
    }
    const result: Required<SetAgentWorkingMemory> = {
        summary: text(value.summary, 'summary', issues, 1000),
        currentActivity,
        location,
        observations: stringList(value.observations ?? [], 'observations', issues, false),
        observedAt
    };
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}

export function validateCreateEpisode(value: CreateAgentEpisode): Required<CreateAgentEpisode> {
    const issues: string[] = [];
    const occurredAt = text(value.occurredAt, 'occurredAt', issues, 40);
    if (occurredAt && Number.isNaN(Date.parse(occurredAt))) issues.push('occurredAt must be an ISO timestamp');
    const expiresAt = value.expiresAt === null || value.expiresAt === undefined
        ? null : text(value.expiresAt, 'expiresAt', issues, 40);
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) issues.push('expiresAt must be an ISO timestamp');
    if (expiresAt && occurredAt && Date.parse(expiresAt) <= Date.parse(occurredAt)) {
        issues.push('expiresAt must be later than occurredAt');
    }
    const importance = value.importance ?? 50;
    if (!Number.isInteger(importance) || importance < 0 || importance > 100) {
        issues.push('importance must be an integer from 0 to 100');
    }
    if (!EPISODE_KINDS.has(value.kind)) issues.push('episode kind is invalid');
    if (!EPISODE_SOURCES.has(value.source)) issues.push('episode source is invalid');
    const trust = value.trust ?? 'trusted';
    if (!EPISODE_TRUST.has(trust)) issues.push('episode trust is invalid');
    const result: Required<CreateAgentEpisode> = {
        episodeId: id(value.episodeId, 'episodeId', issues),
        kind: value.kind,
        summary: text(value.summary, 'summary', issues, 500),
        details: text(value.details ?? '', 'details', issues, 2000, true),
        importance,
        goalIds: boundedStringList(value.goalIds ?? [], 'goalIds', issues, 8)
            .map((goalId, index) => id(goalId, `goalIds[${index}]`, issues)),
        actors: boundedStringList(value.actors ?? [], 'actors', issues, 12),
        tags: boundedStringList(value.tags ?? [], 'tags', issues, 12)
            .map(tag => tag.toLocaleLowerCase('en-US')),
        source: value.source,
        trust,
        externalKey: value.externalKey === null || value.externalKey === undefined
            ? null : text(value.externalKey, 'externalKey', issues, 160),
        occurredAt,
        expiresAt
    };
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}

export function validateCreateKnowledge(value: CreateAgentKnowledge): Required<CreateAgentKnowledge> {
    const issues: string[] = [];
    if (!KNOWLEDGE_KINDS.has(value.kind)) issues.push('knowledge kind is invalid');
    if (!KNOWLEDGE_SOURCES.has(value.source)) issues.push('knowledge source is invalid');
    const confidence = value.confidence ?? 50;
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
        issues.push('confidence must be an integer from 0 to 100');
    }
    const validFrom = text(value.validFrom, 'validFrom', issues, 40);
    if (validFrom && Number.isNaN(Date.parse(validFrom))) issues.push('validFrom must be an ISO timestamp');
    const validUntil = value.validUntil === null || value.validUntil === undefined
        ? null : text(value.validUntil, 'validUntil', issues, 40);
    if (validUntil && Number.isNaN(Date.parse(validUntil))) issues.push('validUntil must be an ISO timestamp');
    if (validUntil && validFrom && Date.parse(validUntil) <= Date.parse(validFrom)) {
        issues.push('validUntil must be later than validFrom');
    }
    const result: Required<CreateAgentKnowledge> = {
        knowledgeId: id(value.knowledgeId, 'knowledgeId', issues),
        kind: value.kind,
        subject: text(value.subject, 'subject', issues, 200),
        predicate: text(value.predicate, 'predicate', issues, 100),
        object: text(value.object, 'object', issues, 500),
        summary: text(value.summary, 'summary', issues, 800),
        confidence,
        goalIds: boundedStringList(value.goalIds ?? [], 'goalIds', issues, 8)
            .map((goalId, index) => id(goalId, `goalIds[${index}]`, issues)),
        tags: boundedStringList(value.tags ?? [], 'tags', issues, 12)
            .map(tag => tag.toLocaleLowerCase('en-US')),
        evidenceEpisodeIds: boundedStringList(value.evidenceEpisodeIds ?? [], 'evidenceEpisodeIds', issues, 20)
            .map((episodeId, index) => id(episodeId, `evidenceEpisodeIds[${index}]`, issues)),
        source: value.source,
        supersedesId: value.supersedesId === null || value.supersedesId === undefined
            ? null : id(value.supersedesId, 'supersedesId', issues),
        externalKey: value.externalKey === null || value.externalKey === undefined
            ? null : text(value.externalKey, 'externalKey', issues, 160),
        validFrom,
        validUntil
    };
    if (result.supersedesId === result.knowledgeId) issues.push('knowledge cannot supersede itself');
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
}
