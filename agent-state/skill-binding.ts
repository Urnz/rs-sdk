import { createHash } from 'node:crypto';
import type { AgentSkillParameterBinding, AgentSkillParameterSourceKind } from './types.js';

const SOURCE_KINDS = new Set<AgentSkillParameterSourceKind>([
    'goal', 'work-order', 'contract-obligation', 'approved-policy', 'llm-suggestion'
]);
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const SOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

export function canonicalSkillParameters(value: unknown): Record<string, string | number | boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Skill parameters must be an object');
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 20) throw new Error('Skill parameters may contain at most 20 entries');
    const output: Record<string, string | number | boolean> = {};
    for (const [key, parameter] of entries.sort(([left], [right]) => left.localeCompare(right))) {
        if (!KEY_PATTERN.test(key)) throw new Error(`Invalid skill parameter name: ${key}`);
        if (typeof parameter !== 'string' && typeof parameter !== 'number' && typeof parameter !== 'boolean') {
            throw new Error(`Invalid skill parameter value: ${key}`);
        }
        if (typeof parameter === 'string' && parameter.length > 500) {
            throw new Error(`Skill parameter ${key} exceeds 500 characters`);
        }
        if (typeof parameter === 'number' && !Number.isFinite(parameter)) {
            throw new Error(`Skill parameter ${key} must be finite`);
        }
        output[key] = parameter;
    }
    return output;
}

export function skillParameterDigest(parameters: Record<string, string | number | boolean>): string {
    return createHash('sha256').update(JSON.stringify(canonicalSkillParameters(parameters))).digest('hex');
}

export function createSkillParameterBinding(value: Omit<AgentSkillParameterBinding, 'digest'>): AgentSkillParameterBinding {
    if (!SOURCE_KINDS.has(value.sourceKind)) throw new Error('Unsupported skill parameter source');
    if (!SOURCE_ID_PATTERN.test(value.sourceId)) throw new Error('Invalid skill parameter source ID');
    const parameters = canonicalSkillParameters(value.parameters);
    return { sourceKind: value.sourceKind, sourceId: value.sourceId, parameters,
        digest: skillParameterDigest(parameters) };
}
