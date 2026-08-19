import {
    SKILL_SCHEMA_VERSION,
    type SkillArguments,
    type SkillConditionName,
    type SkillDefinition,
    type SkillOperationName,
    type SkillParameterDefinition,
    type SkillStep,
    type SkillValue
} from './types';

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const OPERATION_NAMES = new Set<SkillOperationName>([
    'walk-to', 'interact-loc', 'interact-npc', 'gather-loc', 'gather-npc', 'open-bank', 'deposit-item',
    'withdraw-item', 'close-bank', 'wait-ticks'
]);
const CONDITION_NAMES = new Set<SkillConditionName>([
    'inventory-full', 'inventory-contains', 'inventory-free-slots-at-most',
    'skill-level-at-least'
]);
const OPERATION_ARGUMENTS: Record<SkillOperationName, { allowed: string[]; required: string[] }> = {
    'walk-to': { allowed: ['x', 'z', 'tolerance'], required: ['x', 'z'] },
    'interact-loc': { allowed: ['name', 'match', 'option'], required: ['name'] },
    'interact-npc': { allowed: ['name', 'match', 'option'], required: ['name'] },
    'gather-loc': { allowed: ['name', 'match', 'option', 'item', 'skill', 'timeoutMs'], required: ['name', 'item'] },
    'gather-npc': { allowed: ['name', 'match', 'option', 'item', 'skill', 'timeoutMs'], required: ['name', 'item'] },
    'open-bank': { allowed: ['timeoutMs'], required: [] },
    'deposit-item': { allowed: ['name', 'match', 'amount'], required: ['name'] },
    'withdraw-item': { allowed: ['name', 'match', 'amount', 'asNote'], required: ['name'] },
    'close-bank': { allowed: [], required: [] },
    'wait-ticks': { allowed: ['ticks'], required: ['ticks'] }
};
const CONDITION_ARGUMENTS: Record<SkillConditionName, { allowed: string[]; required: string[] }> = {
    'inventory-full': { allowed: [], required: [] },
    'inventory-contains': { allowed: ['name', 'match', 'amount'], required: ['name'] },
    'inventory-free-slots-at-most': { allowed: ['slots'], required: ['slots'] },
    'skill-level-at-least': { allowed: ['skill', 'level'], required: ['skill', 'level'] }
};

export class SkillValidationError extends Error {
    constructor(public readonly issues: string[]) {
        super(`Invalid skill definition:\n- ${issues.join('\n- ')}`);
        this.name = 'SkillValidationError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, path: string, issues: string[], max: number): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) {
        issues.push(`${path} must be a non-empty string of at most ${max} characters`);
        return false;
    }
    return true;
}

function validateParameterReference(value: Record<string, unknown>, parameters: Record<string, SkillParameterDefinition>, path: string, issues: string[]): boolean {
    if (Object.keys(value).length !== 1 || typeof value.parameter !== 'string') return false;
    if (!parameters[value.parameter]) issues.push(`${path} references unknown parameter "${value.parameter}"`);
    return true;
}

function validateValue(value: unknown, parameters: Record<string, SkillParameterDefinition>, path: string, issues: string[], depth = 0): value is SkillValue {
    if (depth > 5) {
        issues.push(`${path} exceeds the maximum value nesting depth`);
        return false;
    }
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) issues.push(`${path} must be finite`);
        return Number.isFinite(value);
    }
    if (typeof value === 'string') return boundedString(value, path, issues, 200);
    if (Array.isArray(value)) {
        if (value.length > 50) issues.push(`${path} has too many entries`);
        return value.every((entry, index) => validateValue(entry, parameters, `${path}[${index}]`, issues, depth + 1));
    }
    if (isRecord(value)) {
        if (validateParameterReference(value, parameters, path, issues)) return true;
        const entries = Object.entries(value);
        if (entries.length > 30) issues.push(`${path} has too many fields`);
        return entries.every(([key, entry]) => boundedString(key, `${path} key`, issues, 80)
            && validateValue(entry, parameters, `${path}.${key}`, issues, depth + 1));
    }
    issues.push(`${path} contains an unsupported value`);
    return false;
}

function validateArguments(value: unknown, parameters: Record<string, SkillParameterDefinition>, path: string, issues: string[]): value is SkillArguments {
    if (!isRecord(value)) {
        issues.push(`${path} must be an object`);
        return false;
    }
    return Object.entries(value).every(([key, entry]) => boundedString(key, `${path} key`, issues, 80)
        && validateValue(entry, parameters, `${path}.${key}`, issues));
}

