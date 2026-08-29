import type { CreateAgentGoal, CreateAgentIdentity, GoalHorizon, SetAgentWorkingMemory,
    UpdateAgentIdentity } from './types.js';

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PLAYER_PATTERN = /^[a-z0-9 _-]+$/;
const HORIZONS = new Set<GoalHorizon>(['life', 'long-term', 'current', 'immediate']);

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
        priority
    };
    if (horizon === 'life' && result.parentGoalId !== null) issues.push('a life goal cannot have a parent');
    if (horizon !== 'life' && result.parentGoalId === null) issues.push(`${horizon} goals require a parent`);
    if (issues.length) throw new AgentStateValidationError(issues);
    return result;
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