function validateArgumentShape(value: unknown, shape: { allowed: string[]; required: string[] }, path: string, issues: string[]): void {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) if (!shape.allowed.includes(key)) issues.push(`${path}.${key} is not allowed`);
    for (const key of shape.required) if (!(key in value)) issues.push(`${path}.${key} is required`);
}

function validateParameter(name: string, value: unknown, issues: string[]): value is SkillParameterDefinition {
    const path = `parameters.${name}`;
    if (!ID_PATTERN.test(name)) issues.push(`${path} has an invalid name`);
    if (!isRecord(value)) {
        issues.push(`${path} must be an object`);
        return false;
    }
    if (!['string', 'number', 'boolean'].includes(String(value.type))) issues.push(`${path}.type is invalid`);
    boundedString(value.description, `${path}.description`, issues, 300);
    if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 30)) {
        issues.push(`${path}.enum must contain 1-30 values`);
    }
    if (value.minimum !== undefined && typeof value.minimum !== 'number') issues.push(`${path}.minimum must be a number`);
    if (value.maximum !== undefined && typeof value.maximum !== 'number') issues.push(`${path}.maximum must be a number`);
    if (value.default !== undefined && typeof value.default !== value.type) issues.push(`${path}.default must match its declared type`);
    if (Array.isArray(value.enum) && value.enum.some(entry => typeof entry !== value.type)) issues.push(`${path}.enum values must match the declared type`);
    if (value.type !== 'number' && (value.minimum !== undefined || value.maximum !== undefined)) issues.push(`${path} may only use minimum/maximum for numbers`);
    if (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum) issues.push(`${path}.minimum cannot exceed maximum`);
    return true;
}

function validateStep(value: unknown, parameters: Record<string, SkillParameterDefinition>, path: string, issues: string[], depth: number): value is SkillStep {
    if (!isRecord(value)) {
        issues.push(`${path} must be an object`);
        return false;
    }
    boundedString(value.id, `${path}.id`, issues, 80);
    if (value.kind === 'operation') {
        if (!OPERATION_NAMES.has(value.operation as SkillOperationName)) issues.push(`${path}.operation is not allowed`);
        else validateArgumentShape(value.arguments, OPERATION_ARGUMENTS[value.operation as SkillOperationName], `${path}.arguments`, issues);
        validateArguments(value.arguments, parameters, `${path}.arguments`, issues);
        if (value.maxAttempts !== undefined && (!Number.isInteger(value.maxAttempts) || Number(value.maxAttempts) < 1 || Number(value.maxAttempts) > 10)) {
            issues.push(`${path}.maxAttempts must be an integer from 1 to 10`);
        }
        if (value.onFailure !== undefined && value.onFailure !== 'stop' && value.onFailure !== 'continue') issues.push(`${path}.onFailure is invalid`);
        return true;
    }
    if (value.kind === 'repeat') {
        if (depth >= 3) issues.push(`${path} exceeds the maximum repeat nesting depth`);
        if (!Number.isInteger(value.maxIterations) || Number(value.maxIterations) < 1 || Number(value.maxIterations) > 100) {
            issues.push(`${path}.maxIterations must be an integer from 1 to 100`);
        }
        if (!isRecord(value.until) || !CONDITION_NAMES.has(value.until.condition as SkillConditionName)) {
            issues.push(`${path}.until.condition is not allowed`);
        } else {
            validateArguments(value.until.arguments, parameters, `${path}.until.arguments`, issues);
            validateArgumentShape(value.until.arguments, CONDITION_ARGUMENTS[value.until.condition as SkillConditionName], `${path}.until.arguments`, issues);
        }
        if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 50) {
            issues.push(`${path}.steps must contain 1-50 steps`);
        } else {
            value.steps.forEach((step, index) => validateStep(step, parameters, `${path}.steps[${index}]`, issues, depth + 1));
        }
        return true;
    }
    issues.push(`${path}.kind must be operation or repeat`);
    return false;
}

export function validateSkillDefinition(value: unknown): SkillDefinition {
    const issues: string[] = [];
    if (!isRecord(value)) throw new SkillValidationError(['skill must be an object']);
    if (value.schemaVersion !== SKILL_SCHEMA_VERSION) issues.push(`schemaVersion must be ${SKILL_SCHEMA_VERSION}`);
    if (!boundedString(value.id, 'id', issues, 64) || !ID_PATTERN.test(value.id)) issues.push('id must be a lowercase dotted or dashed identifier');
    if (typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) issues.push('version must use MAJOR.MINOR.PATCH');
    boundedString(value.name, 'name', issues, 100);
    boundedString(value.description, 'description', issues, 1000);
    if (!['draft', 'verified', 'deprecated'].includes(String(value.status))) issues.push('status is invalid');
    if (!Array.isArray(value.tags) || value.tags.length > 20 || value.tags.some(tag => typeof tag !== 'string' || !ID_PATTERN.test(tag))) issues.push('tags must be at most 20 lowercase identifiers');

    const parameters: Record<string, SkillParameterDefinition> = {};
    if (!isRecord(value.parameters) || Object.keys(value.parameters).length > 30) {
        issues.push('parameters must be an object with at most 30 entries');
    } else {
        for (const [name, parameter] of Object.entries(value.parameters)) {
            if (validateParameter(name, parameter, issues)) parameters[name] = parameter;
        }
    }

    if (!isRecord(value.provenance)) issues.push('provenance must be an object');
    else {
        if (!['human', 'agent', 'system'].includes(String(value.provenance.authorKind))) issues.push('provenance.authorKind is invalid');
        boundedString(value.provenance.authorId, 'provenance.authorId', issues, 100);
        if (typeof value.provenance.authorId === 'string' && !/^[A-Za-z0-9._-]+$/.test(value.provenance.authorId)) issues.push('provenance.authorId contains unsupported characters');
        if (typeof value.provenance.createdAt !== 'string' || Number.isNaN(Date.parse(value.provenance.createdAt))) issues.push('provenance.createdAt must be an ISO timestamp');
    }
    if (!isRecord(value.sharing) || !['shared', 'private'].includes(String(value.sharing.visibility))) issues.push('sharing.visibility is invalid');
    else if (value.sharing.visibility === 'private' && !boundedString(value.sharing.ownerAgentId, 'sharing.ownerAgentId', issues, 100)) {
        issues.push('private skills require sharing.ownerAgentId');
    } else if (typeof value.sharing.ownerAgentId === 'string' && !/^[A-Za-z0-9._-]+$/.test(value.sharing.ownerAgentId)) {
        issues.push('sharing.ownerAgentId contains unsupported characters');
    }
    if (!isRecord(value.limits)) issues.push('limits must be an object');
    else {
        if (!Number.isInteger(value.limits.timeoutMs) || Number(value.limits.timeoutMs) < 1000 || Number(value.limits.timeoutMs) > 900_000) issues.push('limits.timeoutMs must be 1000-900000');
        if (!Number.isInteger(value.limits.maxOperations) || Number(value.limits.maxOperations) < 1 || Number(value.limits.maxOperations) > 1000) issues.push('limits.maxOperations must be 1-1000');
    }
    if (!Array.isArray(value.preconditions) || value.preconditions.length > 20) issues.push('preconditions must contain at most 20 conditions');
    else value.preconditions.forEach((condition, index) => {
        if (!isRecord(condition) || !CONDITION_NAMES.has(condition.condition as SkillConditionName)) {
            issues.push(`preconditions[${index}].condition is not allowed`);
        } else {
            validateArguments(condition.arguments, parameters, `preconditions[${index}].arguments`, issues);
            validateArgumentShape(condition.arguments, CONDITION_ARGUMENTS[condition.condition as SkillConditionName], `preconditions[${index}].arguments`, issues);
        }
    });
    if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 100) issues.push('steps must contain 1-100 steps');
    else value.steps.forEach((step, index) => validateStep(step, parameters, `steps[${index}]`, issues, 0));

    if (issues.length > 0) throw new SkillValidationError([...new Set(issues)]);
    return value as unknown as SkillDefinition;
}

export function resolveSkillParameters(definition: SkillDefinition, supplied: Record<string, unknown> = {}): Record<string, string | number | boolean> {
    const issues: string[] = [];
    const resolved: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(supplied)) if (!definition.parameters[key]) issues.push(`unknown parameter "${key}"`);
    for (const [name, spec] of Object.entries(definition.parameters)) {
        const value = supplied[name] ?? spec.default;
        if (value === undefined) {
            if (spec.required) issues.push(`missing required parameter "${name}"`);
            continue;
        }
        if (typeof value !== spec.type) issues.push(`parameter "${name}" must be ${spec.type}`);
        else if (spec.enum && !spec.enum.includes(value as never)) issues.push(`parameter "${name}" is not in its allowed values`);
        else if (typeof value === 'number' && spec.minimum !== undefined && value < spec.minimum) issues.push(`parameter "${name}" is below its minimum`);
        else if (typeof value === 'number' && spec.maximum !== undefined && value > spec.maximum) issues.push(`parameter "${name}" is above its maximum`);
        else resolved[name] = value as string | number | boolean;
    }
    if (issues.length > 0) throw new SkillValidationError(issues);
    return resolved;
}
